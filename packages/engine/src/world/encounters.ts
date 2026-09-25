import { ANIMALS } from '../animals/catalog.js';
import type { AnimalInstance, AnimalSpec, Biome, Tier } from '../animals/types.js';
import type { Rng } from '../rng.js';
import { isEncounterTile, type GridPos, type Tile } from './types.js';

/**
 * Wild encounters: which animal, if any, steps out of the tall grass.
 *
 * The authority calls `rollEncounter` once per completed step. Only a step that
 * lands on an encounter tile can start a battle; the roll then draws the
 * encounter chance and, on a hit, a species from the biome's table. The table
 * is the catalog filtered by habitat, weighted by tier so that fierce animals
 * are rare near the spawn tile and ordinary far from it. [[PRODUCT]] §4
 * "Wild encounters" states the numbers in prose; they must agree with the
 * constants below.
 *
 * Every draw comes from the caller's `Rng`, so a walk replays exactly from
 * (seed, intents). The rng is only touched when the tile can hold an encounter.
 */

/** Chance that a step landing on tall grass starts a battle: one encounter per ten grass steps. */
export const ENCOUNTER_CHANCE = 0.1;

/** Up to this many tiles from spawn the tier mix is at its gentlest. */
export const SAFE_RADIUS = 32;

/** From this many tiles out, every tier living in a biome is equally likely. */
export const WILD_RADIUS = 128;

/** Inside the safe radius each tier is this many times rarer than the tier below it. */
export const NEAR_TIER_RATIO = 5;

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

/** Straight-line distance in tiles. "Radius" in the rules means this. */
export function distanceFromSpawn(pos: GridPos, spawn: GridPos): number {
	return Math.hypot(pos.x - spawn.x, pos.y - spawn.y);
}

/** 0 inside the safe radius, 1 beyond the wild radius, linear in between. */
function danger(distance: number): number {
	const t = (distance - SAFE_RADIUS) / (WILD_RADIUS - SAFE_RADIUS);
	return Math.min(1, Math.max(0, t));
}

/** Relative weight of a tier at a distance: `ratio^-(tier-1)` near spawn, 1 far out. */
function tierWeight(tier: Tier, distance: number): number {
	return Math.pow(NEAR_TIER_RATIO, -(tier - 1) * (1 - danger(distance)));
}

/**
 * The species that can appear in `biome` at `distance` tiles from spawn, with
 * their normalised shares. Empty only if no species in the catalog lives there.
 */
export function encounterTable(biome: Biome, distance: number): EncounterEntry[] {
	const raw = ANIMALS.filter((a) => a.habitats.includes(biome)).map((species) => ({
		species,
		weight: tierWeight(species.tier, distance)
	}));
	const total = raw.reduce((sum, e) => sum + e.weight, 0);
	return raw.map((e) => ({ species: e.species, weight: e.weight / total }));
}

/**
 * Roll for a wild encounter after a step. Returns the wild animal at full HP,
 * or `null` when nothing happens. The instance id is drawn from the rng; an
 * authority that persists a caught animal may re-id it.
 */
export function rollEncounter(rng: Rng, site: EncounterSite): AnimalInstance | null {
	if (!isEncounterTile(site.tile.kind)) return null;
	if (!rng.chance(ENCOUNTER_CHANCE)) return null;
	const table = encounterTable(site.tile.biome, distanceFromSpawn(site.pos, site.spawn));
	if (table.length === 0) return null;
	const species = pickWeighted(rng, table);
	const tag = rng.int(0, 0xffffffff).toString(16).padStart(8, '0');
	return { id: `wild-${species.id}-${tag}`, speciesId: species.id, hp: species.maxHp };
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
