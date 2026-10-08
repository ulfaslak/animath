import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import type { AnimalInstance, Biome, Realm, Terrain, Tier } from '../src/animals/types.js';
import { Rng, hashString } from '../src/rng.js';
import {
	ENCOUNTER_CHANCE,
	NEAR_ONE_UP,
	SAFE_RADIUS,
	SKY_CHANCE,
	TIER_SIGMA,
	VISITORS_WEIGHT,
	WILD_RADIUS,
	distanceFromSpawn,
	encounterTable,
	encounterTableAt,
	rollEncounter,
	rollEncounterFor,
	rollSkyEncounter,
	skyTableAt,
	type EncounterEntry,
	type EncounterSite
} from '../src/world/encounters.js';
import { landSeed } from '../src/lands/ids.js';
import { LANDS, getLand } from '../src/lands/lands.js';
import { biomeLand } from '../src/world/biomes.js';
import { generateChunk, tileAtWorld } from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import { HABITAT_BOOST, surroundings, type Surroundings } from '../src/world/habitat.js';
import { isEncounterTile, type GridPos, type Tile, type TileKind } from '../src/world/types.js';
import { turn } from './turn.js';

/**
 * Where encounters happen, in every land: Nordland's four biomes on land and the sea's deep
 * water, and The Arctic's (#192), each on one pole. Each biome's place, written out again from
 * #192: its land, and in The Arctic its pole. Animals come out only in their own place.
 */
const PLACE: Record<Biome, string> = {
	meadow: 'nordland',
	forest: 'nordland',
	river: 'nordland',
	mountain: 'nordland',
	sea: 'nordland',
	tundra: 'arctic north',
	taiga: 'arctic north',
	fell: 'arctic north',
	'bird-cliffs': 'arctic north',
	'frozen-lake': 'arctic north',
	'arctic-ice': 'arctic north',
	'arctic-ocean': 'arctic north',
	'ice-sheet': 'arctic south',
	rookery: 'arctic south',
	'antarctic-ice': 'arctic south',
	'southern-ocean': 'arctic south'
};
const BIOMES = Object.keys(PLACE) as Biome[];
const LEADS: readonly Tier[] = [1, 2, 3, 4, 5];
const ORIGIN = { x: 0, y: 0 };
const tallgrass = (biome: Biome): Tile => ({ kind: 'tallgrass', biome, height: 0 });
/**
 * The biomes whose encounters are out on the water, on deep water: the open seas. A frozen
 * lake has no encounter tile (its ice and its banks of snow start nothing); what lives under
 * the ice is hooked through a fishing hole, from its own table (§ the fishing holes).
 */
const WATERY: readonly Biome[] = ['sea', 'arctic-ocean', 'southern-ocean'];
/** The realm of an encounter in a biome: out on the open sea, the water; else land. */
const realmOf = (biome: Biome): Realm => (WATERY.includes(biome) ? 'water' : 'land');
/** The tile an encounter in a biome happens on: tall grass, or out on the water, deep water. */
const encounterTile = (biome: Biome): Tile =>
	realmOf(biome) === 'water' ? { kind: 'deepwater', biome, height: 0 } : tallgrass(biome);
/** The biome's table in its own realm. */
const tableIn = (biome: Biome, distance: number, lead: Tier) =>
	encounterTable(biome, distance, lead, realmOf(biome));
/** Whether a kind lives in `biome`'s place, in `realm`: where it lives, or in the air the skies it flies. */
const livesNear = (a: Kind, biome: Biome, realm: Realm): boolean =>
	a.realms.includes(realm) &&
	(realm === 'air' ? skiesOfKind(a) : a.habitats).some((b) => PLACE[b] === PLACE[biome]);

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

