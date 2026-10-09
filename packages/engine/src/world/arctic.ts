import type { Biome, Pole } from '../animals/types.js';
import { Rng, hashInts } from '../rng.js';
import { TENT_LATTICE, mod } from './lattice.js';
import { valueNoise } from './noise.js';
import { CHUNK_SIZE, DEEP_WATER_MARGIN, isWalkable, type Chunk, type Tile } from './types.js';

/**
 * The Arctic's world ([[PRODUCT]] §4 "The Arctic's map", #191 step 4): a pure
 * function of `(seed, x, y)`, its randomness keyed by coordinates alone, as
 * Nordland's is (`generate.ts`, which hands a seed of The Arctic here).
 *
 * - **Two poles, kept apart.** A band of open sea runs east to west for ever
 *   just south of spawn (`ARCTIC_BAND`): north of its middle line is the
 *   Arctic, south of it the Antarctic, and every biome belongs to one of them
 *   (`BIOME_POLE`), so polar bears and penguins never meet. The band's
 *   middle is deep water (`arctic-ocean` on the north half, `southern-ocean`
 *   on the south), its edges shallows, with a few ice blocks afloat.
 * - **The north**: open `tundra` of snow with patches of deep snow (the
 *   land's tall grass), the `taiga` edge where it is wetter, the rocky `fell`
 *   on the hills, with ice blocks, and the `bird-cliffs` along the shore;
 *   inland, `frozen-lake`s of ice; out at sea, the `arctic-ice`.
 * - **The south**: the `rookery` coast of rock and deep snow, the white
 *   `ice-sheet` inland with a rock (a nunatak) sticking up here and there,
 *   and the `antarctic-ice`.
 * - **The ice** (a frozen lake, the sea ice) slides a kid on (`slide.ts`).
 *   No tile of it borders anything a kid can't step onto: there it is a bank
 *   of snow (`isBanked`), so every slide ends on ground that isn't ice, and
 *   sliding back the other way returns the kid to where they slid from: no
 *   slide ever leads anywhere a kid can't get back from.
 *   Every straight run of it ends within `ICE_RUN` tiles, by construction:
 *   each row has a stopper (a snowdrift or an ice block) every `ICE_STOP`
 *   tiles at an offset of its own, and so does each column (`isStopper`).
 *   Fishing holes lie about on it, and the sea ice has open leads of water.
 * - **Tents**: one on every spot of the tents' lattice, with a clearing of
 *   snow `TENT_CLEARING` tiles round it, and no open water within
 *   `LEAD_FREE` of it, so every tent stands on ground a kid reaches on foot.
 */

/**
 * The open-sea band between the poles: water wherever `|y − middle|` is under
 * `halfWidth` plus up to `wobble` more (a slow noise along x). So it covers
 * rows 11 to 22 at most, between the tents' lattice rows 7 and 26 and clear
 * of their clearings, and is at least ten rows wide, deep water in its middle.
 */
export const ARCTIC_BAND = { middle: 16.5, halfWidth: 5, wobble: 1.5 } as const;

/** How far round each tent the ground is cleared to snow (the square round it). */
export const TENT_CLEARING = 2;

/** No open water in the sea ice this near a tent spot (the square round it): no tent on an island. */
export const LEAD_FREE = 6;

/** Each row and column of the ice has a stopper every this many tiles. */
const ICE_STOP = 23;

/** The longest straight run of ice tiles the world has: a slide crosses at most this many. */
export const ICE_RUN = ICE_STOP - 1;

/**
 * Below this the continent noise is sea, the sea ice: `SEA_LEVEL` near the
 * band, rising by `SEA_RISE` from `SEA_FROM` rows out to `SEA_FULL`, so the
 * far north is mostly the frozen Arctic Ocean and the far south's coast is
 * cut by bays of sea ice.
 */
