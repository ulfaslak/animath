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
 * label per tile. Doctor tents are placed on a sparse lattice near water or
 * trees. Rivers, paths, points of interest and proper biome shaping are the
 * real work, tracked as issues.
 */

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

function tileAt(seed: number, x: number, y: number): Tile {
	const elev = elevation(seed, x, y);
	const moist = moisture(seed, x, y);
	const biome = biomeFor(elev, moist);
	const local = new Rng(hashInts(seed, x, y, 7));

	let kind: TileKind;
	if (elev < 0.36) kind = 'water';
	else if (elev < 0.4) kind = 'sand';
	else if (elev > 0.8) kind = 'rock';
	else if (biome === 'forest' && local.chance(0.35)) kind = 'tree';
	else if (biome === 'mountain' && local.chance(0.15)) kind = 'rock';
	else if (local.chance(biome === 'forest' ? 0.35 : 0.18)) kind = 'tallgrass';
	else kind = 'grass';

	// Doctor tents: sparse lattice, only on ground, only near water or forest.
	if (
		kind === 'grass' &&
		x % 23 === 5 &&
		y % 19 === 7 &&
		(biome === 'forest' || hasWaterNearby(seed, x, y))
	) {
		kind = 'tent';
	}

	const height = kind === 'water' ? 0 : Math.max(0, Math.round((elev - 0.36) * 6));
	return { kind, biome, height };
}

function hasWaterNearby(seed: number, x: number, y: number): boolean {
	for (let dy = -3; dy <= 3; dy++) {
		for (let dx = -3; dx <= 3; dx++) {
			if (elevation(seed, x + dx, y + dy) < 0.36) return true;
		}
	}
	return false;
}

export function generateChunk(seed: number, cx: number, cy: number): Chunk {
	const tiles: Tile[] = new Array(CHUNK_SIZE * CHUNK_SIZE);
	for (let y = 0; y < CHUNK_SIZE; y++) {
		for (let x = 0; x < CHUNK_SIZE; x++) {
			tiles[y * CHUNK_SIZE + x] = tileAt(seed, cx * CHUNK_SIZE + x, cy * CHUNK_SIZE + y);
		}
	}
	return { cx, cy, tiles };
}

/** Convenience for callers that think in world coordinates. */
export function tileAtWorld(seed: number, x: number, y: number): Tile {
	return tileAt(seed, x, y);
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