/** Site `distance` tiles east of an origin spawn, with the ground `around` it, in the biome's land. */
const siteAt = (biome: Biome, distance: number, around: Surroundings = OPEN): EncounterSite => ({
	land: biomeLand(biome),
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

/**
 * The biomes where something of the realm of their encounter tile lives. Every biome of a
 * land open to players is one ("is never empty…"); The Arctic's frozen lakes have no encounter
 * tile, only fishing holes.
 */
const INHABITED = BIOMES.filter((b) => residents(b).some((a) => a.realms.includes(realmOf(b))));

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
	skies?: readonly Biome[];
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
 * visits, the visitors adding three of the lead's tier's bells to it times
 * 1 − danger: near home each visitor weighs a third of the three, unless a
 * visitor would then weigh more than a resident of its size (#136), and then
 * the residents and the visitors weigh the tier's four bells evenly, the
 * residents' part beyond their own bell thinning out with the visitors.
 * Shares, in roster order. With the starter in front near spawn before the
 * bell it was PR #12's table: the river and the mountains were exactly the
 * biomes with residents but no tier-1 animal.
 */
function bellTable(
	roster: readonly Kind[],
	biome: Biome,
	distance: number,
	lead: number
): Map<string, number> {
	const danger = Math.min(1, Math.max(0, (distance - 32) / 96));
	const realm = realmOf(biome);
	const here = roster.filter((a) => livesNear(a, biome, realm));
	const living = here.filter((a) => a.habitats.includes(biome));
	const visited = (biome === 'river' || biome === 'mountain') && living.some((a) => a.tier > lead);
	const count = (tier: number) => living.filter((a) => a.tier === tier).length;
	const guest = (a: Kind) =>
		a.tier === lead && !a.habitats.includes(biome) && visited && danger < 1;
	const guests = here.filter(guest).length;
	const hosts = count(lead);
	// Near home, in bells of the lead's tier (its bell is 1 at every distance).
	const outweighs = hosts > 0 && 3 / guests > 1 / hosts;
	const visitor = outweighs ? 4 / (hosts + guests) : 3 / guests;
	const theirs = (1 + (3 - guests * visitor) * (1 - danger)) / hosts;
	const raw = new Map<string, number>();
	for (const a of here) {
		if (a.habitats.includes(biome))
			raw.set(
				a.id,
				a.tier === lead && guests > 0 ? theirs : bell(a.tier - lead, distance) / count(a.tier)
			);
		else if (guest(a)) raw.set(a.id, visitor * (1 - danger));
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
	lead: number,
	inBiome: typeof bellTable = bellTable
): Map<string, number> {
	const danger = Math.min(1, Math.max(0, (distance - 32) / 96));
	const kinds = new Map(roster.map((a) => [a.id, a]));
	const table = inBiome(roster, biome, distance, lead);
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
	for (const e of tableIn(biome, distance, lead)) shares[e.species.tier - 1]! += e.weight;
	return shares;
}

/** The tiers with an animal living in the biome, in its realm. */
const livingTiers = (biome: Biome) =>
	new Set<number>(
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
		// for the starter, the small ones 1, the tier-2 ones 1/9, tier 3 (the red deer, the
		// wild boar, the eagle-owl, the mute swan) 1/9^4, tier 4 1/9^9 and tier 5 1/9^16; at
		// the river and in the mountains the small animals that live elsewhere come too, all
		// together three times as much as those living there.
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
				...split(nearUp(1), 'fox', 'roe-deer', 'badger', 'stoat', 'adder', 'buzzard'),
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
				...split(nearUp(2), 'deer', 'wild-boar', 'eagle-owl'),
				...split(nearUp(3), 'wolf', 'lynx'),
				...split(nearUp(4), 'bear', 'moose', 'european-bison')
			})
		);
		// The river's three small kinds share their bell, and the nine small visitors, on top,
		// three more: 1/3 each, as every small animal weighed before the bell; the small ones
		// weigh 4 there, and one tier up is still 1 in 37. Since #89's big animals every tier
		// lives at the river: the mute swan, the sea eagle and the moose, one kind each.
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
				...split(nearUp(1), 'otter', 'grey-heron', 'raccoon', 'beaver'),
				'mute-swan': nearUp(2),
				'white-tailed-eagle': nearUp(3),
				moose: nearUp(4)
			})
		);
		const river = 4 + nearUp(1) + nearUp(2) + nearUp(3) + nearUp(4);
		expect(share('river', 0, 1, (t) => t === 2)).toBeCloseTo(nearUp(1) / river, 12);
		expect(Math.round(1 / share('river', 0, 1, (t) => t === 2))).toBe(37);
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
				'eagle-owl': nearUp(2),
				...split(nearUp(3), 'wolf', 'lynx', 'wolverine', 'golden-eagle'),
				bear: nearUp(4)
			})
		);
		// Out on the deep water: the sea animals only, the frog in the boat's lead or not, and
		// since #89's third wave every tier of them two to four kinds.
		expectShares(
			encounterTable('sea', 0, 1, 'water'),
			normalised({
				...split(1, 'crab', 'starfish', 'moon-jellyfish', 'plaice'),
				...split(nearUp(1), 'turtle', 'lions-mane-jellyfish', 'lobster'),
				...split(nearUp(2), 'dolphin', 'harbour-seal', 'harbour-porpoise'),
				...split(nearUp(3), 'octopus', 'grey-seal'),
				...split(nearUp(4), 'whale', 'orca')
			})
		);
		// Nine small kinds beside five tier-2 ones in the meadow, seven beside six in the
		// forest: near home the starter meets one tier up 1 time in 10 in both.
		expect(share('meadow', 0, 1, (t) => t === 2)).toBeCloseTo(1 / 10, 3);
		expect(share('forest', 0, 1, (t) => t === 2)).toBeCloseTo(1 / 10, 3);
		// Smaller animals weigh the same near and far. A bear in front far out: the tier-5
		// animals (bears, moose, bison) 1, tier 4 (wolves, lynxes) e^−1/2, tier 3 (red deer,
		// wild boars, eagle-owls) e^−2, the tier-2 ones e^−4.5 and the small ones e^−8.
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
				...split(down(2), 'deer', 'wild-boar', 'eagle-owl'),
				...split(down(1), 'wolf', 'lynx'),
				...split(1, 'bear', 'moose', 'european-bison')
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
				...split(down(3), 'fox', 'roe-deer', 'badger', 'stoat', 'adder', 'buzzard'),
				deer: down(2)
			})
		);
		// A red deer in the mountains near home: the eagle-owl lives there, and the red deer, the
		// wild boar and the mute swan visit, with the visitors' three bells.
		expectShares(
			encounterTable('mountain', 0, 3),
			normalised({
				'common-lizard': down(2),
				...split(down(1), 'stoat', 'adder'),
				'eagle-owl': 1,
				...split(3, 'deer', 'wild-boar', 'mute-swan'),
				...split(nearUp(1), 'wolf', 'lynx', 'wolverine', 'golden-eagle'),
				bear: nearUp(2)
			})
		);
		// A wolf in the mountains near home: the sea eagle is the one tier-4 animal that comes up
		// the hills, beside the four living there. Its three bells alone would make it twelve
		// times as common as each of them, 62% of the battles (#136): no visitor weighs more
		// than a resident, so the five share the tier's four bells, 16% each.
		expectShares(
			encounterTable('mountain', 0, 4),
			normalised({
				'common-lizard': down(3),
				...split(down(2), 'stoat', 'adder'),
				'eagle-owl': down(1),
				...split(4, 'wolf', 'lynx', 'wolverine', 'golden-eagle', 'white-tailed-eagle'),
				bear: nearUp(1)
			})
		);
		expect(sharesOf(encounterTable('mountain', 0, 4)).get('white-tailed-eagle')!).toBeCloseTo(
			0.8 / (4 + down(1) + down(2) + down(3) + nearUp(1)),
			12
		);
		// A tier-2 animal at the river near home: its eight visitors (the buzzard, #91, the
		// eighth) would weigh 3/8 of a bell each against the four residents' 1/4; so all twelve
		// share the four bells. The small animals and the bigger ones keep their shares: only
		// the tier's own split moves.
		expectShares(
			encounterTable('river', 0, 2),
			normalised({
				...split(down(1), 'frog', 'brown-rat', 'common-toad'),
				...split(
					4,
					'fox',
					'otter',
					'roe-deer',
					'badger',
					'pine-marten',
					'stoat',
					'adder',
					'grey-heron',
					'tawny-owl',
					'raccoon',
					'beaver',
					'buzzard'
				),
				'mute-swan': nearUp(1),
				'white-tailed-eagle': nearUp(2),
				moose: nearUp(3)
			})
		);
		// Halfway out the visitor has thinned to half, and the residents' part beyond their own
		// bell with it: near home each of them weighs 4/5 of a bell, 11/20 more than its quarter;
		// here 11/40 more.
		const half = SAFE_RADIUS + (WILD_RADIUS - SAFE_RADIUS) / 2;
		const up = (k: number) => bell(k, half);
		expectShares(
			encounterTable('mountain', half, 4),
			normalised({
				'common-lizard': down(3),
				...split(down(2), 'stoat', 'adder'),
				'eagle-owl': down(1),
				...split(1 + 11 / 10, 'wolf', 'lynx', 'wolverine', 'golden-eagle'),
				'white-tailed-eagle': 0.8 / 2,
				bear: up(1)
			})
		);
		// A bear at the river, where the moose is its size (#89): the moose, and the sea eagle,
		// the mute swan, the tier-2 animals and the small ones a tier and more below.
		expectShares(
			encounterTable('river', 0, 5),
			normalised({
				...split(down(4), 'frog', 'brown-rat', 'common-toad'),
				...split(down(3), 'otter', 'grey-heron', 'raccoon', 'beaver'),
				'mute-swan': down(2),
				'white-tailed-eagle': down(1),
				moose: 1
			})
		);
		// 9,650 tables, each written out again here: 0.8 to 1.8 s at a load average of 100.
		// 0.5 s alone at a load average of 10 and 2.6 s in the whole suite at 29 since #89's second
		// wave, which scales to 13 s at 150.
	}, 60_000);

	it('the frog lives in the river reeds: every lead meets it there, near and far, and it hops up the hills only for a small lead near home', () => {
		const frog = getAnimal('frog');
		expect(frog.tier).toBe(1);
		expect(frog.habitats).toEqual(['river']);
		const frogShare = (biome: Biome, d: number, lead: Tier) =>
			encounterTable(biome, d, lead).find((e) => e.species.id === 'frog')?.weight ?? 0;
		// Every tier lives at the river since #89's big animals: the frog, the brown rat and the
		// toad, four tier-2 kinds, the mute swan, the sea eagle and the moose.
		const up = (k: number) => Math.pow(9, -k * k);
		const reeds = 4 + up(1) + up(2) + up(3) + up(4);
		// A tier-1 lead: in the reeds near home the frog is one of the three small kinds living
		// there, which weigh 1 together, beside the nine that come down to the water (3 together),
		// the river's four tier-2 animals (1/9) and its big ones; far out the small ones are
		// 1 / (1 + e^−1/2 + e^−2 + e^−4.5 + e^−8) of the reeds, three kinds.
		const farReeds = [0, 1, 2, 3, 4].reduce((s, k) => s + Math.exp(-(k * k) / 2), 0);
		expect(frogShare('river', 0, 1)).toBeCloseTo(1 / 3 / reeds, 12);
		expect(frogShare('river', SAFE_RADIUS, 1)).toBeCloseTo(1 / 3 / reeds, 12);
		expect(frogShare('river', WILD_RADIUS, 1)).toBeCloseTo(1 / farReeds / 3, 12);
		expect(frogShare('river', 1000, 1)).toBeCloseTo(1 / farReeds / 3, 12);
		// It comes up the hills near home too, one of eleven small visitors that weigh three
		// times the lizard together, the one small animal living there, beside the stoats and
		// adders, the eagle-owl, the four tier-4 kinds and the bear.
		expect(frogShare('mountain', 0, 1)).toBeCloseTo(3 / 11 / reeds, 12);
		expect(frogShare('mountain', WILD_RADIUS, 1)).toBe(0);
		// A bigger lead meets it at the river, near and far, one small kind of three, a tier or
		// more below: the tiers weigh their bells, and a lead up to tier 4 has visitors of its
		// size there too, three bells near home, thinning out to none at the wild radius.
		for (const [d, danger] of [
			[0, 0],
			[SAFE_RADIUS, 0],
			[80, 0.5],
			[WILD_RADIUS, 1],
			[1000, 1]
		] as const) {
			for (const lead of [2, 3, 4, 5] as const) {
				const tiers = [1, 2, 3, 4, 5].reduce((s, t) => s + bell(t - lead, d), 0);
				const visitors = lead <= 4 ? 3 * (1 - danger) : 0;
				expect(frogShare('river', d, lead), `tier-${lead} @ ${d}`).toBeCloseTo(
					bell(1 - lead, d) / 3 / (tiers + visitors),
					12
				);
				expect(frogShare('mountain', d, lead), `mountain, tier-${lead} @ ${d}`).toBe(0);
			}
		}
		// A bear at the river meets a frog about 1 time in 16,000: the moose is its size there.
		expect(frogShare('river', 0, 5)).toBeGreaterThan(1 / 17000);
		expect(frogShare('river', 0, 5)).toBeLessThan(1 / 15000);
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

	it('no visitor weighs more than an animal of its size living there, at any distance (#136)', () => {
		// Near home a wolf's hills were 62% sea eagles, the one tier-4 animal that visits them,
		// weighing the visitors' three bells alone beside the four tier-4 animals living there.
		const bad: string[] = [];
		const seen = new Set<string>();
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of SWEEP) {
					const own = tableIn(biome, d, lead).filter((e) => e.species.tier === lead);
					const hosts = own.filter((e) => e.species.habitats.includes(biome));
					const guests = own.filter((e) => !e.species.habitats.includes(biome));
					if (hosts.length === 0 || guests.length === 0) continue;
					seen.add(`${lead}:${biome}`);
					const least = Math.min(...hosts.map((e) => e.weight));
					for (const g of guests)
						if (!(g.weight <= least * (1 + 1e-12)))
							bad.push(
								`${g.species.id}, tier-${lead} lead in ${biome} @ ${d}: ${g.weight} > ${least}`
							);
				}
			}
		}
		expect(bad).toEqual([]);
		// Every lead up to tier 4 has visitors at the river and in the mountains.
		expect([...seen].sort()).toEqual(
			['1', '2', '3', '4'].flatMap((l) => [`${l}:mountain`, `${l}:river`])
		);
		// A lone visitor beside four residents weighs what each of them does near home; where
		// visitors are many (the starter's reeds: nine of them beside three residents), each
		// weighs its third of the three bells, as it did before.
		const hills = sharesOf(encounterTable('mountain', 0, 4));
		for (const id of ['wolf', 'lynx', 'wolverine', 'golden-eagle'])
			expect(hills.get(id)!, id).toBeCloseTo(hills.get('white-tailed-eagle')!, 14);
		const reeds = sharesOf(encounterTable('river', 0, 1));
		expect(reeds.get('squirrel')!).toBeCloseTo(reeds.get('frog')!, 14);
		// 9,650 tables: 0.09 s alone at a load average of 18, and up to ten times its run alone
		// at 150.
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
									livesNear(a, biome, realmOf(biome))
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
		// up the mountains; so do the animals of the lead's size for a bigger lead, wherever
		// something bigger than it lives: at the river the mute swan, the sea eagle and the
		// moose (#89), in the mountains the eagle-owl, the four tier-4 kinds and the bear.
		// Nothing is bigger than a tier-5 lead, so it meets no visitors.
		expect(visited).toEqual([
			'1:river:squirrel+rabbit+shrew+wood-mouse+hedgehog+mole+common-lizard+robin+stag-beetle',
			'1:mountain:squirrel+rabbit+frog+shrew+wood-mouse+brown-rat+hedgehog+mole+common-toad+robin+stag-beetle',
			'2:river:fox+roe-deer+badger+pine-marten+stoat+adder+tawny-owl+buzzard',
			'2:mountain:fox+otter+roe-deer+badger+pine-marten+grey-heron+tawny-owl+raccoon+beaver+buzzard',
			'3:river:deer+wild-boar+eagle-owl',
			'3:mountain:deer+wild-boar+mute-swan',
			'4:river:wolf+lynx+wolverine+golden-eagle',
			'4:mountain:white-tailed-eagle'
		]);
		// 150 tables, each with its own expects: 0.2 to 0.6 s at a load average of 100.
	}, 30_000);

	it('is never empty where anything of its realm lives, and empty where nothing does', () => {
		const bad: string[] = [];
		for (const biome of BIOMES) {
			if (getLand(biomeLand(biome)).available)
				expect(livingTiers(biome).size, biome).toBeGreaterThan(0);
		}
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				const living = livingTiers(biome).size > 0;
				for (const d of SWEEP) {
					if (tableIn(biome, d, lead).length > 0 !== living)
						bad.push(`tier-${lead} lead in ${biome} @ ${d}`);
				}
			}
			// No land animal lives in the sea, and none of the meadow's animals swims.
			expect(encounterTable('sea', 0, lead, 'land')).toEqual([]);
			expect(encounterTable('meadow', 400, lead, 'water')).toEqual([]);
		}
		expect(bad).toEqual([]);
	});

	it('keeps each land to its own animals, and in The Arctic each pole: no animal of another place comes, visiting or not (#191, #192)', () => {
		const bad: string[] = [];
		const realmsOf = (biome: Biome): Realm[] => [realmOf(biome), 'air'];
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const realm of realmsOf(biome)) {
					for (const d of [0, SAFE_RADIUS, 80, WILD_RADIUS, 1000]) {
						for (const land of LANDS) {
							const table = encounterTable(biome, d, lead, realm, land.id);
							const where = `tier-${lead} lead in ${land.id}'s ${biome} (${realm}) @ ${d}`;
							// Another land's ground is quiet there: The Arctic, not built yet, lies on
							// Nordland's kind of ground, and nothing comes out of it.
							if (land.id !== biomeLand(biome) && table.length > 0) bad.push(`${where}: not quiet`);
							for (const e of table) {
								if (!land.species.includes(e.species.id)) bad.push(`${where}: ${e.species.id}`);
								const homes = realm === 'air' ? skiesOfKind(e.species) : e.species.habitats;
								if (!homes.some((b) => PLACE[b] === PLACE[biome]))
									bad.push(`${where}: ${e.species.id} lives elsewhere`);
							}
						}
					}
				}
			}
		}
		expect(bad).toEqual([]);
		// The puffin, a small bird of the north, visits the north's skies, never the south's.
		expect(encounterTable('arctic-ocean', 0, 1, 'air').map((e) => e.species.id)).toContain(
			'snow-bunting'
		);
		expect(encounterTable('southern-ocean', 0, 1, 'air').map((e) => e.species.id)).toEqual([
			'snow-petrel',
			'arctic-tern'
		]);
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
				// Ten thousand steps and more: the least is one of the four small sea animals with a
				// whale or an orca in front, 1.2e−5.
				expect(most / 4, `${a.id} for a tier-${lead} lead far out`).toBeGreaterThan(1e4 * step);
			}
		}
	});

	it('near home a starter meets a wolf hardly ever and a bear or a whale never: four tiers up is under the dice', () => {
		const step = 2 ** -32;
		const weightOf = (biome: Biome, d: number, id: string) =>
			tableIn(biome, d, 1).find((e) => e.species.id === id)!.weight;
		for (const d of [0, 16, SAFE_RADIUS]) {
			// Three tiers up, 9^−9 of the small ones' weight, which the wolf shares with the lynx
			// in the forest: about 1 roll in 800 million each.
			for (const id of ['wolf', 'lynx']) {
				expect(weightOf('forest', d, id), id).toBeGreaterThan(step);
				expect(weightOf('forest', d, id), id).toBeLessThan(1e-8);
			}
			// Four tiers up, 9^−16: far under the smallest step a roll can take.
			for (const [biome, id] of [
				['forest', 'bear'],
				['forest', 'moose'],
				['forest', 'european-bison'],
				['river', 'moose'],
				['mountain', 'bear'],
				['sea', 'whale'],
				['sea', 'orca']
			] as const)
				expect(weightOf(biome, d, id), `${id} in ${biome} @ ${d}`).toBeLessThan(step / 1000);
		}
		// From the wild radius a starter meets a tier-5 animal in the forest 1 time in 5,200:
		// a bear, a moose or a bison, 1 time in 15,700 each (#89).
		const tier5 =
			Math.exp(-8) / (1 + Math.exp(-0.5) + Math.exp(-2) + Math.exp(-4.5) + Math.exp(-8));
		const big = ['bear', 'moose', 'european-bison'] as const;
		for (const id of big)
			expect(weightOf('forest', WILD_RADIUS, id), id).toBeCloseTo(tier5 / 3, 12);
		const share = big.reduce((sum, id) => sum + weightOf('forest', WILD_RADIUS, id), 0);
		expect(Math.round(1 / share / 100) * 100).toBe(5200);
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
					const ofRealm = residents(biome).filter((a) => a.realms.includes(realmOf(biome)));
					if (!ofRealm.some((a) => a.tier >= lead)) continue;
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
	it("lists exactly the biome's species, in its order, each at a quarter to four times its biome share", async () => {
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
				await turn();
			}
		}
		expect(bad.list).toEqual([]);
		expect(compared).toBeGreaterThan(100_000);
		// 109,350 tables: 3.2 s alone at a load average of 10, 15 s in the whole suite at 33,
		// which scales to 68 s at 150; its loop turns after each biome.
	}, 240_000);

	it('for every lead is the table [[PRODUCT]] §4 writes out, on every ground', async () => {
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
				await turn();
			}
		}
		expect(bad.list).toEqual([]);
		expect(compared).toBeGreaterThan(500_000);
		// 49,160 tables, each written out again here: 3.4 s alone at a load average of 10, 10 s in
		// the whole suite at 35, which scales to 44 s at 150; its loop turns after each biome.
	}, 180_000);

	it('more of a terrain nearby never lowers the share of an animal that favours it', async () => {
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
				await turn();
			}
		}
		expect(bad.list).toEqual([]);
		// Not a sweep of ties: the ground moved these shares tens of thousands of times.
		expect(checked).toBeGreaterThan(50_000);
		expect(rose).toBeGreaterThan(20_000);
		// 54,675 tables, and every one-tile change between them: 2.2 s alone at a load average of
		// 10, 5.1 s in the whole suite at 37, and up to ten times its run alone at 150; its loop
		// turns after each biome.
	}, 90_000);

	it('on any ground, the share of animals bigger than the lead, and of those two tiers up, never falls with distance', () => {
		// Its own tier's share may rise: where animals of different tiers favour different
		// ground, the ground's pull as danger rises takes share from the animals below it (#89),
		// up to 15.6 points for a tier-5 lead in an open glade of the forest, where the bison is
		// at home and nothing bigger lives (57.0% near home, 72.6% from the wild radius), and
		// 9.6 for a red deer on meadow grass among trees. The world never gets gentler as a kid
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
		expect(sea).toEqual([
			'crab',
			'starfish',
			'turtle',
			'dolphin',
			'octopus',
			'whale',
			'moon-jellyfish',
			'plaice',
			'lions-mane-jellyfish',
			'lobster',
			'harbour-seal',
			'harbour-porpoise',
			'grey-seal',
			'orca'
		]);
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
	it("inside the safe radius the ground never moves a tier: on every ground, each tier's share is the biome table's, whoever leads", async () => {
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
				await turn();
			}
		}
		expect(bad.list).toEqual([]);
		expect(compared).toBeGreaterThan(300_000);
		// 91,125 tables: 2.8 s alone at a load average of 10, 4.6 s in the whole suite at 38,
		// and up to ten times its run alone at 150; its loop turns after each biome.
	}, 90_000);

	it("at the reed beside the prototype world's spawn, with the lake all round it, most battles are the water's small animals and the bigger ones 1 in 37", () => {
		const seed = hashString('prototype');
		const spawn = spawnPoint(seed);
		const pos = { x: spawn.x - 1, y: spawn.y };
		const tile = tileAtWorld(seed, pos.x, pos.y);
		expect(tile).toMatchObject({ kind: 'tallgrass', biome: 'river' });
		const site = { land: 'nordland' as const, tile, pos, spawn, around: surroundings(seed, pos) };
		// Near home the ground only divides each tier's share. The three small kinds living in
		// the reeds weigh a third of the nine that come down to the water, each as much as one
		// of those, and by the water four times as much: four sevenths of the small animals'
		// 36 in 37. The four tier-2 animals of the river, all at home by the water, split the
		// 37th evenly (7/48 of a visitor each); the mute swan, the sea eagle and the moose
		// (#89), one to a tier, keep 1/9^4, 1/9^9 and 1/9^16 of the small ones' 21/4.
		const each = (w: number, ...ids: string[]) => Object.fromEntries(ids.map((id) => [id, w]));
		expectShares(
			encounterTableAt(site, 1),
			normalised({
				...each(4, 'frog', 'brown-rat', 'common-toad'),
				...each(1, 'squirrel', 'rabbit', 'shrew', 'wood-mouse', 'hedgehog', 'mole'),
				...each(1, 'common-lizard', 'robin', 'stag-beetle'),
				...each(7 / 48, 'otter', 'grey-heron', 'raccoon', 'beaver'),
				'mute-swan': (21 / 4) * Math.pow(9, -4),
				'white-tailed-eagle': (21 / 4) * Math.pow(9, -9),
				moose: (21 / 4) * Math.pow(9, -16)
			})
		);
		// A tier-2 animal in front: its tier weighs four bells there since bigger animals live
		// at the river (#89). Its eight visitors (the buzzard, #91, the eighth) would weigh 3/8
		// of a bell each against the river's own four at 1/4, so all twelve share the four
		// evenly (#136), and the ground re-divides them: the river's own, at home by the water,
		// four times as much each as a visitor of the trees or the rocks, 2/3 of a bell each
		// against 1/6. The three small ones of the water, a tier below, weigh e^−1/2 together
		// (13% of the battles), the mute swan 1/9, the sea eagle 1/9^4 and the moose 1/9^9.
		expectShares(
			encounterTableAt(site, 2),
			normalised({
				...each(2 / 3, 'otter', 'grey-heron', 'raccoon', 'beaver'),
				...each(
					1 / 6,
					'fox',
					'roe-deer',
					'badger',
					'pine-marten',
					'stoat',
					'adder',
					'tawny-owl',
					'buzzard'
				),
				...each(Math.exp(-0.5) / 3, 'frog', 'brown-rat', 'common-toad'),
				'mute-swan': 1 / 9,
				'white-tailed-eagle': Math.pow(9, -4),
				moose: Math.pow(9, -9)
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
					for (const biome of INHABITED) {
						const drawn = new Rng(7);
						rollEncounter(drawn, siteAt(biome, d, around), lead);
						expect(drawn.next(), `tier-${lead} lead in ${biome}`).not.toBe(new Rng(7).next());
					}
				}
			}
		}
	});

	it('for every lead draws exactly as [[PRODUCT]] §4 says: the chance, then a pick down the table for the ground around', async () => {
		const bad = findings();
		let met = 0;
		for (const lead of LEADS) {
			for (const biome of INHABITED) {
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
								bad.note(
									`tier-${lead} lead in ${biome} @ ${d} on ${JSON.stringify(around)}: ${a} vs ${b}`
								);
							if (a !== null) met++;
						}
					}
				}
				await turn();
			}
		}
		expect(bad.list).toEqual([]);
		expect(met).toBeGreaterThan(12_000);
		// 168,000 rolls, each rolled again by the rule here (the starter's in full, a bigger lead's
		// an eighth as many, as its table is checked on every ground above): 4.1 s alone at a load
		// average of 10, 6.5 s in the whole suite at 37, and up to ten times its run alone at 150;
		// its loop turns after each biome.
	}, 180_000);

	it('neither the lead nor the ground changes whether a step starts a battle, only which animal comes out', async () => {
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
				await turn();
			}
		}
		expect(bad).toEqual([]);
		expect(battles).toBeGreaterThan(5000);
		// 123,000 rolls: 3.0 s alone at a load average of 10, 4.5 s in the whole suite at 36, and
		// up to ten times its run alone at 150; its loop turns after each lead.
	}, 120_000);

	it('starts one encounter per 8–12 grass steps, whoever leads and wherever', async () => {
		const steps = 8000;
		for (const lead of LEADS) {
			for (const biome of INHABITED) {
				const rng = new Rng(hashString(`${lead}:${biome}`));
				let hits = 0;
				for (let i = 0; i < steps; i++)
					if (rollEncounter(rng, siteAt(biome, 50, GROUNDS[i % GROUNDS.length]), lead)) hits++;
				const where = `tier-${lead} lead in ${biome}`;
				expect(hits / steps, where).toBeGreaterThan(1 / 12);
				expect(hits / steps, where).toBeLessThan(1 / 8);
				expect(hits / steps, where).toBeCloseTo(ENCOUNTER_CHANCE, 1);
				await turn();
			}
		}
		// 8,000 rolls for each lead and biome: 4.1 s alone at a load average of 10, 6.7 s in the
		// whole suite at 35, and up to ten times its run alone at 150; its loop turns after each biome.
	}, 180_000);

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
			for (const biome of INHABITED) {
				for (const spawn of spawns) {
					for (const o of offsets) {
						const pos = { x: spawn.x + o.x, y: spawn.y + o.y };
						const around = GROUNDS[(o.x + o.y + spawn.x) & 7]!;
						const site = { land: biomeLand(biome), tile: encounterTile(biome), pos, spawn, around };
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
		// 60,000 rolls: 1.4 s alone at a load average of 10, 2.4 s in the whole suite at 36, and
		// up to ten times its run alone at 150.
	}, 60_000);

	it("samples the lead's table: species shares match the weights, and every species of 1 in 250 or more shows up", async () => {
		for (const lead of LEADS) {
			for (const biome of INHABITED) {
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
				await turn();
			}
		}
		// 4,000 encounters for each lead, biome and distance: 4.0 s alone at a load average of 10,
		// 8.6 s in the whole suite at 36, and up to ten times its run alone at 150; its loop turns
		// after each biome.
	}, 120_000);
});

