import { ANIMALS } from '../animals/catalog.js';
import type { AnimalInstance, AnimalSpec, Biome, Realm, Tier } from '../animals/types.js';
import type { Rng } from '../rng.js';
import { factorForShare, terrainShares, type Surroundings } from './habitat.js';
import { encounterRealm, isEncounterTile, type GridPos, type Tile } from './types.js';

/**
 * Wild encounters: which animal, if any, steps out of the tall grass, or out
 * at sea comes up from the deep water.
 *
 * The authority calls `rollEncounter` once per completed step, with the tier of
 * the party's lead where the player stands: the first animal that isn't tired
 * and can fight there (out at sea, the first that swims), the one that steps
 * into the battle first. Only a step that lands on an encounter tile (tall
 * grass, deep water) can start a battle; the roll then draws the encounter
 * chance and, on a hit, a species from the table where the player stands
 * (`encounterTableAt`), in the tile's realm.
 *
 * The biome's table (`encounterTable`) is the catalog filtered by biome and
 * realm and weighted by how many tiers above the lead each species is, so that
 * animals fiercer than the lead are rare near the spawn tile and ordinary far
 * from it. An animal two or more tiers below the lead never challenges it; one
 * tier below does, rarely. Near spawn, animals of the lead's size come down to
 * the water and up the hills: the river and the mountains, wherever something
 * bigger than the lead lives there, also get every species of the lead's tier
 * that doesn't live there as a visitor, so the first few minutes are fair
 * wherever the player walks. From its own tier up, a tier-L lead's table is a
 * tier-1 lead's table in a catalog L − 1 tiers smaller.
 *
 * The table where the player stands (`encounterTableAt`) is the biome's,
 * weighed again by how much of the ground each species favours lies around
 * (`habitat.ts`): the frogs by the water, the rabbits in the open. Near spawn
 * the ground only chooses among the animals of each tier, so every tier keeps
 * the share the biome's table gives it and the start is exactly as gentle as
 * before; further out it also moves the tiers, fully from the wild radius. It
 * lists the same species, so the ground never changes whether a step can
 * start a battle or who could come out, only who is likely to. [[PRODUCT]] §4
 * "Wild encounters" states the numbers in prose; they must agree with the
 * constants here and in `habitat.ts`.
 *
 * Every draw comes from the caller's `Rng`, so a walk replays exactly from
 * (seed, intents). The rng is only touched when the tile can hold an encounter
 * and something in the biome could challenge the lead.
 */

/** Chance that a step landing on tall grass starts a battle: one encounter per ten grass steps. */
export const ENCOUNTER_CHANCE = 0.1;

/** Up to this many tiles from spawn the tier mix is at its gentlest. */
export const SAFE_RADIUS = 32;

/** From this many tiles out, every tier from the lead's up is equally likely on the biome's table. */
export const WILD_RADIUS = 128;

/** Inside the safe radius each tier above the lead is this many times rarer than the tier below it. */
export const NEAR_TIER_RATIO = 5;

/**
 * What a species one tier below the lead weighs, next to a species of the
 * lead's own tier (which weighs 1 at any distance); two or more tiers below
 * weighs nothing. A weight, not a share: where the lead's tier or bigger lives
 * too, smaller challengers are uncommon, one kind at a time (1–33% of a
 * biome's table all together since #89's animals, and so of every tile's
 * near spawn: the most where many smaller kinds live beside few of the
 * lead's, as five tier-2 kinds beside the one deer of the meadow; 1–53% on a
 * tile far out, where the ground moves the tiers), but where nothing else
 * lives — a wolf in the meadow — every encounter is one of them, at the
 * usual `ENCOUNTER_CHANCE`.
 */
export const ONE_TIER_BELOW_WEIGHT = 0.1;

export interface EncounterEntry {
	species: AnimalSpec;
	/** Share of the encounters the table stands for; a table's weights sum to 1. */
	weight: number;
}

/**
 * Where the player just stepped. `spawn` is `spawnPoint(seed)` for the world,
 * and `around` is `surroundings(seed, pos)`: the ground near the tile.
 */
