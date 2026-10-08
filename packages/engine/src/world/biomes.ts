import type { Biome } from '../animals/types.js';
import type { LandId } from '../lands/ids.js';

/**
 * Which land each biome is in, and in The Arctic which pole (#192): a leaf
 * module, so the encounter rules can keep the animals of each land, and of
 * each pole, to their own place without reading the land registry.
 */

/** The Arctic's two halves: its Arctic (north) and its Antarctic (south). */
export type Pole = 'north' | 'south';

interface BiomePlace {
	land: LandId;
	/** The pole it lies on, for a land with two (The Arctic); none in Nordland. */
	pole?: Pole;
}

const PLACES: Record<Biome, BiomePlace> = {
	meadow: { land: 'nordland' },
	forest: { land: 'nordland' },
	river: { land: 'nordland' },
	mountain: { land: 'nordland' },
	sea: { land: 'nordland' },
	tundra: { land: 'arctic', pole: 'north' },
	taiga: { land: 'arctic', pole: 'north' },
	fell: { land: 'arctic', pole: 'north' },
	'bird-cliffs': { land: 'arctic', pole: 'north' },
	'frozen-lake': { land: 'arctic', pole: 'north' },
	'arctic-ice': { land: 'arctic', pole: 'north' },
	'arctic-ocean': { land: 'arctic', pole: 'north' },
	'ice-sheet': { land: 'arctic', pole: 'south' },
	rookery: { land: 'arctic', pole: 'south' },
	'antarctic-ice': { land: 'arctic', pole: 'south' },
	'southern-ocean': { land: 'arctic', pole: 'south' }
};

/** Every biome, land by land, in the order `Biome` names them. */
export const BIOMES: readonly Biome[] = Object.keys(PLACES) as Biome[];

/** The land `biome` is in. */
export function biomeLand(biome: Biome): LandId {
	return PLACES[biome].land;
}

/** The pole `biome` lies on, or `null` in a land without poles. */
export function biomePole(biome: Biome): Pole | null {
	return PLACES[biome].pole ?? null;
}

/**
 * Whether two biomes are one place for the animals that visit: the same
 * land, and in The Arctic the same pole. A visitor comes only from its own
 * place (`encounters.ts`): a puffin never visits the Antarctic's sky.
 */
export function samePlace(a: Biome, b: Biome): boolean {
	return biomeLand(a) === biomeLand(b) && biomePole(a) === biomePole(b);
}
