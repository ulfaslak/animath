import type { Insets } from '../safe-area';
import type { Rect } from './labels';

/**
 * Marks at the edge of the screen ([[UI_SPEC]] § Explore mode, "The corners"
 * and "Arrows"): an arrow for each way the friends out of sight are, with
 * their names beside it, and the way to a doctor's tent. Pure: the page
 * measures the explore HUD's pieces (`keep-clear.ts`) and the names; this is
 * only where everything goes. Three rules:
 *
 * - **The track.** A mark rides a rectangle 44 px inside the safe area's
 *   sides and top and 96 px inside its bottom (clear of the message line),
 *   and goes round the HUD's pieces, each grown by the mark's clearance. It
 *   sits on the line from the player to what it points at, where that line
 *   first leaves the track: on the track's edge, or on the near side of the
 *   first piece in the way, pointing past it. So no mark is ever under a
 *   piece: the party cards, the tokens, a touch control.
 * - **Ways.** Friends whose arrows would stand on one another share one
 *   arrow (#140: two friends far off the same way got the very same spot),
 *   which names every one of them: four names, or three and "+2 more". At
 *   most `MAX_WAYS` arrows, for the nearest ways.
 * - **Names.** A way's names stand beside its arrow, towards the middle of
 *   the screen, moved along the edge as little as it takes to keep clear of
 *   the pieces, the other arrows and the names placed before them.
 *
 * Deterministic: the same screen gives the same marks, so nothing moves
 * between two frames where nothing did.
 */

/** How far inside the safe area's edges the track runs, in CSS pixels: the bottom stays clear of the message line. */
export const TRACK_INSET = { side: 44, top: 44, bottom: 96 } as const;
/** How far a friend's arrow (30 px) keeps from a piece of the HUD, from its middle. */
export const ARROW_CLEARANCE = 24;
/** The nearest a friend's arrow comes to the player's spot, however crowded the screen: never on the trainer. */
export const ARROW_NEAREST = 40;
/** Half an arrow's size: the box another way's names keep clear of. */
const ARROW_HALF = 15;
/** Two friends whose arrows' middles are closer than this share one arrow. */
export const GATHER_PX = 36;
/** How many ways get an arrow: the nearest. */
export const MAX_WAYS = 4;
/** Names beside an arrow: all of them up to this many; more, and the first ones and "+N more" take this many rows. */
export const MAX_NAMES = 4;
/** The same on a short screen (a phone held sideways), where four rows would take a third of its height. */
export const SHORT_NAMES = 2;
/** The gap between an arrow's middle and the near edge of its names. */
export const NAME_GAP = 20;
/** The least room between a way's names and a piece of the HUD, another arrow or other names. */
export const NAME_CLEAR = 4;
/** The furthest a way's names move along the edge to keep clear; further, and they stay beside their arrow. */
const MAX_NUDGE = 160;

/**
 * Where marks may stand: the track's rectangle, the HUD's pieces it goes
 * round, and how far a mark's middle keeps from them (its clearance).
 */
export interface Track {
	left: number;
	right: number;
	top: number;
	bottom: number;
	pieces: readonly Rect[];
	clearance: number;
}

/** A mark's place on the screen (CSS pixels) and the way it points (radians clockwise from up). */
export interface Spot {
	x: number;
	y: number;
	angle: number;
}

/**
 * The track on a `w` × `h` screen: inside the safe area (`insets`) by
 * `TRACK_INSET`, round the HUD's `pieces`, which a mark keeps `clearance`
 * from (its own half-size and a gap).
 */
export function edgeTrack(
	w: number,
	h: number,
	insets: Insets,
	pieces: readonly Rect[],
	clearance: number
): Track {
	const left = insets.left + TRACK_INSET.side;
	const right = Math.max(left, w - insets.right - TRACK_INSET.side);
	const top = insets.top + TRACK_INSET.top;
	const bottom = Math.max(top, h - insets.bottom - TRACK_INSET.bottom);
	return { left, right, top, bottom, pieces, clearance };
}

