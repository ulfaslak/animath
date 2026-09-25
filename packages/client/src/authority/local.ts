import {
	MAX_PARTY,
	Rng,
	applyBattleIntent,
	applyDoctorIntent,
	canTalkToDoctor,
	getAnimal,
	hashInts,
	hashString,
	isWalkable,
	rollEncounter,
	spawnPoint,
	startBattle,
	startDoctorVisit,
	step,
	takeToDoctor,
	tileAtWorld,
	type AnimalInstance,
	type Authority,
	type BattleEvent,
	type BattleIntent,
	type BattleState,
	type Direction,
	type DoctorIntent,
	type DoctorState,
	type GameEvent,
	type GridPos,
	type Intent,
	type Rescue
} from '@mathgame/engine';

/**
 * Salts keep the per-step encounter roll, the battle seed and the doctor's
 * seed apart from each other and from world generation, which also hashes the
 * world seed.
 */
const ENCOUNTER_SALT = hashString('encounter');
const BATTLE_SALT = hashString('battle');
const DOCTOR_SALT = hashString('doctor');

/** What `interact` says when the player is not facing a doctor's tent. */
export const NOT_AT_A_TENT = 'Walk up to a tent to talk to the doctor.';

export interface LocalAuthorityOptions {
	/**
	 * Start with this party instead of the one squirrel: the `?party=` URL
	 * switch, for looking at screens that need a bigger or hurt party. Every
	 * animal must be valid (a catalog species, HP in `0..maxHp`, unique ids);
	 * at most `MAX_PARTY`.
	 */
	party?: readonly AnimalInstance[];
}

/**
 * Single-player authority: applies the rules in-process and emits events.
 *
 * This is the seam multiplayer will replace. A `RemoteAuthority` with the same
 * interface will forward intents over a WebSocket and relay the server's
 * events; nothing above this class needs to know which one it is talking to.
 * So: keep game rules in the engine, keep this class thin, and never let the
 * renderer or UI reach past it.
 *
 * Everything random here is seeded from the world seed and the number of
 * completed steps, so a session replays from `(seed, intents)` and a server
 * running the same code would agree with it. The one exception is the id an
 * animal gets when it is caught, which must be unique across sessions and is
 * therefore minted, not derived.
 */
export class LocalAuthority implements Authority {
	private listeners = new Set<(e: GameEvent) => void>();
	private readonly playerId = 'local';
	private readonly seed = hashString('prototype');
	private spawn: GridPos = { x: 0, y: 0 };
	private pos: GridPos = { x: 0, y: 0 };
	/**
	 * The way the player faces, as the client shows it: down from `welcome`
	 * until the first `move`, then the direction of every move, walked or
	 * blocked, and the direction of `taken-to-doctor`. `interact` talks to a
	 * doctor only when this faces a tent.
	 */
	private facing: Direction = 'down';
	private party: AnimalInstance[] = [];
	/** Completed steps this session. Keys the encounter roll and the battle and doctor seeds. */
	private steps = 0;
	/** Doctor visits opened this session, so a second visit at the same step asks new puzzles. */
	private visits = 0;
	/** The battle in progress, with the seed every intent of it is applied with. */
	private battle: { state: BattleState; seed: number } | null = null;
	/** The doctor visit in progress, with its seed; like the battle's, it never leaves here. */
	private doctor: { state: DoctorState; seed: number } | null = null;

	constructor(private readonly options: LocalAuthorityOptions = {}) {}

	start(): void {
		this.spawn = spawnPoint(this.seed);
		this.pos = this.spawn;
		this.facing = 'down';
		this.party = this.options.party
			? this.options.party.map((a) => ({ ...a }))
			: [{ id: 'starter', speciesId: 'squirrel', hp: 20 }];
		this.emit({
			type: 'welcome',
			playerId: this.playerId,
			seed: this.seed,
			pos: this.pos,
			party: this.partyCopy()
		});
	}

	dispatch(intent: Intent): void {
		if (this.battle) {
			// Mid-battle there is no walking and no talking; only battle intents count.
			if (intent.type === 'battle') this.applyBattle(intent.intent);
			return;
		}
		if (this.doctor) {
			// At the doctor, walking waits until the visit ends; only doctor intents count.
			if (intent.type === 'doctor') this.applyDoctor(intent.intent);
			return;
		}
		switch (intent.type) {
			case 'move':
				this.move(intent.dir);
				break;
			case 'interact':
				this.interact();
				break;
			case 'battle':
			case 'doctor':
				// Nothing to act in; the client is showing a result card or is stale.
				break;
		}
	}

