import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import type { Biome, Tier } from '../src/animals/types.js';
import { Rng, hashString } from '../src/rng.js';
import {
	ENCOUNTER_CHANCE,
	ONE_TIER_BELOW_WEIGHT,
	SAFE_RADIUS,
	WILD_RADIUS,
	distanceFromSpawn,
	encounterTable,
	rollEncounter,
	type EncounterEntry,
	type EncounterSite
} from '../src/world/encounters.js';
import { generateChunk, spawnPoint, tileAtWorld } from '../src/world/generate.js';
import type { GridPos, Tile, TileKind } from '../src/world/types.js';

const BIOMES: readonly Biome[] = ['meadow', 'forest', 'river', 'mountain'];
const LEADS: readonly Tier[] = [1, 2, 3, 4, 5];
const ORIGIN = { x: 0, y: 0 };
const tallgrass = (biome: Biome): Tile => ({ kind: 'tallgrass', biome, height: 0 });

/** Site `distance` tiles east of an origin spawn. */
const siteAt = (biome: Biome, distance: number): EncounterSite => ({
	tile: tallgrass(biome),
	pos: { x: distance, y: 0 },
	spawn: ORIGIN
});

/** Every half tile from spawn to past the wild radius, and far away. */
const SWEEP = [...Array.from({ length: 2 * (WILD_RADIUS + 64) + 1 }, (_, i) => i / 2), 1000];

const total = (entries: readonly EncounterEntry[]) => entries.reduce((s, e) => s + e.weight, 0);

function share(biome: Biome, distance: number, lead: Tier, tiers: (t: number) => boolean): number {
	return total(encounterTable(biome, distance, lead).filter((e) => tiers(e.species.tier)));
}

/** Species whose habitats include the biome. */
const residents = (biome: Biome) => ANIMALS.filter((a) => a.habitats.includes(biome));

/** Raw weights scaled to shares. */
function normalised(weights: Record<string, number>): Record<string, number> {
	const sum = Object.values(weights).reduce((s, w) => s + w, 0);
	return Object.fromEntries(Object.entries(weights).map(([id, w]) => [id, w / sum]));
}

function expectShares(table: readonly EncounterEntry[], want: Record<string, number>): void {
	const got = Object.fromEntries(table.map((e) => [e.species.id, e.weight]));
	expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
	for (const [id, w] of Object.entries(want)) expect(got[id], id).toBeCloseTo(w, 12);
}

interface Kind {
	id: string;
	tier: number;
	habitats: readonly Biome[];
}

/**
 * A tier-1 lead's encounter table, written out again from [[PRODUCT]] §4 for
 * any roster, with its numbers as literals: a tier-t resident weighs
 * 5^−(t−1)(1−danger) with danger = clamp((d − 32)/96), and at the river and in
 * the mountains, where a resident is bigger than tier 1, every tier-1 species
 * that doesn't live there visits, weighing 1 − danger. Shares, in roster order.
 * Before the frog it was PR #12's table: the river and the mountains were
 * exactly the biomes with residents but no tier-1 animal.
 */
function tierOneTable(
	roster: readonly Kind[],
	biome: Biome,
	distance: number
): Map<string, number> {
	const danger = Math.min(1, Math.max(0, (distance - 32) / 96));
	const living = roster.filter((a) => a.habitats.includes(biome));
	const visited = (biome === 'river' || biome === 'mountain') && living.some((a) => a.tier > 1);
	const raw = new Map<string, number>();
	for (const a of roster) {
		if (a.habitats.includes(biome)) raw.set(a.id, Math.pow(5, -(a.tier - 1) * (1 - danger)));
		else if (a.tier === 1 && visited && danger < 1) raw.set(a.id, 1 - danger);
	}
	let sum = 0;
	for (const w of raw.values()) sum += w;
	return new Map([...raw].map(([id, w]) => [id, w / sum]));
}

/** A tier-1 lead's roll: the chance, then a pick down `tierOneTable`. */
function tierOneRoll(rng: Rng, site: EncounterSite): string | null {
	if (site.tile.kind !== 'tallgrass') return null;
	if (!rng.chance(0.1)) return null;
	const table = tierOneTable(ANIMALS, site.tile.biome, distanceFromSpawn(site.pos, site.spawn));
	let r = rng.next();
	let last: string | null = null;
	for (const [id, w] of table) {
		r -= w;
		last = id;
		if (r < 0) return id;
	}
	return last;
}