const SEA_LEVEL = 0.33;
const SEA_RISE = 0.1;
const SEA_FROM = 20;
const SEA_FULL = 100;
/** Just above the sea level is the coast. */
const COAST_BAND = 0.045;
/** Within this many rows of the band the land rises, so its shores are land, not sea ice. */
const COAST_ROWS = 10;
const COAST_LIFT = 0.35;
/** Rows next to the band that are its coast: the bird cliffs and the rookery. */
const SHORE_ROWS = 4;
/** Above this the hills are the fell (north) or nunataks (south). */
const FELL_LEVEL = 0.66;
const NUNATAK_LEVEL = 0.7;
/** Wetter than this, the taiga's trees. */
const TAIGA_LEVEL = 0.58;
/** How much higher the fell's and the taiga's levels are (and lower a lake's) for each row nearer the band than `COAST_ROWS`. */
const SHORE_THIN = 0.03;
/** Below this, a frozen lake inland (north only). */
const LAKE_LEVEL = 0.2;
/** Above this, an open lead in the sea ice. */
const LEAD_LEVEL = 0.7;
/** Above this, a patch of deep snow. */
const DRIFT_LEVEL = 0.6;

/** Which pole a row is at: the Arctic north of the band's middle line, the Antarctic south of it. */
export function poleAt(y: number): Pole {
	return y < ARCTIC_BAND.middle ? 'north' : 'south';
}

/** How far out from the band's middle line the open sea reaches at column `x`. */
function bandHalf(seed: number, x: number): number {
	return ARCTIC_BAND.halfWidth + ARCTIC_BAND.wobble * valueNoise(seed ^ 0x5eaba7d, x, 0, 11);
}

/** Whether (x, y) is in the open-sea band. */
function inBand(seed: number, x: number, y: number): boolean {
	return Math.abs(y - ARCTIC_BAND.middle) < bandHalf(seed, x);
}

/** Whether the band's water at (x, y) is deep: the band all round it, `DEEP_WATER_MARGIN` tiles out. */
function bandDeep(seed: number, x: number, y: number): boolean {
	const m = DEEP_WATER_MARGIN;
	for (let dx = -m; dx <= m; dx++) {
		const half = bandHalf(seed, x + dx);
		for (let dy = -m; dy <= m; dy++) {
			if (Math.abs(y + dy - ARCTIC_BAND.middle) >= half) return false;
		}
	}
	return true;
}

/**
 * How far (x, y) is from the nearest spot of the tents' lattice, in the
 * square sense (the larger of the two distances): 0 on a tent's spot.
 */
export function tentSpotDistance(x: number, y: number): number {
	const { everyX, atX, everyY, atY } = TENT_LATTICE;
	const dx = mod(x - atX + Math.floor(everyX / 2), everyX) - Math.floor(everyX / 2);
	const dy = mod(y - atY + Math.floor(everyY / 2), everyY) - Math.floor(everyY / 2);
	return Math.max(Math.abs(dx), Math.abs(dy));
}

/**
 * Whether the ice at (x, y) holds a stopper by rule: the one tile in every
 * `ICE_STOP` of its row at the row's own offset, and of its column at the
 * column's. So no row or column of the ice runs longer than `ICE_RUN`.
 */
function isStopper(seed: number, x: number, y: number): boolean {
	return (
		mod(x, ICE_STOP) === hashInts(seed, y, 0x10e) % ICE_STOP ||
		mod(y, ICE_STOP) === hashInts(seed, x, 0xc01) % ICE_STOP
	);
}

/**
 * A tile of ice, on a frozen lake or the sea: mostly ice, now and then a
 * fishing hole, and wherever the rule (`isStopper`) or chance puts one, a
 * stopper: on the sea ice a snowdrift of deep snow, where animals hide, or
 * an ice block; on a lake a drift of plain snow or an ice block.
 */
function iceTile(seed: number, x: number, y: number, local: Rng, biome: Biome, sea: boolean): Tile {
	if (isStopper(seed, x, y) || local.chance(0.06)) {
		if (local.chance(0.55)) return { kind: sea ? 'deepsnow' : 'snow', biome, height: 0 };
		return { kind: 'iceblock', biome, height: 0, under: 'ice' };
	}
	if (local.chance(sea ? 0.012 : 0.02)) return { kind: 'hole', biome, height: 0 };
	return { kind: 'ice', biome, height: 0 };
}

/**
 * The tile at (x, y) of The Arctic's world of `seed`; deep water read as
 * shallows unless `depth`. Ice beside anything a kid can't step onto (a
 * tree, a rock, an ice block, a fishing hole, water, a tent) is a bank of
 * snow instead (`isBanked`), so no slide ever stops on the ice: it stops on
 * ground that isn't ice, and the way back is the same slide the other way.
 */