describe('rollEncounterFor: the lead where the step lands, or nobody', () => {
	/** A random team: any species, each standing or tired. */
	function team(rng: Rng): AnimalInstance[] {
		return Array.from({ length: rng.int(0, 5) }, (_, i) => {
			const spec = rng.pick(ANIMALS);
			return { id: `m${i}`, speciesId: spec.id, hp: rng.chance(0.4) ? 0 : spec.maxHp };
		});
	}

	it("rolls exactly the lead's roll, and with nobody standing who can fight there draws nothing at all", () => {
		const pick = new Rng(hashString('rollEncounterFor'));
		const bad: string[] = [];
		let quiet = 0;
		let met = 0;
		for (let n = 0; n < 1500; n++) {
			const party = team(pick);
			const biome = pick.pick(BIOMES);
			const site = siteAt(biome, pick.int(0, 200), pick.pick(GROUNDS));
			const realm = realmOf(biome);
			const seed = hashString(`step ${n}`);
			const rng = new Rng(seed);
			const wild = rollEncounterFor(rng, site, party);
			const lead = party.find((a) => a.hp > 0 && getAnimal(a.speciesId).realms.includes(realm));
			if (!lead) {
				quiet++;
				if (wild !== null) bad.push(`${n}: met ${wild.speciesId} with nobody to fight`);
				// Nothing drawn: the next draw is the stream's first.
				if (rng.next() !== new Rng(seed).next()) bad.push(`${n}: drew with nobody to fight`);
				continue;
			}
			const same = new Rng(seed);
			const want = rollEncounter(same, site, getAnimal(lead.speciesId).tier);
			if (JSON.stringify(wild) !== JSON.stringify(want)) bad.push(`${n}: ${JSON.stringify(wild)}`);
			if (rng.next() !== same.next()) bad.push(`${n}: drew differently`);
			if (wild) met++;
		}
		expect(bad.slice(0, 5)).toEqual([]);
		// Both halves happened, plenty.
		expect(quiet).toBeGreaterThan(200);
		expect(met).toBeGreaterThan(50);
	});

	it('a team that needs the doctor meets nothing, on any tile, however long it walks', () => {
		const tired = [
			{ id: 'a', speciesId: 'squirrel', hp: 0 },
			{ id: 'b', speciesId: 'otter', hp: 0 },
			{ id: 'c', speciesId: 'whale', hp: 0 }
		];
		const kinds: readonly TileKind[] = ['tallgrass', 'deepwater', 'grass', 'water', 'sand'];
		for (const biome of BIOMES) {
			for (const kind of kinds) {
				const site = { ...siteAt(biome, 100), tile: { kind, biome, height: 0 } };
				const rng = new EveryStepMeets(7);
				for (let n = 0; n < 20; n++) expect(rollEncounterFor(rng, site, tired)).toBeNull();
			}
		}
		// A crab standing is someone out at sea, and nobody in the grass.
		const crab = [...tired, { id: 'd', speciesId: 'crab', hp: getAnimal('crab').maxHp }];
		const every = new EveryStepMeets(3);
		expect(rollEncounterFor(every, siteAt('meadow', 0), crab)).toBeNull();
		expect(rollEncounterFor(every, siteAt('sea', 0), crab)).not.toBeNull();
	});
});

