import {
	leadIndex,
	type Authority,
	type Direction,
	type GameEvent,
	type GridPos
} from '@mathgame/engine';
import type { Keyboard } from '../input/keyboard';
import type { Follower } from '../render/follower';
import type { GameRenderer } from '../render/renderer';
import { doctor } from '../state/doctor.svelte';
import { game } from '../state/game.svelte';

const STEP_SECONDS = 0.18; // one tile per step; Game Boy pace is ~0.25

/**
 * Explore mode: turns held keys into `move` intents, one per tile, and
 * animates the player mesh between tiles as `player-moved` events arrive.
 * Enter is sent as `interact`; what came of it is the authority's to say.
 * A number key sends `select-lead` for the animal in that party slot.
 *
 * The lead walks behind the trainer (`render/follower.ts`): it steps onto
 * the tile each step leaves, is put beside the trainer whenever the trainer
 * is put somewhere without walking, and shows whoever leads the party the
 * screen shows (the doctor's card's while it is open, which heals on its
 * beat). Nothing it does goes to the authority.
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
		private keyboard: Keyboard,
		private follower: Follower | null = null
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
				this.follower?.place(this.seed, event.pos, this.facing);
				break;
			case 'player-moved':
				if (event.playerId !== this.playerId) break;
				this.from = this.pos;
				this.pos = event.pos;
				this.progress = 0;
				this.facing = event.dir;
				this.follower?.follow(this.from, this.pos);
				break;
			case 'player-blocked':
				if (event.playerId === this.playerId) this.facing = event.dir;
				break;
			case 'player-placed':
				// Put down, not walked: no tween, and the figure keeps its facing.
				if (event.playerId !== this.playerId) break;
				this.pos = this.from = event.pos;
				this.progress = 1;
				this.follower?.place(this.seed, event.pos, this.facing);
				break;
			case 'taken-to-doctor':
				// After a lost battle: beside a tent that can be far away, so no
				// tween; the figure turns to the tent (or down, if a doctor came).
				if (event.playerId !== this.playerId) break;
				this.pos = this.from = event.pos;
				this.progress = 1;
				this.facing = event.dir;
				this.follower?.place(this.seed, event.pos, this.facing);
				break;
			case 'game-left':
				// Quit to the title, which gathers the team round the trainer itself.
				this.follower?.hide();
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
		if (this.follower) {
			// The party on screen: the doctor's card heals on its beat, after the authority has.
			const party = doctor.active ? doctor.party : game.party;
			this.follower.lead(party[leadIndex(party)]?.speciesId ?? null);
			this.follower.update(this.progress, dt);
		}
	}
}
