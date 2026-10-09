import {
	TENT_SEARCH_STEPS,
	gearOf,
	nearestTent,
	type GridPos,
	type TentSpot,
	type WorldEdits
} from '@mathgame/engine';
import { edgeTrack, spotOnTrack } from '../presence/edges';
import type { Rect } from '../presence/labels';
import type { GameRenderer } from '../render/renderer';
import { safeArea } from '../safe-area';
import { battle } from '../state/battle.svelte';
import { doctor } from '../state/doctor.svelte';
import { doctorWay, needsTent } from '../state/doctor-way.svelte';
import { game } from '../state/game.svelte';
import { pause } from '../state/pause.svelte';
import { surprise } from '../state/surprise.svelte';
import { title } from '../state/title.svelte';

/**
 * How far the way looks for a tent, in steps: twice as far as a doctor comes
 * from (`TENT_SEARCH_STEPS`), so a kid no doctor comes to (one with the
 * paraglider) still has an arrow where one would have come. Every search
 * looks this far, so what the way finds depends only on where the player is,
 * never on how they got there. A search stops at the nearest tent, so it
 * costs as much as the way is long, not this.
 */
export const DOCTOR_WAY_STEPS = 2 * TENT_SEARCH_STEPS;

/**
 * How far, in CSS pixels, the arrow keeps from the ground a tent it points to
 * stands on: the tip on its rim reaches 36 px from its middle, towards the
 * tent, and the tent rises about 35 px above its ground, so the arrow never
 * covers the tent, from above or from the side, however near the edge of the
 * screen the tent is.
 */
export const TENT_CLEARANCE = 84;

/**
 * How far, in CSS pixels, the arrow reaches from its middle: the tip on the
 * disc's rim (36 px), its shadow, and a little air. The arrow's middle keeps
 * this far from every piece of the HUD it would go under, on the track the
 * friends' arrows ride (`presence/edges.ts`), a pixel more so the whole
 * pixels it is drawn on never bring it nearer.
 */
export const ARROW_REACH = 44;

/**
 * The nearest, in CSS pixels, the arrow comes to the player, however crowded
 * the screen's edge: by the trainer's feet. On a phone held sideways, three
 * lines of the message line leave about 95 px under the trainer, room for the
 * arrow only this near.
 */
const NEAREST_TO_PLAYER = 48;

/** What the way needs of the renderer: where things are on the canvas, and whether the world is. */
export type DoctorWayRenderer = Pick<
	GameRenderer,
	'groundToScreen' | 'screenSize' | 'showingWorld'
>;

/** What a search was made for: the world, the ground as the player left it, the boat, and where from. */
interface Search {
	seed: number;
	edits: WorldEdits;
	boat: boolean;
	from: GridPos;
	spot: TentSpot | null;
}

/**
 * The way to a doctor while the team needs one ([[UI_SPEC]] § Explore mode):
 * the nearest tent the player could walk to, or sail to with the boat, from
 * the engine's `nearestTent` in the world as they left it, and, until that
 * tent is in plain sight, an arrow at the screen's edge pointing to it, on
 * the track a friend's arrow rides (`spotOnTrack`, `presence/edges.ts`;
 * `arrowTo`). Only over the explore screen.
 *
 * It reads where the player is from `game`, however they got there (a step,
 * a go-to, another world, a reload), and looks again whenever that, the
 * world, the ground or the boat changes, never while it doesn't, nor up on
 * the glider, which keeps what it found where the kid took off: the tent is
 * found by the pure function, from the seeded world and the overlay, so it
 * is the same however many chunks are on screen, and always as far
 * (`DOCTOR_WAY_STEPS`), so it is the same however the kid got there.
 */
export class DoctorWay {
	private last: Search | null = null;

	/**
	 * `keepClear`: the pieces of the HUD the arrow must never go under, as laid
	 * out now (`clearBoxes` in the page, `keep-clear.ts`), asked each frame the
	 * arrow is placed.
	 */
	constructor(
		private readonly renderer: DoctorWayRenderer,
		private readonly keepClear: () => readonly Rect[] = () => []
	) {}