describe('the generated world offers every habitat', () => {
	it('grows tall grass or deep water in at least one habitat of every species, within 8 chunks of spawn', () => {
		// Every species of every land, in that land's worlds: The Arctic's map is built (#191 step
		// 4), and its deep snow grows round its animals, on both poles, close enough to meet them.
		const open = LANDS;
		for (const [land, seed] of open.flatMap((l) =>
			l.id === 'nordland'
				? [hashString('prototype'), 1, 2, 3].map((seed) => [l, seed] as const)
				: [1, 2, 3, 4].map((n) => [l, landSeed(l.id, n)] as const)
		)) {
			const grassy = new Set<Biome>();
			const spawn = spawnPoint(seed);
			const scx = Math.floor(spawn.x / 16);
			const scy = Math.floor(spawn.y / 16);
			for (let cy = scy - 8; cy <= scy + 8; cy++)
				for (let cx = scx - 8; cx <= scx + 8; cx++)
					for (const t of generateChunk(seed, cx, cy).tiles)
						if (isEncounterTile(t.kind)) grassy.add(t.biome);
			for (const a of ANIMALS.filter((a) => land.species.includes(a.id))) {
				const reachable = a.habitats.some((b) => grassy.has(b));
				expect(reachable, `${a.id} has nowhere to be met (seed ${seed})`).toBe(true);
			}
		}
		// 1,156 chunks generated: 1.3 s alone at a load average of 10, 2.7 s in the whole suite at
		// 37, and up to ten times its run alone at 150.
	}, 60_000);
});

