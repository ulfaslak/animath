import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import type { Biome, Realm, Terrain, Tier } from '../src/animals/types.js';
import { Rng, hashString } from '../src/rng.js';
import {
	ENCOUNTER_CHANCE,
	ONE_TIER_BELOW_WEIGHT,
	SAFE_RADIUS,
	WILD_RADIUS,
	distanceFromSpawn,
	encounterTable,
	encounterTableAt,
	rollEncounter,
	type EncounterEntry,
	type EncounterSite
} from '../src/world/encounters.js';
import { generateChunk, tileAtWorld } from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import { surroundings, type Surroundings } from '../src/world/habitat.js';
import { isEncounterTile, type GridPos, type Tile, type TileKind } from '../src/world/types.js';

/** Where encounters happen: the tall grass of the four biomes on land, and the sea's deep water. */
const BIOMES: readonly Biome[] = ['meadow', 'forest', 'river', 'mountain', 'sea'];
const LEADS: readonly Tier[] = [1, 2, 3, 4, 5];
const ORIGIN = { x: 0, y: 0 };
const tallgrass = (biome: Biome): Tile => ({ kind: 'tallgrass', biome, height: 0 });
/** The realm of an encounter in a biome: out on the sea's deep water, the water; else land. */
const realmOf = (biome: Biome): Realm => (biome === 'sea' ? 'water' : 'land');
/** The tile an encounter in a biome happens on: tall grass, or out in the sea, deep water. */
const encounterTile = (biome: Biome): Tile =>
	biome === 'sea' ? { kind: 'deepwater', biome, height: 0 } : tallgrass(biome);
/** The biome's table in its own realm. */
const tableIn = (biome: Biome, distance: number, lead: Tier) =>
	encounterTable(biome, distance, lead, realmOf(biome));

/** Open ground: no water, trees or rocks within 3 tiles. */
const OPEN: Surroundings = { water: 0, trees: 0, rocks: 0 };

/**
 * A handful of grounds for the sweeps that don't need every one: open, each
 * terrain in plenty, a little of each, and a mix of two.
 */
const GROUNDS: readonly Surroundings[] = [
	OPEN,
	{ water: 9, trees: 0, rocks: 0 },
	{ water: 0, trees: 12, rocks: 0 },
	{ water: 0, trees: 0, rocks: 7 },
	{ water: 1, trees: 1, rocks: 1 },
	{ water: 3, trees: 4, rocks: 0 },
	{ water: 0, trees: 2, rocks: 5 },
	{ water: 5, trees: 0, rocks: 2 }
];

/**
 * Every ground that makes a difference, and one past it: water, trees and
 * rocks each 0 to 8 tiles (from 7 each counts in full, so 8 behaves like 7).
 */
const GROUND_GRID: readonly Surroundings[] = Array.from({ length: 9 ** 3 }, (_, i) => ({
	water: i % 9,
	trees: Math.floor(i / 9) % 9,
	rocks: Math.floor(i / 81)
}));

/** Site `distance` tiles east of an origin spawn, with the ground `around` it. */
const siteAt = (biome: Biome, distance: number, around: Surroundings = OPEN): EncounterSite => ({
	tile: encounterTile(biome),
	pos: { x: distance, y: 0 },
	spawn: ORIGIN,
	around
});

/** Every half tile from spawn to past the wild radius, and far away. */
const SWEEP = [...Array.from({ length: 2 * (WILD_RADIUS + 64) + 1 }, (_, i) => i / 2), 1000];

const total = (entries: readonly EncounterEntry[]) => entries.reduce((s, e) => s + e.weight, 0);

function share(biome: Biome, distance: number, lead: Tier, tiers: (t: number) => boolean): number {
	return total(tableIn(biome, distance, lead).filter((e) => tiers(e.species.tier)));
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
	realms: readonly Realm[];
	favours: Terrain;
}

/**
 * A tier-1 lead's encounter table, written out again from [[PRODUCT]] §4 for
 * any roster, with its numbers as literals: only animals living in the
 * biome's realm (the water out in the sea, land everywhere else) come out; a
 * tier-t resident weighs 5^−(t−1)(1−danger) with danger = clamp((d − 32)/96),
 * and at the river and in the mountains, where a resident is bigger than
 * tier 1, every tier-1 species of the realm that doesn't live there visits,
 * weighing 1 − danger. Shares, in roster order. Before the frog it was PR
 * #12's table: the river and the mountains were exactly the biomes with
 * residents but no tier-1 animal.
 */