export interface EncounterSite {
	tile: Tile;
	pos: GridPos;
	spawn: GridPos;
	around: Surroundings;
}

/**
 * A wild animal at full HP, without an id: a seeded engine can only make ids
 * that repeat across replays, so the authority mints one when it needs it.
 */
export type WildAnimal = Omit<AnimalInstance, 'id'>;

/** Straight-line distance in tiles. "Radius" in the rules means this. */
export function distanceFromSpawn(pos: GridPos, spawn: GridPos): number {
	return Math.hypot(pos.x - spawn.x, pos.y - spawn.y);
}

/** 0 inside the safe radius, 1 beyond the wild radius, linear in between. */
function danger(distance: number): number {
	const t = (distance - SAFE_RADIUS) / (WILD_RADIUS - SAFE_RADIUS);
	return Math.min(1, Math.max(0, t));
}

/**
 * Relative weight of a resident `above` tiers above the lead (negative:
 * below it): `ratio^-above` near spawn and 1 far out for the lead's tier and
 * up, `ONE_TIER_BELOW_WEIGHT` one tier below at any distance, 0 further down.
 */
function challengerWeight(above: number, distance: number): number {
	if (above >= 0) return Math.pow(NEAR_TIER_RATIO, -above * (1 - danger(distance)));
	return above === -1 ? ONE_TIER_BELOW_WEIGHT : 0;
}

/**
 * Where visitors come near spawn: the water and the hills, which animals of
 * the lead's size that don't live there come down to and up to (the small
 * animals of the meadow and the forest to the river, and those of the river
 * too to the mountains). Not a property of the catalog: the river and the
 * mountains have small animals of their own (the frogs, brown rats and toads,
 * the lizards), and the visitors still keep the bigger ones rare near home.
 */
const VISITED_BIOMES: readonly Biome[] = ['river', 'mountain'];

/**
 * What a visitor of the lead's tier weighs: 1 inside the safe radius, as much
 * as a resident of that tier, thinning out linearly to 0 at the wild radius.
 * Beyond it, for a tier-1 lead, the river and the mountains are their own
 * residents only.
 */
function visitorWeight(distance: number): number {
	return challengerWeight(0, distance) * (1 - danger(distance));
}

function assertTier(tier: unknown, where: string): asserts tier is Tier {
	if (!Number.isInteger(tier) || (tier as number) < 1 || (tier as number) > 5) {
		throw new Error(`${where}: the lead's tier is ${String(tier)}, expected 1..5`);
	}
}

/**
 * The biome's table: the species that can challenge a lead of tier `leadTier`
 * in `biome` at `distance` tiles from spawn, with their normalised shares, in
 * catalog order, before the ground around a tile has a say.
 *
 * Only species living in `realm` are listed: on land every species but the
 * sea animals, and out at sea (the sea biome's deep water) only them, as no
 * other species lives in the sea. Residents (species whose habitats
 * include the biome) are weighted by how many tiers above the lead they are;
 * residents two or more tiers below it are left out. In a visited biome (the
 * river, the mountains) where a resident is bigger than the lead, every
 * species of the lead's tier that doesn't live there is listed too, as a
 * visitor weighted by `visitorWeight`. Empty when nothing living in the biome
 * is within one tier below the lead: a bear meets nothing in the meadow.
 */
export function encounterTable(
	biome: Biome,
	distance: number,
	leadTier: Tier,
	realm: Realm = 'land'
): EncounterEntry[] {
	if (!Number.isFinite(distance)) throw new Error(`encounterTable: distance is ${distance}`);
	assertTier(leadTier, 'encounterTable');
	const lives = (a: AnimalSpec) => a.realms.includes(realm);
	const residents = ANIMALS.filter((a) => lives(a) && a.habitats.includes(biome));
	const visitors =
		VISITED_BIOMES.includes(biome) && residents.some((a) => a.tier > leadTier)
			? visitorWeight(distance)
			: 0;
	const raw = ANIMALS.flatMap((species) => {
		if (!lives(species)) return [];
		const above = species.tier - leadTier;
		if (species.habitats.includes(biome)) {
			const weight = challengerWeight(above, distance);
			return weight > 0 ? [{ species, weight }] : [];
		}
		if (above === 0 && visitors > 0) return [{ species, weight: visitors }];
		return [];
	});
	const total = raw.reduce((sum, e) => sum + e.weight, 0);
	return raw.map((e) => ({ species: e.species, weight: e.weight / total }));
}

