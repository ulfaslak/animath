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
 * the engine's `nearestTent` in the world as they left it, and, while that
 * tent is off the screen, an arrow at the screen's edge pointing to it
 * (`edgeSpot`, as a friend's arrow is placed). Only over the explore screen.
 *
 * It reads where the player is from `game`, however they got there (a step,
 * a go-to, another world, a reload), and looks again whenever that, the
 * world, the ground or the boat changes, never while it doesn't: the tent is
 * found by the pure function, from the seeded world and the overlay, so it
 * is the same however many chunks are on screen. After a step it looks no
 * further than one step past the tent it found before, so the search stays
 * as small as the way is long, and a kid who walks the wrong way keeps an
 * arrow back, up to `DOCTOR_WAY_STEPS`.
 */
export class DoctorWay {
	private last: Search | null = null;

	constructor(private readonly renderer: DoctorWayRenderer) {}

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

	/** The arrow at the screen's edge for the tent at `tent`, or null while the tent is on the screen. */
	private arrowTo(tent: GridPos): { x: number; y: number; angle: number } | null {
		const { w, h } = this.renderer.screenSize();
		const there = this.renderer.groundToScreen(tent.x, tent.y);
		// Anywhere on the screen, as a friend on it: the tent is there to see, and at the
		// very edge an arrow, which sits a little way in, would cover the tent it points to.
		if (there.x >= 0 && there.x <= w && there.y >= 0 && there.y <= h) return null;
		return edgeSpot(this.renderer.groundToScreen(game.pos.x, game.pos.y), there, w, h);
	}
}

function samePos(a: GridPos | null, b: GridPos | null): boolean {
	return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);
}

/** Steps between two tiles as the crow walks: across plus down. */
function tilesApart(a: GridPos, b: GridPos): number {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
