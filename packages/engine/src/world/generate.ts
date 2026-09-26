import type { Biome } from '../animals/types.js';
import { Rng, hashInts } from '../rng.js';
import { CHUNK_SIZE, type Chunk, type Tile, type TileKind } from './types.js';

/**
 * Procedural world — placeholder version.
 *
 * Contract (the part that must hold as this grows): `generateChunk(seed, cx, cy)`
 * is a pure function. Any client or server with the same seed produces the
 * identical chunk, in any order, without talking to anyone. Only *dynamic*
 * state — players, spawned animals, catches — ever needs to travel over the
 * network. Keep every random draw here keyed on (seed, coordinates) via
 * `hashInts`, never on call order.
 *
 * What it does today: value noise for elevation → water / sand / grass / rock,
 * a second noise for moisture → tall grass and tree density, a coarse biome
 * label per tile. River banks are sand with patches of reeds (tall grass) so
 * the river biome has encounter tiles. Water with water all round it,
 * `DEEP_WATER_MARGIN` tiles out, is deep water, the sea biome: the middle of
 * a lake, never next to a shore. Doctor tents are placed on a sparse lattice
 * near water or trees. Rivers, paths, points of interest and proper biome
 * shaping are the real work, tracked as issues.
 */

/** Below this elevation a tile is water. */
const WATER_LEVEL = 0.36;

/**
 * Deep water is water whose every tile within this many tiles, diagonals
 * included, is water too: the 5×5 square round it. So the shallows along
 * every shore are two tiles wide, a river narrower than five tiles has no
 * deep water, and deep water is at least three steps from any land.
 */
export const DEEP_WATER_MARGIN = 2;

function valueNoise(seed: number, x: number, y: number, scale: number): number {
	const fx = x / scale;
	const fy = y / scale;
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const tx = fx - x0;
	const ty = fy - y0;
	const lattice = (ix: number, iy: number) => hashInts(seed, ix, iy) / 4294967296;
	const sx = tx * tx * (3 - 2 * tx);
	const sy = ty * ty * (3 - 2 * ty);
	const top = lattice(x0, y0) * (1 - sx) + lattice(x0 + 1, y0) * sx;
	const bottom = lattice(x0, y0 + 1) * (1 - sx) + lattice(x0 + 1, y0 + 1) * sx;
	return top * (1 - sy) + bottom * sy;
}

function elevation(seed: number, x: number, y: number): number {
	return (
		0.6 * valueNoise(seed ^ 0x1a2b3c, x, y, 24) +
		0.3 * valueNoise(seed ^ 0x4d5e6f, x, y, 9) +
		0.1 * valueNoise(seed ^ 0x708192, x, y, 3)
	);
}

function moisture(seed: number, x: number, y: number): number {
	return 0.7 * valueNoise(seed ^ 0xabcdef, x, y, 18) + 0.3 * valueNoise(seed ^ 0x123456, x, y, 5);
}

function biomeFor(elev: number, moist: number): Biome {
	if (elev < 0.4) return 'river';
	if (elev > 0.72) return 'mountain';
	return moist > 0.55 ? 'forest' : 'meadow';
}

/** The elevation at a world tile: `elevation`, or a cache of it that a whole chunk shares. */
type ElevationAt = (x: number, y: number) => number;

/**
 * Elevations read lately, in the world last asked about: the deep-water check
 * reads the 24 tiles round a water tile, and its neighbour's check most of
 * them again, so a sweep over nearby tiles (a way to a tent, the ground round
 * a tall-grass tile, the tiles under the figures) reads each one once. A
 * cache, not state: it holds exactly what `elevation` gives, forgets it all
 * past `MEMO_LIMIT` tiles or when another seed is asked about, and leaves out
 * coordinates too far out to pack into one key.
 */
const MEMO_LIMIT = 1 << 18;
const MEMO_SPAN = 2 ** 26;
const memo = new Map<number, number>();
let memoSeed: number | null = null;

function memoElevation(seed: number, x: number, y: number): number {
	const half = MEMO_SPAN / 2;
	if (!(Math.abs(x) < half && Math.abs(y) < half)) return elevation(seed, x, y);
	if (memoSeed !== seed) {
		memo.clear();
		memoSeed = seed;
	}
	const key = (x + half) * MEMO_SPAN + (y + half);
	let e = memo.get(key);
	if (e === undefined) {
		if (memo.size >= MEMO_LIMIT) memo.clear();
		e = elevation(seed, x, y);
		memo.set(key, e);
	}
	return e;
}

