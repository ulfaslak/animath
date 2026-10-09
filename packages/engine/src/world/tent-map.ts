import { WorldEdits, editedTileAt } from './edits.js';
import { TENT_LATTICE, onTentLattice, travelKindAt } from './generate.js';
import { isWalkable, step, type Direction, type GridPos } from './types.js';

/**
 * The tent mapping ([[PRODUCT]] §4 "Lands", #191): where a flight from a
 * witch doctor's tent comes down in another land. Every land keeps the same
 * lattice of tent spots (`TENT_LATTICE`), so a flight from tent T lands at the
 * tent on T's own spot in the land reached when that land has one there, and
 * otherwise at the tent of that land nearest to T. A land with a tent on
 * every lattice spot (The Arctic, #191 step 4) is always reached at T, so a
 * flight out and back comes home to the tent it left. A first arrival, the
 * one a starter is picked on, is mapped from the world's spawn instead
 * (`fly`), so it comes down at the spawn tent.
 *
 * Grid coordinates throughout: the coordinates a kid sees count from each
 * world's spawn (`coordinates.ts`), and are unaffected.
 */

/** Where a flight comes down: the tent, the tile beside it to stand on, and the way to face it. */
export interface TentArrival {
	tent: GridPos;
	stand: GridPos;
	facing: Direction;
}

/**
 * How far from T, in lattice spots across or down, the search for the
 * nearest tent goes: 40 spots is over 750 tiles, where every world has tents
 * many times over. Past it there is no tent (`tentArrival` is null).
 */
export const TENT_MAP_SPOTS = 40;

/**
 * The sides of a tent a kid can be put on, in order of preference: below it
 * facing up (in front of its door, which faces the camera), then from the
 * left, from the right, and from behind, as `nearestTent` prefers them.
 */
const SIDES: readonly Direction[] = ['up', 'right', 'left', 'down'];

const OPPOSITE: Record<Direction, Direction> = {
	up: 'down',
	down: 'up',
	left: 'right',
	right: 'left'
};

/**
 * The tent mapping over any land, told by two questions about it: whether
 * the lattice spot `p` holds a tent, and whether a kid can stand on tile `p`.
 * The spot of `from`'s own lattice cell first when it holds a tent a kid can
 * stand beside; otherwise, of the spots holding one, the nearest to `from` in
 * a straight line, then the one further up, then further left. The side to
 * stand on is the first of `SIDES` a kid can stand on; a tent with none is
 * passed over. Null when no spot within `TENT_MAP_SPOTS` will do.
 */
export function mappedTent(
	from: GridPos,
	land: { isTent: (p: GridPos) => boolean; canStand: (p: GridPos) => boolean }
): TentArrival | null {
	if (!from || !Number.isSafeInteger(from.x) || !Number.isSafeInteger(from.y)) {
		throw new Error('mappedTent: from must be a whole-number grid position');
	}
	const { everyX, atX, everyY, atY } = TENT_LATTICE;
	// The lattice spot nearest to `from`, in lattice steps (i, j): spot (atX + i·everyX, atY + j·everyY).
	const i0 = Math.round((from.x - atX) / everyX);
	const j0 = Math.round((from.y - atY) / everyY);
	let best: { arrival: TentArrival; d2: number } | null = null;
	const spacing = Math.min(everyX, everyY);
	for (let ring = 0; ring <= TENT_MAP_SPOTS; ring++) {
		// A spot `ring` lattice steps out is at least this far from `from`: once the best so far is
		// nearer, no later ring can beat it.
		const nearest = Math.max(0, ring * spacing - spacing / 2 - 1);
		if (best && nearest * nearest > best.d2) break;
		for (let dj = -ring; dj <= ring; dj++) {
			for (let di = -ring; di <= ring; di++) {
				if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
				const tent = { x: atX + (i0 + di) * everyX, y: atY + (j0 + dj) * everyY };
				const dx = tent.x - from.x;
				const dy = tent.y - from.y;
				const d2 = dx * dx + dy * dy;
				if (best && !comesFirst(tent, d2, best.arrival.tent, best.d2)) continue;
				if (!land.isTent(tent)) continue;
				const side = SIDES.find((facing) => land.canStand(step(tent, OPPOSITE[facing])));
				if (!side) continue;
				best = { arrival: { tent, stand: step(tent, OPPOSITE[side]), facing: side }, d2 };
			}
		}
	}
	return best?.arrival ?? null;
}

/** Whether spot `a`, `d2a` from the start (squared), comes before `b`: nearer, then further up, then further left. */
function comesFirst(a: GridPos, d2a: number, b: GridPos, d2b: number): boolean {
	if (d2a !== d2b) return d2a < d2b;
	if (a.y !== b.y) return a.y < b.y;
	return a.x < b.x;
}

/**
 * The tent mapping in the world of `seed` as the player left it (`edits`):
 * where a flight from the tent at `from` comes down there. A spot holds a
 * tent when the seed's tile there is one (tents are never cleared), and a kid
 * can stand on walkable ground, a path they cleared included: they get off
 * the plane on foot, beside the witch doctor, who can always fly them on.
 */
export function tentArrival(
	seed: number,
	from: GridPos,
	edits: WorldEdits = WorldEdits.none
): TentArrival | null {
	return mappedTent(from, {
		isTent: (p) => onTentLattice(p.x, p.y) && travelKindAt(seed, p.x, p.y) === 'tent',
		canStand: (p) => isWalkable(editedTileAt(seed, edits, p.x, p.y).kind)
	});
}