export function arcticTileAt(seed: number, x: number, y: number, depth = true): Tile {
	const tile = baseTileAt(seed, x, y, depth);
	if (tile.kind !== 'ice' || !isBanked(seed, x, y)) return tile;
	return { kind: 'snow', biome: tile.biome, height: tile.height };
}

/** Whether a tile of ice at (x, y) has a side no kid can step onto, and is a bank of snow instead. */
function isBanked(seed: number, x: number, y: number): boolean {
	for (const [dx, dy] of SIDES) {
		if (!isWalkable(baseTileAt(seed, x + dx, y + dy, false).kind)) return true;
	}
	return false;
}

const SIDES: readonly (readonly [number, number])[] = [
	[0, -1],
	[0, 1],
	[-1, 0],
	[1, 0]
];

/** The tile at (x, y) before the ice is banked: `arcticTileAt` but for its banks of snow. */
function baseTileAt(seed: number, x: number, y: number, depth = true): Tile {
	const pole = poleAt(y);
	const local = new Rng(hashInts(seed, x, y, 7));
	const half = bandHalf(seed, x);

	// The open-sea band between the poles.
	if (Math.abs(y - ARCTIC_BAND.middle) < half) {
		const biome: Biome = pole === 'north' ? 'arctic-ocean' : 'southern-ocean';
		if (local.chance(0.03)) return { kind: 'iceblock', biome, height: 0, under: 'water' };
		const deep = depth && bandDeep(seed, x, y);
		return { kind: deep ? 'deepwater' : 'water', biome, height: 0 };
	}

	// Rows out from the band's edge, from 1 on the shore.
	const rows = pole === 'north' ? ARCTIC_BAND.middle - half - y : y - (ARCTIC_BAND.middle + half);
	const continent =
		0.65 * valueNoise(seed ^ 0xc0a571, x, y, 40) +
		0.35 * valueNoise(seed ^ 0x7e11a5, x, y, 13) +
		(rows < COAST_ROWS ? COAST_LIFT * (1 - rows / COAST_ROWS) : 0);
	const hills =
		0.7 * valueNoise(seed ^ 0x4111e5, x, y, 20) + 0.3 * valueNoise(seed ^ 0x2b0b, x, y, 6);
	const landHeight = Math.max(0, Math.min(3, Math.round((hills - 0.35) * 5)));
	const near = tentSpotDistance(x, y);

	const sea =
		SEA_LEVEL + SEA_RISE * Math.min(1, Math.max(0, (rows - SEA_FROM) / (SEA_FULL - SEA_FROM)));
	let tile: Tile;
	if (continent < sea) {
		// The sea ice, with open leads of water, never by a tent.
		const biome: Biome = pole === 'north' ? 'arctic-ice' : 'antarctic-ice';
		if (near > LEAD_FREE && valueNoise(seed ^ 0x1ead5, x, y, 7) > LEAD_LEVEL) {
			tile = local.chance(0.05)
				? { kind: 'iceblock', biome, height: 0, under: 'water' }
				: { kind: 'water', biome, height: 0 };
		} else {
			tile = iceTile(seed, x, y, local, biome, true);
		}
	} else if (
		pole === 'north' &&
		continent > sea + COAST_BAND &&
		valueNoise(seed ^ 0x1a4e, x, y, 9) < LAKE_LEVEL - Math.max(0, COAST_ROWS - rows) * SHORE_THIN
	) {
		tile = iceTile(seed, x, y, local, 'frozen-lake', false);
	} else {
		const coast = continent < sea + COAST_BAND || rows <= SHORE_ROWS;
		const drift = valueNoise(seed ^ 0xd21f7, x, y, 5) > DRIFT_LEVEL;
		tile =
			pole === 'north'
				? northLand(seed, x, y, local, coast, drift, hills, landHeight, rows)
				: southLand(local, coast, drift, hills, landHeight);
	}

	if (near === 0)
		return { kind: 'tent', biome: tile.biome, height: groundHeight(tile, landHeight) };
	if (near <= TENT_CLEARING) {
		return { kind: 'snow', biome: tile.biome, height: groundHeight(tile, landHeight) };
	}
	return tile;
}