function tierOneTable(
	roster: readonly Kind[],
	biome: Biome,
	distance: number
): Map<string, number> {
	const danger = Math.min(1, Math.max(0, (distance - 32) / 96));
	const realm = realmOf(biome);
	const here = roster.filter((a) => a.realms.includes(realm));
	const living = here.filter((a) => a.habitats.includes(biome));
	const visited = (biome === 'river' || biome === 'mountain') && living.some((a) => a.tier > 1);
	const raw = new Map<string, number>();
	for (const a of here) {
		if (a.habitats.includes(biome)) raw.set(a.id, Math.pow(5, -(a.tier - 1) * (1 - danger)));
		else if (a.tier === 1 && visited && danger < 1) raw.set(a.id, 1 - danger);
	}
	let sum = 0;
	for (const w of raw.values()) sum += w;
	return new Map([...raw].map(([id, w]) => [id, w / sum]));
}

/**
 * What the ground does, written out again from [[PRODUCT]] §4 with its numbers
 * as literals: a species comes out 4^s times as often, s being how much of the
 * terrain it favours lies within 3 tiles. Water, trees or rocks count fully
 * from 7 of the 28 tiles there; open ground counts fully with none of those
 * three near and not at all once they make 7 together.
 */
function groundFactor(favours: Terrain, around: Surroundings): number {
	const cover = around.water + around.trees + around.rocks;
	const s = favours === 'open' ? 1 - Math.min(1, cover / 7) : Math.min(1, around[favours] / 7);
	return 4 ** s;
}

/**
 * `tierOneTable` on a tile with the ground `around` it, as [[PRODUCT]] §4
 * writes it out: within a tier, each animal's share of its tier goes by its
 * biome share times its `groundFactor`; a tier's share is its biome share
 * times its animals' mean factor (weighted by their biome shares) raised to
 * danger = clamp((d − 32) / 96), normalised.
 */
function tierOneTableAt(
	roster: readonly Kind[],
	biome: Biome,
	distance: number,
	around: Surroundings
): Map<string, number> {
	const danger = Math.min(1, Math.max(0, (distance - 32) / 96));
	const kinds = new Map(roster.map((a) => [a.id, a]));
	const table = tierOneTable(roster, biome, distance);
	const tiers = new Map<number, { share: number; weighed: number }>();
	for (const [id, w] of table) {
		const a = kinds.get(id)!;
		const t = tiers.get(a.tier) ?? { share: 0, weighed: 0 };
		t.share += w;
		t.weighed += w * groundFactor(a.favours, around);
		tiers.set(a.tier, t);
	}
	const tierWeight = (t: { share: number; weighed: number }) =>
		t.share * (t.weighed / t.share) ** danger;
	let sum = 0;
	for (const t of tiers.values()) sum += tierWeight(t);
	return new Map(
		[...table].map(([id, w]) => {
			const a = kinds.get(id)!;
			const t = tiers.get(a.tier)!;
			return [id, (tierWeight(t) / sum) * ((w * groundFactor(a.favours, around)) / t.weighed)];
		})
	);
}

