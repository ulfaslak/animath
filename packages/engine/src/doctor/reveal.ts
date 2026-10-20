import type { AnimalBook } from '../animals/book.js';
import { getAnimal, skiesOf } from '../animals/catalog.js';
import type { Biome } from '../animals/types.js';
import type { LandId } from '../lands/ids.js';
import { getLand } from '../lands/lands.js';

/**
 * The druid's tip ([[PRODUCT]] §4 "Asking the druid"):
 * for one puzzle he tells the kid about an animal of the land they have not
 * caught yet, and where to look for it. Which animal he may pick, and where
 * that animal is met, are rules, here; the words are the client's.
 */

/**
 * The species the druid may tell about in `land`, given the kid's `book`: the
 * land's species not caught yet, and of those the ones never met and never
 * told about, if any; else the ones not told about yet; else every one not
 * caught. So he tells first about the animals the kid has never seen, and
 * never twice about one while another is left he has not told about. Empty
 * once every animal of the land is caught. In the book's order.
 */
export function revealChoices(land: LandId, book: AnimalBook): readonly string[] {
	const missing = getLand(land).species.filter((id) => !book.caught.includes(id));
	const untold = missing.filter((id) => !book.told.includes(id));
	const unmet = untold.filter((id) => !book.seen.includes(id));
	if (unmet.length > 0) return unmet;
	if (untold.length > 0) return untold;
	return missing;
}

/** The deep water out at sea, met from the boat: Nordland's sea, the Arctic's two oceans. */
const OPEN_SEAS: readonly Biome[] = ['sea', 'arctic-ocean', 'southern-ocean'];

/** The ice a fishing hole is cut in, where the animals of the water alone under it bite. */
const HOLE_ICE: readonly Biome[] = ['frozen-lake', 'arctic-ice', 'antarctic-ice'];

/**
 * The biomes whose encounter tile is on land: tall grass (the river's reeds
 * too) in Nordland, deep snow in The Arctic. A frozen lake has none (its
 * drifts are plain snow), and the open seas' is deep water.
 */
function hasGrass(biome: Biome): boolean {
	return !OPEN_SEAS.includes(biome) && biome !== 'frozen-lake';
}

/**
 * Where a species is met, by the encounter rules (`encounterTable`,
 * `holeTable`, `skyTableAt`), each list in the order of its habitats or skies:
 * - `grass`: the biomes in whose tall grass (deep snow in The Arctic) it comes
 *   out, for a species that walks;
 * - `sea`: the open seas on whose deep water it comes out, from the boat, for
 *   one that swims;
 * - `ice`: the ice it bites through at a fishing hole, for one of the water alone;
 * - `sky`: the biomes over which it notices a kid on the glider, for a bird.
 * Never all empty ([[INVARIANTS]] § Encounters, "Every species in the catalog
 * can be met somewhere"). A visitor's other places, near home, are not
 * listed: an animal is surest where it lives.
 */
export interface MeetingPlaces {
	grass: readonly Biome[];
	sea: readonly Biome[];
	ice: readonly Biome[];
	sky: readonly Biome[];
}

/** Where `speciesId` is met (`MeetingPlaces`). Throws for an id the catalog lacks. */
export function meetingPlaces(speciesId: string): MeetingPlaces {
	const spec = getAnimal(speciesId);
	const walks = spec.realms.includes('land');
	const swims = spec.realms.includes('water');
	return {
		grass: walks ? spec.habitats.filter(hasGrass) : [],
		sea: swims ? spec.habitats.filter((b) => OPEN_SEAS.includes(b)) : [],
		ice: swims && !walks ? spec.habitats.filter((b) => HOLE_ICE.includes(b)) : [],
		sky: spec.realms.includes('air') ? [...skiesOf(spec)] : []
	};
}