/** Where a bird flies: its own skies, or where it lives; no sky for an animal that does not fly. */
const skiesOfKind = (a: Kind): readonly Biome[] =>
	a.realms.includes('air') ? (a.skies ?? a.habitats) : [];

/**
 * A sky's table, written out again from [[PRODUCT]] §4 "Wild encounters" ("In the air") for
 * any roster, with its numbers as literals: only birds come out, each weighing its tier's
 * `bell` over the number of its tier's birds flying over that sky (where they live, and the
 * sea eagle over the sea too); and in every sky, not only at the river and in the mountains,
 * wherever a bird bigger than the lead flies there, every bird of the lead's tier that does
 * not visits, the visitors adding three of the lead's tier's bells to it times 1 − danger,
 * as on the ground: a third of the three each near home, unless a visitor would then weigh
 * more than a bird of its size flying there (#136), and then the birds of the tier flying
 * there and the visitors weigh its four bells evenly. Shares, in roster order.
 */
function skyBellTable(
	roster: readonly Kind[],
	biome: Biome,
	distance: number,
	lead: number
): Map<string, number> {
	const danger = Math.min(1, Math.max(0, (distance - 32) / 96));
	const birds = roster.filter((a) => livesNear(a, biome, 'air'));
	const flying = birds.filter((a) => skiesOfKind(a).includes(biome));
	const visited = flying.some((a) => a.tier > lead);
	const count = (tier: number) => flying.filter((a) => a.tier === tier).length;
	const guest = (a: Kind) =>
		a.tier === lead && !skiesOfKind(a).includes(biome) && visited && danger < 1;
	const guests = birds.filter(guest).length;
	const hosts = count(lead);
	// Near home, in bells of the lead's tier (its bell is 1 at every distance).
	const outweighs = hosts > 0 && 3 / guests > 1 / hosts;
	const visitor = outweighs ? 4 / (hosts + guests) : 3 / guests;
	const theirs = (1 + (3 - guests * visitor) * (1 - danger)) / hosts;
	const raw = new Map<string, number>();
	for (const a of birds) {
		if (skiesOfKind(a).includes(biome))
			raw.set(
				a.id,
				a.tier === lead && guests > 0 ? theirs : bell(a.tier - lead, distance) / count(a.tier)
			);
		else if (guest(a)) raw.set(a.id, visitor * (1 - danger));
	}
	let sum = 0;
	for (const w of raw.values()) sum += w;
	return new Map([...raw].map(([id, w]) => [id, w / sum]));
}