/** A tier-1 lead's roll on tall grass or deep water: the chance, then a pick down `tierOneTableAt`. */
function tierOneRoll(rng: Rng, site: EncounterSite): string | null {
	if (site.tile.kind !== 'tallgrass' && site.tile.kind !== 'deepwater') return null;
	if (!rng.chance(0.1)) return null;
	const table = tierOneTableAt(
		ANIMALS,
		site.tile.biome,
		distanceFromSpawn(site.pos, site.spawn),
		site.around
	);
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
				const table = tableIn(biome, d, 1);
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
		// Today's numbers near spawn, as [[PRODUCT]] §4 quotes them: every small animal of the
		// biome at 1, a tier-2 one at 1/5, a deer at 1/25, and so on up; at the river and in
		// the mountains, the small animals that live elsewhere come too, at 1 each.
		const each = (w: number, ...ids: string[]) => Object.fromEntries(ids.map((id) => [id, w]));
		expectShares(
			encounterTable('meadow', 0, 1),
			normalised({
				...each(1, 'squirrel', 'rabbit', 'shrew', 'wood-mouse', 'brown-rat', 'hedgehog'),
				...each(1, 'mole', 'common-lizard', 'robin'),
				fox: 0.2,
				'roe-deer': 0.2,
				badger: 0.2,
				stoat: 0.2,
				adder: 0.2,
				deer: 0.04
			})
		);
		expectShares(
			encounterTable('forest', 0, 1),
			normalised({
				...each(1, 'squirrel', 'shrew', 'wood-mouse', 'hedgehog', 'common-toad', 'robin'),
				'stag-beetle': 1,
				fox: 0.2,
				'roe-deer': 0.2,
				badger: 0.2,
				'pine-marten': 0.2,
				'tawny-owl': 0.2,
				raccoon: 0.2,
				deer: 0.04,
				wolf: 0.008,
				bear: 0.0016
			})
		);
		expectShares(
			encounterTable('river', 0, 1),
			normalised({
				...each(1, 'frog', 'brown-rat', 'common-toad'),
				...each(1, 'squirrel', 'rabbit', 'shrew', 'wood-mouse', 'hedgehog', 'mole'),
				...each(1, 'common-lizard', 'robin', 'stag-beetle'),
				otter: 0.2,
				'grey-heron': 0.2,
				raccoon: 0.2,
				beaver: 0.2
			})
		);
		expectShares(
			encounterTable('mountain', 0, 1),
			normalised({
				'common-lizard': 1,
				...each(1, 'squirrel', 'rabbit', 'frog', 'shrew', 'wood-mouse', 'brown-rat'),
				...each(1, 'hedgehog', 'mole', 'common-toad', 'robin', 'stag-beetle'),
				stoat: 0.2,
				adder: 0.2,
				wolf: 0.008,
				bear: 0.0016
			})
		);
		// Out on the deep water: the sea animals only, the frog in the boat's lead or not.
		expectShares(
			encounterTable('sea', 0, 1, 'water'),
			normalised({
				crab: 1,
				starfish: 1,
				turtle: 0.2,
				dolphin: 0.04,
				octopus: 0.008,
				whale: 0.0016
			})
		);
	});

	it('the frog lives in the river reeds: every lead it may challenge meets it there, near and far, and no bigger one ever does', () => {
		const frog = getAnimal('frog');
		expect(frog.tier).toBe(1);
		expect(frog.habitats).toEqual(['river']);
		const frogShare = (biome: Biome, d: number, lead: Tier) =>
			encounterTable(biome, d, lead).find((e) => e.species.id === 'frog')?.weight ?? 0;
		// A tier-1 lead: one of the twelve small animals in the reeds near home, beside the
		// brown rats and toads that live there too and the nine that come down to the water
		// (the four tier-2 animals of the river weigh a fifth each); one in seven far out,
		// beside the rats, the toads and the four bigger ones.
		expect(frogShare('river', 0, 1)).toBeCloseTo(1 / 12.8, 12);
		expect(frogShare('river', SAFE_RADIUS, 1)).toBeCloseTo(1 / 12.8, 12);
		expect(frogShare('river', WILD_RADIUS, 1)).toBeCloseTo(1 / 7, 12);
		expect(frogShare('river', 1000, 1)).toBeCloseTo(1 / 7, 12);
		// It comes up the hills near home too, like the other tier-1 animals.
		expect(frogShare('mountain', 0, 1)).toBeCloseTo(1 / 12.4096, 12);
		expect(frogShare('mountain', WILD_RADIUS, 1)).toBe(0);
		// A tier-2 lead: one tier below, 1/10 of each of the river's four tier-2 animals,
		// near and far, and never a visitor.
		for (const d of [0, SAFE_RADIUS, 80, WILD_RADIUS, 1000]) {
			expect(frogShare('river', d, 2), `river @ ${d}`).toBeCloseTo(0.1 / 4.3, 12);
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
					for (const e of tableIn(biome, d, lead)) {
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
				habitats: a.habitats,
				realms: a.realms,
				favours: a.favours
			}));
			for (const biome of BIOMES) {
				for (const d of SWEEP) {
					const where = `tier-${lead} lead in ${biome} @ ${d}`;
					const upper = tableIn(biome, d, lead).filter((e) => e.species.tier >= lead);
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
					const table = tableIn(biome, d, lead);
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
		// Near spawn with a tier-2 animal in front, as [[PRODUCT]] §4 quotes it: its own
		// tier at 1, a small one at 1/10, a deer at 1/5, and so on up.
		const each = (w: number, ...ids: string[]) => Object.fromEntries(ids.map((id) => [id, w]));
		expectShares(
			encounterTable('meadow', 0, 2),
			normalised({
				...each(1, 'fox', 'roe-deer', 'badger', 'stoat', 'adder'),
				deer: 0.2,
				...each(0.1, 'squirrel', 'rabbit', 'shrew', 'wood-mouse', 'brown-rat', 'hedgehog'),
				...each(0.1, 'mole', 'common-lizard', 'robin')
			})
		);
		expectShares(
			encounterTable('forest', 0, 2),
			normalised({
				...each(1, 'fox', 'roe-deer', 'badger', 'pine-marten', 'tawny-owl', 'raccoon'),
				deer: 0.2,
				wolf: 0.04,
				bear: 0.008,
				...each(0.1, 'squirrel', 'shrew', 'wood-mouse', 'hedgehog', 'common-toad', 'robin'),
				'stag-beetle': 0.1
			})
		);
		expectShares(
			encounterTable('river', 0, 2),
			normalised({
				...each(1, 'otter', 'grey-heron', 'raccoon', 'beaver'),
				...each(0.1, 'frog', 'brown-rat', 'common-toad')
			})
		);
		// The mountains' own stoats and adders, the other tier-2 animals come up the hills,
		// and the lizard is one tier below.
		expectShares(
			encounterTable('mountain', 0, 2),
			normalised({
				...each(1, 'stoat', 'adder', 'fox', 'otter', 'roe-deer', 'badger', 'pine-marten'),
				...each(1, 'grey-heron', 'tawny-owl', 'raccoon', 'beaver'),
				'common-lizard': 0.1,
				wolf: 0.04,
				bear: 0.008
			})
		);
		// An otter in front, out on the deep water: turtles, and the small ones 1 time in 10 of a turtle.
		expectShares(
			encounterTable('sea', 0, 2, 'water'),
			normalised({ crab: 0.1, starfish: 0.1, turtle: 1, dolphin: 0.2, octopus: 0.04, whale: 0.008 })
		);
	});

	it("lists the residents from one tier below the lead up, plus, at the river and in the mountains, visitors of the lead's tier where bigger animals live", () => {
		const visited: string[] = [];
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				const living = residents(biome);
				const guests =
					(biome === 'river' || biome === 'mountain') && living.some((a) => a.tier > lead)
						? ANIMALS.filter(
								(a) =>
									a.tier === lead &&
									!a.habitats.includes(biome) &&
									a.realms.includes(realmOf(biome))
							)
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
					const table = tableIn(biome, d, lead);
					expect(
						table.map((e) => e.species.id).sort(),
						`tier-${lead} lead in ${biome} @ ${d}`
					).toEqual(expected);
					if (table.length > 0) expect(total(table)).toBeCloseTo(1, 12);
					for (const e of table) expect(e.weight, `${e.species.id} in ${biome}`).toBeGreaterThan(0);
				}
			}
		}
		// The small animals that live elsewhere come down to the river for the starter, and
		// up the mountains; so do the tier-2 animals for a tier-2 lead, and the deer for a
		// deer. The river has nothing bigger than tier 2, so a tier-2 lead meets no visitors there.
		expect(visited).toEqual([
			'1:river:squirrel+rabbit+shrew+wood-mouse+hedgehog+mole+common-lizard+robin+stag-beetle',
			'1:mountain:squirrel+rabbit+frog+shrew+wood-mouse+brown-rat+hedgehog+mole+common-toad+robin+stag-beetle',
			'2:mountain:fox+otter+roe-deer+badger+pine-marten+grey-heron+tawny-owl+raccoon+beaver',
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
					if (tableIn(biome, d, lead).length > 0 !== anyone)
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
					const met = BIOMES.some((b) => tableIn(b, d, lead).some((e) => e.species.id === a.id));
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
				const far = tableIn(biome, WILD_RADIUS, lead);
				for (const e of far) expect(e.species.habitats, 'no visitor far out').toContain(biome);
				const upper = far.filter((e) => e.species.tier >= lead);
				for (const e of upper) expect(e.weight).toBeCloseTo(upper[0]!.weight, 12);
				expect(tableIn(biome, WILD_RADIUS * 4, lead)).toEqual(far);
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

/** Shares of a table by species id. */
const sharesOf = (table: readonly EncounterEntry[]) =>
	new Map(table.map((e) => [e.species.id, e.weight] as const));

/** The share of a table held by species whose tier passes `tiers`. */
const tierShare = (table: readonly EncounterEntry[], tiers: (t: number) => boolean) =>
	total(table.filter((e) => tiers(e.species.tier)));

/**
 * Failures of a sweep, the first 20 of them with a count of the rest: a
 * broken rule fails thousands of cells, and formatting every one of them
 * would take longer than the sweep.
 */
function findings() {
	const list: string[] = [];
	let more = 0;
	return {
		list,
		note(finding: string) {
			if (list.length < 20) list.push(finding);
			else list[19] = `…and ${++more} more`;
		}
	};
}

describe('encounterTableAt: the ground around the tall grass', () => {
	it("lists exactly the biome's species, in its order, each at a quarter to four times its biome share", () => {
		const bad = findings();
		let compared = 0;
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of [0, 16, 48, 80, 127, 400]) {
					const inBiome = tableIn(biome, d, lead);
					for (const around of GROUND_GRID) {
						const here = encounterTableAt(siteAt(biome, d, around), lead);
						const where = `tier-${lead} lead in ${biome} @ ${d} on ${JSON.stringify(around)}`;
						if (here.map((e) => e.species.id).join() !== inBiome.map((e) => e.species.id).join())
							bad.note(`${where} lists ${here.map((e) => e.species.id)}`);
						if (here.length > 0 && !(Math.abs(total(here) - 1) <= 1e-12))
							bad.note(`${where} sums to ${total(here)}`);
						here.forEach((e, i) => {
							compared++;
							const ratio = e.weight / inBiome[i]!.weight;
							if (!(ratio >= 0.25 - 1e-12 && ratio <= 4 + 1e-12))
								bad.note(`${e.species.id}, ${where}: ×${ratio}`);
						});
					}
				}
			}
		}
		expect(bad.list).toEqual([]);
		expect(compared).toBeGreaterThan(100_000);
	});

	it('for a tier-1 lead is the table [[PRODUCT]] §4 writes out, on every ground', () => {
		const bad = findings();
		for (const biome of BIOMES) {
			for (const d of [0, 20, 32, 50, 80, 127.5, 128, 1000]) {
				for (const around of GROUND_GRID) {
					const here = encounterTableAt(siteAt(biome, d, around), 1);
					const expected = tierOneTableAt(ANIMALS, biome, d, around);
					const where = `${biome} @ ${d} on ${JSON.stringify(around)}`;
					if (here.map((e) => e.species.id).join() !== [...expected.keys()].join())
						bad.note(`${where} lists ${here.map((e) => e.species.id)}`);
					for (const e of here)
						if (!(Math.abs(e.weight - expected.get(e.species.id)!) <= 1e-12))
							bad.note(`${e.species.id} in ${where}: ${e.weight} vs ${expected.get(e.species.id)}`);
				}
			}
		}
		expect(bad.list).toEqual([]);
	});

	it('from its own tier up, a tier-T lead meets what a tier-1 lead met in a world T − 1 tiers smaller, on every ground', () => {
		const bad = findings();
		let compared = 0;
		const grounds = GROUND_GRID.filter((g) =>
			[g.water, g.trees, g.rocks].every((n) => n % 2 === 1 || n === 0)
		);
		for (const lead of LEADS) {
			const shrunk = ANIMALS.filter((a) => a.tier >= lead).map((a) => ({
				id: a.id,
				tier: a.tier - (lead - 1),
				habitats: a.habitats,
				realms: a.realms,
				favours: a.favours
			}));
			for (const biome of BIOMES) {
				for (const d of [0, 16, 32, 48, 80, 127, 128, 400]) {
					for (const around of grounds) {
						const where = `tier-${lead} lead in ${biome} @ ${d} on ${JSON.stringify(around)}`;
						const upper = encounterTableAt(siteAt(biome, d, around), lead).filter(
							(e) => e.species.tier >= lead
						);
						const mass = total(upper);
						const expected = tierOneTableAt(shrunk, biome, d, around);
						if (upper.map((e) => e.species.id).join() !== [...expected.keys()].join())
							bad.note(`${where} lists ${upper.map((e) => e.species.id)}`);
						for (const e of upper) {
							compared++;
							if (!(Math.abs(e.weight / mass - expected.get(e.species.id)!) <= 1e-12))
								bad.note(`${e.species.id}, ${where}: ${e.weight / mass}`);
						}
					}
				}
			}
		}
		expect(bad.list).toEqual([]);
		expect(compared).toBeGreaterThan(20_000);
	});

	it('more of a terrain nearby never lowers the share of an animal that favours it', () => {
		// One tile around turns into terrain `to`, from open ground or from
		// another terrain; `open` gains when a tile of water, trees or rocks
		// turns into ground with none of them. Every animal favouring the
		// terrain that gained keeps its share or grows it, whoever leads,
		// wherever, at any distance.
		type Move = { to: Terrain; from: Terrain };
		const moves: Move[] = [];
		for (const to of ['water', 'trees', 'rocks', 'open'] as const)
			for (const from of ['water', 'trees', 'rocks', 'open'] as const)
				if (to !== from) moves.push({ to, from });
		const index = (w: number, t: number, r: number) => w + 9 * t + 81 * r;
		const bad = findings();
		let rose = 0;
		let checked = 0;
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				if (isSilent(lead, biome)) continue;
				for (const d of [0, 48, 400]) {
					const tables = GROUND_GRID.map((around) =>
						sharesOf(encounterTableAt(siteAt(biome, d, around), lead))
					);
					const ids = [...tables[0]!.keys()];
					GROUND_GRID.forEach((before, i) => {
						for (const { to, from } of moves) {
							const after = { ...before };
							if (from !== 'open') after[from] -= 1;
							if (to !== 'open') after[to] += 1;
							if ([after.water, after.trees, after.rocks].some((n) => n < 0 || n > 8)) continue;
							const j = index(after.water, after.trees, after.rocks);
							for (const id of ids) {
								if (getAnimal(id).favours !== to) continue;
								checked++;
								const was = tables[i]!.get(id)!;
								const now = tables[j]!.get(id)!;
								if (now < was - 1e-12)
									bad.note(
										`${id}, tier-${lead} lead in ${biome} @ ${d}: ${from} → ${to} at ${JSON.stringify(before)}: ${was} → ${now}`
									);
								if (now > was + 1e-12) rose++;
							}
						}
					});
				}
			}
		}
		expect(bad.list).toEqual([]);
		// Not a sweep of ties: the ground moved these shares tens of thousands of times.
		expect(checked).toBeGreaterThan(50_000);
		expect(rose).toBeGreaterThan(20_000);
	});

	it('on any ground, the share of animals bigger than the lead, and of those two tiers up, never falls with distance', () => {
		// Its own tier's share may rise by a hair: where animals of one tier favour different
		// ground, the ground's pull as danger rises can take a little from the animals one tier
		// below before distance brings the bigger ones on (#89). The world never gets gentler
		// as a kid walks out, which is what the promise is for.
		const bad = findings();
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				if (isSilent(lead, biome)) continue;
				for (const around of GROUNDS) {
					let prevFierce = -1;
					let prevBigger = -1;
					for (let d = 0; d <= WILD_RADIUS + 64; d += 1) {
						const here = encounterTableAt(siteAt(biome, d, around), lead);
						const fierce = tierShare(here, (t) => t >= lead + 2);
						const bigger = tierShare(here, (t) => t > lead);
						const where = `tier-${lead} lead in ${biome} @ ${d} on ${JSON.stringify(around)}`;
						if (!(fierce >= prevFierce - 1e-12)) bad.note(`${where}: two up fell to ${fierce}`);
						if (!(bigger >= prevBigger - 1e-12)) bad.note(`${where}: bigger fell to ${bigger}`);
						prevFierce = fierce;
						prevBigger = bigger;
					}
				}
			}
		}
		expect(bad.list).toEqual([]);
	});

	it('lists only animals that live in the realm the tile is in: out on the deep water only the sea animals, in the tall grass never one', () => {
		// The frog and the otter swim, but live by the river: out at sea only the
		// animals that live nowhere else come out, and none of them ever in the reeds.
		const sea = ANIMALS.filter((a) => a.habitats.includes('sea')).map((a) => a.id);
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of [0, 64, 400]) {
					for (const e of encounterTableAt(siteAt(biome, d), lead)) {
						const where = `${e.species.id} in ${biome}, tier-${lead} lead @ ${d}`;
						expect(e.species.realms, where).toContain(realmOf(biome));
						expect(sea.includes(e.species.id), where).toBe(biome === 'sea');
					}
					expect(encounterTable(biome, d, lead, 'land')).toEqual(encounterTable(biome, d, lead));
				}
			}
			// The shallows along a shore are no one's: nothing comes out of them.
			for (const biome of ['river', 'meadow', 'sea'] as const) {
				const shallows = { ...siteAt(biome, 0), tile: { kind: 'water', biome, height: 0 } };
				expect(encounterTableAt(shallows as EncounterSite, lead)).toEqual([]);
			}
		}
		expect(sea).toEqual(['crab', 'starfish', 'turtle', 'dolphin', 'octopus', 'whale']);
		// A land biome grows no water to meet anything in; were its table built for the water,
		// it would hold only the amphibious animals living there (the toad in the forest).
		for (const biome of ['meadow', 'forest', 'mountain'] as const) {
			for (const e of encounterTable(biome, 0, 1, 'water')) {
				expect(e.species.realms, e.species.id).toEqual(['land', 'water']);
				expect(e.species.habitats, e.species.id).toContain(biome);
			}
		}
	});
});

