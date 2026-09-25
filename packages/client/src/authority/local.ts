import {
	MAX_PARTY,
	Rng,
	applyBattleIntent,
	applyDoctorIntent,
	applyPartyIntent,
	canTalkToDoctor,
	getAnimal,
	hashInts,
	hashString,
	isWalkable,
	leadIndex,
	newGame,
	normalizeNickname,
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
	type PartyIntent,
	type PlayerActivity,
	type Rescue,
	type SavedGame
} from '@mathgame/engine';

/** The prototype world. Every new game is played in it; a save carries its own seed. */
export const WORLD_SEED = hashString('prototype');

/**
 * Salts keep the per-step encounter roll, the battle seed and the doctor's
 * seed apart from each other and from world generation, which also hashes the
 * world seed.
 */
const ENCOUNTER_SALT = hashString('encounter');
const BATTLE_SALT = hashString('battle');
const DOCTOR_SALT = hashString('doctor');

export interface LocalAuthorityOptions {
	/**
	 * Start with this party instead of the one squirrel: the `?party=` URL
	 * switch, for looking at screens that need a bigger or hurt party. Every
	 * animal must be valid (a catalog species, HP in `0..maxHp`, unique ids);
	 * at most `MAX_PARTY`. Nicknames are cleaned on the way in, like a rename.
	 */
	party?: readonly AnimalInstance[];
}

/** How a session begins: a saved game to pick up, or a new game when absent. */
export interface StartOptions {
	game?: SavedGame;
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
 *
 * The whole game fits in a `SavedGame`: `snapshot()` takes one at any moment,
 * a battle included, and `start({ game })` picks it up again, so a save
 * continues the same step count, and a battle the same intents, as if the
 * page had never reloaded.
 */
export class LocalAuthority implements Authority {
	private listeners = new Set<(e: GameEvent) => void>();
	private readonly playerId = 'local';
	private seed = WORLD_SEED;
	private spawn: GridPos = { x: 0, y: 0 };
	private pos: GridPos = { x: 0, y: 0 };
	/**
	 * The way the player faces, as the client shows it: `down` in a new game
	 * (the saved facing in a restored one), then the direction of every
	 * move, walked or blocked, and the direction of `taken-to-doctor`.
	 * `interact` talks to a doctor only when this faces a tent.
	 */
	private facing: Direction = 'down';
	private party: AnimalInstance[] = [];
	/** Completed steps in this game, saved with it. Keys the encounter roll and the battle and doctor seeds. */
	private steps = 0;
	/** Doctor visits opened in this game, saved with it, so a later visit at the same step asks new puzzles. */
	private visits = 0;
	/** The battle in progress, with the seed every intent of it is applied with. */
	private battle: { state: BattleState; seed: number } | null = null;
	/** Intents before `start` have no game to act on. */
	private started = false;
	/**
	 * The doctor visit in progress: its number (every event of it carries
	 * that) and its seed, which like the battle's never leaves here. Not
	 * saved: a reload closes the visit, and what it healed is in the party.
	 */
	private doctor: { visit: number; state: DoctorState; seed: number } | null = null;

	constructor(private readonly options: LocalAuthorityOptions = {}) {}

	/**
	 * Begin a game: a new one, or `options.game` from a save. Emits `welcome`,
	 * then `battle-started` if the save was taken mid-battle.
	 */
	start(options: StartOptions = {}): void {
		const game = options.game ?? this.newGame();
		this.seed = game.seed;
		this.spawn = spawnPoint(this.seed);
		this.pos = { x: game.pos.x, y: game.pos.y };
		this.facing = game.facing;
		this.steps = game.steps;
		this.visits = game.visits;
		// A party from outside (`?party=`, a save) enters through the engine's
		// name cleaning, like a rename: the party only ever holds cleaned
		// nicknames, so every screen can show one as stored.
		this.party = game.party.map(withCleanNickname);
		this.battle = null;
		this.doctor = null;
		this.started = true;
		this.emit({
			type: 'welcome',
			playerId: this.playerId,
			seed: this.seed,
			pos: { ...this.pos },
			facing: this.facing,
			party: this.partyCopy()
		});
		if (game.battle) {
			// The battle's seed is the one it started with: the steps have not moved since.
			this.battle = { state: game.battle, seed: this.battleSeed() };
			this.emit({ type: 'battle-started', state: game.battle });
		}
	}

	/**
	 * The game as it stands, for a save. Mid-battle the party is the battle's,
	 * HP as it is now, and the battle comes too (its state, never its seed).
	 * A doctor visit is not saved; what it healed already is in the party.
	 */
	snapshot(): SavedGame {
		const party = this.battle ? this.battle.state.party : this.party;
		return {
			seed: this.seed,
			pos: { ...this.pos },
			facing: this.facing,
			steps: this.steps,
			visits: this.visits,
			party: party.map((a) => ({ ...a })),
			battle: this.battle ? this.battle.state : null
		};
	}

	/**
	 * Another tab of this game walked further, and the save this page carries
	 * on from has its counts: raise this page's to them, so its next
	 * encounters and doctor puzzles follow on instead of repeating. Never
	 * lowers a count, and leaves a battle or visit in progress alone (their
	 * seeds are fixed already).
	 */
	catchUp(counts: { steps: number; visits: number }): void {
		if (this.battle || this.doctor) return;
		this.steps = Math.max(this.steps, counts.steps);
		this.visits = Math.max(this.visits, counts.visits);
	}