	subscribe(listener: (e: GameEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	// --- explore -----------------------------------------------------------

	private move(dir: Direction): void {
		// Walked or blocked, the player turns to face the way they tried to go.
		this.facing = dir;
		const next = step(this.pos, dir);
		const tile = tileAtWorld(this.seed, next.x, next.y);
		if (!isWalkable(tile.kind)) {
			this.emit({ type: 'player-blocked', playerId: this.playerId, dir });
			return;
		}
		this.pos = next;
		this.steps += 1;
		this.emit({ type: 'player-moved', playerId: this.playerId, pos: next, dir });

		// A party with nobody standing can't battle (`startBattle` refuses it).
		// Losing takes everyone to the doctor, so only a `?party=` of tired
		// animals walks here; it meets nothing until the doctor has helped.
		if (!this.party.some((a) => a.hp > 0)) return;
		// One roll per completed step, keyed by the step count so a replayed
		// walk meets the same animals; the engine only draws on tall grass.
		const rng = new Rng(hashInts(this.seed, ENCOUNTER_SALT, this.steps));
		const wild = rollEncounter(rng, { tile, pos: next, spawn: this.spawn });
		if (wild) this.beginBattle({ ...wild, id: mintId() });
	}

	// --- battle ------------------------------------------------------------

	private beginBattle(wild: AnimalInstance): void {
		const state = startBattle(this.party, wild);
		this.battle = { state, seed: hashInts(this.seed, BATTLE_SALT, this.steps) };
		this.emit({ type: 'battle-started', state });
	}

	private applyBattle(intent: BattleIntent): void {
		const battle = this.battle!;
		const { state, events } = applyBattleIntent(battle.state, intent, battle.seed);
		battle.state = state;
		this.emit({ type: 'battle-updated', state, events });
		if (state.phase.kind !== 'ended') return;
		this.battle = null;
		this.endBattle(state, events);
	}

	/**
	 * Write the battle's result back into the world: HP lost stays lost, a
	 * caught animal joins the party if there is room, and a lost battle takes
	 * the player to the nearest doctor's tent, where the whole party is healed
	 * (the engine's knock-out rule, `takeToDoctor`). That one has no `message`:
	 * the client words the doctor's line from `taken-to-doctor`.
	 */
	private endBattle(state: BattleState, events: readonly BattleEvent[]): void {
		if (state.phase.kind !== 'ended') return;
		this.party = state.party.map((a) => ({ ...a }));
		const wildName = getAnimal(state.opponent.speciesId).name;
		let rescue: Rescue | null = null;
		let text: string | null = null;
		switch (state.phase.outcome) {
			case 'won':
				text = `The wild ${wildName} runs home to rest.`;
				break;
			case 'fled':
				text = `The wild ${wildName} stays in the grass.`;
				break;
			case 'caught': {
				// The reducer always reports the caught animal on `ended`.
				const ended = events.find((e) => e.type === 'ended');
				const caught = ended?.type === 'ended' ? ended.caught : undefined;
				if (caught && this.party.length >= MAX_PARTY) {
					text = `Your team is full, so ${wildName} goes back into the grass.`;
				} else {
					if (caught) this.party.push({ ...caught });
					text = `${wildName} joins your team!`;
				}
				break;
			}
			case 'lost':
				// Every animal is tired: off to the nearest tent on foot, facing it.
				rescue = takeToDoctor(this.seed, this.pos, this.party);
				this.party = rescue.party;
				this.pos = rescue.pos;
				this.facing = rescue.facing;
				break;
		}
		this.emit({ type: 'battle-ended', state });
		if (rescue) {
			this.emit({
				type: 'taken-to-doctor',
				playerId: this.playerId,
				pos: { ...rescue.pos },
				dir: rescue.facing,
				tent: rescue.tent && { ...rescue.tent },
				party: this.partyCopy()
			});
		} else {
			this.emit({ type: 'party-changed', party: this.partyCopy() });
		}
		if (text !== null) this.emit({ type: 'message', text });
	}

	// --- doctor ------------------------------------------------------------

	/** Enter/Space: talk to the doctor when facing a tent, or say how to find one. */
	private interact(): void {
		if (!canTalkToDoctor(this.seed, this.pos, this.facing)) {
			this.emit({ type: 'message', text: NOT_AT_A_TENT });
			return;
		}
		this.visits += 1;
		const state = startDoctorVisit(this.party);
		// A fresh seed per visit, keyed like everything else here so a session
		// replays; the visit count keeps a second visit from asking the same puzzles.
		this.doctor = { state, seed: hashInts(this.seed, DOCTOR_SALT, this.steps, this.visits) };
		this.emit({ type: 'doctor-visit-started', state });
	}

	/**
	 * Apply one doctor intent. A heal is written back at once (the kid earned
	 * it, whatever happens to the visit after); leaving ends the visit, and
	 * the client says the doctor's goodbye.
	 */
	private applyDoctor(intent: DoctorIntent): void {
		const visit = this.doctor!;
		const { state, events } = applyDoctorIntent(visit.state, intent, visit.seed);
		visit.state = state;
		this.emit({ type: 'doctor-visit-updated', state, events });
		if (events.some((e) => e.type === 'healed')) {
			this.party = state.party.map((a) => ({ ...a }));
			this.emit({ type: 'party-changed', party: this.partyCopy() });
		}
		if (state.phase.kind !== 'ended') return;
		this.doctor = null;
		this.emit({ type: 'doctor-visit-ended', state });
	}

	// --- helpers -----------------------------------------------------------

	private partyCopy(): AnimalInstance[] {
		return this.party.map((a) => ({ ...a }));
	}

	private emit(event: GameEvent): void {
		for (const l of this.listeners) l(event);
	}
}

/**
 * A fresh instance id. `crypto.randomUUID` needs a secure context, which a
 * LAN address over plain http is not, so fall back to random bytes there.
 */
function mintId(): string {
	const c = globalThis.crypto;
	if (typeof c.randomUUID === 'function') return c.randomUUID();
	const bytes = c.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
