import type { Authority, Direction, GameEvent, GridPos } from '@mathgame/engine';
import type { Keyboard } from '../input/keyboard';
import type { GameRenderer } from '../render/renderer';
import { game } from '../state/game.svelte';

const STEP_SECONDS = 0.18; // one tile per step; Game Boy pace is ~0.25

/**
 * Explore mode: turns held keys into `move` intents, one per tile, and
 * animates the player mesh between tiles as `player-moved` events arrive.
 * Enter is sent as `interact`; what came of it is the authority's to say.
 * A number key sends `select-lead` for the animal in that party slot.
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
				// `welcome` carries the authority's facing (down in a new game, the
				// saved one in a restored game), so after any `welcome` both sides
				// agree about which way the player looks.
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
			case 'taken-to-doctor':
				// After a lost battle: beside a tent that can be far away, so no
				// tween; the figure turns to the tent (or down, if a doctor came).
				if (event.playerId !== this.playerId) break;
				this.pos = this.from = event.pos;
				this.progress = 1;
				this.facing = event.dir;
				break;
		}
	}

	update(dt: number): void {
		// A number key chooses who goes first, at once, even mid-step — and before
		// any step this frame sends: that step can start a battle, and the animal
		// chosen on the same frame must be the one that fights.
		const slot = this.keyboard.takeSlot();
		const animal = slot === undefined ? undefined : game.party[slot];
		if (animal) {
			this.authority.dispatch({
				type: 'party',
				intent: { type: 'select-lead', animalId: animal.id }
			});
		}
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
