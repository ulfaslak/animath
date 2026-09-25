import {
	Rng,
	applyBattleIntent,
	getAnimal,
	hashInts,
	hashString,
	isWalkable,
	rollEncounter,
	spawnPoint,
	startBattle,
	step,
	tileAtWorld,
	type AnimalInstance,
	type Authority,
	type BattleEvent,
	type BattleIntent,
	type BattleState,
	type Direction,
	type GameEvent,
	type GridPos,
	type Intent
} from '@mathgame/engine';

/** A party holds at most this many animals; a catch beyond it is let go. */
const PARTY_LIMIT = 6;

/**
 * Salts keep the per-step encounter roll and the battle seed apart from each
 * other and from world generation, which also hashes the world seed.
 */
const ENCOUNTER_SALT = hashString('encounter');
const BATTLE_SALT = hashString('battle');

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
	private party: AnimalInstance[] = [];
	/** Completed steps this session. Keys the encounter roll and the battle seed. */
	private steps = 0;
	/** The battle in progress, with the seed every intent of it is applied with. */
	private battle: { state: BattleState; seed: number } | null = null;

	start(): void {
		this.spawn = spawnPoint(this.seed);
		this.pos = this.spawn;
		this.party = [{ id: 'starter', speciesId: 'squirrel', hp: 20 }];
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
		switch (intent.type) {
			case 'move':
				this.move(intent.dir);
				break;
			case 'interact':
				this.emit({ type: 'message', text: 'Nothing here yet.' });
				break;
			case 'battle':
				// No battle to act in; the client is showing a result card or is stale.
				break;
		}
	}

	subscribe(listener: (e: GameEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	// --- explore -----------------------------------------------------------

	private move(dir: Direction): void {
		const next = step(this.pos, dir);
		const tile = tileAtWorld(this.seed, next.x, next.y);
		if (!isWalkable(tile.kind)) {
			this.emit({ type: 'player-blocked', playerId: this.playerId, dir });
			return;
		}
		this.pos = next;
		this.steps += 1;
		this.emit({ type: 'player-moved', playerId: this.playerId, pos: next, dir });

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
	 * caught animal joins the party if there is room, and a lost battle heals
	 * everyone and puts the player back on the spawn tile. (That last one is a
	 * placeholder for the nearest doctor's tent, which lands with the doctor.)
	 */
	private endBattle(state: BattleState, events: readonly BattleEvent[]): void {
		if (state.phase.kind !== 'ended') return;
		this.party = state.party.map((a) => ({ ...a }));
		const wildName = getAnimal(state.opponent.speciesId).name;
		let text: string;
		switch (state.phase.outcome) {
			case 'won':
				text = `The wild ${wildName} runs home to rest.`;
				break;
			case 'fled':
				text = `The wild ${wildName} stays in the grass.`;
				break;
			case 'caught': {
				const ended = events.find((e) => e.type === 'ended');
				const caught = ended?.type === 'ended' ? ended.caught : undefined;
				if (caught && this.party.length < PARTY_LIMIT) {
					this.party.push({ ...caught });
					text = `${wildName} joins your team!`;
				} else {
					text = `Your team is full, so ${wildName} goes back into the grass.`;
				}
				break;
			}
			case 'lost':
				this.party = this.party.map((a) => ({ ...a, hp: getAnimal(a.speciesId).maxHp }));
				this.pos = this.spawn;
				text = 'Everyone is tired. You rest and feel better.';
				break;
		}
		this.emit({ type: 'battle-ended', state });
		this.emit({ type: 'party-changed', party: this.partyCopy() });
		if (state.phase.outcome === 'lost') {
			this.emit({ type: 'player-placed', playerId: this.playerId, pos: this.pos });
		}
		this.emit({ type: 'message', text });
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
