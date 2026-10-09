import { BIOME_POLE, type Biome } from '../animals/types.js';
import type { LandId } from '../lands/ids.js';

/**
 * Which land each biome is in (#192), beside the pole The Arctic's are on
 * (`BIOME_POLE`): a leaf module, so the encounter rules can keep the animals
 * of each land, and of each pole, to their own place without reading the
 * land registry.
 */

const LANDS: Record<Biome, LandId> = {
	meadow: 'nordland',
	forest: 'nordland',
	river: 'nordland',
	mountain: 'nordland',
	sea: 'nordland',
	tundra: 'arctic',
	taiga: 'arctic',
	fell: 'arctic',
	'bird-cliffs': 'arctic',
	'frozen-lake': 'arctic',
	'arctic-ice': 'arctic',
	'arctic-ocean': 'arctic',
	'ice-sheet': 'arctic',
	rookery: 'arctic',
	'antarctic-ice': 'arctic',
	'southern-ocean': 'arctic'
};

/** The land `biome` is in. */
export function biomeLand(biome: Biome): LandId {
	return LANDS[biome];
}

/**
 * Whether two biomes are one place for the animals that visit: the same
 * land, and in The Arctic the same pole. A visitor comes only from its own
 * place (`encounters.ts`): a puffin never visits the Antarctic's sky.
 */
export function samePlace(a: Biome, b: Biome): boolean {
	return biomeLand(a) === biomeLand(b) && BIOME_POLE[a] === BIOME_POLE[b];
}
