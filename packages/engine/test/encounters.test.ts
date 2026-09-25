import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import type { Biome, Tier } from '../src/animals/types.js';
import { Rng, hashString } from '../src/rng.js';
import {
	ENCOUNTER_CHANCE,
	SAFE_RADIUS,
	WILD_RADIUS,
	distanceFromSpawn,
	encounterTable,
	rollEncounter
} from '../src/world/encounters.js';
import { generateChunk, spawnPoint } from '../src/world/generate.js';
import type { Tile, TileKind } from '../src/world/types.js';

const BIOMES: readonly Biome[] = ['meadow', 'forest', 'river', 'mountain'];
const ORIGIN = { x: 0, y: 0 };
const tallgrass = (biome: Biome): Tile => ({ kind: 'tallgrass', biome, height: 0 });

/** Site `distance` tiles east of an origin spawn. */
const siteAt = (biome: Biome, distance: number) => ({
	tile: tallgrass(biome),
	pos: { x: distance, y: 0 },
	spawn: ORIGIN
});

function share(biome: Biome, distance: number, tiers: (t: Tier) => boolean): number {
	return encounterTable(biome, distance)
		.filter((e) => tiers(e.species.tier))
		.reduce((sum, e) => sum + e.weight, 0);
}

/** Species whose habitats include the biome. */
const residents = (biome: Biome) => ANIMALS.filter((a) => a.habitats.includes(biome));
/** The biomes that have no tier-1 animal of their own: the river and the mountains today. */
const UNGENTLE = BIOMES.filter((b) => !residents(b).some((a) => a.tier === 1));

describe('encounterTable', () => {
	it('lists the residents, plus tier-1 visitors inside the wild radius where no tier-1 animal lives', () => {
		expect(UNGENTLE).toEqual(['river', 'mountain']);
		const tier1 = ANIMALS.filter((a) => a.tier === 1);
		for (const biome of BIOMES) {
			for (const d of [
				0,
				SAFE_RADIUS,
				(SAFE_RADIUS + WILD_RADIUS) / 2,
				WILD_RADIUS - 1,
				WILD_RADIUS,
				1000
			]) {
				const visitors = UNGENTLE.includes(biome) && d < WILD_RADIUS ? tier1 : [];
				const expected = [...residents(biome), ...visitors].map((a) => a.id).sort();
				const table = encounterTable(biome, d);
				expect(table.map((e) => e.species.id).sort(), `${biome} @ ${d}`).toEqual(expected);
				expect(table.reduce((s, e) => s + e.weight, 0)).toBeCloseTo(1, 9);
				for (const e of table) expect(e.weight, `${e.species.id} in ${biome}`).toBeGreaterThan(0);
			}
		}
	});

	it('near spawn the river is mostly tier-1 visitors, and it is otters only from the wild radius out', () => {
		// Visitors weigh 1 each near spawn and a tier-2 resident weighs 1/5, like everywhere else.
		expect(share('river', 0, (t) => t === 2)).toBeCloseTo(0.2 / 2.2, 9);
		expect(share('river', SAFE_RADIUS, (t) => t === 2)).toBeCloseTo(0.2 / 2.2, 9);
		expect(share('mountain', 0, (t) => t === 1)).toBeGreaterThan(0.99);
		for (const biome of UNGENTLE) {
			const far = encounterTable(biome, WILD_RADIUS);
			expect(far.map((e) => e.species.id).sort()).toEqual(
				residents(biome)
					.map((a) => a.id)
					.sort()
			);
		}
	});

	it('every biome has a species and every species has a biome', () => {
		for (const biome of BIOMES) expect(encounterTable(biome, 0).length).toBeGreaterThan(0);
		for (const a of ANIMALS) {
			const met = BIOMES.some((b) => encounterTable(b, 0).some((e) => e.species.id === a.id));
			expect(met, `${a.id} can never be met`).toBe(true);
		}
	});

	it('inside the safe radius tier 1 is the majority and tiers 3+ are under 5%, in every biome', () => {
		for (const biome of BIOMES) {
			for (const d of [0, SAFE_RADIUS / 2, SAFE_RADIUS]) {
				expect(
					share(biome, d, (t) => t === 1),
					`${biome} @ ${d}`
				).toBeGreaterThan(0.5);
				expect(
					share(biome, d, (t) => t >= 3),
					`${biome} @ ${d}`
				).toBeLessThan(0.05);
			}
		}
	});

	it('the tier-3+ share never falls and the tier-1 share never rises with distance; beyond the wild radius every species is equal', () => {
		for (const biome of BIOMES) {
			let prevFierce = -1;
			let prevGentle = 2;
			for (let d = 0; d <= WILD_RADIUS + 64; d += 2) {
				const fierce = share(biome, d, (t) => t >= 3);
				const gentle = share(biome, d, (t) => t === 1);
				expect(fierce, `${biome} @ ${d}`).toBeGreaterThanOrEqual(prevFierce - 1e-12);
				expect(gentle, `${biome} @ ${d}`).toBeLessThanOrEqual(prevGentle + 1e-12);
				prevFierce = fierce;
				prevGentle = gentle;
			}
			const far = encounterTable(biome, WILD_RADIUS);
			for (const e of far) expect(e.weight).toBeCloseTo(1 / far.length, 9);
			expect(encounterTable(biome, WILD_RADIUS * 4)).toEqual(far);
		}
	});

	it('measures distance as the crow flies', () => {
		expect(distanceFromSpawn({ x: 1, y: 10 }, { x: -2, y: 6 })).toBe(5);
	});
});