/** A bird's roll over a tile: the 1-in-20 chance first, then a pick down the sky's table for the ground. */
function skyRoll(rng: Rng, site: EncounterSite, lead: Tier): string | null {
	if (!rng.chance(1 / 20)) return null;
	const distance = distanceFromSpawn(site.pos, site.spawn);
	const table = bellTableAt(ANIMALS, site.tile.biome, distance, site.around, lead, skyBellTable);
	let r = rng.next();
	let last: string | null = null;
	for (const [id, w] of table) {
		r -= w;
		last = id;
		if (r < 0) return id;
	}
	return last;
}

/** The sky over a tile of any kind in `biome`, `distance` tiles east of an origin spawn. */
const skySite = (
	biome: Biome,
	distance: number,
	around: Surroundings = OPEN,
	kind: TileKind = 'grass'
): EncounterSite => ({ ...siteAt(biome, distance, around), tile: { kind, biome, height: 0 } });

/** Every kind of tile a glider flies over. */
const UNDER: readonly TileKind[] = [
	'grass',
	'tallgrass',
	'sand',
	'water',
	'deepwater',
	'tree',
	'rock',
	'tent'
];

/** The birds' tiers: a lead in the air is one of them. */
const FLYING_LEADS: readonly Tier[] = [1, 2, 3, 4];

/** A sky's table: the biome's in the air. */
const skyIn = (biome: Biome, distance: number, lead: Tier) =>
	encounterTable(biome, distance, lead, 'air');

