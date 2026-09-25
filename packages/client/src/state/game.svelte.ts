import type { AnimalInstance, GameEvent, GridPos } from '@mathgame/engine';

/**
 * The UI's read-only view of the game. It is filled exclusively from
 * authority events — Svelte components never poke game state directly.
 *
 * `mode` is the authority's mode: it flips to `battle` on `battle-started`
 * and back on `battle-ended`. The battle *screen* stays up a little longer
 * than that (the last events are narrated, then a result card waits for
 * Enter); that presentation state lives in `battle.svelte.ts`.
 */
class GameView {
	mode = $state<'loading' | 'explore' | 'battle'>('loading');
	playerId = $state<string>('');
	seed = $state<number>(0);
	pos = $state<GridPos>({ x: 0, y: 0 });
	party = $state<AnimalInstance[]>([]);
	message = $state<string>('');

	apply(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
				this.playerId = event.playerId;
				this.seed = event.seed;
				this.pos = event.pos;
				this.party = event.party;
				this.mode = 'explore';
				break;
			case 'player-moved':
				if (event.playerId === this.playerId) this.pos = event.pos;
				break;
			case 'taken-to-doctor':
				if (event.playerId === this.playerId) this.pos = event.pos;
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
			case 'message':
				this.message = event.text;
				break;
		}
	}
}

export const game = new GameView();
