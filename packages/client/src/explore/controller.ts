import type { Authority, Direction, GameEvent, GridPos } from '@mathgame/engine';
import type { Keyboard } from '../input/keyboard';
import type { GameRenderer } from '../render/renderer';

const STEP_SECONDS = 0.18; // one tile per step; Game Boy pace is ~0.25

/**
 * Explore mode: turns held keys into `move` intents, one per tile, and
 * animates the player mesh between tiles as `player-moved` events arrive.
 */
export class ExploreController {
	private pos: GridPos = { x: 0, y: 0 };
	private from: GridPos = { x: 0, y: 0 };
	private progress = 1; // 0..1 along from → pos
	private facing: Direction = 'down';
	private seed = 0;
	private playerId = '';

	constructor(
		private authority: Authority,
		private renderer: GameRenderer,
		private keyboard: Keyboard
	) {}

	handle(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
				this.playerId = event.playerId;
				this.seed = event.seed;
				this.pos = this.from = event.pos;
				this.progress = 1;
				this.facing = event.facing;
				this.renderer.setWorld(this.seed);
				this.renderer.setPlayer(event.pos, event.pos, 1, this.facing);
				break;
			case 'player-moved':
				if (event.playerId !== this.playerId) break;
				this.from = this.pos;
				this.pos = event.pos;
				this.progress = 0;
				this.facing = event.dir;
				break;
			case 'player-blocked':
				if (event.playerId === this.playerId) this.facing = event.dir;
				break;
			case 'player-placed':
				// Put down, not walked: no tween, and the figure keeps its facing.
				if (event.playerId !== this.playerId) break;
				this.pos = this.from = event.pos;
				this.progress = 1;
				break;
		}
	}

	update(dt: number): void {
		if (this.progress < 1) {
			this.progress = Math.min(1, this.progress + dt / STEP_SECONDS);
		} else {
			const dir = this.keyboard.takeTap() ?? this.keyboard.heldDirection();
			if (dir) this.authority.dispatch({ type: 'move', dir });
			if (this.keyboard.takeInteract()) this.authority.dispatch({ type: 'interact' });
		}
		this.renderer.setPlayer(this.from, this.pos, this.progress, this.facing);
		this.renderer.ensureChunksAround(this.pos);
	}
}
