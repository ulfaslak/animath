import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import { REALMS, TERRAINS, type Terrain } from '../src/animals/types.js';
import { hashString } from '../src/rng.js';
import { generateChunk, tileAtWorld } from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import {
	HABITAT_BOOST,
	HABITAT_FULL,
	HABITAT_RADIUS,
	HABITAT_TILES,
	habitatFactor,
	surroundings,
	terrainShares,
	type Surroundings
} from '../src/world/habitat.js';
import { encounterRealm, isEncounterTile, type TileKind } from '../src/world/types.js';

/**
 * The ground around an encounter tile, the rule [[PRODUCT]] §4 "Wild
 * encounters" states: a species comes out 4^s times as often, where s is how
 * much of the terrain it favours lies within 3 tiles. What that does to the
 * encounter tables is `encounters.test.ts`.
 */

const SEEDS = [hashString('prototype'), 1, 2, 3];

/** The same count, done the long way: every tile of a 7 × 7 square whose centre is within 3 tiles. */
function countAround(seed: number, x: number, y: number): Surroundings & { open: number } {
	const c = { water: 0, trees: 0, rocks: 0, open: 0 };
	for (let dy = -3; dy <= 3; dy++) {
		for (let dx = -3; dx <= 3; dx++) {
			if (dx === 0 && dy === 0) continue;
			if (Math.hypot(dx, dy) > 3) continue;
			const kind = tileAtWorld(seed, x + dx, y + dy).kind;
			// Water is water, shallow or deep.
			if (kind === 'water' || kind === 'deepwater') c.water++;
			else if (kind === 'tree') c.trees++;
			else if (kind === 'rock') c.rocks++;
			else c.open++;
		}
	}
	return c;
}

describe('surroundings', () => {
	it('counts the water, trees and rocks among the 28 tiles within 3 of a tile, on every side of spawn', () => {
		expect(HABITAT_RADIUS).toBe(3);
		expect(HABITAT_TILES).toBe(28);
		const bad: string[] = [];
		const sawEach = { water: 0, trees: 0, rocks: 0 };
		for (const seed of SEEDS) {
			const spawn = spawnPoint(seed);
			// Tall grass in a few chunks on both sides of both axes.
			for (const [cx, cy] of [
				[-3, -2],
				[0, 0],
				[2, -1],
				[-1, 3],
				[5, 5]
			] as const) {
				const chunk = generateChunk(
					seed,
					cx + Math.floor(spawn.x / 16),
					cy + Math.floor(spawn.y / 16)
				);
				chunk.tiles.forEach((t, i) => {
					if (t.kind !== 'tallgrass') return;
					const x = chunk.cx * 16 + (i % 16);
					const y = chunk.cy * 16 + Math.floor(i / 16);
					const got = surroundings(seed, { x, y });
					const want = countAround(seed, x, y);
					if (
						got.water !== want.water ||
						got.trees !== want.trees ||
						got.rocks !== want.rocks ||
						Object.keys(got).sort().join() !== 'rocks,trees,water'
					)
						bad.push(
							`seed ${seed} (${x}, ${y}): ${JSON.stringify(got)} vs ${JSON.stringify(want)}`
						);
					if (want.water + want.trees + want.rocks + want.open !== 28)
						bad.push(`(${x}, ${y}) not 28`);
					if (got.water > 0) sawEach.water++;
					if (got.trees > 0) sawEach.trees++;
					if (got.rocks > 0) sawEach.rocks++;
				});
			}
		}
		expect(bad).toEqual([]);
		// The sweep met every terrain, so it compared something.
		for (const n of Object.values(sawEach)) expect(n).toBeGreaterThan(20);
	});

	it('is a pure function of the seed and the tile, like the world', () => {
		const seed = hashString('prototype');
		const spots = Array.from({ length: 50 }, (_, i) => ({
			x: ((i * 37) % 101) - 50,
			y: ((i * 53) % 97) - 48
		}));
		const first = spots.map((p) => surroundings(seed, p));
		const again = [...spots]
			.reverse()
			.map((p) => surroundings(seed, p))
			.reverse();
		expect(again).toEqual(first);
		expect(spots.map((p) => surroundings(seed + 1, p))).not.toEqual(first);
	});

	it("the reed beside the prototype world's spawn tile has the lake all round it", () => {
		const seed = hashString('prototype');
		const spawn = spawnPoint(seed);
		const reed = { x: spawn.x - 1, y: spawn.y };
		expect(tileAtWorld(seed, reed.x, reed.y)).toMatchObject({ kind: 'tallgrass', biome: 'river' });
		const around = surroundings(seed, reed);
		expect(around.water).toBeGreaterThanOrEqual(HABITAT_FULL);
		expect(terrainShares(around)).toEqual({ water: 1, trees: 0, rocks: 0, open: 0 });
	});
});

