import { editedTileAt, type WorldEdits } from './edits.js';
import { moveFrom } from './slide.js';
import {
	NO_GEAR,
	isEncounterTile,
	isIce,
	isPassable,
	isWater,
	step,
	type Direction,
	type Gear,
	type GridPos,
	type Tile
} from './types.js';

/**
 * Skis ([[PRODUCT]] §4 "The Arctic's shop", #191 step 6): on The Arctic's
 * snow a kid with skis picks up speed while they hold a way, coasts on when
 * they let go, and at top speed flies over a little deep snow and skims a
 * little water. The
 * authority decides every tile (`skiMove` for a held step, `coast` for the
 * glide after it), each one a step of the count; the screen only paces them.
 *
 * - **Speed** is a level from 0 to `TOP` (3), from how many steps in a row
 *   the kid has held one way (`Ski.run`): the first two steps from a
 *   standstill are a walk (level 0, so a tap, or two, is still one tile each
 *   and a kid walks precisely by a hole or a tent: letting go at level 0
 *   coasts nowhere), then level 1 after `LEVEL_RUNS[1]` steps, 2 after
 *   `LEVEL_RUNS[2]`, top after `LEVEL_RUNS[3]`. The screen paces a step at
 *   each level (`STEP_SECONDS` 0.18, 0.18, 0.13, 0.09 on the client).
 * - **Turning** a quarter drops a level; turning right round stops the kid
 *   (level 0). **Anything in the way** stops them dead: the move is refused
 *   (`null`), and so is their speed.
 * - **Letting go** coasts them on: as many tiles as their level, each a
 *   level slower than the one before (`coast`).
 * - **Deep snow**: at top speed the first `DEEP_CARRY` (2) deep-snow tiles in
 *   a row keep the speed and roll no encounter; the next one slows the kid to
 *   a walk and rolls as usual, and so does every deep-snow tile below top
 *   speed. On deep snow nobody speeds up.
 * - **Water** at top speed: the kid skims up to `SKIM_TILES` (5) tiles of
 *   it. With the boat they hop into it where the skim ends; without it a
 *   skim starts only when ground a kid can stand on lies within those tiles
 *   (as a glide takes off only when it can come down) from which they can get
 *   back: with room on it to take the run-up back (`runUpBack`), or a way
 *   round on foot (`walksBack`); and they come down on it at top speed; else
 *   the water stops them at the shore, as ever.
 * - **The ice** slides the same with skis or without (#191): a step onto it
 *   is `moveFrom`'s slide, and it stops the skis' speed.
 *
 * Nothing here is saved: speed is what a held key gives, so a reload (or
 * anything else the kid does: a battle, a word with the druid, a
 * take-off) stands them still.
 */

/** The top speed level. */
export const TOP = 3;
/** The steps held one way in a row at which each level starts. */
export const LEVEL_RUNS: readonly number[] = [0, 2, 4, 7];
/** Deep-snow tiles in a row the kid flies over at top speed, no encounter rolled. */
export const DEEP_CARRY = 2;
/** The most water tiles a skim crosses. */
export const SKIM_TILES = 5;

/** A kid moving on skis: the way they go, the steps held that way, the deep-snow tiles crossed in a row. */
export interface Ski {
	readonly dir: Direction;
	readonly run: number;
	readonly deep: number;
}

/** The speed level of `ski` (0 standing or walking, up to `TOP`). */
export function skiLevel(ski: Ski | null): number {
	if (!ski) return 0;
	let level = 0;
	for (let l = 1; l <= TOP; l++) if (ski.run >= LEVEL_RUNS[l]!) level = l;
	return level;
}

const OPPOSITE: Readonly<Record<Direction, Direction>> = {
	up: 'down',
	down: 'up',
	left: 'right',
	right: 'left'
};

/** One ski move: every tile entered, the speed level of each, where it ends, and what follows. */
export interface SkiMoved {
	/** Every tile entered, in order, the last the tile the kid stands on. Never empty. */
	path: GridPos[];
	/** The speed level each tile of `path` was crossed at (a slide's tiles at the level it began). */
	speeds: number[];
	/** The tile the move ends on, as the world shows it there. */
	tile: Tile;
	/** The kid's speed after it: null when they stand still (or walk on from a standstill). */
	ski: Ski | null;
	/** Whether the tile it ends on rolls an encounter (an encounter tile not flown over). */
	roll: boolean;
}

