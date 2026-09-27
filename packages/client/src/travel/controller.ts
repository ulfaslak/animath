import type { Authority, GameEvent } from '@mathgame/engine';
import { sfx } from '../audio/sfx.svelte';
import { motion } from '../motion';
import type { GameRenderer } from '../render/renderer';
import { doctor } from '../state/doctor.svelte';
import { game } from '../state/game.svelte';
import { pause } from '../state/pause.svelte';
import { travel, type Arrival } from '../state/travel.svelte';

/** Seconds the world takes to close into the sky round the trainer. */
export const CLOSE_SECONDS = 0.55;
/** Seconds the new world takes to open out of it. */
export const OPEN_SECONDS = 0.65;
/** With reduced motion, the sky fades in and out instead, this long each way. */
export const FADE_SECONDS = 0.3;
/** Seconds the world's number stays up on arrival, its fade included. */
export const BANNER_SECONDS = 2.6;

/**
 * A trip to another world, as the screen plays it ([[UI_SPEC]] § Explore
 * mode, "Travelling"): the world closes into a circle of sky round the
 * trainer (with reduced motion, the sky fades in), and only once it is shut
 * does the `travel` intent go, so the world changes where nobody sees it;
 * the authority's `travelled` opens the new world out of the sky, with its
 * number big on the screen ("World 42!") and a line for how the kid arrived:
 * somewhere new, back where they left off, or home. A trip the authority
 * refuses (the screen offers none it would) opens on the same world.
 *
 * `go` starts one, from the pause menu's Worlds screen; the frame loop calls
 * `update`, and `main.ts` lets no key through while the cover is up
 * (`travel.active`). The number is for the world: a menu or the doctor's
 * card opened over it puts it away for good.
 */
export class TravelController {
	/** The world the cover is closing on the way to; null when no trip is on its way. */
	private to: number | null = null;

	constructor(
		private authority: Authority,
		private renderer: Pick<GameRenderer, 'playerScreenPoint'>
	) {}

	/** Go to world `world`. Nothing while a trip is under way. */
	go(world: number): void {
		if (travel.cover) return;
		const at = this.renderer.playerScreenPoint();
		travel.banner = null;
		travel.cover = { closing: true, p: 0, x: at.x, y: at.y, calm: motion.reduced };
		this.to = world;
		sfx.play('travel');
	}

	handle(event: GameEvent): void {
		switch (event.type) {
			case 'travelled': {
				if (event.playerId !== game.playerId) break;
				// Shut: open on the new world, and name it.
				const arrival: Arrival =
					event.world === game.home ? 'home' : event.firstVisit ? 'new' : 'back';
				travel.banner = { world: event.world, arrival, age: 0, calm: motion.reduced };
				if (travel.cover) {
					// Round the trainer where they stand now (explore has put them down): the point
					// moves with the ground's height, and out on the water with the boat.
					const at = this.renderer.playerScreenPoint();
					travel.cover = { ...travel.cover, closing: false, p: 0, x: at.x, y: at.y };
				}
				break;
			}
			case 'travel-refused':
				// Nothing changed: open on the same world.
				if (travel.cover) travel.cover = { ...travel.cover, closing: false, p: 0 };
				break;
			case 'welcome':
			case 'game-left':
			case 'battle-started':
				this.to = null;
				travel.reset();
				break;
			case 'doctor-visit-started':
				travel.banner = null;
				break;
		}
	}

	update(dt: number): void {
		const cover = travel.cover;
		if (cover) {
			const seconds = cover.calm ? FADE_SECONDS : cover.closing ? CLOSE_SECONDS : OPEN_SECONDS;
			const p = Math.min(1, cover.p + dt / seconds);
			if (cover.closing && p >= 1) {
				travel.cover = { ...cover, p: 1 };
				const to = this.to;
				this.to = null;
				// The world changes under the cover; `travelled` (or a refusal) opens it again.
				if (to !== null) this.authority.dispatch({ type: 'travel', world: to });
				// Whatever answered, never leave the kid under a closed cover.
				if (travel.cover?.closing) travel.cover = { ...travel.cover, closing: false, p: 0 };
			} else if (!cover.closing && p >= 1) {
				travel.cover = null;
			} else {
				travel.cover = { ...cover, p };
			}
		}
		const banner = travel.banner;
		if (banner) {
			const age = banner.age + dt;
			const over = age >= BANNER_SECONDS || pause.open || doctor.active;
			travel.banner = over ? null : { ...banner, age };
		}
	}
}