describe('the start: the ground near spawn', () => {
	it("inside the safe radius the ground never moves a tier: on every ground, each tier's share is the biome table's, whoever leads", () => {
		const bad = findings();
		let compared = 0;
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of [0, 8, 16, 24, SAFE_RADIUS]) {
					const inBiome = tableIn(biome, d, lead);
					for (const around of GROUND_GRID) {
						const here = encounterTableAt(siteAt(biome, d, around), lead);
						for (const tier of [1, 2, 3, 4, 5]) {
							compared++;
							const was = tierShare(inBiome, (t) => t === tier);
							const now = tierShare(here, (t) => t === tier);
							if (!(Math.abs(now - was) <= 1e-12))
								bad.note(
									`tier ${tier}, tier-${lead} lead in ${biome} @ ${d} on ${JSON.stringify(around)}: ${was} → ${now}`
								);
						}
					}
				}
			}
		}
		expect(bad.list).toEqual([]);
		expect(compared).toBeGreaterThan(300_000);
	});

	it("at the reed beside the prototype world's spawn, with the lake all round it, most battles are the water's small animals and the bigger ones stay 1 in 16", () => {
		const seed = hashString('prototype');
		const spawn = spawnPoint(seed);
		const pos = { x: spawn.x - 1, y: spawn.y };
		const tile = tileAtWorld(seed, pos.x, pos.y);
		expect(tile).toMatchObject({ kind: 'tallgrass', biome: 'river' });
		const site = { tile, pos, spawn, around: surroundings(seed, pos) };
		// Near home the ground only divides each tier's share: the frogs, brown rats and
		// toads, four times as likely by the water as the nine small animals that come down
		// to it, take four sevenths of the tier-1 share; the four tier-2 animals of the river,
		// all at home by the water, split theirs (1 in 16 together) evenly.
		const each = (w: number, ...ids: string[]) => Object.fromEntries(ids.map((id) => [id, w]));
		expectShares(
			encounterTableAt(site, 1),
			normalised({
				...each(4, 'frog', 'brown-rat', 'common-toad'),
				...each(1, 'squirrel', 'rabbit', 'shrew', 'wood-mouse', 'hedgehog', 'mole'),
				...each(1, 'common-lizard', 'robin', 'stag-beetle'),
				...each(0.35, 'otter', 'grey-heron', 'raccoon', 'beaver')
			})
		);
		// A tier-2 animal in front: the river's four tier-2 animals, and each small one of the
		// water 1 time in 43, as on the biome's table.
		expectShares(
			encounterTableAt(site, 2),
			normalised({
				...each(1, 'otter', 'grey-heron', 'raccoon', 'beaver'),
				...each(0.1, 'frog', 'brown-rat', 'common-toad')
			})
		);
	});
});