/** The kid on skis before a step: the speed they carry into it after a turn. */
function carried(ski: Ski | null, dir: Direction): { run: number; deep: number } {
	if (!ski) return { run: 0, deep: 0 };
	if (ski.dir === dir) return { run: ski.run, deep: ski.deep };
	if (OPPOSITE[ski.dir] === dir) return { run: 0, deep: 0 };
	// A quarter turn: a level slower.
	const level = Math.max(0, skiLevel(ski) - 1);
	return { run: LEVEL_RUNS[level]!, deep: 0 };
}

/**
 * The kid holding `dir` from `from`, on skis, carrying `ski`, with `gear`, in
 * the world of `seed` as `edits` leave it: the move, or null when the way is
 * blocked (the kid stops dead and turns). The whole rule of a held step.
 */
export function skiMove(
	seed: number,
	edits: WorldEdits,
	from: GridPos,
	dir: Direction,
	ski: Ski | null,
	gear: Gear = NO_GEAR
): SkiMoved | null {
	const { run, deep } = carried(ski, dir);
	const level = skiLevel({ dir, run, deep });
	return glide(seed, edits, from, dir, level, run, deep, gear, true);
}

/**
 * Letting go at speed: the kid coasts on the way `ski` goes, from `from`, a
 * tile for each level they have, each a level slower, by the same rules as a
 * held step but never faster (deep snow, water, the ice, anything in the
 * way). Null when they are not moving fast enough to coast (level 0), or the
 * very first tile is blocked. Afterwards they stand still.
 */
export function coast(
	seed: number,
	edits: WorldEdits,
	from: GridPos,
	ski: Ski | null,
	gear: Gear = NO_GEAR
): SkiMoved | null {
	const level = skiLevel(ski);
	if (!ski || level === 0) return null;
	const path: GridPos[] = [];
	const speeds: number[] = [];
	let at = from;
	let deep = ski.deep;
	let last: SkiMoved | null = null;
	for (let l = level; l >= 1; l--) {
		const moved = glide(seed, edits, at, ski.dir, l, LEVEL_RUNS[l]!, deep, gear, false);
		if (!moved) break;
		path.push(...moved.path);
		speeds.push(...moved.speeds);
		last = moved;
		at = moved.path[moved.path.length - 1]!;
		// A slide, a skim, a step into the boat or a slow step onto deep snow ends the coast.
		if (!moved.ski || moved.roll) break;
		deep = moved.ski.deep;
	}
	if (!last) return null;
	return { path, speeds, tile: last.tile, ski: null, roll: last.roll };
}

/**
 * One tile on at speed `level` (run `run`, `deep` deep-snow tiles crossed in
 * a row), or a skim or a slide from it; `held`: a held step, which speeds up.
 */
function glide(
	seed: number,
	edits: WorldEdits,
	from: GridPos,
	dir: Direction,
	level: number,
	run: number,
	deep: number,
	gear: Gear,
	held: boolean
): SkiMoved | null {
	const next = step(from, dir);
	const tile = editedTileAt(seed, edits, next.x, next.y);
	if (level === TOP && isWater(tile.kind)) return skim(seed, edits, from, dir, run, gear);
	const moved = moveFrom(seed, edits, from, dir, gear);
	if (!moved) return null;
	const end = moved.path[moved.path.length - 1]!;
	const speeds = moved.path.map(() => level);
	// The ice slides as it always does, and the boat sails: either stops the skis' speed.
	if (moved.path.length > 1 || isIce(moved.tile.kind) || isWater(moved.tile.kind)) {
		return {
			path: moved.path,
			speeds,
			tile: moved.tile,
			ski: null,
			roll: isEncounterTile(moved.tile.kind)
		};
	}
	if (moved.tile.kind === 'deepsnow') {
		// Flown over at top speed, the first few in a row; else a slow, ordinary step onto it.
		if (level === TOP && deep < DEEP_CARRY) {
			return {
				path: [end],
				speeds,
				tile: moved.tile,
				ski: { dir, run: run + 1, deep: deep + 1 },
				roll: false
			};
		}
		return {
			path: [end],
			speeds: [0],
			tile: moved.tile,
			ski: { dir, run: 0, deep: deep + 1 },
			roll: true
		};
	}
	return {
		path: [end],
		speeds,
		tile: moved.tile,
		ski: { dir, run: held ? run + 1 : run, deep: 0 },
		roll: isEncounterTile(moved.tile.kind)
	};
}

