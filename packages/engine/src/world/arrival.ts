import { editedTileAt, WorldEdits } from './edits.js';
import {
	NO_GEAR,
	isPassable,
	isWater,
	step,
	type Direction,
	type Gear,
	type GridPos
} from './types.js';

/**
 * Going to another player ([[PRODUCT]] §4 "Playing together"): the pause
 * menu's "Go to Ada" puts you beside Ada at once, however far away she is,
 * with a poof. This is where you land.
 *
 * The nearest tile to hers you could stand on yourself, in the world as you
 * left it (a tree you chopped is ground; one she chopped is a tree to you,
 * since what a kid clears is their own), never her own tile: on foot the
 * ground, with the boat the water too. The four tiles touching hers come
 * first, then those two steps away (a diagonal away, or two along), and so
 * on, within `ARRIVAL_RADIUS` across and down; at the same number of steps
 * ground beats water, so a kid with a boat going to a friend on the beach
 * lands on the beach, and one going to a friend out sailing lands in their
 * own boat beside her. Among tiles still tied, the one lower on the screen
 * (bigger `y`) wins, then the one further left.
 *
 * A spot must open onto the world: at least `OPEN_TILES` tiles reachable
 * from it the way the player gets about. A kid put in a nook between trees
 * and rocks, or on a sandbar without a boat, could never walk out of it, and
 * a go-to is no way to get stuck. With no such tile near her (she is out at
 * sea and you have no boat, say) there is no spot, and you stay where you are.
 *
 * You arrive facing her.
 */
export const ARRIVAL_RADIUS = 6;

/** How many tiles an arrival spot must reach, walking (or sailing, with the boat), to count as open. */
export const OPEN_TILES = 40;

export interface Arrival {
	pos: GridPos;
	/** Towards the one you came to. */
	facing: Direction;
}

const WAYS: readonly Direction[] = ['up', 'down', 'left', 'right'];

/**
 * Where a player with `gear` arrives beside `target`, in world `seed` as
 * `edits` leave it, or null when nowhere near is open to them.
 */
export function arrivalSpot(
	seed: number,
	target: GridPos,
	edits: WorldEdits = WorldEdits.none,
	gear: Gear = NO_GEAR
): Arrival | null {
	if (!target || !Number.isSafeInteger(target.x) || !Number.isSafeInteger(target.y)) {
		throw new Error(`arrivalSpot: target must be a whole-number grid position`);
	}
	const kindAt = (p: GridPos) => editedTileAt(seed, edits, p.x, p.y).kind;
	const canGo = (p: GridPos) => isPassable(kindAt(p), gear);
	for (const ring of arrivalRings(target)) {
		// Ground first, then water, at the same number of steps.
		for (const wet of [false, true]) {
			for (const pos of ring) {
				const kind = kindAt(pos);
				if (isWater(kind) !== wet || !isPassable(kind, gear) || !opensOut(pos, canGo)) continue;
				return { pos, facing: facingToward(pos, target) };
			}
		}
	}
	return null;
}

/**
 * Every tile within `ARRIVAL_RADIUS` of `target` across and down but
 * `target` itself, in rings of the same number of steps from it, nearest
 * first; within a ring lower on the screen first, then further left.
 */
export function arrivalRings(target: GridPos): GridPos[][] {
	const rings: GridPos[][] = [];
	for (let dy = -ARRIVAL_RADIUS; dy <= ARRIVAL_RADIUS; dy++) {
		for (let dx = -ARRIVAL_RADIUS; dx <= ARRIVAL_RADIUS; dx++) {
			const steps = Math.abs(dx) + Math.abs(dy);
			if (steps === 0) continue;
			(rings[steps - 1] ??= []).push({ x: target.x + dx, y: target.y + dy });
		}
	}
	for (const ring of rings) ring.sort((a, b) => b.y - a.y || a.x - b.x);
	return rings;
}

/** Whether `from` reaches `OPEN_TILES` tiles over tiles `canGo` takes, itself counted. */
function opensOut(from: GridPos, canGo: (p: GridPos) => boolean): boolean {
	const seen = new Set<string>([`${from.x},${from.y}`]);
	const queue: GridPos[] = [from];
	for (let i = 0; i < queue.length && seen.size < OPEN_TILES; i++) {
		for (const way of WAYS) {
			const next = step(queue[i]!, way);
			const key = `${next.x},${next.y}`;
			if (seen.has(key) || !canGo(next)) continue;
			seen.add(key);
			queue.push(next);
		}
	}
	return seen.size >= OPEN_TILES;
}

/** The way from `pos` that looks most straight at `target`: across when it is further across, else up or down. */
function facingToward(pos: GridPos, target: GridPos): Direction {
	const dx = target.x - pos.x;
	const dy = target.y - pos.y;
	if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
	return dy > 0 ? 'down' : 'up';
}