/** An Rng whose every chance comes up, so each roll on tall grass is an encounter, picked from the real stream. */
class EveryStepMeets extends Rng {
	override chance(): boolean {
		return true;
	}
}

/** The (lead, biome) pairs where nothing in the prototype catalog can challenge the lead. */
const SILENT: readonly (readonly [Tier, Biome])[] = [
	[4, 'river'],
	[5, 'meadow'],
	[5, 'river']
];
const isSilent = (lead: Tier, biome: Biome) => SILENT.some(([l, b]) => l === lead && b === biome);

describe('encounterTable', () => {
	it('for a tier-1 lead is the table [[PRODUCT]] §4 writes out, at every distance', () => {
		const bad: string[] = [];
		for (const biome of BIOMES) {
			for (const d of SWEEP) {
				const table = encounterTable(biome, d, 1);
				const expected = tierOneTable(ANIMALS, biome, d);
				const ids = table.map((e) => e.species.id).join();
				if (ids !== [...expected.keys()].join()) bad.push(`${biome} @ ${d} lists ${ids}`);
				for (const e of table) {
					if (!(Math.abs(e.weight - expected.get(e.species.id)!) <= 1e-14))
						bad.push(`${e.species.id} in ${biome} @ ${d}: ${e.weight}`);
				}
			}
		}
		expect(bad).toEqual([]);
		// Today's numbers near spawn, as [[PRODUCT]] §4 quotes them.
		expectShares(
			encounterTable('meadow', 0, 1),
			normalised({ squirrel: 1, rabbit: 1, fox: 0.2, deer: 0.04 })
		);
		expectShares(
			encounterTable('forest', 0, 1),
			normalised({ squirrel: 1, fox: 0.2, deer: 0.04, wolf: 0.008, bear: 0.0016 })
		);
		expectShares(
			encounterTable('river', 0, 1),
			normalised({ squirrel: 1, rabbit: 1, frog: 1, otter: 0.2 })
		);
		expectShares(
			encounterTable('mountain', 0, 1),
			normalised({ squirrel: 1, rabbit: 1, frog: 1, wolf: 0.008, bear: 0.0016 })
		);
	});

	it('the frog lives in the river reeds: every lead it may challenge meets it there, near and far, and no bigger one ever does', () => {
		const frog = getAnimal('frog');
		expect(frog.tier).toBe(1);
		expect(frog.habitats).toEqual(['river']);
		const frogShare = (biome: Biome, d: number, lead: Tier) =>
			encounterTable(biome, d, lead).find((e) => e.species.id === 'frog')?.weight ?? 0;
		// A tier-1 lead: a third of the reeds near home, beside the squirrels and
		// rabbits that come down to the water; half of them far out, beside the otters.
		expect(frogShare('river', 0, 1)).toBeCloseTo(1 / 3.2, 12);
		expect(frogShare('river', SAFE_RADIUS, 1)).toBeCloseTo(1 / 3.2, 12);
		expect(frogShare('river', WILD_RADIUS, 1)).toBeCloseTo(1 / 2, 12);
		expect(frogShare('river', 1000, 1)).toBeCloseTo(1 / 2, 12);
		// It comes up the hills near home too, like the other tier-1 animals.
		expect(frogShare('mountain', 0, 1)).toBeCloseTo(1 / 3.0096, 12);
		expect(frogShare('mountain', WILD_RADIUS, 1)).toBe(0);
		// A tier-2 lead: one tier below, 1/10 of an otter, near and far, and never a visitor.
		for (const d of [0, SAFE_RADIUS, 80, WILD_RADIUS, 1000]) {
			expect(frogShare('river', d, 2), `river @ ${d}`).toBeCloseTo(0.1 / 1.1, 12);
			expect(frogShare('mountain', d, 2), `mountain @ ${d}`).toBe(0);
		}
		// Two or more tiers above it, never; and no meadow or forest, for anyone.
		for (const lead of LEADS) {
			for (const d of [0, 64, 1000]) {
				if (lead >= 3) expect(frogShare('river', d, lead), `tier-${lead} @ ${d}`).toBe(0);
				expect(frogShare('meadow', d, lead)).toBe(0);
				expect(frogShare('forest', d, lead)).toBe(0);
			}
		}
		// And the reed straight left of the prototype world's spawn tile is one of its homes.
		const seed = hashString('prototype');
		const spawn = spawnPoint(seed);
		expect(tileAtWorld(seed, spawn.x - 1, spawn.y)).toMatchObject({
			kind: 'tallgrass',
			biome: 'river'
		});
	});

	it('never lists an animal two or more tiers below the lead', () => {
		const bad: string[] = [];
		let listed = 0;
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of SWEEP) {
					for (const e of encounterTable(biome, d, lead)) {
						listed++;
						if (e.species.tier < lead - 1)
							bad.push(`${e.species.id} vs a tier-${lead} lead in ${biome} @ ${d}`);
					}
				}
			}
		}
		expect(bad).toEqual([]);
		expect(listed).toBeGreaterThan(10000);
	});

	it('from its own tier up, a tier-T lead meets what a tier-1 lead met in a world T − 1 tiers smaller', () => {
		const bad: string[] = [];
		let compared = 0;
		for (const lead of LEADS) {
			// The catalog as a tier-1 lead would see it if every animal were
			// lead − 1 tiers smaller; animals below the lead drop out.
			const shrunk = ANIMALS.filter((a) => a.tier >= lead).map((a) => ({
				id: a.id,
				tier: a.tier - (lead - 1),
				habitats: a.habitats
			}));
			for (const biome of BIOMES) {
				for (const d of SWEEP) {
					const where = `tier-${lead} lead in ${biome} @ ${d}`;
					const upper = encounterTable(biome, d, lead).filter((e) => e.species.tier >= lead);
					const mass = total(upper);
					const expected = tierOneTable(shrunk, biome, d);
					const ids = upper.map((e) => e.species.id).join();
					if (ids !== [...expected.keys()].join()) bad.push(`${where} lists ${ids}`);
					for (const e of upper) {
						compared++;
						if (!(Math.abs(e.weight / mass - expected.get(e.species.id)!) <= 1e-12))
							bad.push(`${e.species.id}, ${where}: ${e.weight / mass}`);
					}
				}
			}
		}
		expect(bad).toEqual([]);
		expect(compared).toBeGreaterThan(10000);
	});

	it(`weighs an animal one tier below the lead ${ONE_TIER_BELOW_WEIGHT} of one of the lead's own tier, near and far`, () => {
		const bad: string[] = [];
		let compared = 0;
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of SWEEP) {
					const table = encounterTable(biome, d, lead);
					const below = table.filter((e) => e.species.tier === lead - 1);
					const own = table.filter(
						(e) => e.species.tier === lead && e.species.habitats.includes(biome)
					);
					for (const b of below) {
						for (const o of own) {
							compared++;
							if (!(Math.abs(b.weight / o.weight - ONE_TIER_BELOW_WEIGHT) <= 1e-12))
								bad.push(`${b.species.id} / ${o.species.id} in ${biome} @ ${d}`);
						}
					}
				}
			}
		}
		expect(bad).toEqual([]);
		expect(compared).toBeGreaterThan(1000);
		// Near spawn with a fox or otter in front, as [[PRODUCT]] §4 quotes it.
		expectShares(
			encounterTable('meadow', 0, 2),
			normalised({ squirrel: 0.1, rabbit: 0.1, fox: 1, deer: 0.2 })
		);
		expectShares(
			encounterTable('forest', 0, 2),
			normalised({ squirrel: 0.1, fox: 1, deer: 0.2, wolf: 0.04, bear: 0.008 })
		);
		expectShares(encounterTable('river', 0, 2), normalised({ frog: 0.1, otter: 1 }));
		expectShares(
			encounterTable('mountain', 0, 2),
			normalised({ fox: 1, otter: 1, wolf: 0.04, bear: 0.008 })
		);
	});

	it("lists the residents from one tier below the lead up, plus, at the river and in the mountains, visitors of the lead's tier where bigger animals live", () => {
		const visited: string[] = [];
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				const living = residents(biome);
				const guests =
					(biome === 'river' || biome === 'mountain') && living.some((a) => a.tier > lead)
						? ANIMALS.filter((a) => a.tier === lead && !a.habitats.includes(biome))
						: [];
				if (guests.length > 0)
					visited.push(`${lead}:${biome}:${guests.map((a) => a.id).join('+')}`);
				for (const d of [
					0,
					SAFE_RADIUS,
					(SAFE_RADIUS + WILD_RADIUS) / 2,
					WILD_RADIUS - 1,
					WILD_RADIUS,
					1000
				]) {
					const visitors = d < WILD_RADIUS ? guests : [];
					const expected = [...living.filter((a) => a.tier >= lead - 1), ...visitors]
						.map((a) => a.id)
						.sort();
					const table = encounterTable(biome, d, lead);
					expect(
						table.map((e) => e.species.id).sort(),
						`tier-${lead} lead in ${biome} @ ${d}`
					).toEqual(expected);
					if (table.length > 0) expect(total(table)).toBeCloseTo(1, 12);
					for (const e of table) expect(e.weight, `${e.species.id} in ${biome}`).toBeGreaterThan(0);
				}
			}
		}
		// With the prototype catalog: squirrels and rabbits come down to the frogs'
		// river for the starter, the tier-1 animals up the mountains, and the
		// mountains for a fox, an otter or a deer. The river has nothing bigger
		// than an otter, so a fox or an otter in front meets no visitors there.
		expect(visited).toEqual([
			'1:river:squirrel+rabbit',
			'1:mountain:squirrel+rabbit+frog',
			'2:mountain:fox+otter',
			'3:mountain:deer'
		]);
	});

	it('is empty exactly where nothing living there is within one tier below the lead', () => {
		const silent: [Tier, Biome][] = [];
		const bad: string[] = [];
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				const anyone = residents(biome).some((a) => a.tier >= lead - 1);
				for (const d of SWEEP) {
					if (encounterTable(biome, d, lead).length > 0 !== anyone)
						bad.push(`tier-${lead} lead in ${biome} @ ${d}`);
				}
				if (!anyone) silent.push([lead, biome]);
			}
		}
		expect(bad).toEqual([]);
		expect(silent).toEqual(SILENT);
	});

	it('every species can be met somewhere by every lead it may challenge', () => {
		for (const lead of LEADS) {
			for (const a of ANIMALS.filter((a) => a.tier >= lead - 1)) {
				for (const d of [0, 1000]) {
					const met = BIOMES.some((b) =>
						encounterTable(b, d, lead).some((e) => e.species.id === a.id)
					);
					expect(met, `${a.id} never challenges a tier-${lead} lead (d = ${d})`).toBe(true);
				}
			}
		}
	});

	it("inside the safe radius the lead's tier is the majority and two tiers up is under 5%, wherever anything its size or bigger lives", () => {
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				if (!residents(biome).some((a) => a.tier >= lead)) continue;
				for (const d of [0, SAFE_RADIUS / 2, SAFE_RADIUS]) {
					const where = `tier-${lead} lead in ${biome} @ ${d}`;
					expect(
						share(biome, d, lead, (t) => t === lead),
						where
					).toBeGreaterThan(0.5);
					expect(
						share(biome, d, lead, (t) => t >= lead + 2),
						where
					).toBeLessThan(0.05);
				}
			}
		}
	});

	it("the share two tiers above the lead never falls and the lead's own never rises with distance; beyond the wild radius its tier and up are equal", () => {
		const bad: string[] = [];
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				let prevFierce = -1;
				let prevOwn = 2;
				for (let d = 0; d <= WILD_RADIUS + 64; d += 0.5) {
					const fierce = share(biome, d, lead, (t) => t >= lead + 2);
					const own = share(biome, d, lead, (t) => t === lead);
					const where = `tier-${lead} lead in ${biome} @ ${d}`;
					if (!(fierce >= prevFierce - 1e-12)) bad.push(`${where}: two up fell to ${fierce}`);
					if (!(own <= prevOwn + 1e-12)) bad.push(`${where}: own tier rose to ${own}`);
					prevFierce = fierce;
					prevOwn = own;
				}
				const far = encounterTable(biome, WILD_RADIUS, lead);
				for (const e of far) expect(e.species.habitats, 'no visitor far out').toContain(biome);
				const upper = far.filter((e) => e.species.tier >= lead);
				for (const e of upper) expect(e.weight).toBeCloseTo(upper[0]!.weight, 12);
				expect(encounterTable(biome, WILD_RADIUS * 4, lead)).toEqual(far);
			}
		}
		expect(bad).toEqual([]);
	});

	it('measures distance as the crow flies', () => {
		expect(distanceFromSpawn({ x: 1, y: 10 }, { x: -2, y: 6 })).toBe(5);
	});

	it('refuses a lead that is not a tier', () => {
		for (const bad of [0, 6, 2.5, -1, NaN, Infinity, undefined, null, '2']) {
			const lead = bad as unknown as Tier;
			expect(() => encounterTable('meadow', 0, lead), String(bad)).toThrow(/tier/);
			expect(() => rollEncounter(new Rng(1), siteAt('meadow', 0), lead), String(bad)).toThrow(
				/tier/
			);
			const onSand = { ...siteAt('meadow', 0), tile: { kind: 'sand', biome: 'meadow', height: 0 } };
			expect(() => rollEncounter(new Rng(1), onSand as EncounterSite, lead)).toThrow(/tier/);
		}
	});
});