/**
 * The boxes a mark from `from` must not enter: each piece grown by the
 * track's clearance, or, for a piece nearer `from` than that (a message line
 * of many lines reaching up to the player on a phone), grown only as far as
 * leaves `from` outside it, so a mark heading for it still stops before it.
 * A piece `from` is inside (a screen too small for it) is not in the way.
 */
export function aroundFrom(track: Track, from: { x: number; y: number }): Rect[] {
	const boxes: Rect[] = [];
	for (const p of track.pieces) {
		const outside = Math.max(p.x0 - from.x, from.x - p.x1, p.y0 - from.y, from.y - p.y1);
		if (outside <= 0) continue;
		const grow = Math.min(track.clearance, outside - 0.5);
		boxes.push({ x0: p.x0 - grow, x1: p.x1 + grow, y0: p.y0 - grow, y1: p.y1 + grow });
	}
	return boxes;
}

/**
 * Where a mark for something at `there` goes: on the line from the player
 * (`me`, brought inside the track's rectangle first), where it first leaves
 * the track (`aroundFrom`), and the way it points; never nearer the player
 * than `nearest` px, where the track's edge allows (on a crowded phone a
 * mark would otherwise stand on the trainer). Null when `there` is the
 * player's own spot.
 */
export function spotOnTrack(
	me: { x: number; y: number },
	there: { x: number; y: number },
	track: Track,
	nearest = 0
): Spot | null {
	const dx = there.x - me.x;
	const dy = there.y - me.y;
	const length = Math.hypot(dx, dy);
	if (length < 1e-6) return null;
	const ux = dx / length;
	const uy = dy / length;
	const cx = Math.min(track.right, Math.max(track.left, me.x));
	const cy = Math.min(track.bottom, Math.max(track.top, me.y));
	const tx =
		ux > 0 ? (track.right - cx) / ux : ux < 0 ? (track.left - cx) / ux : Number.POSITIVE_INFINITY;
	const ty =
		uy > 0 ? (track.bottom - cy) / uy : uy < 0 ? (track.top - cy) / uy : Number.POSITIVE_INFINITY;
	const edge = Math.min(tx, ty);
	let t = edge;
	for (const box of aroundFrom(track, { x: cx, y: cy })) {
		const hit = entry(cx, cy, ux, uy, box);
		if (hit !== null && hit < t) t = hit;
	}
	t = Math.min(edge, Math.max(t, nearest));
	return {
		x: Math.round(cx + ux * t),
		y: Math.round(cy + uy * t),
		angle: Math.round(Math.atan2(ux, -uy) * 100) / 100
	};
}

/**
 * How far along the ray from `(px, py)` going `(ux, uy)` it first meets
 * `box`: null when it never does, or starts inside it.
 */
function entry(px: number, py: number, ux: number, uy: number, box: Rect): number | null {
	if (px > box.x0 && px < box.x1 && py > box.y0 && py < box.y1) return null;
	let near = 0;
	let far = Number.POSITIVE_INFINITY;
	const axes: [number, number, number, number][] = [
		[px, ux, box.x0, box.x1],
		[py, uy, box.y0, box.y1]
	];
	for (const [p, u, lo, hi] of axes) {
		if (u === 0) {
			if (p < lo || p > hi) return null;
			continue;
		}
		const a = (lo - p) / u;
		const b = (hi - p) / u;
		near = Math.max(near, Math.min(a, b));
		far = Math.min(far, Math.max(a, b));
		if (near > far) return null;
	}
	return near;
}

/** A friend out of sight, and where their arrow alone would stand. */
export interface Heading {
	pid: string;
	name: string;
	spot: Spot;
}

/**
 * One arrow for the friends out of sight one way: where it stands and points
 * (its nearest friend's), its key (that friend's), the names beside it,
 * nearest first, and how many more are that way than it names.
 */
export interface Way extends Spot {
	key: string;
	names: string[];
	more: number;
}

/**
 * The arrows for friends out of sight, from their `headings`, nearest first:
 * a friend whose arrow would stand within `GATHER_PX` of a way's joins it;
 * any other starts a way of their own, until there are `MAX_WAYS`. A way
 * names everyone up to `most` (`MAX_NAMES`, or `SHORT_NAMES` on a short
 * screen); beyond that, the first `most - 1` and how many more.
 */
