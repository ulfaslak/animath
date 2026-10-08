import {
	FIRST_LAND,
	WorldEdits,
	tileAtWorld,
	tileRealm,
	type AnimalInstance,
	type Direction,
	type GameEvent,
	type GridPos,
	type Realm,
	type LandId
} from '@mathgame/engine';

/**
 * The UI's read-only view of the game. It is filled exclusively from
 * authority events — Svelte components never poke game state directly.
 *
 * `mode` is the authority's mode: `loading` until the first game starts,
 * then `explore`; it flips to `battle` on `battle-started` and back on
 * `battle-ended`, and to `title` on `game-left`, when no game is under way
 * until the next `welcome`. The title screen itself is `title.svelte.ts`,
 * which is up before the first game too. The battle *screen* stays up a little longer
 * than that (the last events are narrated, then a result card waits for
 * Enter); that presentation state lives in `battle.svelte.ts`. A doctor
 * visit is not a mode: its card is in `doctor.svelte.ts`. What the message
 * line says is in `hud.svelte.ts`.
 */
class GameView {
	mode = $state<'loading' | 'title' | 'explore' | 'battle'>('loading');
	playerId = $state<string>('');
	/**
	 * The player's name: `welcome`'s, then `name-chosen`'s. Null until they
	 * have chosen one (a game saved before names asks for it on load). What
	 * other players see above this player's character.
	 */
	name = $state<string | null>(null);
	/**
	 * The world number the player is in (1 to 9999): `welcome`'s, then every
	 * `travelled`'s. Two players with the same number are in the same world.
	 */
	world = $state<number>(0);
	/**
	 * The land the player is in (`welcome`'s, then every `travelled`'s): with
	 * `world`, the place whose players see each other ([[PRODUCT]] §4 "Lands").
	 */
	land = $state<LandId>(FIRST_LAND);
	/** The lands unlocked: `welcome`'s, then every `unlocked-changed`'s. */
	unlocked = $state<string[]>([FIRST_LAND]);
	/** The world the game began in: `welcome`'s. */
	home = $state<number>(0);
	/** The generator seed of `world` in `land` (`landSeed(land, world)`). */
	seed = $state<number>(0);
	pos = $state<GridPos>({ x: 0, y: 0 });
	/** The way the player faces: `welcome`'s facing, then every move's direction, walked or blocked. */
	facing = $state<Direction>('down');
	/**
	 * Steps walked since `welcome` (the controls hint counts them). Bumps are
	 * not steps: a key held against a wall sends a blocked move every frame.
	 */
	steps = $state(0);
	party = $state<AnimalInstance[]>([]);
	/** The player's tokens: `welcome`'s, then every `belongings-changed`. */
	tokens = $state(0);
	/** The ids of the items the player owns (`hasItem`), in the order bought. */
	items = $state<string[]>([]);
	/** The puzzles the player has solved: `welcome`'s, then every `solved-changed`. */
	solved = $state(0);
	/**
	 * The animal book's species seen (caught and set-free ones included),
	 * caught and set free at the witch doctor's, each in the order first met:
	 * `welcome`'s, then every `book-changed`.
	 */
	seen = $state<string[]>([]);
	caught = $state<string[]>([]);
	freed = $state<string[]>([]);
	/**
	 * Where the player is: out on the water, in the boat, or on land (the
	 * engine's `tileRealm` of their tile), or up in the air with the glider,
	 * whatever the tiles flown over (#91). Who goes first is the lead there: in
	 * the air, the first bird standing, the one a bird that notices the glider
	 * sizes up and the one that fights it.
	 */
	realm = $derived.by<Realm>(() => {
		if (this.flying) return 'air';
		return tileRealm(tileAtWorld(this.seed, this.pos.x, this.pos.y).kind);
	});
	/**
	 * The tiles the player has cleared with a tool: `welcome`'s, then every
	 * `tile-cleared`. Immutable, so it is replaced, never changed in place.
	 */
	edits = $state.raw<WorldEdits>(WorldEdits.none);
	/**
	 * Up in the air with the glider, as the authority has it: from `took-off`
	 * until `landed`. Meanwhile `pos` is the tile the glider is over.
	 */
	flying = $state(false);

	apply(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
				this.playerId = event.playerId;
				this.name = event.name;
				this.world = event.world;
				this.land = event.land;
				this.unlocked = event.unlocked;
				this.home = event.home;
				this.seed = event.seed;
				this.pos = event.pos;
				this.facing = event.facing;
				this.steps = 0;
				this.party = event.party;
				this.tokens = event.tokens;
				this.items = event.items;
				this.solved = event.solved;
				this.seen = event.seen;
				this.caught = event.caught;
				this.freed = event.freed;
				this.edits = WorldEdits.decode(event.edits);
				this.flying = false;
				this.mode = 'explore';
				break;
			case 'took-off':
				if (event.playerId !== this.playerId) break;
				this.flying = true;
				break;
			case 'glided':
				if (event.playerId === this.playerId) this.pos = event.pos;
				break;
			case 'landed':
				if (event.playerId !== this.playerId) break;
				this.pos = event.pos;
				this.facing = event.dir;
				this.flying = false;
				break;
			case 'name-chosen':
				if (event.playerId === this.playerId) this.name = event.name;
				break;
			case 'travelled':
				// Another world: where the player stands there, and what they cleared there.
				if (event.playerId !== this.playerId) break;
				this.world = event.world;
				this.land = event.land;
				this.seed = event.seed;
				this.pos = event.pos;
				this.facing = event.facing;
				this.edits = WorldEdits.decode(event.edits);
				break;
			case 'unlocked-changed':
				this.unlocked = event.unlocked;
				break;
			case 'tile-cleared':
				if (event.playerId === this.playerId) {
					this.edits = this.edits.with(event.pos).without(event.regrown);
				}
				break;
			case 'player-moved':
				if (event.playerId !== this.playerId) break;
				this.pos = event.pos;
				this.facing = event.dir;
				// A slide on the ice is a step for every tile of it.
				this.steps += event.tiles ?? 1;
				break;
			case 'player-blocked':
				if (event.playerId === this.playerId) this.facing = event.dir;
				break;
			case 'player-placed':
				if (event.playerId !== this.playerId) break;
				this.pos = event.pos;
				this.facing = event.dir;
				break;
			case 'battle-started':
				this.mode = 'battle';
				break;
			case 'battle-ended':
				this.mode = 'explore';
				break;
			case 'game-left':
				this.mode = 'title';
				break;
			case 'party-changed':
			case 'party-edited':
				this.party = event.party;
				break;
			case 'belongings-changed':
				this.tokens = event.tokens;
				this.items = event.items;
				break;
			case 'solved-changed':
				this.solved = event.solved;
				break;
			case 'book-changed':
				this.seen = event.seen;
				this.caught = event.caught;
				this.freed = event.freed;
				break;
			case 'doctor-visit-ended':
				this.party = event.state.party.map((a) => ({ ...a }));
				break;
		}
	}
}

export const game = new GameView();