describe('rollEncounter', () => {
	it('is empty on every tile kind but tall grass, and leaves the rng untouched', () => {
		const kinds: readonly TileKind[] = ['grass', 'sand', 'water', 'rock', 'tree', 'tent'];
		for (const lead of LEADS) {
			for (const kind of kinds) {
				for (const biome of BIOMES) {
					const rng = new Rng(1);
					const site = { tile: { kind, biome, height: 0 }, pos: { x: 300, y: 0 }, spawn: ORIGIN };
					const rolls = Array.from({ length: 100 }, () => rollEncounter(rng, site, lead));
					expect(rolls.filter((w) => w !== null)).toEqual([]);
					expect(rng.next()).toBe(new Rng(1).next());
				}
			}
		}
	});

	it('stays quiet without a draw where nothing could challenge the lead', () => {
		for (const [lead, biome] of SILENT) {
			for (const d of [0, 64, 400]) {
				const rng = new Rng(7);
				const rolls = Array.from({ length: 500 }, () => rollEncounter(rng, siteAt(biome, d), lead));
				expect(rolls.filter((w) => w !== null)).toEqual([]);
				expect(rng.next()).toBe(new Rng(7).next());
			}
		}
	});

	it('for a tier-1 lead draws exactly as [[PRODUCT]] §4 says: the chance, then a pick down the table', () => {
		for (const biome of BIOMES) {
			for (const d of [0, 16, 40, 64, 100, 127.5, 160]) {
				const now = new Rng(hashString(`before:${biome}:${d}`));
				const spec = new Rng(hashString(`before:${biome}:${d}`));
				const rolls = Array.from({ length: 1500 }, () => [
					rollEncounter(now, siteAt(biome, d), 1)?.speciesId ?? null,
					tierOneRoll(spec, siteAt(biome, d))
				]);
				expect(
					rolls.filter(([a, b]) => a !== b),
					`${biome} @ ${d}`
				).toEqual([]);
				expect(rolls.filter(([a]) => a !== null).length).toBeGreaterThan(100);
			}
		}
	});

	it('the lead never changes whether a step starts a battle, only which animal comes out', () => {
		let battles = 0;
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				if (isSilent(lead, biome)) continue;
				for (const d of [0, 64, 400]) {
					const seeds = Array.from({ length: 400 }, (_, i) => hashString(`${biome}:${d}:${i}`));
					const withLead = seeds.map((s) => rollEncounter(new Rng(s), siteAt(biome, d), lead));
					const withStarter = seeds.map((s) => rollEncounter(new Rng(s), siteAt(biome, d), 1));
					expect(
						withLead.map((w) => w !== null),
						`tier-${lead} lead in ${biome} @ ${d}`
					).toEqual(withStarter.map((w) => w !== null));
					battles += withLead.filter((w) => w !== null).length;
				}
			}
		}
		expect(battles).toBeGreaterThan(1000);
	});

	it('starts one encounter per 8–12 grass steps wherever anything could challenge the lead', () => {
		const steps = 8000;
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				if (isSilent(lead, biome)) continue;
				const rng = new Rng(hashString(`${lead}:${biome}`));
				let hits = 0;
				for (let i = 0; i < steps; i++) if (rollEncounter(rng, siteAt(biome, 50), lead)) hits++;
				const where = `tier-${lead} lead in ${biome}`;
				expect(hits / steps, where).toBeGreaterThan(1 / 12);
				expect(hits / steps, where).toBeLessThan(1 / 8);
				expect(hits / steps, where).toBeCloseTo(ENCOUNTER_CHANCE, 1);
			}
		}
		// Under 1 s alone (8,000 rolls per lead and biome); over 5 s under a heavy load.
	}, 30_000);

	it('is deterministic: same seed, site and lead, same sequence', () => {
		for (const lead of LEADS) {
			const run = (seed: number) => {
				const rng = new Rng(seed);
				return Array.from({ length: 300 }, () => rollEncounter(rng, siteAt('forest', 200), lead));
			};
			expect(run(42)).toEqual(run(42));
			expect(run(42)).not.toEqual(run(43));
		}
	});

	it('refuses a site with a broken position instead of guessing a table', () => {
		const broken = { tile: tallgrass('forest'), pos: { x: NaN, y: 0 }, spawn: ORIGIN };
		for (const lead of LEADS) expect(() => rollEncounter(new Rng(3), broken, lead)).toThrow();
		expect(() => encounterTable('forest', NaN, 1)).toThrow();
		expect(() => encounterTable('forest', Infinity, 3)).toThrow();
	});

	it('anywhere on the map, returns only an animal that may challenge the lead, at full HP', () => {
		// Spawns and steps on both sides of both axes.
		const spawns: GridPos[] = [
			{ x: -2, y: 6 },
			{ x: -1000, y: -1000 },
			{ x: 37, y: -91 }
		];
		const offsets: GridPos[] = [
			{ x: -3, y: -4 },
			{ x: 20, y: -21 },
			{ x: -45, y: 60 },
			{ x: -150, y: -150 }
		];
		const bad: string[] = [];
		let met = 0;
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const spawn of spawns) {
					for (const o of offsets) {
						const pos = { x: spawn.x + o.x, y: spawn.y + o.y };
						const site = { tile: tallgrass(biome), pos, spawn };
						const table = encounterTable(biome, distanceFromSpawn(pos, spawn), lead);
						const rng = new Rng(hashString(`${lead}:${biome}:${pos.x}:${pos.y}`));
						let here = 0;
						for (let i = 0; i < 200; i++) {
							const wild = rollEncounter(rng, site, lead);
							if (!wild) continue;
							here++;
							const spec = getAnimal(wild.speciesId);
							const where = `${spec.id} vs a tier-${lead} lead in ${biome} at (${pos.x}, ${pos.y})`;
							if (spec.tier < lead - 1) bad.push(`${where}: too small`);
							if (!table.some((e) => e.species.id === spec.id))
								bad.push(`${where}: not in the table`);
							if (!spec.habitats.includes(biome) && spec.tier !== lead)
								bad.push(`${where}: a visitor not of the lead's tier`);
							if (wild.hp !== spec.maxHp) bad.push(`${where}: hp ${wild.hp}`);
							if (Object.keys(wild).sort().join() !== 'hp,speciesId')
								bad.push(`${where}: keys ${Object.keys(wild)}`);
						}
						if (here > 0 === isSilent(lead, biome))
							bad.push(`tier-${lead} lead in ${biome} at (${pos.x}, ${pos.y}): ${here} met`);
						met += here;
					}
				}
			}
		}
		expect(bad).toEqual([]);
		expect(met).toBeGreaterThan(2000);
	});

	it("samples the lead's table: species shares match the weights, and far out every species shows up", () => {
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				if (isSilent(lead, biome)) continue;
				for (const d of [0, 400]) {
					// Every roll is an encounter, so no time goes on the nine steps in
					// ten that meet nothing (the rate has its own tests above).
					const rng = new EveryStepMeets(hashString(`sample:${lead}:${biome}:${d}`));
					const counts = new Map<string, number>();
					const encounters = 4000;
					for (let n = 0; n < encounters; n++) {
						const wild = rollEncounter(rng, siteAt(biome, d), lead);
						if (!wild) throw new Error(`no encounter for a tier-${lead} lead in ${biome}`);
						counts.set(wild.speciesId, (counts.get(wild.speciesId) ?? 0) + 1);
					}
					const table = encounterTable(biome, d, lead);
					for (const e of table) {
						const observed = (counts.get(e.species.id) ?? 0) / encounters;
						expect(
							Math.abs(observed - e.weight),
							`${e.species.id}, tier-${lead} lead in ${biome} @ ${d}`
						).toBeLessThan(0.03);
					}
					if (d > WILD_RADIUS) expect(counts.size).toBe(table.length);
				}
			}
		}
		// Under 1 s alone (4,000 encounters per lead, biome and distance); over 5 s under a heavy load.
	}, 30_000);
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
		// About 1.5 s alone (1,156 chunks generated); over 2 s with two browsers drawing beside it.
	}, 30_000);
});