describe('terrainShares and habitatFactor', () => {
	it('count water, trees and rocks fully from 7 tiles, and open ground fully with none of them near', () => {
		expect(HABITAT_FULL).toBe(7);
		expect(HABITAT_BOOST).toBe(4);
		expect(terrainShares({ water: 0, trees: 0, rocks: 0 })).toEqual({
			water: 0,
			trees: 0,
			rocks: 0,
			open: 1
		});
		expect(terrainShares({ water: 7, trees: 0, rocks: 0 })).toEqual({
			water: 1,
			trees: 0,
			rocks: 0,
			open: 0
		});
		expect(terrainShares({ water: 28, trees: 0, rocks: 0 })).toEqual({
			water: 1,
			trees: 0,
			rocks: 0,
			open: 0
		});
		const mixed = terrainShares({ water: 1, trees: 2, rocks: 3 });
		expect(mixed.water).toBeCloseTo(1 / 7, 15);
		expect(mixed.trees).toBeCloseTo(2 / 7, 15);
		expect(mixed.rocks).toBeCloseTo(3 / 7, 15);
		expect(mixed.open).toBeCloseTo(1 / 7, 15);
		expect(terrainShares({ water: 3, trees: 3, rocks: 3 }).open).toBe(0);
	});

	it('a species comes out 4^s times as often, s being how much of its terrain is near: 1 to 4, twice with half', () => {
		const frog = getAnimal('frog');
		const rabbit = getAnimal('rabbit');
		expect(habitatFactor(frog, { water: 0, trees: 5, rocks: 0 })).toBe(1);
		expect(habitatFactor(frog, { water: 7, trees: 0, rocks: 0 })).toBe(4);
		expect(habitatFactor(frog, { water: 3.5, trees: 0, rocks: 0 })).toBeCloseTo(2, 12);
		expect(habitatFactor(rabbit, { water: 0, trees: 0, rocks: 0 })).toBe(4);
		expect(habitatFactor(rabbit, { water: 2, trees: 5, rocks: 0 })).toBe(1);
		const bad: string[] = [];
		for (const species of ANIMALS) {
			for (let w = 0; w <= 9; w++) {
				for (let t = 0; t <= 9; t++) {
					for (let r = 0; r <= 9; r++) {
						const around = { water: w, trees: t, rocks: r };
						const cover = w + t + r;
						const s =
							species.favours === 'open'
								? 1 - Math.min(1, cover / 7)
								: Math.min(1, around[species.favours] / 7);
						const f = habitatFactor(species, around);
						if (!(Math.abs(f - 4 ** s) <= 1e-12) || !(f >= 1 && f <= 4))
							bad.push(`${species.id} at ${JSON.stringify(around)}: ${f}`);
					}
				}
			}
		}
		expect(bad).toEqual([]);
	});

	it('refuses surroundings that are not counts of tiles, rather than guessing', () => {
		const frog = getAnimal('frog');
		for (const around of [
			undefined,
			null,
			{},
			{ water: NaN, trees: 0, rocks: 0 },
			{ water: 0, trees: -1, rocks: 0 },
			{ water: 0, trees: 0, rocks: Infinity },
			{ water: '3', trees: 0, rocks: 0 },
			{ water: 0, trees: 0 }
		]) {
			expect(
				() => terrainShares(around as unknown as Surroundings),
				JSON.stringify(around)
			).toThrow(/surroundings/);
			expect(() => habitatFactor(frog, around as unknown as Surroundings)).toThrow(/surroundings/);
		}
	});
});

describe('where each species lives', () => {
	it('every species favours one terrain; the amphibious ones are the frog, the otter, the toad and the beaver, and only the sea animals live only in the water', () => {
		for (const species of ANIMALS) {
			expect(TERRAINS, species.id).toContain(species.favours);
			expect(species.realms.length, species.id).toBeGreaterThan(0);
			expect(new Set(species.realms).size, species.id).toBe(species.realms.length);
			for (const realm of species.realms) expect(REALMS, species.id).toContain(realm);
			// Living only in the water is living in the sea, the deep water's biome, and nowhere
			// else: an encounter out there is the only way to meet one.
			const aquatic = !species.realms.includes('land');
			expect(aquatic, species.id).toBe(species.habitats.includes('sea'));
			if (aquatic) expect(species.habitats, species.id).toEqual(['sea']);
		}
		const amphibious = ANIMALS.filter(
			(a) => a.realms.includes('land') && a.realms.includes('water')
		);
		expect(amphibious.map((a) => a.id)).toEqual(['frog', 'otter', 'common-toad', 'beaver']);
		const aquatic = ANIMALS.filter((a) => !a.realms.includes('land'));
		expect(aquatic.map((a) => a.id)).toEqual([
			'crab',
			'starfish',
			'turtle',
			'dolphin',
			'octopus',
			'whale'
		]);
	});

	it('the ground each animal favours, as [[PRODUCT]] §4 lists it with a reason for each', () => {
		const by = (t: Terrain) => ANIMALS.filter((a) => a.favours === t).map((a) => a.id);
		expect(by('water')).toEqual([
			'frog',
			'otter',
			'brown-rat',
			'common-toad',
			'grey-heron',
			'raccoon',
			'beaver',
			'crab',
			'starfish',
			'turtle',
			'dolphin',
			'octopus',
			'whale'
		]);
		expect(by('trees')).toEqual([
			'squirrel',
			'fox',
			'deer',
			'wood-mouse',
			'robin',
			'stag-beetle',
			'roe-deer',
			'badger',
			'pine-marten',
			'tawny-owl'
		]);
		expect(by('rocks')).toEqual(['wolf', 'bear', 'common-lizard', 'stoat', 'adder']);
		expect(by('open')).toEqual(['rabbit', 'shrew', 'hedgehog', 'mole']);
	});

	it('only tall grass starts an encounter, and it is on land', () => {
		const kinds: readonly TileKind[] = [
			'grass',
			'tallgrass',
			'sand',
			'water',
			'rock',
			'tree',
			'tent'
		];
		for (const kind of kinds) {
			expect(encounterRealm(kind), kind).toBe(kind === 'tallgrass' ? 'land' : null);
			expect(isEncounterTile(kind), kind).toBe(kind === 'tallgrass');
		}
	});
});
