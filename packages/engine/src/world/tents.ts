import { editedTileAt, WorldEdits } from './edits.js';
import { tileAtWorld, travelKindAt } from './generate.js';
import {
	NO_GEAR,
	isPassable,
	isWalkable,
	step,
	type Direction,
	type Gear,
	type GridPos,
	type TileKind
} from './types.js';

/**
 * Doctor's tents, from the player's side: which one is nearest, where to stand
 * beside it, and whether the player is facing one.
 *
 * Tents are solid. A player talks to the doctor by standing on a tile next to
 * the tent and facing it; walking into the tent is a bump that turns them
 * toward it.
 *
 * "Nearest" is measured the way the player gets about: the fewest steps over
 * walkable ground, never through water, rock, trees or another tent — or,
 * with the boat, over walkable ground and water. A tent nobody can get to
 * (boxed in by trees, or on an island without a boat) is never the nearest.
 * The tile to stand on beside it is always ground, never water. So when a
 * knock-out takes the player to a tent, they land on ground they could have
 * got to themselves, and they can always get back. The ground is the world
 * as the player has left it (`world/edits.ts`): a path they chopped through
 * the trees is a path.
 */

/** How far `nearestTent` looks by default, in steps, before it gives up. */
export const TENT_SEARCH_STEPS = 200;

/** Keeps the packed search keys exact (well inside 2^53). */
const MAX_SEARCH_STEPS = 1_000_000;

export interface TentSpot {
	/** The tent's tile. */
	tent: GridPos;
	/** Where the player stands: a walkable tile next to the tent, reachable on foot from the start. */
	stand: GridPos;
	/** The way a player on `stand` faces to look at the tent. */
	facing: Direction;
	/** Steps on foot from the start to `stand`; 0 when the start is already beside the tent. */
	steps: number;
}

/**
 * Directions from a stand toward its tent, in order of preference when a tent
 * can be reached from two sides in the same number of steps: facing up is
 * standing in front of the door (the tent's door faces down, toward the
 * camera), then from the left, from the right, and from behind.
 */
const TOWARD_TENT: readonly Direction[] = ['up', 'right', 'left', 'down'];

/**
 * The tent nearest to `from` for a player with `gear` (on foot without a
 * boat), with the tile to stand on beside it.
 *
 * The search spreads out one step at a time from `from` over the tiles the
 * player can go to (`isPassable`). The first ring that touches a tent from a
 * walkable tile wins; when that ring touches more than one tent side, the
 * tent further up (smaller `y`) wins, then the one further left (smaller
 * `x`), then the side in `TOWARD_TENT` order. `from` itself may be any tile:
 * it is where the search starts, and it is a stand only if it is walkable.
 * Water is crossed with a boat, never stood on beside a tent.
 *
 * Returns `null` when no tent can be reached within `maxSteps` steps — `from`
 * is walled in, or there is simply no tent that close. `edits` are the tiles
 * the player has cleared (none by default), `gear` what they carry (the boat
 * crosses water).
 */
export function nearestTent(
	seed: number,
	from: GridPos,
	maxSteps: number = TENT_SEARCH_STEPS,
	edits: WorldEdits = WorldEdits.none,
	gear: Gear = NO_GEAR
): TentSpot | null {
	if (!from || !Number.isSafeInteger(from.x) || !Number.isSafeInteger(from.y)) {
		throw new Error(
			`nearestTent: from must be a whole-number grid position, got ${String(from && `${from.x},${from.y}`)}`
		);
	}
	if (!Number.isInteger(maxSteps) || maxSteps < 0 || maxSteps > MAX_SEARCH_STEPS) {
		throw new Error(
			`nearestTent: maxSteps must be a whole number 0..${MAX_SEARCH_STEPS}, got ${maxSteps}`
		);
	}

	// Every tile the search looks at is within maxSteps + 1 of `from`, so offsets
	// pack into one number without collisions.
	const reach = maxSteps + 1;
	const span = 2 * reach + 1;
	const key = (p: GridPos) => (p.x - from.x + reach) * span + (p.y - from.y + reach);
	const kinds = new Map<number, TileKind>();
	const kindAt = (p: GridPos): TileKind => {
		const k = key(p);
		let kind = kinds.get(k);
		if (kind === undefined) {
			// A tile the player cleared is ground; any other reads as the seed's, with
			// deep water read as water: a boat crosses both alike.
			kind = edits.has(p.x, p.y)
				? editedTileAt(seed, edits, p.x, p.y).kind
				: travelKindAt(seed, p.x, p.y);
			kinds.set(k, kind);
		}
		return kind;
	};

	const start = { x: from.x, y: from.y };
	const seen = new Set<number>([key(start)]);
	let ring: GridPos[] = [start];
	for (let steps = 0; ; steps++) {
		let best: TentSpot | null = null;
		for (const stand of ring) {
			if (!isWalkable(kindAt(stand))) continue;
			for (const facing of TOWARD_TENT) {
				const tent = step(stand, facing);
				if (kindAt(tent) !== 'tent') continue;
				const spot: TentSpot = { tent, stand, facing, steps };
				if (!best || comesFirst(spot, best)) best = spot;
			}
		}
		if (best) return best;
		if (steps === maxSteps) return null;

		const next: GridPos[] = [];
		for (const pos of ring) {
			for (const dir of TOWARD_TENT) {
				const n = step(pos, dir);
				const k = key(n);
				if (seen.has(k)) continue;
				seen.add(k);
				if (isPassable(kindAt(n), gear)) next.push(n);
			}
		}
		if (next.length === 0) return null;
		ring = next;
	}
}

function comesFirst(a: TentSpot, b: TentSpot): boolean {
	if (a.tent.y !== b.tent.y) return a.tent.y < b.tent.y;
	if (a.tent.x !== b.tent.x) return a.tent.x < b.tent.x;
	return TOWARD_TENT.indexOf(a.facing) < TOWARD_TENT.indexOf(b.facing);
}

/**
 * Whether a player standing at `pos` and facing `facing` can talk to a doctor:
 * the tile in front of them is a tent. This is the one check behind the
 * "Press Enter to talk to the doctor" prompt and behind `interact` opening a
 * doctor visit. Facing, not just being next to it: a player walking past a
 * tent is not interrupted, and one who bumps into it is facing it.
 */
export function canTalkToDoctor(seed: number, pos: GridPos, facing: Direction): boolean {
	const front = step(pos, facing);
	return tileAtWorld(seed, front.x, front.y).kind === 'tent';
}