export function gatherWays(headings: readonly Heading[], most: number = MAX_NAMES): Way[] {
	const ways: { key: string; spot: Spot; names: string[] }[] = [];
	for (const heading of headings) {
		const way = ways.find(
			(w) => Math.hypot(w.spot.x - heading.spot.x, w.spot.y - heading.spot.y) < GATHER_PX
		);
		if (way) way.names.push(heading.name);
		else if (ways.length < MAX_WAYS)
			ways.push({ key: heading.pid, spot: heading.spot, names: [heading.name] });
	}
	return ways.map((way) => {
		const names = way.names.length <= most ? way.names : way.names.slice(0, most - 1);
		return { key: way.key, ...way.spot, names, more: way.names.length - names.length };
	});
}

/** Which side of its arrow a way's names go on, by the way it points: beside it, or under or over it. */
export function namesSide(angle: number): 'right' | 'left' | 'under' | 'over' {
	const across = Math.sin(angle);
	const down = -Math.cos(angle);
	if (Math.abs(across) >= Math.abs(down)) return across < 0 ? 'right' : 'left';
	return down < 0 ? 'under' : 'over';
}

/** A way's names to place: its arrow's middle and the way it points, and the block's measured size. */
export interface NameBlock extends Spot {
	w: number;
	h: number;
}

/** Which way a way's names go from its arrow. */
type Side = ReturnType<typeof namesSide>;

/**
 * Where each way's names go, in order (the nearest way first): the block's
 * top left corner, from its arrow's middle. Beside the arrow towards the
 * middle of the screen (`namesSide`), `NAME_GAP` from its middle, centred
 * on it; else, the nearest place clear of every piece, every other arrow
 * and the blocks placed before it (by `NAME_CLEAR`), inside `bounds` (the
 * screen, inside its safe area): moved along the edge (up or down beside
 * an arrow, sideways under or over one), and if that is not enough, further
 * from the arrow towards the middle of the screen, never towards the edge;
 * or else on the arrow's other side that faces the middle (beside an arrow
 * that would have them under it, say), if that is nearer by more than
 * `OTHER_SIDE`. Moved no more than `MAX_NUDGE` in all: past that, nowhere
 * near is clear, and it stays beside its arrow, inside `bounds`.
 */
export function placeNames(
	blocks: readonly NameBlock[],
	pieces: readonly Rect[],
	bounds: Rect
): { dx: number; dy: number }[] {
	const arrows = blocks.map((b) => ({
		x0: b.x - ARROW_HALF,
		x1: b.x + ARROW_HALF,
		y0: b.y - ARROW_HALF,
		y1: b.y + ARROW_HALF
	}));
	const placed: Rect[] = [];
	return blocks.map((block, i) => {
		const obstacles = [...pieces, ...arrows.filter((_, j) => j !== i), ...placed];
		const side = namesSide(block.angle);
		// The other side of the arrow that faces the middle of the screen.
		const other: Side =
			side === 'right' || side === 'left'
				? block.y < (bounds.y0 + bounds.y1) / 2
					? 'under'
					: 'over'
				: block.x < (bounds.x0 + bounds.x1) / 2
					? 'right'
					: 'left';
		const first = nearestClear(block, side, obstacles, bounds);
		const second = nearestClear(block, other, obstacles, bounds);
		const best =
			second && (!first || second.cost + OTHER_SIDE < first.cost)
				? second
				: (first ?? beside(block, side, bounds));
		placed.push(best.rect);
		return { dx: Math.round(best.rect.x0 - block.x), dy: Math.round(best.rect.y0 - block.y) };
	});
}

/** How much nearer the arrow's other side must be to be taken instead (CSS pixels of moving). */
const OTHER_SIDE = 24;

/**
 * The nearest place for `block`'s names on `side` of its arrow that keeps
 * clear of every obstacle, inside `bounds`, within `MAX_NUDGE` of moving:
 * along the edge (`u`: down beside an arrow, right under or over one) and
 * away from the arrow (`v`: towards the middle of the screen). Null when
 * there is none.
 */
