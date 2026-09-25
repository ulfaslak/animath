import { ANIMALS } from '../animals/catalog.js';
import type { AnimalInstance, AnimalSpec, Biome, Tier } from '../animals/types.js';
import type { Rng } from '../rng.js';
import { isEncounterTile, type GridPos, type Tile } from './types.js';

/**
 * Wild encounters: which animal, if any, steps out of the tall grass.
 *
 * The authority calls `rollEncounter` once per completed step, with the tier of
 * the party's lead: the first animal that isn't tired, the one that steps into
 * the battle first. Only a step that lands on an encounter tile can start a
 * battle; the roll then draws the encounter chance and, on a hit, a species
 * from the biome's table.
 *
 * The table is the catalog filtered by habitat and weighted by how many tiers
 * above the lead each species is, so that animals fiercer than the lead are
 * rare near the spawn tile and ordinary far from it. An animal two or more
 * tiers below the lead never challenges it; one tier below does, rarely. A
 * biome where the only animals at least the lead's size are bigger than it
 * (for a tier-1 lead: the river, the mountains) also gets the animals of the
 * lead's own tier as visitors near spawn, so the first few minutes are fair
 * wherever the player walks. For a tier-1 lead, nothing is below it, and this
 * is the rule from before the lead mattered. [[PRODUCT]] §4 "Wild encounters"
 * states the numbers in prose; they must agree with the constants below.
 *
 * Every draw comes from the caller's `Rng`, so a walk replays exactly from
 * (seed, intents). The rng is only touched when the tile can hold an encounter
 * and something in the biome could challenge the lead.
 */

/** Chance that a step landing on tall grass starts a battle: one encounter per ten grass steps. */
export const ENCOUNTER_CHANCE = 0.1;

/** Up to this many tiles from spawn the tier mix is at its gentlest. */
export const SAFE_RADIUS = 32;

/** From this many tiles out, every tier from the lead's up is equally likely. */
export const WILD_RADIUS = 128;

/** Inside the safe radius each tier above the lead is this many times rarer than the tier below it. */
export const NEAR_TIER_RATIO = 5;

/**
 * What a species one tier below the lead weighs, next to a species of the
 * lead's own tier (which weighs 1 at any distance). Small animals rarely
 * challenge a bigger one; two or more tiers below, never.
 */
export const ONE_TIER_BELOW_WEIGHT = 0.1;

export interface EncounterEntry {
	species: AnimalSpec;
	/** Share of encounters in this biome at this distance; a table's weights sum to 1. */
	weight: number;
}

/** Where the player just stepped. `spawn` is `spawnPoint(seed)` for the world. */
export interface EncounterSite {
	tile: Tile;
	pos: GridPos;
	spawn: GridPos;
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
 * How welcome visitors of the lead's tier are in a biome that has no animal of
 * that tier of its own: 1 inside the safe radius, thinning out linearly to 0
 * at the wild radius. Beyond it, for a tier-1 lead, the river is otters and
 * the mountains are wolves and bears.
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
 * The species that can challenge a lead of tier `leadTier` in `biome` at
 * `distance` tiles from spawn, with their normalised shares, in catalog order.
 *
 * Residents (species whose habitats include the biome) are weighted by how
 * many tiers above the lead they are; residents two or more tiers below it are
 * left out. A biome with residents at or above the lead's tier but none of
 * its tier also lists every species of the lead's tier as a visitor, weighted
 * by `visitorWeight`. Empty when nothing living in the biome is within one
 * tier below the lead: a bear meets nothing in the meadow.
 */
export function encounterTable(biome: Biome, distance: number, leadTier: Tier): EncounterEntry[] {
	if (!Number.isFinite(distance)) throw new Error(`encounterTable: distance is ${distance}`);
	assertTier(leadTier, 'encounterTable');
	const residents = ANIMALS.filter((a) => a.habitats.includes(biome));
	const visitors =
		residents.some((a) => a.tier >= leadTier) && !residents.some((a) => a.tier === leadTier)
			? visitorWeight(distance)
			: 0;
	const raw = ANIMALS.flatMap((species) => {
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
 * Roll for a wild encounter after a step, for a party led by an animal of
 * tier `leadTier`. Returns the wild animal at full HP, or `null` when nothing
 * happens. The chance is `ENCOUNTER_CHANCE` whatever the lead, wherever
 * anything could challenge it; where nothing could, the roll is `null` without
 * a draw. Throws on a site whose position or spawn is not a real coordinate,
 * or a lead that is not a tier, rather than guessing a table.
 */
export function rollEncounter(rng: Rng, site: EncounterSite, leadTier: Tier): WildAnimal | null {
	assertTier(leadTier, 'rollEncounter');
	if (!isEncounterTile(site.tile.kind)) return null;
	const distance = distanceFromSpawn(site.pos, site.spawn);
	if (!Number.isFinite(distance)) throw new Error(`rollEncounter: distance is ${distance}`);
	const table = encounterTable(site.tile.biome, distance, leadTier);
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
