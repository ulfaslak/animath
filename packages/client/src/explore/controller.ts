import {
	WorldEdits,
	leadIndex,
	type Authority,
	type Direction,
	type GameEvent,
	type GridPos
} from '@mathgame/engine';
import { sfx } from '../audio/sfx.svelte';
import type { Keyboard } from '../input/keyboard';
import { SWING_STRIKE } from '../render/clearing';
import type { Follower } from '../render/follower';
import type { GameRenderer } from '../render/renderer';
import { doctor } from '../state/doctor.svelte';
import { game } from '../state/game.svelte';

const STEP_SECONDS = 0.18; // one tile per step; Game Boy pace is ~0.25

/**
 * Explore mode: turns held keys into `move` intents, one per tile, and
 * animates the player mesh between tiles as `player-moved` events arrive.
 * Enter is sent as `interact` (after the keyboard's quiet moment); what came
 * of it is the authority's to say. When it cleared a tile (`tile-cleared`),
 * the world on screen takes the change and the chop plays: the trainer's
 * swing, the tree tipping or the rock cracking, its sound as the tool lands.
 * A number key sends `select-lead` for the
 * animal in that party slot.
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
	/** The tiles the player has cleared: `welcome`'s, then every `tile-cleared`. */
	private edits = WorldEdits.none;

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
				this.edits = WorldEdits.decode(event.edits);
				this.pos = this.from = event.pos;
				this.progress = 1;
				this.facing = event.facing;
				this.renderer.setWorld(this.seed, this.edits);
				this.renderer.setPlayer(event.pos, event.pos, 1, this.facing);
				this.follower?.place(this.seed, event.pos, this.facing, this.edits);
				break;
			case 'tile-cleared':
				if (event.playerId !== this.playerId) break;
				this.edits = this.edits.with(event.pos).without(event.regrown);
				this.renderer.cleared(event.pos, event.tool, this.facing, this.edits, event.regrown);
				this.follower?.setEdits(this.edits);
				// As the tool lands: a woody chop, or a rock's crack.
				sfx.play(event.was === 'tree' ? 'chop' : 'crack', { delay: SWING_STRIKE });
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
				this.follower?.place(this.seed, event.pos, this.facing, this.edits);
				break;
			case 'taken-to-doctor':
				// After a lost battle: beside a tent that can be far away, so no
				// tween; the figure turns to the tent (or down, if a doctor came).
				if (event.playerId !== this.playerId) break;
				this.pos = this.from = event.pos;
				this.progress = 1;
				this.facing = event.dir;
				this.follower?.place(this.seed, event.pos, this.facing, this.edits);
				break;
			case 'game-left':
				// Quit to the title, which gathers the team round the trainer itself.
				this.follower?.hide();
				break;
		}
	}

	update(dt: number): void {
		this.keyboard.tick(dt);
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
