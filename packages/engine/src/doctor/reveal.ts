import type { AnimalBook } from '../animals/book.js';
import { canFightIn, getAnimal, skiesOf } from '../animals/catalog.js';
import type { AnimalInstance, Biome, Realm, Tier } from '../animals/types.js';
import type { LandId } from '../lands/ids.js';
import { getLand } from '../lands/lands.js';
import { biomeLand } from '../world/biomes.js';
import {
	WILD_RADIUS,
	encounterTable,
	favourUncaught,
	type EncounterEntry
} from '../world/encounters.js';
import { holeTable } from '../world/fishing.js';

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

/**
 * Which of the kid's animals to put first to meet `speciesId` most often, as
 * the druid's tip names it: of the animals that can go where it is met (on
 * land for one that walks, in the water for one of the water), the one whose
 * size brings it out most, by the encounter rules (`encounterTable`,
 * `holeTable`), as the rolls weigh them once the druid has told about it:
 * with the kinds in `caught` caught and it the one told last
 * (`favourUncaught`). A size is scored by the animal's share of the table in each
 * of its places, near home and from the wild radius out, all added up, so a
 * smaller lead that meets it far out can win, and so can a bigger one in a
 * place where few sizes live. The tip is read at the druid's, who heals, so
 * tiredness counts for nothing: of the best size, the first in the team, and
 * `leads` when no animal before it can go there (out on the water, the
 * first that swims), so it leads once the team is well.
 * - `realm`: where it is met, land or the water;
 * - `far`: bigger than that animal, and in every one of its places met more
 *   often far out than near home (near the spawn an animal bigger than the
 *   lead hardly ever comes out: the distance rule), so it is to be looked
 *   for far from the start; never where its share is the same near home, as
 *   under a frozen lake, where the char is alone whoever leads;
 * - `big`: bigger than it, and a lead of its own size would meet it at least
 *   twice as often, so a smaller animal is to be caught first (with a bear
 *   alone, a shrew hardly ever comes out; red deer do, for a bear in the
 *   meadow, which holds nothing bigger).
 * Null when no animal of the team can go there (a sea animal, and nobody swims).
 */
export function bestLead(
	party: readonly AnimalInstance[],
	speciesId: string,
	caught: readonly string[]
): { index: number; realm: Realm; leads: boolean; far: boolean; big: boolean } | null {
	const spec = getAnimal(speciesId);
	const places = meetingPlaces(speciesId);
	const realm: Realm = places.grass.length > 0 ? 'land' : 'water';
	const goes = party.flatMap((a, i) => (canFightIn(a.speciesId, realm) ? [i] : []));
	if (goes.length === 0) return null;
	const share = (table: readonly EncounterEntry[]) =>
		favourUncaught(table, caught, speciesId).find((e) => e.species.id === speciesId)?.weight ?? 0;
	/** Its share in each of its places, for a lead of `lead`'s size `distance` tiles out. */
	const shares = (lead: Tier, distance: number): number[] =>
		realm === 'land'
			? places.grass.map((b) => share(encounterTable(b, distance, lead, 'land', biomeLand(b))))
			: [
					...places.sea.map((b) => share(encounterTable(b, distance, lead, 'water', biomeLand(b)))),
					...places.ice.map((b) => share(holeTable(b, distance, lead)))
				];
	const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
	const tierOf = (i: number) => getAnimal(party[i]!.speciesId).tier;
	const score = (lead: Tier) => sum(shares(lead, 0)) + sum(shares(lead, WILD_RADIUS));
	const scores = new Map<Tier, number>();
	for (const i of goes) if (!scores.has(tierOf(i))) scores.set(tierOf(i), score(tierOf(i)));
	const best = Math.max(...scores.values());
	// Sizes a hair apart score alike: the bigger of them, as nearer home a bigger lead meets it more.
	const tier = Math.max(...[...scores].filter(([, s]) => s >= best - 1e-9).map(([t]) => t)) as Tier;
	const index = goes.find((i) => tierOf(i) === tier)!;
	const near = shares(tier, 0);
	const out = shares(tier, WILD_RADIUS);
	return {
		index,
		realm,
		leads: goes[0] === index,
		far: spec.tier > tier && near.every((n, k) => n < out[k]! - 1e-9),
		big: tier > spec.tier && score(spec.tier) >= 2 * best
	};
}