/**
 * The table where the player stands: the biome's table for the tile's realm
 * and distance from spawn, weighed again by the ground around (`habitat.ts`).
 *
 * Within a tier, each species' share of its tier goes by its biome weight
 * times its habitat factor. Between tiers, a tier's biome share is multiplied
 * by its animals' mean factor (weighted as the biome weights them) raised to
 * `danger`. So inside the safe radius every tier keeps exactly the share the
 * biome's table gives it, and the ground only picks which animal of that size
 * comes out; from the wild radius out each species' weight is simply its
 * biome weight times its factor; in between the ground moves the tiers more
 * with every step out.
 *
 * It lists the same species as the biome's table, in the same order, each at
 * a quarter to four times its biome share. Empty on a tile where no encounter
 * can happen. Throws on a site whose position, spawn or surroundings are not
 * real, or a lead that is not a tier.
 */
export function encounterTableAt(site: EncounterSite, leadTier: Tier): EncounterEntry[] {
	assertTier(leadTier, 'encounterTableAt');
	const realm = encounterRealm(site.tile.kind);
	if (realm === null) return [];
	const distance = distanceFromSpawn(site.pos, site.spawn);
	if (!Number.isFinite(distance)) throw new Error(`encounterTableAt: distance is ${distance}`);
	const shares = terrainShares(site.around);
	const inBiome = encounterTable(site.tile.biome, distance, leadTier, realm);
	// Per tier: its share of the biome's table, and that share weighed by the ground.
	const tiers = new Map<Tier, { share: number; weighed: number }>();
	const weighed = inBiome.map((e) => {
		const weight = e.weight * factorForShare(shares[e.species.favours]);
		const tier = tiers.get(e.species.tier) ?? { share: 0, weighed: 0 };
		tier.share += e.weight;
		tier.weighed += weight;
		tiers.set(e.species.tier, tier);
		return { species: e.species, weight };
	});
	const reach = danger(distance);
	const tierWeight = new Map<Tier, number>();
	let total = 0;
	for (const [tier, t] of tiers) {
		const weight = t.share * Math.pow(t.weighed / t.share, reach);
		tierWeight.set(tier, weight);
		total += weight;
	}
	return weighed.map((e) => ({
		species: e.species,
		weight:
			(tierWeight.get(e.species.tier)! / total) * (e.weight / tiers.get(e.species.tier)!.weighed)
	}));
}

/**
 * Roll for a wild encounter after a step, for a party led by an animal of
 * tier `leadTier`. Returns the wild animal at full HP, or `null` when nothing
 * happens. The chance is `ENCOUNTER_CHANCE` whatever the lead and the ground,
 * wherever anything could challenge the lead; where nothing could, the roll is
 * `null` without a draw. On a hit, the animal is picked from
 * `encounterTableAt`. Throws on a site whose position, spawn or surroundings
 * are not real, or a lead that is not a tier, rather than guessing a table.
 */
export function rollEncounter(rng: Rng, site: EncounterSite, leadTier: Tier): WildAnimal | null {
	assertTier(leadTier, 'rollEncounter');
	if (!isEncounterTile(site.tile.kind)) return null;
	const table = encounterTableAt(site, leadTier);
	if (table.length === 0) return null;
	if (!rng.chance(ENCOUNTER_CHANCE)) return null;
	const species = pickWeighted(rng, table);
	return { speciesId: species.id, hp: species.maxHp };
}

function pickWeighted(rng: Rng, table: readonly EncounterEntry[]): AnimalSpec {
	let r = rng.next();
	for (const entry of table) {
		r -= entry.weight;
		if (r < 0) return entry.species;
	}
	// Float rounding can leave a sliver above the last cumulative weight.
	return (table[table.length - 1] as EncounterEntry).species;
}
