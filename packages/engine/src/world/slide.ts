import { ICE_RUN } from './arctic.js';
import { editedTileAt, type WorldEdits } from './edits.js';
import {
	NO_GEAR,
	isIce,
	isPassable,
	step,
	type Direction,
	type Gear,
	type GridPos,
	type Tile
} from './types.js';

/**
 * A step, on the ice too ([[PRODUCT]] §4 "The Arctic's map", #191): a step
 * onto ice slides the kid on the way they stepped, over every tile of ice,
 * until something stops them, like the ice puzzles of the Game Boy games.
 * The same with skis or without (#191: "ski-agnostic").
 *
 * - A tile they could not step onto (an ice block, a rock, a tree, a tent, a
 *   fishing hole, water without the boat) stops them on the ice in front of
 *   it, facing it: sliding dead into a fishing hole leaves them facing the
 *   hole, ready to fish.
 * - A tile they can step onto that is not ice (snow, deep snow, the water in
 *   the boat) stops them on it, as an ordinary step onto it would: a slide
 *   onto deep snow is a step onto deep snow.
 * - A slide never goes past `MAX_SLIDE` tiles. The Arctic never makes a run
 *   of ice longer than `ICE_RUN` (`arctic.ts`), so the cap is never what
 *   stops one there; it keeps a slide finite whatever the ground.
 *
 * The whole slide is one move, decided at once by the authority: a save is
 * never taken in the middle of one, and every tile of it is a step.
 */

/** The most tiles one move goes: a run of ice as long as the world has, and the tile it ends on. */
export const MAX_SLIDE = ICE_RUN + 1;

/** One move: every tile entered, in order, the last the tile the kid stands on, and that tile. */
export interface Moved {
	/** Every tile entered, in order: one for a step, more for a slide. Never empty. */
	path: GridPos[];
	/** The tile the move ends on, as the world shows it there. */
	tile: Tile;
}

/**
 * Where a move `dir` from `from` takes a player with `gear`, in the world of
 * `seed` as `edits` leave it: null when the tile in front can't be stepped
 * onto (the player only turns), else the path: one tile, or on the ice the
 * whole slide.
 */
export function moveFrom(
	seed: number,
	edits: WorldEdits,
	from: GridPos,
	dir: Direction,
	gear: Gear = NO_GEAR
): Moved | null {
	let at = step(from, dir);
	let tile = editedTileAt(seed, edits, at.x, at.y);
	if (!isPassable(tile.kind, gear)) return null;
	const path: GridPos[] = [at];
	while (isIce(tile.kind) && path.length < MAX_SLIDE) {
		const next = step(at, dir);
		const ahead = editedTileAt(seed, edits, next.x, next.y);
		if (!isPassable(ahead.kind, gear)) break;
		at = next;
		tile = ahead;
		path.push(at);
	}
	return { path, tile };
}
