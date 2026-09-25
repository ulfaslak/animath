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

describe('encounterTable', () => {
	it('lists exactly the species whose habitats include the biome, with shares summing to 1', () => {
		for (const biome of BIOMES) {
			const expected = ANIMALS.filter((a) => a.habitats.includes(biome))
				.map((a) => a.id)
				.sort();
			for (const d of [0, SAFE_RADIUS, (SAFE_RADIUS + WILD_RADIUS) / 2, WILD_RADIUS, 1000]) {
				const table = encounterTable(biome, d);
				expect(table.map((e) => e.species.id).sort()).toEqual(expected);
				expect(table.reduce((s, e) => s + e.weight, 0)).toBeCloseTo(1, 9);
				for (const e of table) expect(e.weight, `${e.species.id} in ${biome}`).toBeGreaterThan(0);
			}
		}
	});

	it('every biome has a species and every species has a biome', () => {
		for (const biome of BIOMES) expect(encounterTable(biome, 0).length).toBeGreaterThan(0);
		for (const a of ANIMALS) {
			const met = BIOMES.some((b) => encounterTable(b, 0).some((e) => e.species.id === a.id));
			expect(met, `${a.id} can never be met`).toBe(true);
		}
	});

	it('inside the safe radius tier 1 is the majority and tiers 3+ are under 5%, wherever a tier-1 species lives', () => {
		for (const biome of BIOMES) {
			if (!ANIMALS.some((a) => a.tier === 1 && a.habitats.includes(biome))) continue;
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

	it('the tier-3+ share never falls with distance, and beyond the wild radius every species is equal', () => {
		for (const biome of BIOMES) {
			let prev = -1;
			for (let d = 0; d <= WILD_RADIUS + 64; d += 2) {
				const s = share(biome, d, (t) => t >= 3);
				expect(s, `${biome} @ ${d}`).toBeGreaterThanOrEqual(prev - 1e-12);
				prev = s;
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

	it('returns a catalog species that lives in the biome, at full HP, with a fresh id', () => {
		const ids = new Set<string>();
		for (const biome of BIOMES) {
			for (const d of [0, 64, 400]) {
				const rng = new Rng(hashString(`${biome}:${d}`));
				for (let n = 0; n < 200;) {
					const wild = rollEncounter(rng, siteAt(biome, d));
					if (!wild) continue;
					n++;
					const spec = getAnimal(wild.speciesId);
					expect(spec.habitats).toContain(biome);
					expect(wild.hp).toBe(spec.maxHp);
					expect(ids.has(wild.id), `duplicate id ${wild.id}`).toBe(false);
					ids.add(wild.id);
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
