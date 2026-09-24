import { describe, expect, it } from 'vitest';
import { generateChunk, spawnPoint, tileAtWorld } from '../src/world/generate.js';
import { CHUNK_SIZE, isWalkable, step } from '../src/world/types.js';

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
