import { getAnimal } from '../animals/catalog.js';
import type { AnimalInstance, Biome, Tier } from '../animals/types.js';
import { hasItem } from '../items/catalog.js';
import { leadIndex } from '../party/reducer.js';
import type { Rng } from '../rng.js';
import { editedTileAt, type WorldEdits } from './edits.js';
import {
	distanceFromSpawn,
	encounterTable,
	type EncounterEntry,
	type WildAnimal
} from './encounters.js';
import { step, type Direction, type GridPos } from './types.js';

/**
 * Fishing at a fishing hole in The Arctic's ice ([[PRODUCT]] §4 "The Arctic's
 * shop", #191 step 6, #192 § Fishing holes). With the fishing rod, Enter
 * facing a hole casts a line into it: something may bite, and the battle is
 * fought in the water, by swimmers only, as out at sea (one rule a kid can
 * hold in their head). With no swimmer standing in the team nothing bites,
 * and the kid is told why; a cast draws nothing then.
 *
 * Every cast is one of the step count's (the authority counts it as a step),
 * so each cast rolls on a stream of its own, keyed like an encounter, and a
 * game picked up from a save casts on exactly as it would have.
 */

/** The share of casts something bites, where something lives under the ice. */
export const BITE_CHANCE = 0.4;

/**
 * What lives under the ice of `biome` that a line can hook, for a lead in the
 * water of tier `leadTier`, `distance` tiles from spawn: the animals of the
 * water alone (never one that walks too: a polar bear or a penguin is met on
 * the ice, not hooked through it) whose habitats are that ice, at the shares
 * the bell over tiers gives them (`encounterTable` in the water), in catalog
 * order. Empty where nothing of the kind lives (a biome with no hole, or a
 * hole's animals not in the game yet).
 */
export function holeTable(biome: Biome, distance: number, leadTier: Tier): EncounterEntry[] {
	const swimmers = encounterTable(biome, distance, leadTier, 'water').filter(
		(e) => !e.species.realms.includes('land')
	);
	const total = swimmers.reduce((sum, e) => sum + e.weight, 0);
	return swimmers.map((e) => ({ species: e.species, weight: e.weight / total }));
}

/** The fishing hole in front of a player at `pos` facing `facing`, in the world as `edits` leave it, or null. */
export function holeAhead(
	seed: number,
	edits: WorldEdits,
	pos: GridPos,
	facing: Direction
): GridPos | null {
	const front = step(pos, facing);
	return editedTileAt(seed, edits, front.x, front.y).kind === 'hole' ? front : null;
}

/**
 * What came of a cast: an animal bit (`bite`, the battle in the water starts
 * at once), nothing did (`nothing`), or nobody in the team can swim, so
 * nothing would (`no-swimmer`).
 */
export type Catch =
	| { outcome: 'bite'; wild: WildAnimal }
	| { outcome: 'nothing' }
	| { outcome: 'no-swimmer' };

/** Where a line is cast: the hole, and the world's spawn for the bell's distance. */
export interface CastSite {
	hole: GridPos;
	spawn: GridPos;
}

/**
 * A cast into the hole at `site.hole` of the world of `seed` by a kid who
 * owns `items` with `party`: the whole rule. The hole's table is the ice's
 * it is in (`holeTable`, the world as it was made: a hole the ice pick made
 * is in the ice the block stood on), sized to the lead in the water (the first
 * swimmer standing, `leadIndex`, who fights first). With nobody to fight in
 * the water nothing is drawn (`no-swimmer`); with nothing living there, or a
 * roll over `BITE_CHANCE`, nothing bites. Throws without the rod, or with no
 * hole there: the caller asks both first.
 */
export function castLine(
	rng: Rng,
	seed: number,
	edits: WorldEdits,
	site: CastSite,
	owner: { readonly items: readonly string[] },
	party: readonly AnimalInstance[]
): Catch {
	if (!hasItem(owner, 'fishing-rod')) throw new Error('castLine: no fishing rod');
	const { hole, spawn } = site;
	const tile = editedTileAt(seed, edits, hole.x, hole.y);
	if (tile.kind !== 'hole') throw new Error(`castLine: no hole at ${hole.x},${hole.y}`);
	const lead = party[leadIndex(party, 'water')];
	if (!lead) return { outcome: 'no-swimmer' };
	const table = holeTable(tile.biome, distanceFromSpawn(hole, spawn), getAnimal(lead.speciesId).tier);
	const wild = rollCast(rng, table);
	return wild ? { outcome: 'bite', wild } : { outcome: 'nothing' };
}

/**
 * One cast's roll on a hole's table: with nothing living there, nothing, and
 * nothing drawn; else `BITE_CHANCE` that something bites, drawn first, then
 * which, by the table's shares. The animal at full HP, or null.
 */
export function rollCast(rng: Rng, table: readonly EncounterEntry[]): WildAnimal | null {
	if (table.length === 0 || !rng.chance(BITE_CHANCE)) return null;
	let r = rng.next();
	for (const entry of table) {
		r -= entry.weight;
		if (r < 0) return { speciesId: entry.species.id, hp: entry.species.maxHp };
	}
	// Float rounding can leave a sliver above the last share.
	const last = table[table.length - 1]!.species;
	return { speciesId: last.id, hp: last.maxHp };
}