	/** A new game in the prototype world, with the `?party=` party when there is one. */
	private newGame(): SavedGame {
		const game = newGame(WORLD_SEED);
		// An empty `?party=` is no party: the starter, as without one.
		return this.options.party?.length
			? { ...game, party: this.options.party.map((a) => ({ ...a })) }
			: game;
	}

	dispatch(intent: Intent): void {
		if (!this.started) return;
		if (intent.type === 'party') {
			// In any mode: the engine is told what the player is doing and refuses
			// an edit outside explore itself.
			this.editParty(intent.intent);
			return;
		}
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

		// The lead (the engine's `leadIndex`: the first animal that isn't tired)
		// is the one `startBattle` sends out first, and the one wild animals size
		// up before they come out, so choosing a lead changes what the grass
		// holds. A party with nobody standing can't battle (`startBattle` refuses
		// it). Losing takes everyone to the doctor, so only a `?party=` of tired
		// animals walks here; it meets nothing until the doctor has helped.
		const lead = this.party[leadIndex(this.party)];
		if (!lead) return;
		// One roll per completed step, keyed by the step count so a replayed
		// walk meets the same animals; the engine only draws on tall grass.
		const rng = new Rng(hashInts(this.seed, ENCOUNTER_SALT, this.steps));
		const site = { tile, pos: next, spawn: this.spawn };
		const wild = rollEncounter(rng, site, getAnimal(lead.speciesId).tier);
		if (wild) this.beginBattle({ ...wild, id: mintId() });
	}

	// --- battle ------------------------------------------------------------

	private beginBattle(wild: AnimalInstance): void {
		const state = startBattle(this.party, wild);
		this.battle = { state, seed: this.battleSeed() };
		this.emit({ type: 'battle-started', state });
	}

	/** The seed of a battle that starts on the current step. */
	private battleSeed(): number {
		return hashInts(this.seed, BATTLE_SALT, this.steps);
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

	/**
	 * Enter/Space: talk to the doctor when facing a tent. Anywhere else there
	 * is nothing to talk to, and the event says so without words: the client
	 * says how to find a doctor, in the player's language.
	 */
	private interact(): void {
		if (!canTalkToDoctor(this.seed, this.pos, this.facing)) {
			this.emit({ type: 'nothing-to-interact', playerId: this.playerId });
			return;
		}
		this.visits += 1;
		const state = startDoctorVisit(this.party);
		// A fresh seed per visit, keyed like everything else here so a session
		// replays; the visit count keeps a second visit from asking the same
		// puzzles, and tells the visits apart in their events.
		this.doctor = {
			visit: this.visits,
			state,
			seed: hashInts(this.seed, DOCTOR_SALT, this.steps, this.visits)
		};
		this.emit({ type: 'doctor-visit-started', visit: this.visits, state });
	}

	/**
	 * Apply one doctor intent. A heal is written back at once (the kid earned
	 * it, whatever happens to the visit after); leaving ends the visit, and
	 * the client says the doctor's goodbye.
	 */
	private applyDoctor(intent: DoctorIntent): void {
		const doctor = this.doctor!;
		const { visit } = doctor;
		const { state, events } = applyDoctorIntent(doctor.state, intent, doctor.seed);
		doctor.state = state;
		this.emit({ type: 'doctor-visit-updated', visit, state, events });
		if (events.some((e) => e.type === 'healed')) {
			this.party = state.party.map((a) => ({ ...a }));
			this.emit({ type: 'party-changed', party: this.partyCopy() });
		}
		if (state.phase.kind !== 'ended') return;
		this.doctor = null;
		this.emit({ type: 'doctor-visit-ended', visit, state });
	}

	// --- party ---------------------------------------------------------------

	/**
	 * Apply a party intent and say what happened: the facts only. The client
	 * words them (the message line's notice about the lead), in the language
	 * on screen.
	 */
	private editParty(intent: PartyIntent): void {
		const { party, events } = applyPartyIntent(this.party, intent, this.activity());
		this.party = party.map((a) => ({ ...a }));
		this.emit({ type: 'party-edited', party: this.partyCopy(), events });
	}

	/** What the player is doing, for the engine's rules that depend on it. */
	private activity(): PlayerActivity {
		return this.battle ? 'battle' : this.doctor ? 'doctor' : 'explore';
	}

	// --- helpers -----------------------------------------------------------

	private partyCopy(): AnimalInstance[] {
		return this.party.map((a) => ({ ...a }));
	}

	private emit(event: GameEvent): void {
		for (const l of this.listeners) l(event);
	}
}

/** A copy of the animal with its nickname cleaned, and no `nickname` key when none is left. */
function withCleanNickname(animal: AnimalInstance): AnimalInstance {
	const { nickname, ...rest } = animal;
	const clean = normalizeNickname(nickname);
	return clean === undefined ? rest : { ...rest, nickname: clean };
}

/**
 * A fresh instance id. `crypto.randomUUID` needs a secure context, which a
 * LAN address over plain http is not, so fall back to random bytes there.
 */
export function mintId(): string {
	const c = globalThis.crypto;
	if (typeof c.randomUUID === 'function') return c.randomUUID();
	const bytes = c.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
