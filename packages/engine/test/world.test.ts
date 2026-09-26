import { describe, expect, it } from 'vitest';
import { generateChunk, spawnPoint, tileAtWorld } from '../src/world/generate.js';
import { CHUNK_SIZE, isWalkable, step } from '../src/world/types.js';
import { hashString } from '../src/rng.js';

describe('generateChunk', () => {
	it('is a pure function of (seed, cx, cy)', () => {
		const a = generateChunk(123, 4, -2);
		const b = generateChunk(123, 4, -2);
		expect(a).toEqual(b);
		expect(a.tiles).toHaveLength(CHUNK_SIZE * CHUNK_SIZE);
	});

	it('agrees with tileAtWorld at chunk edges (no seams)', () => {
		const c = generateChunk(99, 1, 1);
		const last = c.tiles[CHUNK_SIZE * CHUNK_SIZE - 1];
		expect(last).toEqual(tileAtWorld(99, 2 * CHUNK_SIZE - 1, 2 * CHUNK_SIZE - 1));
	});

	it('differs between seeds', () => {
		const a = generateChunk(1, 0, 0)
			.tiles.map((t) => t.kind)
			.join('');
		const b = generateChunk(2, 0, 0)
			.tiles.map((t) => t.kind)
			.join('');
		expect(a).not.toBe(b);
	});

	it('produces a mix of tile kinds over a region', () => {
		const kinds = new Set<string>();
		for (let cy = -3; cy < 3; cy++)
			for (let cx = -3; cx < 3; cx++)
				for (const t of generateChunk(7, cx, cy).tiles) kinds.add(t.kind);
		expect(kinds.has('grass')).toBe(true);
		expect(kinds.has('water')).toBe(true);
		expect(kinds.has('tree')).toBe(true);
		expect(kinds.has('tallgrass')).toBe(true);
	});

	it('river banks are sand with patches of reeds, so water animals have tall grass to hide in', () => {
		let sand = 0;
		let reeds = 0;
		for (let cy = -4; cy < 4; cy++)
			for (let cx = -4; cx < 4; cx++)
				for (const t of generateChunk(hashString('prototype'), cx, cy).tiles) {
					if (t.biome !== 'river') continue;
					if (t.kind === 'sand') sand++;
					else if (t.kind === 'tallgrass') reeds++;
					else expect(t.kind).toBe('water');
				}
		expect(reeds).toBeGreaterThan(0);
		expect(reeds / (sand + reeds)).toBeGreaterThan(0.2);
		expect(reeds / (sand + reeds)).toBeLessThan(0.4);
	});

	it('places tents in every quadrant, on one lattice with no mirror at 0', () => {
		const quadrants = new Set<string>();
		const offLattice: string[] = [];
		for (let cy = -12; cy < 12; cy++)
			for (let cx = -12; cx < 12; cx++)
				for (const [i, t] of generateChunk(hashString('prototype'), cx, cy).tiles.entries()) {
					if (t.kind !== 'tent') continue;
					const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE);
					const y = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
					quadrants.add(`${x < 0 ? 'W' : 'E'}${y < 0 ? 'N' : 'S'}`);
					// Tents repeat every 23 columns and 19 rows, straight through 0.
					if (
						(x - 5) / 23 !== Math.floor((x - 5) / 23) ||
						(y - 7) / 19 !== Math.floor((y - 7) / 19)
					)
						offLattice.push(`${x},${y}`);
				}
		expect([...quadrants].sort()).toEqual(['EN', 'ES', 'WN', 'WS']);
		expect(offLattice).toEqual([]);
		// Under 1 s alone (576 chunks generated); over 5 s under a heavy load.
	}, 30_000);
});

describe('spawnPoint', () => {
	it('lands on walkable ground for many seeds', () => {
		for (let seed = 0; seed < 25; seed++) {
			const p = spawnPoint(seed);
			expect(isWalkable(tileAtWorld(seed, p.x, p.y).kind)).toBe(true);
		}
	});
});

describe('step', () => {
	it('moves one tile in screen coordinates (y grows downward)', () => {
		expect(step({ x: 0, y: 0 }, 'up')).toEqual({ x: 0, y: -1 });
		expect(step({ x: 0, y: 0 }, 'right')).toEqual({ x: 1, y: 0 });
	});
});