describe('rollEncounter', () => {
	it('is empty on every tile kind but tall grass, and leaves the rng untouched', () => {
		const kinds: readonly TileKind[] = ['grass', 'sand', 'water', 'rock', 'tree', 'tent'];
		for (const kind of kinds) {
			for (const biome of BIOMES) {
				const rng = new Rng(1);
				for (let i = 0; i < 100; i++) {
					const site = { tile: { kind, biome, height: 0 }, pos: { x: 300, y: 0 }, spawn: ORIGIN };
					expect(rollEncounter(rng, site)).toBeNull();
				}
				expect(rng.next()).toBe(new Rng(1).next());
			}
		}
	});

	it('is deterministic: same seed and site, same sequence', () => {
		const run = (seed: number) => {
			const rng = new Rng(seed);
			return Array.from({ length: 300 }, () => rollEncounter(rng, siteAt('forest', 200)));
		};
		expect(run(42)).toEqual(run(42));
		expect(run(42)).not.toEqual(run(43));
	});

	it('refuses a site with a broken position instead of guessing a table', () => {
		const broken = { tile: tallgrass('forest'), pos: { x: NaN, y: 0 }, spawn: ORIGIN };
		expect(() => rollEncounter(new Rng(3), broken)).toThrow();
		expect(() => encounterTable('forest', NaN)).toThrow();
		expect(() => encounterTable('forest', Infinity)).toThrow();
	});

	it('starts one encounter per 8–12 grass steps in every biome', () => {
		const steps = 20000;
		for (const biome of BIOMES) {
			const rng = new Rng(hashString(biome));
			let hits = 0;
			for (let i = 0; i < steps; i++) if (rollEncounter(rng, siteAt(biome, 50))) hits++;
			expect(hits / steps, biome).toBeGreaterThan(1 / 12);
			expect(hits / steps, biome).toBeLessThan(1 / 8);
			expect(hits / steps, biome).toBeCloseTo(ENCOUNTER_CHANCE, 1);
		}
	});

	it('returns a species that lives in the biome or visits it near spawn, at full HP', () => {
		for (const biome of BIOMES) {
			for (const d of [0, 64, 400]) {
				const rng = new Rng(hashString(`${biome}:${d}`));
				for (let n = 0; n < 200;) {
					const wild = rollEncounter(rng, siteAt(biome, d));
					if (!wild) continue;
					n++;
					const spec = getAnimal(wild.speciesId);
					const visitor = UNGENTLE.includes(biome) && d < WILD_RADIUS && spec.tier === 1;
					if (!visitor) expect(spec.habitats).toContain(biome);
					expect(wild.hp).toBe(spec.maxHp);
					expect(Object.keys(wild).sort()).toEqual(['hp', 'speciesId']);
				}
			}
		}
	});

	it('samples the table: species shares match the weights, and far out every species shows up', () => {
		for (const biome of BIOMES) {
			for (const d of [0, 400]) {
				const rng = new Rng(hashString(`sample:${biome}:${d}`));
				const counts = new Map<string, number>();
				const encounters = 5000;
				for (let n = 0; n < encounters;) {
					const wild = rollEncounter(rng, siteAt(biome, d));
					if (!wild) continue;
					n++;
					counts.set(wild.speciesId, (counts.get(wild.speciesId) ?? 0) + 1);
				}
				const table = encounterTable(biome, d);
				for (const e of table) {
					const observed = (counts.get(e.species.id) ?? 0) / encounters;
					expect(Math.abs(observed - e.weight), `${e.species.id} in ${biome} @ ${d}`).toBeLessThan(
						0.03
					);
				}
				if (d > WILD_RADIUS) expect(counts.size).toBe(table.length);
			}
		}
	});
});

describe('the generated world offers every habitat', () => {
	it('grows tall grass in at least one habitat of every species, within 8 chunks of spawn', () => {
		for (const seed of [hashString('prototype'), 1, 2, 3]) {
			const grassy = new Set<Biome>();
			const spawn = spawnPoint(seed);
			const scx = Math.floor(spawn.x / 16);
			const scy = Math.floor(spawn.y / 16);
			for (let cy = scy - 8; cy <= scy + 8; cy++)
				for (let cx = scx - 8; cx <= scx + 8; cx++)
					for (const t of generateChunk(seed, cx, cy).tiles)
						if (t.kind === 'tallgrass') grassy.add(t.biome);
			for (const a of ANIMALS) {
				const reachable = a.habitats.some((b) => grassy.has(b));
				expect(reachable, `${a.id} has no tall grass to be met in (seed ${seed})`).toBe(true);
			}
		}
	});
});