/** The height of ground laid where `tile` was: the land's own, or level with the ice or water. */
function groundHeight(tile: Tile, landHeight: number): number {
	return tile.kind === 'ice' ||
		tile.kind === 'hole' ||
		tile.kind === 'water' ||
		tile.under === 'ice' ||
		tile.under === 'water' ||
		tile.biome === 'frozen-lake' ||
		tile.biome === 'arctic-ice' ||
		tile.biome === 'antarctic-ice'
		? 0
		: landHeight;
}

function northLand(
	seed: number,
	x: number,
	y: number,
	local: Rng,
	coast: boolean,
	drift: boolean,
	hills: number,
	height: number,
	rows: number
): Tile {
	if (coast && valueNoise(seed ^ 0xb12d, x, y, 8) > 0.42) {
		// The bird cliffs: rock along the shore, deep snow on the cliff tops.
		const biome: Biome = 'bird-cliffs';
		if (local.chance(0.22)) return { kind: 'rock', biome, height };
		if (drift ? local.chance(0.7) : local.chance(0.06)) return { kind: 'deepsnow', biome, height };
		return { kind: 'snow', biome, height };
	}
	// Towards the band the fell and the taiga thin out, so the shore by spawn is the tundra
	// meeting the bird cliffs (#192 § Starters).
	const shore = Math.max(0, COAST_ROWS - rows) * SHORE_THIN;
	if (hills > FELL_LEVEL + shore) {
		const biome: Biome = 'fell';
		if (hills > 0.8 || local.chance(0.14)) return { kind: 'rock', biome, height };
		if (local.chance(0.06)) return { kind: 'iceblock', biome, height, under: 'snow' };
		if (drift ? local.chance(0.6) : local.chance(0.05)) return { kind: 'deepsnow', biome, height };
		return { kind: 'snow', biome, height };
	}
	const wet = 0.7 * valueNoise(seed ^ 0x7a16a, x, y, 16) + 0.3 * valueNoise(seed ^ 0x3e7, x, y, 5);
	if (wet > TAIGA_LEVEL + shore) {
		const biome: Biome = 'taiga';
		if (local.chance(0.3)) return { kind: 'tree', biome, height };
		if (drift ? local.chance(0.8) : local.chance(0.12)) return { kind: 'deepsnow', biome, height };
		return { kind: 'snow', biome, height };
	}
	const biome: Biome = 'tundra';
	if (local.chance(0.015)) return { kind: 'rock', biome, height };
	if (local.chance(0.01)) return { kind: 'iceblock', biome, height, under: 'snow' };
	if (drift ? local.chance(0.75) : local.chance(0.05)) return { kind: 'deepsnow', biome, height };
	return { kind: 'snow', biome, height };
}

function southLand(
	local: Rng,
	coast: boolean,
	drift: boolean,
	hills: number,
	height: number
): Tile {
	if (coast) {
		// The rookery: an ice-free rocky coast, where the penguins nest.
		const biome: Biome = 'rookery';
		if (local.chance(0.2)) return { kind: 'rock', biome, height };
		if (drift ? local.chance(0.6) : local.chance(0.06)) return { kind: 'deepsnow', biome, height };
		return { kind: 'snow', biome, height };
	}
	// The ice sheet, nearly lifeless: snow, a nunatak's rocks, a little deep snow.
	const biome: Biome = 'ice-sheet';
	if (hills > NUNATAK_LEVEL && local.chance(0.55)) return { kind: 'rock', biome, height };
	if (local.chance(0.02)) return { kind: 'iceblock', biome, height, under: 'snow' };
	if (drift ? local.chance(0.25) : local.chance(0.01)) return { kind: 'deepsnow', biome, height };
	return { kind: 'snow', biome, height };
}

/** Chunk (cx, cy) of The Arctic's world of `seed`: `arcticTileAt` for every tile of it. */
export function generateArcticChunk(seed: number, cx: number, cy: number): Chunk {
	const tiles: Tile[] = new Array(CHUNK_SIZE * CHUNK_SIZE);
	const x0 = cx * CHUNK_SIZE;
	const y0 = cy * CHUNK_SIZE;
	for (let y = 0; y < CHUNK_SIZE; y++) {
		for (let x = 0; x < CHUNK_SIZE; x++) {
			tiles[y * CHUNK_SIZE + x] = arcticTileAt(seed, x0 + x, y0 + y);
		}
	}
	return { cx, cy, tiles };
}
