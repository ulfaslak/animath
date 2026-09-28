import {
	TENT_SEARCH_STEPS,
	gearOf,
	nearestTent,
	needsDoctor,
	type GridPos,
	type TentSpot,
	type WorldEdits
} from '@mathgame/engine';
import { edgeSpot } from '../presence/controller';
import type { GameRenderer } from '../render/renderer';
import { battle } from '../state/battle.svelte';
import { doctor } from '../state/doctor.svelte';
import { doctorWay } from '../state/doctor-way.svelte';
import { game } from '../state/game.svelte';
import { pause } from '../state/pause.svelte';
import { title } from '../state/title.svelte';

/**
 * The furthest a tired kid who walks away from the tent the way last found is
 * still pointed back to it, in steps: the search after a step never looks
 * further than one step past the tent it found before (a step away from it
 * is never more than one more), so it keeps finding a tent, up to this.
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
 * this far from every piece of the HUD it would go under.
 */
export const ARROW_REACH = 44;

/**
 * The nearest, in CSS pixels, the arrow comes to the player, however crowded
 * the screen's edge: by the trainer's feet. On a phone held sideways, three
 * lines of the message line leave about 95 px under the trainer, room for the
 * arrow only this near.
 */
const NEAREST_TO_PLAYER = 48;

/** How far, in CSS pixels, the arrow moves back towards the player at a time while it is under the HUD. */
const BACK_STEP = 4;

/** A box on the screen in CSS pixels: a piece of the HUD the arrow keeps clear of. */
export interface ScreenRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * The pieces of the HUD at the screen's edges that the way to the doctor
 * keeps clear of, as laid out now: every element marked `data-keep-clear`
 * (the team's cards, the belongings, the coordinates, the message line and
 * what stands over it, the touch controls) that takes up any room.
 */
export function hudRects(root: ParentNode = document): ScreenRect[] {
	const rects: ScreenRect[] = [];
	for (const el of root.querySelectorAll('[data-keep-clear]')) {
		const { left, top, right, bottom } = el.getBoundingClientRect();
		if (right > left && bottom > top) rects.push({ left, top, right, bottom });
	}
	return rects;
}

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
 * tent is in plain sight, an arrow at the screen's edge pointing to it
 * (`edgeSpot`, as a friend's arrow is placed; `arrowTo`). Only over the
 * explore screen.
 *
 * It reads where the player is from `game`, however they got there (a step,
 * a go-to, another world, a reload), and looks again whenever that, the
 * world, the ground or the boat changes, never while it doesn't, nor up on
 * the glider, which keeps the tent found where the kid took off: the tent is
 * found by the pure function, from the seeded world and the overlay, so it
 * is the same however many chunks are on screen. After a step it looks no
 * further than one step past the tent it found before, so the search stays
 * as small as the way is long, and a kid who walks the wrong way keeps an
 * arrow back, up to `DOCTOR_WAY_STEPS`.
 */
export class DoctorWay {
	private last: Search | null = null;

	/**
	 * `keepClear`: the pieces of the HUD the arrow must never go under, as laid
	 * out now (`hudRects` in the page), asked each frame the arrow is placed.
	 */
	constructor(
		private readonly renderer: DoctorWayRenderer,
		private readonly keepClear: () => readonly ScreenRect[] = () => []
	) {}

	/** Every frame, after the world is drawn: the tent the way leads to, and the arrow to it. */
	overlay(): void {
		if (!this.showing() || !needsDoctor(game.party, game.realm)) {
			// The search is kept, so coming back from a menu, a battle or the doctor's
			// card is no search at all, unless the player moved meanwhile.
			if (doctorWay.tent) doctorWay.tent = null;
			if (doctorWay.arrow) doctorWay.arrow = null;
			return;
		}
		const tent = this.find()?.tent ?? null;
		if (!samePos(tent, doctorWay.tent)) doctorWay.tent = tent && { x: tent.x, y: tent.y };
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
	private showing(): boolean {
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
		const same = last !== null && last.seed === game.seed && last.edits === game.edits;
		if (same && last.boat === boat && samePos(last.from, from)) return last.spot;
		// Up on the glider the way holds the tent found where the kid took off: the tile under
		// the glider can be the middle of a lake or a forest, where no walk begins. It looks
		// again once they are down.
		if (same && game.flying && last.spot !== null) return last.spot;
		// A step from the last search (and nothing else changed) is never more than one
		// step further from the tent it found: look that far, and no further.
		const stepped =
			same && last.boat === boat && last.spot !== null && tilesApart(last.from, from) === 1;
		const reach = stepped
			? Math.min(DOCTOR_WAY_STEPS, Math.max(TENT_SEARCH_STEPS, last.spot!.steps + 1))
			: TENT_SEARCH_STEPS;
		const spot = nearestTent(game.seed, from, reach, game.edits, { boat });
		this.last = { seed: game.seed, edits: game.edits, boat, from, spot };
		return spot;
	}

	/**
	 * The arrow for the tent at `tent`: where a friend's arrow would sit for it
	 * (`edgeSpot`, inside the screen's edges), or null once the tent is inside
	 * that frame and under no piece of the HUD, in plain sight. A tent in the
	 * strip between that frame and the screen's edge (half off the screen, or
	 * behind the message line), or under the HUD, still has its arrow, a little
	 * way before it (`TENT_CLEARANCE`), so the arrow never covers the tent it
	 * points to. And the arrow keeps clear of the HUD (`keepClear`: the team's
	 * cards, the message line however many lines it has, the touch controls),
	 * back along its line towards the player until none of it would cover the
	 * arrow, so it always points the same way and is always seen whole.
	 */
	private arrowTo(tent: GridPos): { x: number; y: number; angle: number } | null {
		const { w, h } = this.renderer.screenSize();
		const me = this.renderer.groundToScreen(game.pos.x, game.pos.y);
		const there = this.renderer.groundToScreen(tent.x, tent.y);
		const spot = edgeSpot(me, there, w, h);
		if (!spot) return null;
		const hud = this.keepClear();
		const toTent = Math.hypot(there.x - me.x, there.y - me.y);
		const toEdge = Math.hypot(spot.x - me.x, spot.y - me.y);
		if (toTent <= toEdge && !hud.some((r) => within(r, there, 0))) return null;
		// From the player out: the edge, or a little way before the tent, and back from any
		// piece of the HUD the arrow would go under.
		const at = (reach: number) => ({
			x: Math.round(me.x + ((spot.x - me.x) * reach) / toEdge),
			y: Math.round(me.y + ((spot.y - me.y) * reach) / toEdge)
		});
		let reach = Math.min(toEdge, Math.max(NEAREST_TO_PLAYER, toTent - TENT_CLEARANCE));
		while (reach > NEAREST_TO_PLAYER && hud.some((r) => within(r, at(reach), ARROW_REACH))) {
			reach = Math.max(NEAREST_TO_PLAYER, reach - BACK_STEP);
		}
		if (reach === toEdge) return spot;
		return { ...at(reach), angle: spot.angle };
	}
}

/** Whether `p` is within `margin` CSS pixels of the box `r` (inside it, or that close to it). */
function within(r: ScreenRect, p: { x: number; y: number }, margin: number): boolean {
	const dx = Math.max(r.left - p.x, 0, p.x - r.right);
	const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
	return dx * dx + dy * dy < margin * margin || (dx === 0 && dy === 0);
}

function samePos(a: GridPos | null, b: GridPos | null): boolean {
	return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);
}

/** Steps between two tiles as the crow walks: across plus down. */
function tilesApart(a: GridPos, b: GridPos): number {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