describe('the sky: birds that notice the glider (#91)', () => {
	it('for every lead is the table [[PRODUCT]] §4 writes out, over every biome, at every distance', () => {
		const bad = findings();
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of SWEEP) {
					const table = skyIn(biome, d, lead);
					const expected = skyBellTable(ANIMALS, biome, d, lead);
					const where = `tier-${lead} lead over ${biome} @ ${d}`;
					const ids = table.map((e) => e.species.id).join();
					if (ids !== [...expected.keys()].join()) bad.note(`${where} lists ${ids}`);
					for (const e of table) {
						if (!(Math.abs(e.weight - expected.get(e.species.id)!) <= 1e-14))
							bad.note(`${e.species.id}, ${where}: ${e.weight}`);
					}
				}
			}
		}
		expect(bad.list).toEqual([]);
		// With a robin in front, the tables [[PRODUCT]] §4 quotes (#91's check, re-derived here).
		// Near home: over the meadow and the forest the robin lives, so one tier up is the usual
		// 1 in 10; the river's, the mountains' and the sea's birds are all bigger, and robins visit.
		const nearUp = (k: number) => Math.pow(9, -k * k);
		const down = (k: number) => Math.exp(-(k * k) / 2);
		const near = (biome: Biome) => skyIn(biome, 0, 1);
		expectShares(near('meadow'), normalised({ robin: 1, buzzard: nearUp(1) }));
		expectShares(
			near('forest'),
			normalised({ robin: 1, 'tawny-owl': nearUp(1), 'eagle-owl': nearUp(2) })
		);
		expectShares(
			near('river'),
			normalised({
				robin: 3,
				'grey-heron': nearUp(1),
				'mute-swan': nearUp(2),
				'white-tailed-eagle': nearUp(3)
			})
		);
		expectShares(
			near('mountain'),
			normalised({ robin: 3, 'eagle-owl': nearUp(2), 'golden-eagle': nearUp(3) })
		);
		expectShares(near('sea'), normalised({ robin: 3, 'white-tailed-eagle': nearUp(3) }));
		// Far out the visitors are gone, and the sea eagle is the sea's only bird.
		const far = (biome: Biome) => skyIn(biome, WILD_RADIUS, 1);
		expectShares(far('meadow'), normalised({ robin: 1, buzzard: down(1) }));
		expectShares(
			far('forest'),
			normalised({ robin: 1, 'tawny-owl': down(1), 'eagle-owl': down(2) })
		);
		expectShares(
			far('river'),
			normalised({ 'grey-heron': down(1), 'mute-swan': down(2), 'white-tailed-eagle': down(3) })
		);
		expectShares(far('mountain'), normalised({ 'eagle-owl': down(2), 'golden-eagle': down(3) }));
		expectShares(far('sea'), { 'white-tailed-eagle': 1 });
		// 9,625 tables, each written out again here.
	}, 30_000);

	it('no visitor weighs more than a bird of its size flying there, over any biome, at any distance (#136)', () => {
		const bad: string[] = [];
		const seen = new Set<string>();
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of SWEEP) {
					const own = skyIn(biome, d, lead).filter((e) => e.species.tier === lead);
					const hosts = own.filter((e) => skiesOfKind(e.species).includes(biome));
					const guests = own.filter((e) => !skiesOfKind(e.species).includes(biome));
					if (hosts.length === 0 || guests.length === 0) continue;
					seen.add(`${lead}:${biome}`);
					const least = Math.min(...hosts.map((e) => e.weight));
					for (const g of guests)
						if (!(g.weight <= least * (1 + 1e-12)))
							bad.push(
								`${g.species.id}, tier-${lead} lead over ${biome} @ ${d}: ${g.weight} > ${least}`
							);
				}
			}
		}
		expect(bad).toEqual([]);
		// Where a bird of the lead's size lives under a bigger one, and others of its size come:
		// the tawny owl over the forest (the eagle-owl's too) and the heron over the river, with a
		// tier-2 bird in front; the swan over the river and the eagle-owl over the mountains,
		// with a tier-3 one. Near home the heron and the buzzard over the forest weigh what the
		// tawny owl does, where their three bells alone would make each half as common again.
		// In The Arctic's north (#192), every sky with a small bird under the bigger tern, eider,
		// goose or raven, with a small bird in front: the puffin's sea, the cliffs, the fell, the
		// taiga's waxwings and the tundra; the snow petrel's south has no small bird visiting.
		expect([...seen].sort()).toEqual([
			'1:arctic-ocean',
			'1:bird-cliffs',
			'1:fell',
			'1:taiga',
			'1:tundra',
			'2:forest',
			'2:river',
			'3:mountain',
			'3:river'
		]);
		const forest = new Map(skyIn('forest', 0, 2).map((e) => [e.species.id, e.weight]));
		for (const id of ['grey-heron', 'buzzard'])
			expect(forest.get(id)!, id).toBeCloseTo(forest.get('tawny-owl')!, 14);
		// 9,650 tables: 0.07 s alone at a load average of 2, and up to ten times its run alone
		// at 150.
	}, 30_000);

	it('lists only birds, over every biome; every bird flies over a sky of every lead, near home and far out, and far out every one can come out', () => {
		const step = 2 ** -32;
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of [0, 64, 1000]) {
					const table = skyIn(biome, d, lead);
					expect(table.length, `tier-${lead} lead over ${biome}`).toBeGreaterThan(0);
					for (const e of table) expect(e.species.realms, e.species.id).toContain('air');
				}
			}
			for (const bird of ANIMALS.filter((a) => a.realms.includes('air'))) {
				for (const d of [0, 1000]) {
					const listed = BIOMES.some((b) => skyIn(b, d, lead).some((e) => e.species === bird));
					expect(listed, `${bird.id} over no sky of a tier-${lead} lead (d = ${d})`).toBe(true);
				}
				const most = Math.max(
					...BIOMES.flatMap((b) =>
						skyIn(b, 1000, lead)
							.filter((e) => e.species === bird)
							.map((e) => e.weight)
					)
				);
				expect(most / 4, `${bird.id} for a tier-${lead} lead far out`).toBeGreaterThan(1e4 * step);
			}
		}
		// The sea eagle over the sea, the buzzard over the meadow, as the issue says.
		expect(skyIn('sea', 1000, 1).map((e) => e.species.id)).toEqual(['white-tailed-eagle']);
		expect(skyIn('meadow', 1000, 2).map((e) => e.species.id)).toContain('buzzard');
	});

	it("inside the safe radius the lead's tier is the majority wherever a bird its size or bigger flies, one tier up at most 1 in 10 and two or more up under 1 in 5,000", () => {
		const shareOf = (biome: Biome, d: number, lead: Tier, tiers: (t: number) => boolean) =>
			tierShare(skyIn(biome, d, lead), tiers);
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of [0, SAFE_RADIUS / 2, SAFE_RADIUS]) {
					const where = `tier-${lead} lead over ${biome} @ ${d}`;
					expect(
						shareOf(biome, d, lead, (t) => t === lead + 1),
						where
					).toBeLessThanOrEqual(0.1 + 1e-15);
					expect(
						shareOf(biome, d, lead, (t) => t >= lead + 2),
						where
					).toBeLessThan(1 / 5000);
					const flying = ANIMALS.filter((a) => skiesOfKind(a).includes(biome));
					if (!flying.some((a) => a.tier >= lead)) continue;
					expect(
						shareOf(biome, d, lead, (t) => t === lead),
						where
					).toBeGreaterThan(0.5);
				}
			}
		}
	});

	it("bigger birds never grow rarer and the lead's own tier never commoner with distance, on any ground", async () => {
		const bad = findings();
		for (const lead of LEADS) {
			await turn();
			for (const biome of BIOMES) {
				for (const around of GROUNDS) {
					let prevBigger = -1;
					let prevFierce = -1;
					let prevOwn = 2;
					for (let d = 0; d <= WILD_RADIUS + 16; d += 1) {
						const table = skyTableAt(skySite(biome, d, around), lead);
						const bigger = tierShare(table, (t) => t > lead);
						const fierce = tierShare(table, (t) => t >= lead + 2);
						const where = `tier-${lead} lead over ${biome} @ ${d} on ${JSON.stringify(around)}`;
						if (!(bigger >= prevBigger - 1e-12)) bad.note(`${where}: bigger fell to ${bigger}`);
						if (!(fierce >= prevFierce - 1e-12)) bad.note(`${where}: two up fell to ${fierce}`);
						prevBigger = bigger;
						prevFierce = fierce;
						// The lead's own tier, on the sky's own table (the ground may pull it up,
						// as on land, only from the tiers below it).
						const own = tierShare(skyIn(biome, d, lead), (t) => t === lead);
						if (!(own <= prevOwn + 1e-12)) bad.note(`${where}: own tier rose to ${own}`);
						prevOwn = own;
					}
				}
				const far = skyIn(biome, WILD_RADIUS, lead);
				for (const e of far) expect(skiesOfKind(e.species), 'no visitor far out').toContain(biome);
				expect(skyIn(biome, WILD_RADIUS * 4, lead)).toEqual(far);
			}
		}
		expect(bad.list).toEqual([]);
		// 5,800 sky tables, each weighed by one of 8 grounds, and as many of the sky's own: 1.3 s
		// alone at a load of 8, so about 20 s at 150; a turn of the loop between leads.
	}, 60_000);

	it('over a tile of any kind lists the sky’s birds, each at a quarter to four times its share, weighed by the ground as [[PRODUCT]] §4 writes it', () => {
		const bad = findings();
		let compared = 0;
		for (const lead of LEADS) {
			for (const biome of BIOMES) {
				for (const d of [0, 20, 50, 80, 127.5, 128, 1000]) {
					const inSky = skyIn(biome, d, lead);
					for (const around of GROUNDS) {
						for (const kind of UNDER) {
							const here = skyTableAt(skySite(biome, d, around, kind), lead);
							const expected = bellTableAt(ANIMALS, biome, d, around, lead, skyBellTable);
							const where = `tier-${lead} lead over ${kind} (${biome}) @ ${d} on ${JSON.stringify(around)}`;
							if (here.map((e) => e.species.id).join() !== inSky.map((e) => e.species.id).join())
								bad.note(`${where} lists ${here.map((e) => e.species.id)}`);
							here.forEach((e, i) => {
								compared++;
								if (!(Math.abs(e.weight - expected.get(e.species.id)!) <= 1e-12))
									bad.note(
										`${e.species.id} ${where}: ${e.weight} vs ${expected.get(e.species.id)}`
									);
								const ratio = e.weight / inSky[i]!.weight;
								if (!(ratio >= 0.25 - 1e-12 && ratio <= 4 + 1e-12))
									bad.note(`${e.species.id}, ${where}: ×${ratio}`);
							});
						}
					}
				}
			}
		}
		expect(bad.list).toEqual([]);
		expect(compared).toBeGreaterThan(20_000);
	}, 30_000);

	it('rolls exactly as [[PRODUCT]] §4 says, over every kind of tile: the 1-in-20 chance first, then a pick down the sky’s table for the ground', async () => {
		const bad = findings();
		let met = 0;
		for (const lead of FLYING_LEADS) {
			await turn();
			for (const biome of BIOMES) {
				for (const d of [0, 40, 100, 160]) {
					for (const around of GROUNDS) {
						const kind = UNDER[(lead + d + around.trees) % UNDER.length]!;
						const key = `sky:${lead}:${biome}:${d}:${JSON.stringify(around)}`;
						const now = new Rng(hashString(key));
						const spec = new Rng(hashString(key));
						const site = skySite(biome, d, around, kind);
						for (let i = 0; i < 100; i++) {
							const a = rollSkyEncounter(now, site, lead);
							const b = skyRoll(spec, site, lead);
							if ((a?.speciesId ?? null) !== b) bad.note(`${key}: ${a?.speciesId} vs ${b}`);
							if (a) {
								met++;
								if (a.hp !== getAnimal(a.speciesId).maxHp) bad.note(`${key}: ${a.hp} HP`);
							}
						}
					}
				}
			}
		}
		expect(bad.list).toEqual([]);
		expect(met).toBeGreaterThan(500);
		expect(SKY_CHANCE).toBe(1 / 20);
		// 64,000 rolls, each rolled again by the rule here: 1.3 s alone at a load of 8 (2.6 s at
		// 200 a site), so about 20 s at 150; a turn of the loop between leads.
	}, 60_000);

	it('neither the lead, the ground nor the tile below changes whether a bird notices the glider, and one does about every 20 tiles', async () => {
		const bad: string[] = [];
		let noticed = 0;
		let rolls = 0;
		for (const biome of BIOMES) {
			await turn();
			for (const d of [0, 64, 400]) {
				const seeds = Array.from({ length: 200 }, (_, i) => hashString(`sky:${biome}:${d}:${i}`));
				const robinOverGrass = seeds.map(
					(s) => rollSkyEncounter(new Rng(s), skySite(biome, d), 1) !== null
				);
				for (const lead of FLYING_LEADS) {
					for (const around of GROUNDS.slice(0, 3)) {
						for (const kind of ['water', 'tree', 'tent'] as const) {
							const met = seeds.map(
								(s) => rollSkyEncounter(new Rng(s), skySite(biome, d, around, kind), lead) !== null
							);
							if (met.join() !== robinOverGrass.join())
								bad.push(`tier-${lead} lead over ${kind} in ${biome} @ ${d}`);
						}
					}
				}
				noticed += robinOverGrass.filter(Boolean).length;
				rolls += seeds.length;
			}
		}
		expect(bad).toEqual([]);
		expect(noticed / rolls).toBeGreaterThan(1 / 25);
		expect(noticed / rolls).toBeLessThan(1 / 16);
		// 111,000 rolls: 1.9 s alone at a load of 8 (3.2 s over every lead and 4 grounds), so
		// about 30 s at 150; a turn of the loop between biomes.
	}, 90_000);

	it('is deterministic, and refuses a lead that is not a tier or a site that is not real', () => {
		const run = (seed: number) => {
			const rng = new Rng(seed);
			return Array.from({ length: 400 }, () =>
				rollSkyEncounter(rng, skySite('river', 90, { water: 6, trees: 0, rocks: 1 }), 2)
			);
		};
		expect(run(42)).toEqual(run(42));
		expect(run(42)).not.toEqual(run(43));
		for (const bad of [0, 6, 2.5, NaN, undefined, '2']) {
			const lead = bad as unknown as Tier;
			expect(() => rollSkyEncounter(new Rng(1), skySite('meadow', 0), lead)).toThrow(/tier/);
			expect(() => skyTableAt(skySite('meadow', 0), lead)).toThrow(/tier/);
		}
		const nowhere = { ...skySite('meadow', 0), pos: { x: NaN, y: 0 } };
		expect(() => rollSkyEncounter(new Rng(1), nowhere, 1)).toThrow(/distance/);
	});
});

