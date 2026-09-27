import type { GridPos } from '../world/types.js';
import { BEARINGS } from './protocol.js';

/**
 * Who is near whom, for the presence server ([[PRODUCT]] §4 "Playing
 * together"). Pure, so the rule reads the same in the server and in a test.
 *
 * Two players see each other's every step while each is within
 * `VIEW_RADIUS` tiles of the other, counted the long way round a square
 * (the larger of the two differences): a little more than the screen shows
 * at its widest, so a friend walking in is already there as they come into
 * view. Once they see each other they stay seen until they are more than
 * `VIEW_KEEP` apart: a friend pacing along the edge of the ring does not
 * blink in and out.
 *
 * Everyone else in the world is known roughly, from the roster: which way
 * (one of `BEARINGS` directions) and about how many steps.
 */
export const VIEW_RADIUS = 24;
export const VIEW_KEEP = 28;

/** Tiles apart the long way round a square: the larger of the two differences. */
export function tilesApart(a: GridPos, b: GridPos): number {
	return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Whether `b` is near `a`: within `VIEW_RADIUS`, or within `VIEW_KEEP` when
 * the two already see each other (`seeing`).
 */
export function inView(a: GridPos, b: GridPos, seeing: boolean): boolean {
	return tilesApart(a, b) <= (seeing ? VIEW_KEEP : VIEW_RADIUS);
}

/**
 * Which way `to` lies from `from`, as one of `BEARINGS` directions round the
 * compass: 0 is grid up (smaller `y`), counting clockwise, so 4 is right, 8
 * down and 12 left. The same tile is 0.
 */
export function bearingTo(from: GridPos, to: GridPos): number {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	if (dx === 0 && dy === 0) return 0;
	const turn = Math.atan2(dx, -dy) / (2 * Math.PI); // -0.5..0.5, clockwise from up
	return ((Math.round(turn * BEARINGS) % BEARINGS) + BEARINGS) % BEARINGS;
}

/**
 * About how many steps apart two tiles are, walking the grid (no diagonal
 * steps, nothing in the way): exact up to 20, then to the nearest 5 up to
 * 100, the nearest 10 up to 1,000 and the nearest 100 beyond. A kid reads
 * "about 120 steps", not "117".
 */
export function roughSteps(from: GridPos, to: GridPos): number {
	const steps = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
	const unit = steps <= 20 ? 1 : steps <= 100 ? 5 : steps <= 1000 ? 10 : 100;
	return Math.round(steps / unit) * unit;
}

/** A unit vector on the grid (x right, y down) pointing along `bearing`: for an arrow to draw. */
export function bearingVector(bearing: number): { x: number; y: number } {
	const turn = (bearing / BEARINGS) * 2 * Math.PI;
	return { x: Math.sin(turn), y: -Math.cos(turn) };
}
