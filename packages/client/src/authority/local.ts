import {
	MAX_PARTY,
	Rng,
	applyBattleIntent,
	getAnimal,
	hashInts,
	hashString,
	isWalkable,
	newGame,
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
	type Intent,
	type SavedGame
} from '@mathgame/engine';

/** The prototype world. Every new game is played in it; a save carries its own seed. */
export const WORLD_SEED = hashString('prototype');

/**
 * Salts keep the per-step encounter roll and the battle seed apart from each
 * other and from world generation, which also hashes the world seed.
 */
const ENCOUNTER_SALT = hashString('encounter');
const BATTLE_SALT = hashString('battle');

/** How a session begins: a saved game to pick up (a new game when absent), and a line to say. */
export interface StartOptions {
	game?: SavedGame;
	message?: string;
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
	 * The way the player faces, as the client shows it: `down` in a new game,
	 * then the `dir` of every `move`, walked or blocked.
	 */
	private facing: Direction = 'down';
	private party: AnimalInstance[] = [];
	/** Completed steps in this game, saved with it. Keys the encounter roll and the battle seed. */
	private steps = 0;
	/** The battle in progress, with the seed every intent of it is applied with. */
	private battle: { state: BattleState; seed: number } | null = null;
	/** Intents before `start` have no game to act on. */
	private started = false;

	/**
	 * Begin a game: a new one, or `options.game` from a save. Emits `welcome`,
	 * then `battle-started` if the save was taken mid-battle, then the message.
	 */
	start(options: StartOptions = {}): void {
		const game = options.game ?? newGame(WORLD_SEED);
		this.seed = game.seed;
		this.spawn = spawnPoint(this.seed);
		this.pos = { x: game.pos.x, y: game.pos.y };
		this.facing = game.facing;
		this.steps = game.steps;
		this.party = game.party.map((a) => ({ ...a }));
		this.battle = null;
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
		if (options.message) this.emit({ type: 'message', text: options.message });
	}

	/**
	 * The game as it stands, for a save. Mid-battle the party is the battle's,
	 * HP as it is now, and the battle comes too (its state, never its seed).
	 */
	snapshot(): SavedGame {
		const party = this.battle ? this.battle.state.party : this.party;
		return {
			seed: this.seed,
			pos: { ...this.pos },
			facing: this.facing,
			steps: this.steps,
			party: party.map((a) => ({ ...a })),
			battle: this.battle ? this.battle.state : null
		};
	}

	dispatch(intent: Intent): void {
		if (!this.started) return;
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
		// Unreachable while losing heals everyone; the doctor's rules decide
		// what a tired party meets.
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
	 * caught animal joins the party if there is room, and a lost battle heals
	 * everyone and puts the player back on the spawn tile.
	 *
	 * That last one is a placeholder for the knock-out rule (the engine's
	 * `takeToDoctor`, with its `taken-to-doctor` event), which replaces it
	 * when the doctor comes to the client.
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
export function mintId(): string {
	const c = globalThis.crypto;
	if (typeof c.randomUUID === 'function') return c.randomUUID();
	const bytes = c.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