/** Whether the water tile at (x, y) is deep: water all round it, `DEEP_WATER_MARGIN` tiles out. */
function isDeep(elev: ElevationAt, x: number, y: number): boolean {
	// The nearest tiles first: along a shore the first land is found at once.
	for (let r = 1; r <= DEEP_WATER_MARGIN; r++) {
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
				if (elev(x + dx, y + dy) >= WATER_LEVEL) return false;
			}
		}
	}
	return true;
}

function tileAt(
	seed: number,
	x: number,
	y: number,
	elevAt: ElevationAt = (ex, ey) => memoElevation(seed, ex, ey),
	depth = true
): Tile {
	const elev = elevAt(x, y);
	const moist = moisture(seed, x, y);
	const deep = depth && elev < WATER_LEVEL && isDeep(elevAt, x, y);
	const biome = deep ? 'sea' : biomeFor(elev, moist);
	const local = new Rng(hashInts(seed, x, y, 7));

	let kind: TileKind;
	if (elev < WATER_LEVEL) kind = deep ? 'deepwater' : 'water';
	// The bank: sand with patches of reeds, so river animals have tall grass to hide in.
	else if (elev < 0.4) kind = local.chance(0.3) ? 'tallgrass' : 'sand';
	else if (elev > 0.8) kind = 'rock';
	else if (biome === 'forest' && local.chance(0.35)) kind = 'tree';
	else if (biome === 'mountain' && local.chance(0.15)) kind = 'rock';
	else if (local.chance(biome === 'forest' ? 0.35 : 0.18)) kind = 'tallgrass';
	else kind = 'grass';

	// Doctor tents: sparse lattice, only on ground, only near water or forest.
	if (
		kind === 'grass' &&
		mod(x, 23) === 5 &&
		mod(y, 19) === 7 &&
		(biome === 'forest' || hasWaterNearby(seed, x, y))
	) {
		kind = 'tent';
	}

	const height = elev < WATER_LEVEL ? 0 : Math.max(0, Math.round((elev - WATER_LEVEL) * 6));
	return { kind, biome, height };
}

/** Modulo that is never negative: `%` keeps the sign of `x`, so `-3 % 23` is -3. */
function mod(x: number, m: number): number {
	return ((x % m) + m) % m;
}

function hasWaterNearby(seed: number, x: number, y: number): boolean {
	for (let dy = -3; dy <= 3; dy++) {
		for (let dx = -3; dx <= 3; dx++) {
			if (elevation(seed, x + dx, y + dy) < WATER_LEVEL) return true;
		}
	}
	return false;
}

export function generateChunk(seed: number, cx: number, cy: number): Chunk {
	const tiles: Tile[] = new Array(CHUNK_SIZE * CHUNK_SIZE);
	const x0 = cx * CHUNK_SIZE;
	const y0 = cy * CHUNK_SIZE;
	// Every deep-water check reads the elevation up to DEEP_WATER_MARGIN tiles
	// round a tile: read the chunk's window of it once. The same numbers as
	// `elevation`, so a chunk's tiles are `tileAtWorld`'s.
	const m = DEEP_WATER_MARGIN;
	const span = CHUNK_SIZE + 2 * m;
	const grid = new Float64Array(span * span);
	for (let gy = 0; gy < span; gy++) {
		for (let gx = 0; gx < span; gx++) {
			grid[gy * span + gx] = elevation(seed, x0 - m + gx, y0 - m + gy);
		}
	}
	const elevAt: ElevationAt = (x, y) => grid[(y - y0 + m) * span + (x - x0 + m)]!;

	for (let y = 0; y < CHUNK_SIZE; y++) {
		for (let x = 0; x < CHUNK_SIZE; x++) {
			tiles[y * CHUNK_SIZE + x] = tileAt(seed, x0 + x, y0 + y, elevAt);
		}
	}
	return { cx, cy, tiles };
}

/** Convenience for callers that think in world coordinates. */
export function tileAtWorld(seed: number, x: number, y: number): Tile {
	return tileAt(seed, x, y);
}

/**
 * The tile's kind as far as getting about goes: `tileAtWorld`'s, except that
 * deep water is `water` too. Where a player can go and stand treats both
 * alike, and telling them apart reads 24 more tiles of elevation, so a search
 * over many tiles (`nearestTent`) reads this instead.
 */
export function travelKindAt(seed: number, x: number, y: number): TileKind {
	return tileAt(seed, x, y, undefined, false).kind;
}

/**
 * Where a new player appears: the nearest walkable tile to the origin, scanning
 * outward in rings. Deterministic per seed.
 */
export function spawnPoint(seed: number): { x: number; y: number } {
	for (let r = 0; r < 64; r++) {
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
				const t = tileAt(seed, dx, dy);
				if (t.kind === 'grass') return { x: dx, y: dy };
			}
		}
	}
	return { x: 0, y: 0 };
}
