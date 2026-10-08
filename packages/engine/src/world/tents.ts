import { editedTileAt, WorldEdits } from './edits.js';
import { generateChunk, tileAtWorld, travelKindAt } from './generate.js';
import { MAX_SLIDE } from './slide.js';
import {
	CHUNK_SIZE,
	NO_GEAR,
	isIce,
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
 * The tile to stand on beside it is always ground, never water, so the way it
 * points a kid is one they can walk (or sail) to the end of. The ground is
 * the world as the player has left it (`world/edits.ts`): a path they
 * chopped through the trees is a path.
 */

/** How far `nearestTent` looks by default, in steps, before it gives up. */
export const TENT_SEARCH_STEPS = 200;

/** Keeps the packed search keys exact (well inside 2^53). */
const MAX_SEARCH_STEPS = 1_000_000;

/**
 * The ground the searches read, a chunk at a time, in the world searched
 * last: `travelKindAt`'s kinds (the seed's tile, deep water read as water),
 * taken from the chunk `generateChunk` gives, which reads its elevations
 * once for all 256 tiles. A search spreads over thousands of tiles, and the
 * next one, a step further on (the way to the doctor, looked for again as a
 * tired team walks), over nearly the same tiles again, so a chunk is made
 * once and read many times. A cache, not state: it holds exactly what the
 * seeded world gives, forgets everything when another seed is searched, and
 * keeps the `CHUNKS_KEPT` chunks read latest and at most as many before them
 * (a kilobyte for four chunks), which covers a search to `TENT_SEARCH_STEPS`
 * with room to spare.
 */
const CHUNKS_KEPT = 512;
/** Chunk coordinates within half of this of 0 pack into one exact key; further out is read uncached. */
const CHUNK_SPAN = 2 ** 26;
/**
 * Each tile kind's code in the cache: every kind has one, which the `Record`
 * makes the compiler hold to, so a kind added to `TileKind` can never be
 * read back as another.
 */
const KIND_CODES: Readonly<Record<TileKind, number>> = {
	grass: 0,
	tallgrass: 1,
	sand: 2,
	water: 3,
	deepwater: 4,
	rock: 5,
	tree: 6,
	tent: 7,
	snow: 8,
	deepsnow: 9,
	ice: 10,
	iceblock: 11,
	hole: 12
};
const KINDS: readonly TileKind[] = (Object.keys(KIND_CODES) as TileKind[]).sort(
	(a, b) => KIND_CODES[a] - KIND_CODES[b]
);
let chunksSeed: number | null = null;
let latest = new Map<number, Uint8Array>();
let before = new Map<number, Uint8Array>();

/** The tile's kind as `travelKindAt` gives it, read from the chunk cache. */
function travelKind(seed: number, x: number, y: number): TileKind {
	const cx = Math.floor(x / CHUNK_SIZE);
	const cy = Math.floor(y / CHUNK_SIZE);
	const half = CHUNK_SPAN / 2;
	if (!(Math.abs(cx) < half && Math.abs(cy) < half)) return travelKindAt(seed, x, y);
	if (chunksSeed !== seed) {
		latest = new Map();
		before = new Map();
		chunksSeed = seed;
	}
	const key = (cx + half) * CHUNK_SPAN + (cy + half);
	let kinds = latest.get(key);
	if (kinds === undefined) {
		kinds = before.get(key) ?? chunkKinds(seed, cx, cy);
		if (latest.size >= CHUNKS_KEPT) {
			before = latest;
			latest = new Map();
		}
		latest.set(key, kinds);
	}
	return KINDS[kinds[(y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE)]!]!;
}

/** Chunk (cx, cy)'s kinds as a player gets about in them, row-major, deep water read as water. */
function chunkKinds(seed: number, cx: number, cy: number): Uint8Array {
	const tiles = generateChunk(seed, cx, cy).tiles;
	const kinds = new Uint8Array(tiles.length);
	for (let i = 0; i < tiles.length; i++) {
		const kind = tiles[i]!.kind;
		kinds[i] = KIND_CODES[kind === 'deepwater' ? 'water' : kind];
	}
	return kinds;
}

export interface TentSpot {
	/** The tent's tile. */
	tent: GridPos;
	/**
	 * Where the player stands: a walkable tile next to the tent, reachable from
	 * the start the way the player gets about (on foot, or with the boat over
	 * the water too).
	 */
	stand: GridPos;
	/** The way a player on `stand` faces to look at the tent. */
	facing: Direction;
	/** Steps from the start to `stand`, the same way; 0 when the start is already beside the tent. */
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
 * player can go to (`isPassable`), a move at a time as the kid moves: onto
 * the ice a move is the whole slide (`moveFrom`), so it reaches only the
 * places a slide stops on, each slid tile a step. The first ring that touches a tent from a
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
				: travelKind(seed, p.x, p.y);
			kinds.set(k, kind);
		}
		return kind;
	};

	const start = { x: from.x, y: from.y };
	// A move from a place a kid can stop on: a step, or onto the ice the whole slide (as
	// `moveFrom` slides): the place it ends and its tiles, every one a step; null where the
	// tile that way can't be stepped onto. So the way never stops on the ice where a slide
	// goes on, and never steers across a lake a kid slides past the far end of.
	const passable = (p: GridPos) => isPassable(kindAt(p), gear);
	const move = (pos: GridPos, dir: Direction): { to: GridPos; tiles: number } | null => {
		let at = step(pos, dir);
		if (!passable(at)) return null;
		let tiles = 1;
		while (isIce(kindAt(at)) && tiles < MAX_SLIDE) {
			const next = step(at, dir);
			if (!passable(next)) break;
			at = next;
			tiles++;
		}
		return { to: at, tiles };
	};
	// The places reached, by the fewest steps there, a bucket of them for each number of
	// steps: a slide of n tiles lands n buckets on. A place is taken from the bucket of its
	// fewest steps; a later, longer way to it is passed over.
	const best = new Map<number, number>([[key(start), 0]]);
	const buckets: GridPos[][] = [[start]];
	let waiting = 1;
	for (let steps = 0; steps <= maxSteps && waiting > 0; steps++) {
		const ring = (buckets[steps] ?? []).filter((p) => best.get(key(p)) === steps);
		waiting -= buckets[steps]?.length ?? 0;
		let found: TentSpot | null = null;
		for (const stand of ring) {
			if (!isWalkable(kindAt(stand))) continue;
			for (const facing of TOWARD_TENT) {
				const tent = step(stand, facing);
				if (kindAt(tent) !== 'tent') continue;
				const spot: TentSpot = { tent, stand, facing, steps };
				if (!found || comesFirst(spot, found)) found = spot;
			}
		}
		if (found) return found;
		for (const pos of ring) {
			for (const dir of TOWARD_TENT) {
				const moved = move(pos, dir);
				if (!moved) continue;
				const far = steps + moved.tiles;
				if (far > maxSteps) continue;
				const k = key(moved.to);
				const known = best.get(k);
				if (known !== undefined && known <= far) continue;
				best.set(k, far);
				(buckets[far] ??= []).push(moved.to);
				waiting++;
			}
		}
	}
	return null;
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
