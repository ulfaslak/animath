import { TAP_SLOP_PX } from './taps';

/**
 * A card carried up or down the explore HUD's party column
 * (`ui/Hud.svelte`), as pure rules the HUD feeds its measurements and the
 * pointer's positions to: when a press on a card becomes a drag, how far the
 * card goes, where it lands, and how fast the column scrolls under it at its
 * edges (UI_SPEC § Explore mode, "Moving a card").
 *
 * Time alone never makes a drag. A pointer that rests on a card however long
 * taps it when it lifts (`input/taps.ts`), unless it has moved: a mouse past
 * `LIFT_PX`, a finger past the tap's own slop once it has held still for
 * `HOLD_MS`. A finger that moves before that is scrolling the column.
 */

/** A mouse lifts a card once it has moved this far up or down. */
export const LIFT_PX = 8;
/** A finger held this still (`HOLD_SLOP_PX`) this long lifts the card: it can be carried now. */
export const HOLD_MS = 500;
/** A finger that moves further than this before it has held still long enough is scrolling the column. */
export const HOLD_SLOP_PX = 10;
/** A carried card within this far of the column's top or bottom edge scrolls it. */
export const EDGE_PX = 40;
/** How fast the column scrolls under a carried card, in px/s: as it reaches the edge's zone, and at the edge or past it. */
export const EDGE_SPEED = { least: 120, most: 600 } as const;

/** What moves the card: a mouse, or a finger (a pen counts as one). */
export type Pointer = 'mouse' | 'finger';

/**
 * Where a press on a card stands. `pressed`: down, nothing more yet.
 * `lifted`: a finger held still long enough; the card lifts and follows it
 * to show it can be carried, and still taps if let go before it has moved
 * past the tap's slop. `carried`: a drag, which is never also a tap.
 */
export type DragPhase = 'pressed' | 'lifted' | 'carried';

/**
 * What a press on a card has become, `moved` px up or down from where it
 * landed and `heldMs` after it landed: a phase, or `scroll` for a finger
 * that moved before it had held still, which the column's own scrolling
 * takes. A drag stays a drag.
 */
export function dragPhase(
	pointer: Pointer,
	was: DragPhase,
	moved: number,
	heldMs: number
): DragPhase | 'scroll' {
	if (was === 'carried') return 'carried';
	if (pointer === 'mouse') return moved > LIFT_PX ? 'carried' : 'pressed';
	if (was === 'pressed') {
		if (moved > HOLD_SLOP_PX) return 'scroll';
		return heldMs >= HOLD_MS ? 'lifted' : 'pressed';
	}
	return moved > TAP_SLOP_PX ? 'carried' : 'lifted';
}

/** The column as a card was lifted: each card's top and height, top to bottom, in the column's own pixels. */
export interface Column {
	readonly tops: readonly number[];
	readonly heights: readonly number[];
}

/**
 * How far the card at `from` is drawn from its place when it has been
 * carried `by` px (the column's scroll since it lifted included): never past
 * the first card's top or the last card's bottom, where the column would cut
 * it off.
 */
export function carriedBy(column: Column, from: number, by: number): number {
	const { tops, heights } = column;
	const last = tops.length - 1;
	const least = tops[0]! - tops[from]!;
	const most = tops[last]! + heights[last]! - (tops[from]! + heights[from]!);
	return Math.min(most, Math.max(least, by));
}

/**
 * Where the top of the card at `from` stands once it has landed on place
 * `to`: a card's top at a place above its own, else its bottom where that
 * place's card ends (the cards between slide up by its height).
 */
export function slotTop(column: Column, from: number, to: number): number {
	const { tops, heights } = column;
	return to <= from ? tops[to]! : tops[to]! + heights[to]! - heights[from]!;
}

/**
 * The place the card at `from`, drawn `offset` px from its place, lands on:
 * the one whose slot is nearest where it is drawn, a tie going to the place
 * nearer its own. So a card carried as far as it goes lands first or last,
 * whatever the sizes of the cards it passed (#70: compared middle to middle,
 * a card could not pass the last card when it was as tall as it, nor the
 * first when it was taller).
 */
export function landing(column: Column, from: number, offset: number): number {
	const top = column.tops[from]! + offset;
	let best = from;
	let bestGap = Infinity;
	for (let to = 0; to < column.tops.length; to++) {
		const gap = Math.abs(top - slotTop(column, from, to));
		const nearer = Math.abs(to - from) < Math.abs(best - from);
		if (gap < bestGap || (gap === bestGap && nearer)) {
			best = to;
			bestGap = gap;
		}
	}
	return best;
}

/**
 * How far card `k` is drawn from its place while the card at `from` would
 * land on `to`: the carried card `offset` px (or, `dropped` there, in its
 * new place, until the party comes back in that order), the cards between
 * its place and `to` aside by its height and the gap after it, to show where
 * it will land, and the rest not at all.
 */
export function shiftOf(
	column: Column,
	from: number,
	to: number,
	k: number,
	offset: number,
	dropped: boolean
): number {
	if (k === from) return dropped ? slotTop(column, from, to) - column.tops[from]! : offset;
	const { tops, heights } = column;
	const gap = tops.length > 1 ? tops[1]! - tops[0]! - heights[0]! : 0;
	const room = heights[from]! + gap;
	if (from < to && k > from && k <= to) return -room;
	if (to < from && k >= to && k < from) return room;
	return 0;
}

/** A box on the screen, in CSS pixels: the carried card, the column's visible part. */
export interface Span {
	readonly top: number;
	readonly bottom: number;
}

/**
 * How fast the column scrolls under a carried card, in px/s (negative: up,
 * showing the cards above): nothing until the card is within `EDGE_PX` of
 * the column's top or bottom edge, and then only towards the edge it has been
 * carried towards (`towards`: the pointer's movement since the press,
 * negative up), so a card lifted at an edge and carried away from it never
 * scrolls the column. The deeper into the edge, the faster, fastest at the
 * edge and past it. The HUD keeps scrolling at this speed while the card is
 * held there, moving or not, until the column's end shows (#71).
 */
export function edgeSpeed(card: Span, view: Span, towards: number): number {
	if (towards < 0) {
		const depth = view.top + EDGE_PX - card.top;
		if (depth > 0) return -speedAt(depth);
	} else if (towards > 0) {
		const depth = card.bottom - (view.bottom - EDGE_PX);
		if (depth > 0) return speedAt(depth);
	}
	return 0;
}

function speedAt(depth: number): number {
	const f = Math.min(1, depth / EDGE_PX);
	return EDGE_SPEED.least + (EDGE_SPEED.most - EDGE_SPEED.least) * f;
}
