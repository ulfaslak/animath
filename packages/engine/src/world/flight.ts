import { hasItem } from '../items/catalog.js';
import { clearLanding, clearingTool, type Cleared } from './clearing.js';
import { editedTileAt, type WorldEdits } from './edits.js';
import { travelKindAt } from './generate.js';
import { isWalkable, isWater, type Direction, type GridPos, type TileKind } from './types.js';

/**
 * The paraglider ([[PRODUCT]] §4 "World"): with it, Space held takes the kid
 * up and straight ahead, the way they face, over anything, up to
 * `GLIDE_TILES` tiles, and letting go brings them down on the first tile
 * ahead where they can stand. The rules are here and nowhere else: the
 * authority applies them one intent at a time (`take-off`, `glide`, `land`),
 * and the screen asks `landingDistance` where the landing ring goes.
 *
 * Whether a tile is landable depends only on what the kid owns
 * (`isLandable`): ground always; water, shallow or deep, with the boat (they
 * come down in it); a tree with the axe and a rock with the pickaxe (landing
 * clears it: `clearLanding`); a tent never. The world is read as the kid left
 * it, so a stump or gravel they made is ground.
 *
 * The reach is fixed at take-off: the last landable tile of the
 * `GLIDE_TILES` ahead. No flight ends past it, and with no landable tile in
 * them there is no take-off at all. Letting go lands on the first landable
 * tile at or after the one the glider is over, never the take-off tile, and
 * holding on stops at the reach. So a flight always ends on a tile the kid
 * can stand on, at most `GLIDE_TILES` out, and nobody is ever put back
 * ([[INVARIANTS]] § World).
 */

/** How far a glide goes at most: the tiles straight ahead of the take-off tile that it looks at. */
export const GLIDE_TILES = 20;

/**
 * A flight under way: the tile it took off from, the way it goes (the way
 * the kid faced), its reach (1 to `GLIDE_TILES`: the farthest it may come
 * down, fixed at take-off), and how many tiles it has flown (0 while it
 * rises over the take-off tile).
 */
export interface Flight {
	readonly from: GridPos;
	readonly dir: Direction;
	readonly reach: number;
	readonly flown: number;
}

/** What a flight's rules ask of the kid: what they own. */
export interface FlightGear {
	readonly items: readonly string[];
}

/** The kid about to take off: where they stand, which way they face, what they own. */
export interface Flyer extends FlightGear {
	readonly pos: GridPos;
	readonly facing: Direction;
}

/**
 * Why a take-off was refused, as a code: the kid owns no glider
 * (`no-glider`), or none of the `GLIDE_TILES` ahead is a tile they could come
 * down on (`nowhere-to-land`: a lake too wide without the boat, a forest too
 * deep without the axe).
 */
export type TakeOffRejection = 'no-glider' | 'nowhere-to-land';

export type TakeOff = { ok: true; flight: Flight } | { ok: false; reason: TakeOffRejection };

/**
 * Where a flight came down: the tile the kid stands on, the tiles flown in
 * the whole flight (each one a step, the landing tile's included), the world
 * as they leave it, and the tree chopped or the rock broken by landing on it.
 */
export interface Landing {
	pos: GridPos;
	flown: number;
	edits: WorldEdits;
	cleared: Cleared | null;
}

const DELTA: Readonly<Record<Direction, readonly [number, number]>> = {
	up: [0, -1],
	down: [0, 1],
	left: [-1, 0],
	right: [1, 0]
};

/**
 * Whether a kid who owns `gear` can come down on a tile of this kind in the
 * world of `seed`: ground always, water with the boat, a tree with the land's
 * axe, a rock with the pickaxe; a tent, an ice block and a fishing hole never.
 */
export function isLandable(seed: number, kind: TileKind, gear: FlightGear): boolean {
	if (isWalkable(kind)) return true;
	if (isWater(kind)) return hasItem(gear, 'boat');
	if (kind === 'tree' || kind === 'rock') return hasItem(gear, clearingTool(seed, kind));
	return false;
}