describe('rollEncounter', () => {
	it('is empty on every tile kind but tall grass and deep water, and leaves the rng untouched', () => {
		const kinds: readonly TileKind[] = ['grass', 'sand', 'water', 'rock', 'tree', 'tent'];
		for (const lead of LEADS) {
			for (const kind of kinds) {
				for (const biome of BIOMES) {
					const rng = new Rng(1);
					const site = { ...siteAt(biome, 300), tile: { kind, biome, height: 0 } };
					const rolls = Array.from({ length: 100 }, () => rollEncounter(rng, site, lead));
					expect(rolls.filter((w) => w !== null)).toEqual([]);
					expect(rng.next()).toBe(new Rng(1).next());
				}
			}
		}
	});

	it('stays quiet without a draw where nothing could challenge the lead, on any ground', () => {
		for (const [lead, biome] of SILENT) {
			for (const d of [0, 64, 400]) {
				for (const around of GROUNDS) {
					const rng = new Rng(7);
					const site = siteAt(biome, d, around);
					const rolls = Array.from({ length: 100 }, () => rollEncounter(rng, site, lead));
					expect(rolls.filter((w) => w !== null)).toEqual([]);
					expect(rng.next()).toBe(new Rng(7).next());
				}
			}
		}
	});

	it('for a tier-1 lead draws exactly as [[PRODUCT]] §4 says: the chance, then a pick down the table for the ground around', () => {
		const bad: string[] = [];
		let met = 0;
		for (const biome of BIOMES) {
			for (const d of [0, 16, 40, 64, 100, 127.5, 160]) {
				for (const around of GROUNDS) {
					const now = new Rng(hashString(`before:${biome}:${d}:${JSON.stringify(around)}`));
					const spec = new Rng(hashString(`before:${biome}:${d}:${JSON.stringify(around)}`));
					const site = siteAt(biome, d, around);
					for (let i = 0; i < 400; i++) {
						const a = rollEncounter(now, site, 1)?.speciesId ?? null;
						const b = tierOneRoll(spec, site);
						if (a !== b) bad.push(`${biome} @ ${d} on ${JSON.stringify(around)}: ${a} vs ${b}`);
						if (a !== null) met++;
					}
				}
			}
		}
		expect(bad).toEqual([]);
		expect(met).toBeGreaterThan(8000);
	});

	it('neither the lead nor the ground changes whether a step starts a battle, only which animal comes out', () => {
		const bad: string[] = [];
		let battles = 0;
		for (const biome of BIOMES) {
			for (const d of [0, 64, 400]) {
				const seeds = Array.from({ length: 200 }, (_, i) => hashString(`${biome}:${d}:${i}`));
				const starterOnOpen = seeds.map(
					(s) => rollEncounter(new Rng(s), siteAt(biome, d), 1) !== null
				);
				for (const lead of LEADS) {
					if (isSilent(lead, biome)) continue;
					for (const around of GROUNDS) {
						const met = seeds.map(
							(s) => rollEncounter(new Rng(s), siteAt(biome, d, around), lead) !== null
						);
						if (met.join() !== starterOnOpen.join())
							bad.push(`tier-${lead} lead in ${biome} @ ${d} on ${JSON.stringify(around)}`);
						battles += met.filter(Boolean).length;
					}
				}
			}
		}
		expect(bad).toEqual([]);
		expect(battles).toBeGreaterThan(5000);
	});

	it('starts one encounter per 8–12 grass steps wherever anything could challenge the lead', () => {
		const steps = 8000;
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				if (isSilent(lead, biome)) continue;
				const rng = new Rng(hashString(`${lead}:${biome}`));
				let hits = 0;
				for (let i = 0; i < steps; i++)
					if (rollEncounter(rng, siteAt(biome, 50, GROUNDS[i % GROUNDS.length]), lead)) hits++;
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
				const site = siteAt('forest', 200, { water: 0, trees: 4, rocks: 3 });
				return Array.from({ length: 300 }, () => rollEncounter(rng, site, lead));
			};
			expect(run(42)).toEqual(run(42));
			expect(run(42)).not.toEqual(run(43));
		}
	});

	it('refuses a site with a broken position or ground instead of guessing a table', () => {
		const broken = { ...siteAt('forest', 0), pos: { x: NaN, y: 0 } };
		for (const lead of LEADS) {
			expect(() => rollEncounter(new Rng(3), broken, lead)).toThrow(/distance/);
			expect(() => encounterTableAt(broken, lead)).toThrow(/distance/);
		}
		expect(() => encounterTable('forest', NaN, 1)).toThrow();
		expect(() => encounterTable('forest', Infinity, 3)).toThrow();
		// A missing or malformed ground would weigh every species NaN, and the
		// pick's rounding fallback would then return the fiercest one every time.
		for (const around of [undefined, null, { water: NaN, trees: 0, rocks: 0 }, { water: 1 }]) {
			const site = { ...siteAt('forest', 0), around } as unknown as EncounterSite;
			for (const lead of LEADS) {
				expect(() => rollEncounter(new Rng(3), site, lead), JSON.stringify(around)).toThrow(
					/surroundings/
				);
				expect(() => encounterTableAt(site, lead)).toThrow(/surroundings/);
			}
			// Where no encounter can happen, the ground is never read.
			const onSand = {
				...site,
				tile: { kind: 'sand', biome: 'forest', height: 0 }
			} as EncounterSite;
			expect(rollEncounter(new Rng(3), onSand, 1)).toBeNull();
		}
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
						const around = GROUNDS[(o.x + o.y + spawn.x) & 7]!;
						const site = { tile: encounterTile(biome), pos, spawn, around };
						const table = encounterTableAt(site, lead);
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
					// A ground with some of every terrain, so no species is at its floor.
					const site = siteAt(biome, d, { water: 2, trees: 2, rocks: 2 });
					for (let n = 0; n < encounters; n++) {
						const wild = rollEncounter(rng, site, lead);
						if (!wild) throw new Error(`no encounter for a tier-${lead} lead in ${biome}`);
						counts.set(wild.speciesId, (counts.get(wild.speciesId) ?? 0) + 1);
					}
					const table = encounterTableAt(site, lead);
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
	it('grows tall grass or deep water in at least one habitat of every species, within 8 chunks of spawn', () => {
		for (const seed of [hashString('prototype'), 1, 2, 3]) {
			const grassy = new Set<Biome>();
			const spawn = spawnPoint(seed);
			const scx = Math.floor(spawn.x / 16);
			const scy = Math.floor(spawn.y / 16);
			for (let cy = scy - 8; cy <= scy + 8; cy++)
				for (let cx = scx - 8; cx <= scx + 8; cx++)
					for (const t of generateChunk(seed, cx, cy).tiles)
						if (isEncounterTile(t.kind)) grassy.add(t.biome);
			for (const a of ANIMALS) {
				const reachable = a.habitats.some((b) => grassy.has(b));
				expect(reachable, `${a.id} has nowhere to be met (seed ${seed})`).toBe(true);
			}
		}
		// About 1.5 s alone (1,156 chunks generated); over 2 s with two browsers drawing beside it.
	}, 30_000);
});
