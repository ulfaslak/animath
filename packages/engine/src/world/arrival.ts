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
 * A spot must open onto the world: the tiles you can get to from it, the way
 * you get about, must lead at least `ESCAPE_REACH` tiles away from her,
 * across or down. A kid put on an island without a boat, or in a nook between
 * trees and rocks, could never walk out of it, however roomy it is inside,
 * and a go-to is no way to get stuck. So a pocket that fits inside the square
 * `ESCAPE_REACH` tiles round her is closed, and every spot in it is too. With
 * no open tile near her (she is out at sea, or on an island, and you have no
 * boat) there is no spot, and you stay where you are.
 *
 * You arrive facing her.
 */
export const ARRIVAL_RADIUS = 6;

/** How far from the friend, across or down, the tiles you can get to from a spot must lead for it to be open. */
export const ESCAPE_REACH = 64;

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
	// Open or closed, by tile: tiles joined up share the answer, so one search settles a whole pocket.
	const known = new Map<string, boolean>();
	for (const ring of arrivalRings(target)) {
		// Ground first, then water, at the same number of steps.
		for (const wet of [false, true]) {
			for (const pos of ring) {
				const kind = kindAt(pos);
				if (isWater(kind) !== wet || !isPassable(kind, gear)) continue;
				if (!opensOut(pos, target, canGo, known)) continue;
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

/**
 * Whether the tiles `from` joins up with, over tiles `canGo` takes, lead
 * `ESCAPE_REACH` tiles from `target`. The answer is the same for every tile
 * joined up with `from`, so each tile searched is written into `known`, and a
 * search that runs into a known tile takes its answer. The search always goes
 * on from the tile furthest from `target`, so it leaves open country in a
 * straight run; only a closed pocket is searched through, and a closed pocket
 * fits inside the square round `target`.
 */
function opensOut(
	from: GridPos,
	target: GridPos,
	canGo: (p: GridPos) => boolean,
	known: Map<string, boolean>
): boolean {
	const start = keyOf(from);
	const already = known.get(start);
	if (already !== undefined) return already;
	const reach = (p: GridPos) => Math.max(Math.abs(p.x - target.x), Math.abs(p.y - target.y));
	// Tiles still to go on from, by how far they are from `target`.
	const waiting: GridPos[][] = Array.from({ length: ESCAPE_REACH }, () => []);
	const seen = new Set<string>([start]);
	let furthest = reach(from);
	waiting[furthest]!.push(from);
	let open = false;
	search: while (furthest >= 0) {
		const here = waiting[furthest]!.pop();
		if (!here) {
			furthest--;
			continue;
		}
		for (const way of WAYS) {
			const next = step(here, way);
			const key = keyOf(next);
			if (seen.has(key)) continue;
			const answer = known.get(key);
			if (answer !== undefined) {
				// Only tiles `canGo` takes are ever known, so this one is joined up with `from`.
				open = answer;
				break search;
			}
			if (!canGo(next)) continue;
			const far = reach(next);
			if (far >= ESCAPE_REACH) {
				open = true;
				break search;
			}
			seen.add(key);
			waiting[far]!.push(next);
			furthest = Math.max(furthest, far);
		}
	}
	for (const key of seen) known.set(key, open);
	return open;
}

function keyOf(p: GridPos): string {
	return `${p.x},${p.y}`;
}

/** The way from `pos` that looks most straight at `target`: across when it is further across, else up or down. */
function facingToward(pos: GridPos, target: GridPos): Direction {
	const dx = target.x - pos.x;
	const dy = target.y - pos.y;
	if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
	return dy > 0 ? 'down' : 'up';
}
