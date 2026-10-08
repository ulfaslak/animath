import { describe, expect, it } from 'vitest';
import {
	DEEP_WATER_MARGIN,
	generateChunk,
	tileAtWorld,
	travelKindAt
} from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import {
	CHUNK_SIZE,
	isPassable,
	isWalkable,
	isWater,
	step,
	tileRealm,
	type TileKind
} from '../src/world/types.js';
import { hashString } from '../src/rng.js';

const PROTOTYPE = hashString('prototype');

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

	it('agrees with tileAtWorld on every tile, deep water at the chunk edges and negative coordinates included', () => {
		// A chunk reads its elevation once for the deep-water check, a margin round
		// it included; tileAtWorld reads each tile's on its own. They must agree.
		const bad: string[] = [];
		let deepOnEdge = 0;
		for (const seed of [PROTOTYPE, 99]) {
			for (let cy = -3; cy < 2; cy++) {
				for (let cx = -3; cx < 2; cx++) {
					generateChunk(seed, cx, cy).tiles.forEach((t, i) => {
						const lx = i % CHUNK_SIZE;
						const ly = Math.floor(i / CHUNK_SIZE);
						const w = tileAtWorld(seed, cx * CHUNK_SIZE + lx, cy * CHUNK_SIZE + ly);
						if (w.kind !== t.kind || w.biome !== t.biome || w.height !== t.height)
							bad.push(`seed ${seed} chunk ${cx},${cy} tile ${i}`);
						const edge = Math.min(lx, ly, CHUNK_SIZE - 1 - lx, CHUNK_SIZE - 1 - ly);
						if (t.kind === 'deepwater' && edge < DEEP_WATER_MARGIN) deepOnEdge++;
					});
				}
			}
		}
		expect(bad).toEqual([]);
		expect(deepOnEdge).toBeGreaterThan(0);
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

describe('deep water', () => {
	/** Every tile's kind in a box and a margin round it, read once. */
	function kinds(
		seed: number,
		x0: number,
		y0: number,
		size: number
	): (x: number, y: number) => TileKind {
		const m = DEEP_WATER_MARGIN;
		const span = size + 2 * m;
		const all: TileKind[] = [];
		for (let y = 0; y < span; y++)
			for (let x = 0; x < span; x++) all.push(tileAtWorld(seed, x0 - m + x, y0 - m + y).kind);
		return (x, y) => all[(y - y0 + m) * span + (x - x0 + m)]!;
	}

	it('is water with water all round it, two tiles out, diagonals too: the sea biome, and nothing else', () => {
		const bad: string[] = [];
		let deep = 0;
		let shallow = 0;
		for (const seed of [PROTOTYPE, 1, 7]) {
			const origin = spawnPoint(seed);
			const size = 96;
			const x0 = origin.x - size / 2;
			const y0 = origin.y - size / 2;
			const kindAt = kinds(seed, x0, y0, size);
			for (let y = y0; y < y0 + size; y++) {
				for (let x = x0; x < x0 + size; x++) {
					const tile = tileAtWorld(seed, x, y);
					let allWater = true;
					for (let dy = -DEEP_WATER_MARGIN; dy <= DEEP_WATER_MARGIN; dy++)
						for (let dx = -DEEP_WATER_MARGIN; dx <= DEEP_WATER_MARGIN; dx++)
							if (!isWater(kindAt(x + dx, y + dy))) allWater = false;
					const shouldBeDeep = isWater(tile.kind) && allWater;
					if ((tile.kind === 'deepwater') !== shouldBeDeep) bad.push(`seed ${seed} ${x},${y}`);
					if ((tile.biome === 'sea') !== (tile.kind === 'deepwater'))
						bad.push(`seed ${seed} ${x},${y} biome ${tile.biome}`);
					if (isWater(tile.kind) && tile.height !== 0) bad.push(`seed ${seed} ${x},${y} height`);
					if (tile.kind === 'deepwater') deep++;
					if (tile.kind === 'water') shallow++;
				}
			}
		}
		expect(bad).toEqual([]);
		expect(deep).toBeGreaterThan(100);
		expect(shallow).toBeGreaterThan(100);
		// Under 1 s alone (27,648 tiles, each with its 5×5 square); a few seconds under load.
	}, 30_000);

	it('lies a few steps from the start of the prototype world, in the lake beside it', () => {
		const spawn = spawnPoint(PROTOTYPE);
		let nearest = Infinity;
		for (let dy = -8; dy <= 8; dy++)
			for (let dx = -8; dx <= 8; dx++)
				if (tileAtWorld(PROTOTYPE, spawn.x + dx, spawn.y + dy).kind === 'deepwater')
					nearest = Math.min(nearest, Math.hypot(dx, dy));
		expect(nearest).toBeLessThan(5);
	});

	it('is water to anyone getting about: travelKindAt is tileAtWorld with deep water read as water', () => {
		const bad: string[] = [];
		for (let y = -40; y < 40; y++)
			for (let x = -40; x < 40; x++) {
				const kind = tileAtWorld(PROTOTYPE, x, y).kind;
				const travel = travelKindAt(PROTOTYPE, x, y);
				if (travel !== (kind === 'deepwater' ? 'water' : kind)) bad.push(`${x},${y}`);
			}
		expect(bad).toEqual([]);
	});

	it('changed no land: the prototype world near spawn is the one saved games stand in', () => {
		// Kids' saves hold a position in this world ([[DEFERRED]] "A saved
		// position assumes today's world generator"). Deep water turned some
		// water tiles into deep water in the sea biome and moved nothing else:
		// read back as water by the river, every tile within 64 of spawn is
		// what the world was before it (the first checksum), and the second pins
		// the world as it is. A change to generation that moves anything fails
		// here: check what it does to saved games before updating them.
		function checksum(fold: boolean): string {
			const spawn = spawnPoint(PROTOTYPE);
			let h = 0x811c9dc5;
			for (let y = spawn.y - 64; y <= spawn.y + 64; y++) {
				for (let x = spawn.x - 64; x <= spawn.x + 64; x++) {
					const t = tileAtWorld(PROTOTYPE, x, y);
					const kind = fold && t.kind === 'deepwater' ? 'water' : t.kind;
					const biome = fold && t.biome === 'sea' ? 'river' : t.biome;
					for (const ch of `${kind}/${biome}/${t.height};`) {
						h ^= ch.charCodeAt(0);
						h = Math.imul(h, 0x01000193) >>> 0;
					}
				}
			}
			return h.toString(16).padStart(8, '0');
		}
		expect(spawnPoint(PROTOTYPE)).toEqual({ x: -2, y: 6 });
		expect(checksum(true)).toBe('6a2ad48f');
		expect(checksum(false)).toBe('8ac33e0d');
	});
});

describe('getting about', () => {
	const ALL: readonly TileKind[] = [
		'grass',
		'tallgrass',
		'sand',
		'water',
		'deepwater',
		'rock',
		'tree',
		'tent',
		'snow',
		'deepsnow',
		'ice',
		'iceblock',
		'hole'
	];

	it('on foot, only ground; with the boat, water of either depth too, and never rock, trees or a tent', () => {
		for (const kind of ALL) {
			expect(isPassable(kind), kind).toBe(isWalkable(kind));
			expect(isPassable(kind, { boat: true }), kind).toBe(isWalkable(kind) || isWater(kind));
			expect(isPassable(kind, { boat: false }), kind).toBe(isWalkable(kind));
		}
		expect(ALL.filter((k) => isPassable(k, { boat: true }))).toEqual([
			'grass',
			'tallgrass',
			'sand',
			'water',
			'deepwater',
			'snow',
			'deepsnow',
			'ice'
		]);
	});

	it('puts the player out on the water on water tiles, and on land everywhere else', () => {
		for (const kind of ALL) expect(tileRealm(kind), kind).toBe(isWater(kind) ? 'water' : 'land');
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