describe('the fishing holes (#192 § Fishing holes)', () => {
	// What a line can hook through a hole is the water's table of the ice it is in, its
	// animals of the water alone (a polar bear or a penguin is met on the ice, not hooked
	// through it): #192's table, each animal on the right pole.
	const hookable = (biome: Biome) =>
		encounterTable(biome, WILD_RADIUS, 3, 'water')
			.filter((e) => !e.species.realms.includes('land'))
			.map((e) => e.species.id);

	it("lists #192's animals under each ice, and the open seas hold every one of them too", () => {
		expect(hookable('frozen-lake')).toEqual(['arctic-char']);
		expect(hookable('arctic-ice')).toEqual(['polar-cod', 'ringed-seal', 'greenland-shark']);
		expect(hookable('antarctic-ice')).toEqual([
			'antarctic-krill',
			'icefish',
			'weddell-seal',
			'toothfish'
		]);
		// Each also swims in its pole's open sea, so a kid with the boat meets it without a rod.
		for (const [ice, sea] of [
			['frozen-lake', 'arctic-ocean'],
			['arctic-ice', 'arctic-ocean'],
			['antarctic-ice', 'southern-ocean']
		] as const)
			for (const id of hookable(ice)) expect(getAnimal(id).habitats, id).toContain(sea);
	});

	it('an animal of the water alone lives only in the open seas and under the ice', () => {
		const wet: readonly Biome[] = [
			'sea',
			'arctic-ocean',
			'southern-ocean',
			'frozen-lake',
			'arctic-ice',
			'antarctic-ice'
		];
		for (const a of ANIMALS.filter((s) => !s.realms.includes('land')))
			for (const b of a.habitats) expect(wet, `${a.id} in ${b}`).toContain(b);
	});
});
