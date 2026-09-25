import type { AnimalInstance, Direction, GameEvent, GridPos } from '@mathgame/engine';

/**
 * The UI's read-only view of the game. It is filled exclusively from
 * authority events — Svelte components never poke game state directly.
 *
 * `mode` is the authority's mode: it flips to `battle` on `battle-started`
 * and back on `battle-ended`. The battle *screen* stays up a little longer
 * than that (the last events are narrated, then a result card waits for
 * Enter); that presentation state lives in `battle.svelte.ts`. A doctor
 * visit is not a mode: its card is in `doctor.svelte.ts`. What the message
 * line says is in `hud.svelte.ts`.
 */
class GameView {
	mode = $state<'loading' | 'explore' | 'battle'>('loading');
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

	apply(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
				this.playerId = event.playerId;
				this.seed = event.seed;
				this.pos = event.pos;
				this.facing = event.facing;
				this.steps = 0;
				this.party = event.party;
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
			case 'party-changed':
				this.party = event.party;
				break;
			case 'doctor-visit-ended':
				this.party = event.state.party.map((a) => ({ ...a }));
				break;
		}
	}
}

export const game = new GameView();
