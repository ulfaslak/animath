import {
	tileAtWorld,
	tileRealm,
	type AnimalInstance,
	type Direction,
	type GameEvent,
	type GridPos,
	type Realm
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
	/**
	 * Where the player stands: out on the water, in the boat, or on land (the
	 * engine's `tileRealm` of their tile). Who goes first is the lead there.
	 */
	realm = $derived<Realm>(tileRealm(tileAtWorld(this.seed, this.pos.x, this.pos.y).kind));

	apply(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
				this.playerId = event.playerId;
				this.seed = event.seed;
				this.pos = event.pos;
				this.facing = event.facing;
				this.steps = 0;
				this.party = event.party;
				this.tokens = event.tokens;
				this.items = event.items;
				this.mode = 'explore';
				break;
			case 'player-moved':
				if (event.playerId !== this.playerId) break;
				this.pos = event.pos;
				this.facing = event.dir;
				this.steps += 1;
				break;
			case 'player-blocked':
				if (event.playerId === this.playerId) this.facing = event.dir;
				break;
			case 'player-placed':
				if (event.playerId === this.playerId) this.pos = event.pos;
				break;
			case 'taken-to-doctor':
				if (event.playerId !== this.playerId) break;
				this.pos = event.pos;
				this.facing = event.dir;
				this.party = event.party;
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
			case 'doctor-visit-ended':
				this.party = event.state.party.map((a) => ({ ...a }));
				break;
		}
	}
}

export const game = new GameView();