/** The tile `n` tiles out from `from` the way `dir` points. */
export function flightTile(from: GridPos, dir: Direction, n: number): GridPos {
	const [dx, dy] = DELTA[dir];
	return { x: from.x + dx * n, y: from.y + dy * n };
}

/**
 * Whether the kid could come down on the tile `n` out, in the world as
 * `edits` leave it. Deep water lands as the shallows do, so this reads the
 * kind as getting about reads it (`travelKindAt`), which spares the 24 tiles
 * of elevation that tell the two apart.
 */
function landableAt(
	seed: number,
	edits: WorldEdits,
	from: GridPos,
	dir: Direction,
	n: number,
	gear: FlightGear
): boolean {
	const { x, y } = flightTile(from, dir, n);
	const kind = edits.has(x, y) ? editedTileAt(seed, edits, x, y).kind : travelKindAt(seed, x, y);
	return isLandable(seed, kind, gear);
}

/** The tile a flight is over now. */
export function flightPos(flight: Flight): GridPos {
	return flightTile(flight.from, flight.dir, flight.flown);
}

/**
 * The reach of a take-off from `from` facing `dir`, in the world of `seed`
 * as `edits` leave it: the last tile of the `GLIDE_TILES` ahead the kid
 * could come down on, as a distance from 1 to `GLIDE_TILES`, or null when
 * there is none.
 */
export function flightReach(
	seed: number,
	edits: WorldEdits,
	from: GridPos,
	dir: Direction,
	gear: FlightGear
): number | null {
	for (let n = GLIDE_TILES; n >= 1; n--) {
		if (landableAt(seed, edits, from, dir, n, gear)) return n;
	}
	return null;
}

/**
 * Take off: the whole rule. The kid owns the glider, and some tile of the
 * `GLIDE_TILES` ahead is one they could come down on; the flight goes the way
 * they face, with that reach, from the tile they stand on (on land or in the
 * boat). Pure: a refusal changes nothing.
 */
export function takeOff(seed: number, edits: WorldEdits, flyer: Flyer): TakeOff {
	if (!hasItem(flyer, 'glider')) return { ok: false, reason: 'no-glider' };
	const reach = flightReach(seed, edits, flyer.pos, flyer.facing, flyer);
	if (reach === null) return { ok: false, reason: 'nowhere-to-land' };
	const from = { x: flyer.pos.x, y: flyer.pos.y };
	return { ok: true, flight: { from, dir: flyer.facing, reach, flown: 0 } };
}

/** The flight one tile further on. At its reach it goes no further: there it lands. */
export function glideOn(flight: Flight): Flight {
	return flight.flown >= flight.reach ? flight : { ...flight, flown: flight.flown + 1 };
}

/**
 * Where the flight comes down if the kid lets go now, as a distance from the
 * take-off tile: the first tile at or after the one it is over (never the
 * take-off tile itself) that they could come down on, and at the latest the
 * reach, which always is one.
 */
export function landingDistance(
	seed: number,
	edits: WorldEdits,
	flight: Flight,
	gear: FlightGear
): number {
	for (let n = Math.max(1, flight.flown); n < flight.reach; n++) {
		if (landableAt(seed, edits, flight.from, flight.dir, n, gear)) return n;
	}
	return flight.reach;
}

/**
 * Come down: the kid lets go, or the flight reached its reach. It glides on
 * to `landingDistance` and lands there; a tree or a rock there is cleared
 * with its tool as they touch down (`clearLanding`), which trims the save's
 * cleared tiles round the landing tile as any clear does. Pure.
 */
export function landFlight(
	seed: number,
	edits: WorldEdits,
	flight: Flight,
	gear: FlightGear
): Landing {
	const flown = landingDistance(seed, edits, flight, gear);
	const pos = flightTile(flight.from, flight.dir, flown);
	const clear = clearLanding(seed, edits, { pos, items: gear.items });
	return clear.ok
		? { pos, flown, edits: clear.edits, cleared: clear.cleared }
		: { pos, flown, edits, cleared: null };
}