	/** Every frame, after the world is drawn: the tent the way leads to, and the arrow to it. */
	overlay(): void {
		const tired = needsTent(game.party, game.realm);
		if (!tired && doctorWay.noWay) doctorWay.noWay = false;
		// A tired team, or the druid's surprise waiting (`surprise.land`): the way to a tent.
		if (!this.showing() || (!tired && surprise.land === null)) {
			// The search is kept, so coming back from a menu, a battle or the doctor's
			// card is no search at all, unless the player moved meanwhile.
			if (doctorWay.tent) doctorWay.tent = null;
			if (doctorWay.arrow) doctorWay.arrow = null;
			return;
		}
		const tent = this.find()?.tent ?? null;
		if (!samePos(tent, doctorWay.tent)) doctorWay.tent = tent && { x: tent.x, y: tent.y };
		const noWay = tired && tent === null;
		if (doctorWay.noWay !== noWay) doctorWay.noWay = noWay;
		const arrow = tent ? this.arrowTo(tent) : null;
		const shown = doctorWay.arrow;
		if (
			arrow?.x !== shown?.x ||
			arrow?.y !== shown?.y ||
			arrow?.angle !== shown?.angle ||
			(arrow === null) !== (shown === null)
		) {
			doctorWay.arrow = arrow;
		}
	}

	/** The world is on screen with the explore screen over it: no battle, card, menu or title. */
	showing(): boolean {
		return (
			this.renderer.showingWorld &&
			game.mode === 'explore' &&
			!battle.active &&
			!doctor.active &&
			!pause.open &&
			!title.open
		);
	}

	/** The nearest tent from where the player stands, searched again only when something changed. */
	private find(): TentSpot | null {
		const boat = gearOf({ items: game.items }).boat;
		const from = { x: game.pos.x, y: game.pos.y };
		const last = this.last;
		const same =
			last !== null && last.seed === game.seed && last.edits === game.edits && last.boat === boat;
		if (same && samePos(last.from, from)) return last.spot;
		// Up on the glider the way holds what it found where the kid took off, a tent or none:
		// the tile under the glider can be the middle of a lake or a forest, where no walk
		// begins. It looks again once they are down.
		if (same && game.flying) return last.spot;
		const spot = nearestTent(game.seed, from, DOCTOR_WAY_STEPS, game.edits, { boat });
		this.last = { seed: game.seed, edits: game.edits, boat, from, spot };
		return spot;
	}

	/**
	 * The arrow for the tent at `tent`, on the track a friend's arrow rides
	 * (`presence/edges.ts`): inside the screen's edges and round every piece
	 * of the HUD (`keepClear`: the team's cards, the message line however many
	 * lines it has, the touch controls), by `ARROW_REACH`, so it always points
	 * the same way and is always seen whole; or null once the tent is inside
	 * that frame and under no piece of the HUD, in plain sight. A tent in the
	 * strip between that frame and the screen's edge (half off the screen, or
	 * behind the message line), or under the HUD, still has its arrow, a
	 * little way before it (`TENT_CLEARANCE`), so the arrow never covers the
	 * tent it points to.
	 */
	private arrowTo(tent: GridPos): { x: number; y: number; angle: number } | null {
		const { w, h } = this.renderer.screenSize();
		const me = this.renderer.groundToScreen(game.pos.x, game.pos.y);
		const there = this.renderer.groundToScreen(tent.x, tent.y);
		const insets = safeArea();
		const frame = spotOnTrack(me, there, edgeTrack(w, h, insets, [], ARROW_REACH));
		if (!frame) return null;
		const hud = this.keepClear();
		const toTent = Math.hypot(there.x - me.x, there.y - me.y);
		const toFrame = Math.hypot(frame.x - me.x, frame.y - me.y);
		if (toTent <= toFrame && !hud.some((r) => inside(r, there))) return null;
		const track = edgeTrack(w, h, insets, hud, ARROW_REACH + 1);
		const spot = spotOnTrack(me, there, track, NEAREST_TO_PLAYER)!;
		// From the player out: where the track stops it, or a little way before the tent.
		const toSpot = Math.hypot(spot.x - me.x, spot.y - me.y);
		const reach = Math.min(toSpot, Math.max(NEAREST_TO_PLAYER, toTent - TENT_CLEARANCE));
		if (reach >= toSpot) return spot;
		return {
			x: Math.round(me.x + ((spot.x - me.x) * reach) / toSpot),
			y: Math.round(me.y + ((spot.y - me.y) * reach) / toSpot),
			angle: spot.angle
		};
	}
}

/** Whether `p` is inside the box `r`, or on its edge. */
function inside(r: Rect, p: { x: number; y: number }): boolean {
	return p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
}

function samePos(a: GridPos | null, b: GridPos | null): boolean {
	return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);
}