function nearestClear(
	block: NameBlock,
	side: Side,
	obstacles: readonly Rect[],
	bounds: Rect
): { rect: Rect; cost: number } | null {
	const g = geometry(block, side, bounds);
	const clear = (u: number, v: number) =>
		g.inside(u, v) && obstacles.every((o) => !touching(g.rect(u, v), o));
	// Where the block could stop: where it wants to be, against the bounds, or just clear
	// of an obstacle's edge; along the edge either way, away from the arrow only inward.
	const us = [g.want.u, g.uLo - g.ux, g.uHi - g.ux - g.uSize];
	const vs = [g.want.v];
	for (const o of obstacles) {
		const [uStart, uEnd, vStart, vEnd] = g.across
			? [o.y0, o.y1, o.x0, o.x1]
			: [o.x0, o.x1, o.y0, o.y1];
		us.push(uStart - NAME_CLEAR - g.uSize - g.ux, uEnd + NAME_CLEAR - g.ux);
		const v = g.inward > 0 ? vEnd + NAME_CLEAR - g.vx : vStart - NAME_CLEAR - g.vSize - g.vx;
		if ((v - g.want.v) * g.inward > 0) vs.push(v);
	}
	// The nearest clear one, counting both moves; the first found of two as near.
	let best: { u: number; v: number; cost: number } | null = null;
	for (const v of vs) {
		for (const u of us) {
			const cost = Math.abs(u - g.want.u) + Math.abs(v - g.want.v);
			if (cost > MAX_NUDGE || (best !== null && cost >= best.cost)) continue;
			if (clear(u, v)) best = { u, v, cost };
		}
	}
	return best && { rect: g.rect(best.u, best.v), cost: best.cost };
}

/** The names beside their arrow on `side`, centred on it, moved along the edge only into `bounds`. */
function beside(block: NameBlock, side: Side, bounds: Rect): { rect: Rect; cost: number } {
	const g = geometry(block, side, bounds);
	const u = Math.min(
		Math.max(g.uLo - g.ux, g.want.u),
		Math.max(g.uLo - g.ux, g.uHi - g.ux - g.uSize)
	);
	return { rect: g.rect(u, g.want.v), cost: Number.POSITIVE_INFINITY };
}

/** A block's measures on `side` of its arrow, along the edge (`u`) and away from the arrow (`v`). */
function geometry(block: NameBlock, side: Side, bounds: Rect) {
	const across = side === 'right' || side === 'left';
	const [uSize, vSize] = across ? [block.h, block.w] : [block.w, block.h];
	const [ux, vx] = across ? [block.y, block.x] : [block.x, block.y];
	const inward = side === 'right' || side === 'under' ? 1 : -1;
	// Centred on the arrow along the edge, its near edge `NAME_GAP` from the arrow's middle.
	const want = { u: -uSize / 2, v: inward > 0 ? NAME_GAP : -NAME_GAP - vSize };
	const [uLo, uHi] = across ? [bounds.y0, bounds.y1] : [bounds.x0, bounds.x1];
	const [vLo, vHi] = across ? [bounds.x0, bounds.x1] : [bounds.y0, bounds.y1];
	const rect = (u: number, v: number): Rect =>
		across
			? { x0: vx + v, x1: vx + v + vSize, y0: ux + u, y1: ux + u + uSize }
			: { x0: ux + u, x1: ux + u + uSize, y0: vx + v, y1: vx + v + vSize };
	const inside = (u: number, v: number) =>
		ux + u >= uLo - 0.5 &&
		ux + u + uSize <= uHi + 0.5 &&
		vx + v >= vLo - 0.5 &&
		vx + v + vSize <= vHi + 0.5;
	return { across, uSize, vSize, ux, vx, inward, want, uLo, uHi, rect, inside };
}

/** Whether two boxes come closer than `NAME_CLEAR`. */
function touching(a: Rect, b: Rect): boolean {
	return (
		a.x0 < b.x1 + NAME_CLEAR &&
		b.x0 < a.x1 + NAME_CLEAR &&
		a.y0 < b.y1 + NAME_CLEAR &&
		b.y0 < a.y1 + NAME_CLEAR
	);
}
