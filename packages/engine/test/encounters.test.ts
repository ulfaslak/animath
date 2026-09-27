import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import type { Biome, Realm, Terrain, Tier } from '../src/animals/types.js';
import { Rng, hashString } from '../src/rng.js';
import {
	ENCOUNTER_CHANCE,
	NEAR_ONE_UP,
	SAFE_RADIUS,
	TIER_SIGMA,
	VISITORS_WEIGHT,
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
import { HABITAT_BOOST, surroundings, type Surroundings } from '../src/world/habitat.js';
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
 * The bell, written out again from [[PRODUCT]] §4 with its numbers as
 * literals: what a tier `k` tiers above the lead (negative: below it) weighs
 * next to the lead's own, `distance` tiles from spawn. Below the lead
 * e^(−k²/2) anywhere; above it 9^(−k²) inside 32 tiles, e^(−k²/2) from 128
 * out, and in between (9^(−k²))^(1−danger) · (e^(−k²/2))^danger with
 * danger = clamp((d − 32)/96).
 */
function bell(k: number, distance: number): number {
	const danger = Math.min(1, Math.max(0, (distance - 32) / 96));
	if (k <= 0) return Math.exp(-(k * k) / 2);
	return Math.pow(9, -k * k * (1 - danger)) * Math.exp(-(k * k * danger) / 2);
}

/**
 * A lead's encounter table, written out again from [[PRODUCT]] §4 for any
 * roster, with its numbers as literals: only animals living in the biome's
 * realm (the water out in the sea, land everywhere else) come out, and each
 * resident weighs its tier's `bell` over the number of its tier's residents;
 * at the river and in the mountains, where a resident is bigger than the lead,
 * every species of the realm and the lead's tier that doesn't live there
 * visits, the visitors together weighing three of the lead's tier's bells
 * times 1 − danger, evenly. Shares, in roster order. With the starter in front near
 * spawn before the bell it was PR #12's table: the river and the mountains
 * were exactly the biomes with residents but no tier-1 animal.
 */
function bellTable(
	roster: readonly Kind[],
	biome: Biome,
	distance: number,
	lead: number
): Map<string, number> {
	const danger = Math.min(1, Math.max(0, (distance - 32) / 96));
	const realm = realmOf(biome);
	const here = roster.filter((a) => a.realms.includes(realm));
	const living = here.filter((a) => a.habitats.includes(biome));
	const visited = (biome === 'river' || biome === 'mountain') && living.some((a) => a.tier > lead);
	const count = (tier: number) => living.filter((a) => a.tier === tier).length;
	const guest = (a: Kind) =>
		a.tier === lead && !a.habitats.includes(biome) && visited && danger < 1;
	const guests = here.filter(guest).length;
	const raw = new Map<string, number>();
	for (const a of here) {
		if (a.habitats.includes(biome)) raw.set(a.id, bell(a.tier - lead, distance) / count(a.tier));
		else if (guest(a)) raw.set(a.id, (3 * bell(0, distance) * (1 - danger)) / guests);
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
 * `bellTable` on a tile with the ground `around` it, as [[PRODUCT]] §4
 * writes it out: within a tier, each animal's share of its tier goes by its
 * biome share times its `groundFactor`; a tier's share is its biome share
 * times its animals' mean factor (weighted by their biome shares) raised to
 * danger = clamp((d − 32) / 96), normalised.
 */
function bellTableAt(
	roster: readonly Kind[],
	biome: Biome,
	distance: number,
	around: Surroundings,
	lead: number
): Map<string, number> {
	const danger = Math.min(1, Math.max(0, (distance - 32) / 96));
	const kinds = new Map(roster.map((a) => [a.id, a]));
	const table = bellTable(roster, biome, distance, lead);
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

/** A lead's roll on tall grass or deep water: the chance, then a pick down `bellTableAt`. */
function bellRoll(rng: Rng, site: EncounterSite, lead: Tier): string | null {
	if (site.tile.kind !== 'tallgrass' && site.tile.kind !== 'deepwater') return null;
	if (!rng.chance(0.1)) return null;
	const table = bellTableAt(
		ANIMALS,
		site.tile.biome,
		distanceFromSpawn(site.pos, site.spawn),
		site.around,
		lead
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

/** The share of the biome's table held by each tier, 1 to 5. */
function tierShares(biome: Biome, distance: number, lead: Tier): number[] {
	const shares = [0, 0, 0, 0, 0];
	for (const e of tableIn(biome, distance, lead)) shares[e.species.tier - 1] += e.weight;
	return shares;
}

/** The tiers with an animal living in the biome, in its realm. */
const livingTiers = (biome: Biome) =>
	new Set(
		residents(biome)
			.filter((a) => a.realms.includes(realmOf(biome)))
			.map((a) => a.tier)
	);

describe('encounterTable', () => {
	it('for every lead is the table [[PRODUCT]] §4 writes out, at every distance', () => {
		const bad: string[] = [];
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of SWEEP) {
					const table = tableIn(biome, d, lead);
					const expected = bellTable(ANIMALS, biome, d, lead);
					const where = `tier-${lead} lead in ${biome} @ ${d}`;
					const ids = table.map((e) => e.species.id).join();
					if (ids !== [...expected.keys()].join()) bad.push(`${where} lists ${ids}`);
					for (const e of table) {
						if (!(Math.abs(e.weight - expected.get(e.species.id)!) <= 1e-14))
							bad.push(`${e.species.id}, ${where}: ${e.weight}`);
					}
				}
			}
		}
		expect(bad).toEqual([]);
		// The constants are the literals [[PRODUCT]] §4 states.
		expect(TIER_SIGMA).toBe(1);
		expect(NEAR_ONE_UP).toBe(1 / 9);
		expect(VISITORS_WEIGHT).toBe(3);
		// Today's numbers, as [[PRODUCT]] §4 quotes them. A tier weighs its bell, split
		// evenly among the animals of it living there, however many they are: near spawn,
		// for the starter, the small ones 1, the tier-2 ones 1/9, the red deer 1/9^4, the
		// wolf 1/9^9 and the bear 1/9^16; at the river and in the mountains the small
		// animals that live elsewhere come too, all together three times as much as those living
		// there.
		const split = (w: number, ...ids: string[]) =>
			Object.fromEntries(ids.map((id) => [id, w / ids.length]));
		const nearUp = (k: number) => Math.pow(9, -k * k);
		const down = (k: number) => Math.exp(-(k * k) / 2);
		expectShares(
			encounterTable('meadow', 0, 1),
			normalised({
				...split(
					1,
					'squirrel',
					'rabbit',
					'shrew',
					'wood-mouse',
					'brown-rat',
					'hedgehog',
					'mole',
					'common-lizard',
					'robin'
				),
				...split(nearUp(1), 'fox', 'roe-deer', 'badger', 'stoat', 'adder'),
				deer: nearUp(2)
			})
		);
		expectShares(
			encounterTable('forest', 0, 1),
			normalised({
				...split(
					1,
					'squirrel',
					'shrew',
					'wood-mouse',
					'hedgehog',
					'common-toad',
					'robin',
					'stag-beetle'
				),
				...split(nearUp(1), 'fox', 'roe-deer', 'badger', 'pine-marten', 'tawny-owl', 'raccoon'),
				deer: nearUp(2),
				wolf: nearUp(3),
				bear: nearUp(4)
			})
		);
		// The river's three small kinds share their bell, and the nine small visitors, on top,
		// three more: 1/3 each, as every small animal weighed before the bell; the small ones
		// weigh 4 there, and one tier up is 1 in 37.
		expectShares(
			encounterTable('river', 0, 1),
			normalised({
				...split(1, 'frog', 'brown-rat', 'common-toad'),
				...split(
					3,
					'squirrel',
					'rabbit',
					'shrew',
					'wood-mouse',
					'hedgehog',
					'mole',
					'common-lizard',
					'robin',
					'stag-beetle'
				),
				...split(nearUp(1), 'otter', 'grey-heron', 'raccoon', 'beaver')
			})
		);
		expect(share('river', 0, 1, (t) => t === 2)).toBeCloseTo(1 / 37, 12);
		// The lizard is the mountains' one small kind; the eleven visitors share three bells.
		expectShares(
			encounterTable('mountain', 0, 1),
			normalised({
				'common-lizard': 1,
				...split(
					3,
					'squirrel',
					'rabbit',
					'frog',
					'shrew',
					'wood-mouse',
					'brown-rat',
					'hedgehog',
					'mole',
					'common-toad',
					'robin',
					'stag-beetle'
				),
				...split(nearUp(1), 'stoat', 'adder'),
				wolf: nearUp(3),
				bear: nearUp(4)
			})
		);
		// Out on the deep water: the sea animals only, the frog in the boat's lead or not.
		expectShares(
			encounterTable('sea', 0, 1, 'water'),
			normalised({
				...split(1, 'crab', 'starfish'),
				turtle: nearUp(1),
				dolphin: nearUp(2),
				octopus: nearUp(3),
				whale: nearUp(4)
			})
		);
		// Nine small kinds beside five tier-2 ones in the meadow, seven beside six in the
		// forest: near home the starter meets one tier up 1 time in 10 in both.
		expect(share('meadow', 0, 1, (t) => t === 2)).toBeCloseTo(1 / 10, 3);
		expect(share('forest', 0, 1, (t) => t === 2)).toBeCloseTo(1 / 10, 3);
		// Smaller animals weigh the same near and far. A bear in front far out: bears 1,
		// wolves e^−1/2, red deer e^−2, the tier-2 ones e^−4.5 and the small ones e^−8.
		expectShares(
			encounterTable('forest', WILD_RADIUS, 5),
			normalised({
				...split(
					down(4),
					'squirrel',
					'shrew',
					'wood-mouse',
					'hedgehog',
					'common-toad',
					'robin',
					'stag-beetle'
				),
				...split(down(3), 'fox', 'roe-deer', 'badger', 'pine-marten', 'tawny-owl', 'raccoon'),
				deer: down(2),
				wolf: down(1),
				bear: 1
			})
		);
		// A bear in the meadow, where nothing its size lives: the meadow's biggest, mostly.
		expectShares(
			encounterTable('meadow', 0, 5),
			normalised({
				...split(
					down(4),
					'squirrel',
					'rabbit',
					'shrew',
					'wood-mouse',
					'brown-rat',
					'hedgehog',
					'mole',
					'common-lizard',
					'robin'
				),
				...split(down(3), 'fox', 'roe-deer', 'badger', 'stoat', 'adder'),
				deer: down(2)
			})
		);
		// A red deer in the mountains near home: the deer visits, the only tier-3 animal there,
		// with the visitors' three bells.
		expectShares(
			encounterTable('mountain', 0, 3),
			normalised({
				'common-lizard': down(2),
				...split(down(1), 'stoat', 'adder'),
				deer: 3,
				wolf: nearUp(1),
				bear: nearUp(2)
			})
		);
		// 9,650 tables, each written out again here: 0.8 to 1.8 s at a load average of 100.
	}, 30_000);

	it('the frog lives in the river reeds: every lead meets it there, near and far, and it hops up the hills only for a small lead near home', () => {
		const frog = getAnimal('frog');
		expect(frog.tier).toBe(1);
		expect(frog.habitats).toEqual(['river']);
		const frogShare = (biome: Biome, d: number, lead: Tier) =>
			encounterTable(biome, d, lead).find((e) => e.species.id === 'frog')?.weight ?? 0;
		// A tier-1 lead: in the reeds near home the frog is one of the three small kinds living
		// there, which weigh 1 together, beside the nine that come down to the water (3 together)
		// and the river's four tier-2 animals (1/9); far out the small ones are 1 / (1 + e^−1/2)
		// of the reeds, three kinds.
		expect(frogShare('river', 0, 1)).toBeCloseTo(1 / 3 / (4 + 1 / 9), 12);
		expect(frogShare('river', SAFE_RADIUS, 1)).toBeCloseTo(1 / 3 / (4 + 1 / 9), 12);
		expect(frogShare('river', WILD_RADIUS, 1)).toBeCloseTo(1 / (1 + Math.exp(-0.5)) / 3, 12);
		expect(frogShare('river', 1000, 1)).toBeCloseTo(1 / (1 + Math.exp(-0.5)) / 3, 12);
		// It comes up the hills near home too, one of eleven small visitors that weigh three
		// times the lizard together, the one small animal living there.
		expect(frogShare('mountain', 0, 1)).toBeCloseTo(
			3 / 11 / (4 + 1 / 9 + Math.pow(9, -9) + Math.pow(9, -16)),
			12
		);
		expect(frogShare('mountain', WILD_RADIUS, 1)).toBe(0);
		// A bigger lead meets it at the river, near and far, one small kind of three: a tier
		// below a tier-2 lead, e^−1/2 of the tier-2 animals' weight; further below, rarer.
		for (const d of [0, SAFE_RADIUS, 80, WILD_RADIUS, 1000]) {
			for (const lead of [2, 3, 4, 5] as const) {
				const small = Math.exp(-((lead - 1) ** 2) / 2);
				const bigger = Math.exp(-((lead - 2) ** 2) / 2);
				expect(frogShare('river', d, lead), `tier-${lead} @ ${d}`).toBeCloseTo(
					small / (small + bigger) / 3,
					12
				);
				expect(frogShare('mountain', d, lead), `mountain, tier-${lead} @ ${d}`).toBe(0);
			}
		}
		// A bear at the river meets a frog about 1 time in 100.
		expect(frogShare('river', 0, 5)).toBeGreaterThan(0.009);
		expect(frogShare('river', 0, 5)).toBeLessThan(0.01);
		// Never in the meadow or the forest, for anyone.
		for (const lead of LEADS) {
			for (const d of [0, 64, 1000]) {
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

	it("a tier's share goes by its distance from the lead's, never by how many animals of it live there", () => {
		// Between any two tiers in a biome's table, the ratio of their shares is the ratio of
		// their bells, whatever the lead, the distance and the number of kinds in each. Near
		// home at the river and in the mountains the visitors add three bells times 1 − danger to
		// the lead's own tier, however many kinds they are.
		const bad: string[] = [];
		let compared = 0;
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				const living = livingTiers(biome);
				// Visited: something bigger than the lead lives there, and some of its tier doesn't.
				const visited =
					(biome === 'river' || biome === 'mountain') &&
					residents(biome).some((a) => a.tier > lead) &&
					ANIMALS.some(
						(a) =>
							a.tier === lead && a.realms.includes(realmOf(biome)) && !a.habitats.includes(biome)
					);
				for (const d of SWEEP) {
					const danger = Math.min(1, Math.max(0, (d - 32) / 96));
					const weight = (t: number) =>
						bell(t - lead, d) *
						((living.has(t) ? 1 : 0) + (t === lead && visited ? 3 * (1 - danger) : 0));
					const shares = tierShares(biome, d, lead);
					const present = [1, 2, 3, 4, 5].filter((t) => weight(t) > 0);
					for (const t of present) {
						for (const u of present) {
							if (t >= u) continue;
							compared++;
							const got = shares[t - 1]! / shares[u - 1]!;
							const want = weight(t) / weight(u);
							if (!(Math.abs(got / want - 1) <= 1e-9))
								bad.push(
									`tiers ${t}:${u}, tier-${lead} lead in ${biome} @ ${d}: ${got} vs ${want}`
								);
						}
					}
				}
			}
		}
		expect(bad).toEqual([]);
		expect(compared).toBeGreaterThan(10000);
		// 9,650 tables: 0.3 to 0.7 s at a load average of 100; 5.4 s at 125 when each tier's share
		// was a table of its own.
	}, 30_000);

	it("the lead's own tier is the likeliest wherever it lives, at every distance; from the wild radius the bell is symmetric", () => {
		const bad: string[] = [];
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				const living = livingTiers(biome);
				for (const d of SWEEP) {
					const shares = tierShares(biome, d, lead);
					const own = shares[lead - 1]!;
					if (living.has(lead) && shares.some((s) => s > own + 1e-15))
						bad.push(`tier-${lead} lead in ${biome} @ ${d}: ${shares}`);
					// Symmetric far out: k tiers above and k below weigh the same where both live.
					if (d < WILD_RADIUS) continue;
					for (let k = 1; k <= 4; k++) {
						if (!living.has(lead + k) || !living.has(lead - k)) continue;
						const [above, below] = [shares[lead + k - 1]!, shares[lead - k - 1]!];
						if (!(Math.abs(above - below) <= 1e-15))
							bad.push(`tier-${lead} lead in ${biome} @ ${d}: ±${k} ${above} vs ${below}`);
					}
				}
			}
		}
		expect(bad).toEqual([]);
		// Far out a tier-3 lead in the forest, the one land biome with every tier: red deer
		// 1, wolves and the tier-2 animals e^−1/2 each, bears and the small ones e^−2 each.
		const forest = tierShares('forest', WILD_RADIUS, 3);
		const whole = 1 + 2 * Math.exp(-0.5) + 2 * Math.exp(-2);
		expect(forest[2]).toBeCloseTo(1 / whole, 12);
		expect(forest[1]).toBeCloseTo(Math.exp(-0.5) / whole, 12);
		expect(forest[3]).toBeCloseTo(Math.exp(-0.5) / whole, 12);
		expect(forest[0]).toBeCloseTo(Math.exp(-2) / whole, 12);
		expect(forest[4]).toBeCloseTo(Math.exp(-2) / whole, 12);
		// 9,650 tables: 0.2 to 0.9 s at a load average of 100.
	}, 30_000);

	it("lists every animal living there, whoever leads, plus, at the river and in the mountains, visitors of the lead's tier where bigger animals live", () => {
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
					const expected = [...living.filter((a) => a.realms.includes(realmOf(biome))), ...visitors]
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
		// 150 tables, each with its own expects: 0.2 to 0.6 s at a load average of 100.
	}, 30_000);

	it('is never empty where anything of its realm lives, and empty where nothing does', () => {
		const bad: string[] = [];
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				expect(livingTiers(biome).size, biome).toBeGreaterThan(0);
				for (const d of SWEEP) {
					if (tableIn(biome, d, lead).length === 0)
						bad.push(`tier-${lead} lead in ${biome} @ ${d}`);
				}
			}
			// No land animal lives in the sea, and none of the meadow's animals swims.
			expect(encounterTable('sea', 0, lead, 'land')).toEqual([]);
			expect(encounterTable('meadow', 400, lead, 'water')).toEqual([]);
		}
		expect(bad).toEqual([]);
	});

	it('every species is on a table of every lead, near home and far out, and far out every one can come out', () => {
		// A roll picks with a number in steps of 2^−32 (`Rng.next`): a share that small or
		// smaller may never be picked. Far out every animal is far above it, for every lead;
		// the ground there keeps at least a quarter of a biome share.
		const step = 2 ** -32;
		for (const lead of LEADS) {
			for (const a of ANIMALS) {
				for (const d of [0, 1000]) {
					const listed = BIOMES.some((b) => tableIn(b, d, lead).some((e) => e.species.id === a.id));
					expect(listed, `${a.id} is on no table of a tier-${lead} lead (d = ${d})`).toBe(true);
				}
				const most = Math.max(
					...BIOMES.flatMap((b) =>
						tableIn(b, 1000, lead)
							.filter((e) => e.species.id === a.id)
							.map((e) => e.weight)
					)
				);
				// Ten thousand steps and more: the least is a crab with a whale in front, 2.4e−5.
				expect(most / 4, `${a.id} for a tier-${lead} lead far out`).toBeGreaterThan(1e4 * step);
			}
		}
	});

	it('near home a starter meets a wolf hardly ever and a bear or a whale never: four tiers up is under the dice', () => {
		const step = 2 ** -32;
		const weightOf = (biome: Biome, d: number, id: string) =>
			tableIn(biome, d, 1).find((e) => e.species.id === id)!.weight;
		for (const d of [0, 16, SAFE_RADIUS]) {
			// Three tiers up, 9^−9 of the small ones' weight: about 1 roll in 400 million.
			expect(weightOf('forest', d, 'wolf')).toBeGreaterThan(step);
			expect(weightOf('forest', d, 'wolf')).toBeLessThan(1e-8);
			// Four tiers up, 9^−16: far under the smallest step a roll can take.
			for (const [biome, id] of [
				['forest', 'bear'],
				['mountain', 'bear'],
				['sea', 'whale']
			] as const)
				expect(weightOf(biome, d, id), `${id} in ${biome} @ ${d}`).toBeLessThan(step / 1000);
		}
		// From the wild radius a starter meets a bear in the forest 1 time in 5,000.
		expect(weightOf('forest', WILD_RADIUS, 'bear')).toBeCloseTo(
			Math.exp(-8) / (1 + Math.exp(-0.5) + Math.exp(-2) + Math.exp(-4.5) + Math.exp(-8)),
			12
		);
	});

	it("inside the safe radius the lead's tier is the majority wherever anything its size or bigger lives, one tier up at most 1 in 10 and two or more up under 1 in 5,000", () => {
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of [0, SAFE_RADIUS / 2, SAFE_RADIUS]) {
					const where = `tier-${lead} lead in ${biome} @ ${d}`;
					expect(
						share(biome, d, lead, (t) => t === lead + 1),
						where
					).toBeLessThanOrEqual(0.1 + 1e-15);
					expect(
						share(biome, d, lead, (t) => t >= lead + 2),
						where
					).toBeLessThan(1 / 5000);
					if (!residents(biome).some((a) => a.tier >= lead)) continue;
					expect(
						share(biome, d, lead, (t) => t === lead),
						where
					).toBeGreaterThan(0.5);
				}
			}
		}
	});

	it("bigger animals never grow rarer and the lead's own tier never commoner with distance; beyond the wild radius no visitor is left and nothing changes", () => {
		const bad: string[] = [];
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				let prevBigger = -1;
				let prevFierce = -1;
				let prevOwn = 2;
				for (let d = 0; d <= WILD_RADIUS + 64; d += 0.5) {
					const shares = tierShares(biome, d, lead);
					const sum = (from: number) => shares.slice(from - 1).reduce((s, x) => s + x, 0);
					const bigger = sum(lead + 1);
					const fierce = sum(lead + 2);
					const own = shares[lead - 1]!;
					const where = `tier-${lead} lead in ${biome} @ ${d}`;
					if (!(bigger >= prevBigger - 1e-12)) bad.push(`${where}: bigger fell to ${bigger}`);
					if (!(fierce >= prevFierce - 1e-12)) bad.push(`${where}: two up fell to ${fierce}`);
					if (!(own <= prevOwn + 1e-12)) bad.push(`${where}: own tier rose to ${own}`);
					prevBigger = bigger;
					prevFierce = fierce;
					prevOwn = own;
				}
				const far = tableIn(biome, WILD_RADIUS, lead);
				for (const e of far) expect(e.species.habitats, 'no visitor far out').toContain(biome);
				expect(tableIn(biome, WILD_RADIUS * 4, lead)).toEqual(far);
			}
		}
		expect(bad).toEqual([]);
		// 9,625 tables: 0.7 to 1.6 s at a load average of 100 when each share was a table of its own.
	}, 30_000);

	it('pulls the side above the lead in near home by enough that no ground can make bigger animals rarer on the way out', () => {
		// On a fixed ground a tier's weight on the tile is its bell times its animals' mean
		// ground factor (1 to HABITAT_BOOST) raised to danger. Above the lead, the log of the
		// bell grows with danger by k²·(ln(1/NEAR_ONE_UP) − 1/2σ²); below it, not at all. So
		// while that rate is at least ln HABITAT_BOOST even for k = 1, no ground can pull a
		// smaller tier up faster than a bigger one grows ([[INVARIANTS]] § Encounters).
		const rate = Math.log(1 / NEAR_ONE_UP) - 1 / (2 * TIER_SIGMA * TIER_SIGMA);
		expect(rate).toBeGreaterThanOrEqual(Math.log(HABITAT_BOOST));
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
		// About 0.75 s alone (109,350 tables); 7.6 s at a load average of 40.
	}, 30_000);

	it('for every lead is the table [[PRODUCT]] §4 writes out, on every ground', () => {
		const bad = findings();
		let compared = 0;
		// The starter on every ground; the bigger leads on every ground whose counts are odd
		// or none, which still takes each terrain from none to full.
		const odd = GROUND_GRID.filter((g) =>
			[g.water, g.trees, g.rocks].every((n) => n % 2 === 1 || n === 0)
		);
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of [0, 20, 32, 50, 80, 127.5, 128, 1000]) {
					for (const around of lead === 1 ? GROUND_GRID : odd) {
						const here = encounterTableAt(siteAt(biome, d, around), lead);
						const expected = bellTableAt(ANIMALS, biome, d, around, lead);
						const where = `tier-${lead} lead in ${biome} @ ${d} on ${JSON.stringify(around)}`;
						if (here.map((e) => e.species.id).join() !== [...expected.keys()].join())
							bad.note(`${where} lists ${here.map((e) => e.species.id)}`);
						for (const e of here) {
							compared++;
							if (!(Math.abs(e.weight - expected.get(e.species.id)!) <= 1e-12))
								bad.note(
									`${e.species.id} in ${where}: ${e.weight} vs ${expected.get(e.species.id)}`
								);
						}
					}
				}
			}
		}
		expect(bad.list).toEqual([]);
		expect(compared).toBeGreaterThan(500_000);
		// 49,160 tables, each written out again here: the starter's 29,160 took 0.45 s alone and
		// 4.8 s at a load average of 40; all of them 12 s at a load average of 100.
	}, 30_000);

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
		// 54,675 tables, and every one-tile change between them: 48,114 took 0.45 s alone and
		// 4.7 s at a load average of 40; all of them 11 s at a load average of 100.
	}, 30_000);

	it('on any ground, the share of animals bigger than the lead, and of those two tiers up, never falls with distance', () => {
		// Its own tier's share may rise: where animals of different tiers favour different
		// ground, the ground's pull as danger rises takes share from the animals below it (#89),
		// up to 9.6 points for a red deer on meadow grass among trees, where nothing bigger lives
		// (57.4% near home, 67.0% from the wild radius). The world never gets gentler as a kid
		// walks out, which is what the promise is for. The bell's first cut let the visitors only
		// share out the lead's tier, and as they thinned out here the lizard on the rocks and the
		// frogs by the water took the starter's tier up and the bigger animals down, by 6.5 points
		// in the mountains; now they come on top of it, and take their weight with them.
		const bad = findings();
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
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
		// 38,600 tables: 6.2 s at a load average of 100, over the 5 s default, since the bell
		// quiets no lead's grass and so leaves no biome out.
	}, 30_000);

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
		// About 0.5 s alone (91,125 tables); 3.9 s at a load average of 40.
	}, 30_000);

	it("at the reed beside the prototype world's spawn, with the lake all round it, most battles are the water's small animals and the bigger ones 1 in 37", () => {
		const seed = hashString('prototype');
		const spawn = spawnPoint(seed);
		const pos = { x: spawn.x - 1, y: spawn.y };
		const tile = tileAtWorld(seed, pos.x, pos.y);
		expect(tile).toMatchObject({ kind: 'tallgrass', biome: 'river' });
		const site = { tile, pos, spawn, around: surroundings(seed, pos) };
		// Near home the ground only divides each tier's share. The three small kinds living in
		// the reeds weigh a third of the nine that come down to the water, each as much as one
		// of those, and by the water four times as much: four sevenths of the small animals'
		// 36 in 37. The four tier-2 animals of the river, all at home by the water, split the
		// 37th evenly (7/48 of a visitor each).
		const each = (w: number, ...ids: string[]) => Object.fromEntries(ids.map((id) => [id, w]));
		expectShares(
			encounterTableAt(site, 1),
			normalised({
				...each(4, 'frog', 'brown-rat', 'common-toad'),
				...each(1, 'squirrel', 'rabbit', 'shrew', 'wood-mouse', 'hedgehog', 'mole'),
				...each(1, 'common-lizard', 'robin', 'stag-beetle'),
				...each(7 / 48, 'otter', 'grey-heron', 'raccoon', 'beaver')
			})
		);
		// A tier-2 animal in front: the river's four tier-2 animals, and the three small ones
		// of the water a tier below, e^−1/2 of theirs together: 38% of the battles.
		expectShares(
			encounterTableAt(site, 2),
			normalised({
				...each(1 / 4, 'otter', 'grey-heron', 'raccoon', 'beaver'),
				...each(Math.exp(-0.5) / 3, 'frog', 'brown-rat', 'common-toad')
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

	it('stays quiet without a draw only where nothing of the tile realm lives in its biome, on any ground', () => {
		// No land animal lives in the sea: tall grass there, were it ever to grow, holds nothing.
		for (const lead of LEADS) {
			for (const d of [0, 64, 400]) {
				for (const around of GROUNDS) {
					const rng = new Rng(7);
					const site = { ...siteAt('sea', d, around), tile: tallgrass('sea') };
					const rolls = Array.from({ length: 100 }, () => rollEncounter(rng, site, lead));
					expect(rolls.filter((w) => w !== null)).toEqual([]);
					expect(rng.next()).toBe(new Rng(7).next());
					// Everywhere animals live, every lead's step draws.
					for (const biome of BIOMES) {
						const drawn = new Rng(7);
						rollEncounter(drawn, siteAt(biome, d, around), lead);
						expect(drawn.next(), `tier-${lead} lead in ${biome}`).not.toBe(new Rng(7).next());
					}
				}
			}
		}
	});

	it('for every lead draws exactly as [[PRODUCT]] §4 says: the chance, then a pick down the table for the ground around', () => {
		const bad: string[] = [];
		let met = 0;
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of [0, 16, 40, 64, 100, 127.5, 160]) {
					for (const around of GROUNDS) {
						const key = `before:${lead}:${biome}:${d}:${JSON.stringify(around)}`;
						const now = new Rng(hashString(key));
						const spec = new Rng(hashString(key));
						const site = siteAt(biome, d, around);
						// The starter's rolls in full; a bigger lead's an eighth as many, as its table is
						// checked on every ground above and only the draws are new here.
						for (let i = 0; i < (lead === 1 ? 400 : 50); i++) {
							const a = rollEncounter(now, site, lead)?.speciesId ?? null;
							const b = bellRoll(spec, site, lead);
							if (a !== b)
								bad.push(
									`tier-${lead} lead in ${biome} @ ${d} on ${JSON.stringify(around)}: ${a} vs ${b}`
								);
							if (a !== null) met++;
						}
					}
				}
			}
		}
		expect(bad).toEqual([]);
		expect(met).toBeGreaterThan(12_000);
		// 168,000 rolls, each rolled again by the rule here: the starter's 112,000 took 0.65 s
		// alone and 5.4 s at a load average of 40; all five leads' 224,000 took 29 s at a load
		// average of 100, so the others' were halved and the limit doubled.
	}, 60_000);

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
		// 123,000 rolls: 108,600 took 0.45 s alone and 3.4 s at a load average of 40; all of them
		// 6 s at a load average of 100.
	}, 30_000);

	it('starts one encounter per 8–12 grass steps, whoever leads and wherever', () => {
		const steps = 8000;
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
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

	it('anywhere on the map, returns only an animal of the table where the player stands, at full HP', () => {
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
							if (!table.some((e) => e.species.id === spec.id))
								bad.push(`${where}: not in the table`);
							if (!spec.habitats.includes(biome) && spec.tier !== lead)
								bad.push(`${where}: a visitor not of the lead's tier`);
							if (wild.hp !== spec.maxHp) bad.push(`${where}: hp ${wild.hp}`);
							if (Object.keys(wild).sort().join() !== 'hp,speciesId')
								bad.push(`${where}: keys ${Object.keys(wild)}`);
						}
						if (here === 0)
							bad.push(`tier-${lead} lead in ${biome} at (${pos.x}, ${pos.y}): nothing met`);
						met += here;
					}
				}
			}
		}
		expect(bad).toEqual([]);
		expect(met).toBeGreaterThan(2000);
		// About 0.3 s alone (60,000 rolls); 2.1 s at a load average of 40.
	}, 30_000);

	it("samples the lead's table: species shares match the weights, and every species of 1 in 250 or more shows up", () => {
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
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
					// 16 or more expected in 4,000: a species of that share missing is not the dice.
					for (const e of table.filter((e) => e.weight >= 1 / 250))
						expect(
							counts.get(e.species.id),
							`${e.species.id}, tier-${lead} lead in ${biome} @ ${d}`
						).toBeGreaterThan(0);
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