/**
 * Whether a kid who came down at `landing` skimming the way `dir` points can
 * skim back: `LEVEL_RUNS[TOP]` tiles of plain ground from it, on away from the
 * water, and one more to start from, none of them ice or deep snow (where no
 * kid speeds up): walked to the far end and held back towards the water, they
 * reach top speed just as they reach the shore.
 */
export function runUpBack(
	seed: number,
	edits: WorldEdits,
	landing: GridPos,
	dir: Direction
): boolean {
	let at = landing;
	for (let k = 0; k <= LEVEL_RUNS[TOP]!; k++) {
		const { kind } = editedTileAt(seed, edits, at.x, at.y);
		if (!isPassable(kind) || isIce(kind) || kind === 'deepsnow') return false;
		at = step(at, dir);
	}
	return true;
}

/** How many places `walksBack` looks at before it gives up. */
const WALK_BACK_PLACES = 2_000;

/**
 * Whether a kid on foot at `landing` can get back to `home` by the moves a
 * kid makes (steps, and the ice's slides: `moveFrom`), looking at no more
 * than `WALK_BACK_PLACES` places: the far side of a skim joined to the near
 * one some other way, round a lake or along the ice.
 */
export function walksBack(
	seed: number,
	edits: WorldEdits,
	landing: GridPos,
	home: GridPos
): boolean {
	const key = (p: GridPos) => `${p.x},${p.y}`;
	const goal = key(home);
	const seen = new Set([key(landing)]);
	const queue = [landing];
	for (let i = 0; i < queue.length && seen.size < WALK_BACK_PLACES; i++) {
		for (const way of WAYS) {
			const moved = moveFrom(seed, edits, queue[i]!, way);
			if (!moved) continue;
			const to = moved.path[moved.path.length - 1]!;
			const k = key(to);
			if (k === goal) return true;
			if (seen.has(k)) continue;
			seen.add(k);
			queue.push(to);
		}
	}
	return false;
}

const WAYS: readonly Direction[] = ['up', 'down', 'left', 'right'];

/**
 * At top speed onto water: across up to `SKIM_TILES` of it. Onto ground
 * within them, at top speed still (a deep-snow tile there flown over as the
 * first of a row); with the boat and no ground, into the boat on the last
 * water tile before anything in the way, or the fifth; without the boat and
 * no ground within reach, no skim: null, the shore stops the kid.
 */
function skim(
	seed: number,
	edits: WorldEdits,
	from: GridPos,
	dir: Direction,
	run: number,
	gear: Gear
): SkiMoved | null {
	const path: GridPos[] = [];
	let at = from;
	for (let k = 1; k <= SKIM_TILES + 1; k++) {
		const next = step(at, dir);
		const tile = editedTileAt(seed, edits, next.x, next.y);
		if (isWater(tile.kind)) {
			if (k > SKIM_TILES) break;
			path.push(next);
			at = next;
			continue;
		}
		if (!isPassable(tile.kind, gear)) break;
		// Without the boat, a skim lands only where the kid can take the same run-up back: no
		// skim ever leaves a kid on a floe they can't leave.
		if (!gear.boat && !runUpBack(seed, edits, next, dir) && !walksBack(seed, edits, next, from)) {
			break;
		}
		// Ground: down on it at top speed. (The ice slides on from there, as ever.)
		path.push(next);
		if (isIce(tile.kind)) {
			const slid = moveFrom(seed, edits, at, dir, gear);
			const rest = slid ? slid.path.slice(1) : [];
			path.push(...rest);
			const end = path[path.length - 1]!;
			const ended = editedTileAt(seed, edits, end.x, end.y);
			return {
				path,
				speeds: path.map(() => TOP),
				tile: ended,
				ski: null,
				roll: isEncounterTile(ended.kind)
			};
		}
		const deep = tile.kind === 'deepsnow';
		return {
			path,
			speeds: path.map(() => TOP),
			tile,
			ski: { dir, run: run + path.length, deep: deep ? 1 : 0 },
			roll: false
		};
	}
	// No ground within reach: into the boat where the water ends or the fifth tile, or no skim.
	if (!gear.boat || path.length === 0) return null;
	const end = path[path.length - 1]!;
	const tile = editedTileAt(seed, edits, end.x, end.y);
	return { path, speeds: path.map(() => TOP), tile, ski: null, roll: isEncounterTile(tile.kind) };
}
