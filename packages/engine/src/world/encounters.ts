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
 * realm, its tiers weighed on a bell around the lead's (`tierWeight`), as the
 * human asked: the lead's own tier is the likeliest, the tiers beside it next,
 * and every tier living there is on the table (though near home four tiers
 * above the lead weigh less than the rng's smallest step, so a starter never
 * meets a bear or a whale there). A tier's share goes by its
 * distance from the lead's, never by how many kinds of animal it has; its
 * animals split it. The bell is symmetric from the wild radius out; nearer
 * home its side above the lead is pulled in, so that bigger animals are rare
 * near the spawn tile and the first minutes are kind. Near spawn, animals of
 * the lead's size also come down to the water and up the hills: the river and
 * the mountains, wherever something bigger than the lead lives there, get
 * every species of the lead's tier that doesn't live there as a visitor: all
 * of them together `VISITORS_WEIGHT` bells of the lead's tier, on top of it,
 * though never so that one visitor outweighs an animal of its size living
 * there (a lone visitor beside several residents shares their weight instead:
 * `visitorShares`). As they thin out, the lead's tier loses weight; were they
 * only to share out its bell, the ground round a reed or a rock, favouring the
 * residents they leave behind, would make the lead's tier commoner on the way
 * out and the bigger animals rarer ([[INVARIANTS]] § Encounters).
 *
 * The table where the player stands (`encounterTableAt`) is the biome's,
 * weighed again by how much of the ground each species favours lies around
 * (`habitat.ts`): the frogs by the water, the rabbits in the open. Near spawn
 * the ground only chooses among the animals of each tier, so every tier keeps
 * the share the biome's table gives it and the start is exactly as gentle as
 * the bell makes it; further out it also moves the tiers, fully from the wild
 * radius. It lists the same species, so the ground never changes whether a
 * step can start a battle or who could come out, only who is likely to.
 * [[PRODUCT]] §4 "Wild encounters" states the numbers in prose; they must
 * agree with the constants here and in `habitat.ts`.
 *
 * Every draw comes from the caller's `Rng`, so a walk replays exactly from
 * (seed, intents). The rng is only touched when the tile can hold an encounter
 * and something of its realm lives in the biome.
 */

/** Chance that a step landing on tall grass starts a battle: one encounter per ten grass steps. */
export const ENCOUNTER_CHANCE = 0.1;

/** Up to this many tiles from spawn the bigger animals are at their rarest. */
export const SAFE_RADIUS = 32;

/** From this many tiles out, the bell is symmetric: a tier above the lead weighs what one as far below does. */
export const WILD_RADIUS = 128;

/**
 * The bell's width, in tiers: a tier `k` tiers from the lead's weighs
 * `e^(−k²/2σ²)` next to the lead's own, below the lead at any distance and
 * above it from the wild radius out. With σ = 1: one tier away 0.61, two
 * 0.14, three 0.011, four 0.0003.
 */
export const TIER_SIGMA = 1;

/**
 * Inside the safe radius, what a tier one above the lead weighs next to the
 * lead's own; `k` tiers above weigh it to the power `k²`, the bell's upper
 * side pulled in (σ ≈ 0.48). With only the lead's tier and the one above
 * living in a biome, one encounter in ten near home is the bigger animal.
 */
export const NEAR_ONE_UP = 1 / 9;

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
 * The bell: what a tier `above` tiers above the lead (negative: below it)
 * weighs next to the lead's own tier, `distance` tiles from spawn. Below the
 * lead, and above it from the wild radius out, `e^(−k²/2σ²)`; above it inside
 * the safe radius, `NEAR_ONE_UP^(k²)`; in between, the logarithm of the weight
 * moves in a straight line with `danger` from the one to the other, so every
 * tier above the lead gains with every step out, the further above the
 * faster, and never falls back.
 */
function tierWeight(above: number, distance: number): number {
	const far = -(above * above) / (2 * TIER_SIGMA * TIER_SIGMA);
	if (above <= 0) return Math.exp(far);
	const near = above * above * Math.log(NEAR_ONE_UP);
	const g = danger(distance);
	return Math.exp((1 - g) * near + g * far);
}

/**
 * Where visitors come near spawn: the water and the hills, which animals of
 * the lead's size that don't live there come down to and up to (the small
 * animals of the meadow and the forest to the river, and those of the river
 * too to the mountains). Not a property of the catalog: the river and the
 * mountains have small animals of their own (the frogs, brown rats and toads,
 * the lizards); near home the visitors make the lead's size commoner there,
 * and give it a home where none of it lives (a red deer in the mountains).
 */
const VISITED_BIOMES: readonly Biome[] = ['river', 'mountain'];

/**
 * What the visitors of the lead's tier add to it inside the safe radius, in
 * bells of that tier, on top of its residents' one: three, so that by the
 * river's reeds the river's own small animals are a quarter of the small
 * animals near home, as when every one of them weighed the same, and a new
 * starter's battles there are no harder than they were. Any fixed number keeps
 * the distance rule's proof; one that grew with the visitors' count would not
 * keep a tier's weight free of how many kinds it has.
 */
export const VISITORS_WEIGHT = 3;

/**
 * How the lead's tier shares its weight near home where visitors come, in
 * bells of the tier: `guest`, what each visitor weighs, and `spare`, what the
 * residents of its size weigh together on top of their own bell.
 *
 * The visitors share `VISITORS_WEIGHT` evenly, unless that would make each of
 * them weigh more than an animal of its size living there: then the
 * residents and the visitors share the tier's `1 + VISITORS_WEIGHT` bells
 * evenly, and the residents keep what the visitors do not take. So the tier
 * weighs the same either way, however many kinds come and live there, and no
 * visitor ever weighs more than a resident of its size: a lone visitor beside
 * several residents (the sea eagle in the mountains, beside four tier-4
 * animals living there, #136) weighs what each of them does, where the three
 * bells alone would make it twelve times as common as each. The two ways
 * agree where they meet (three visitors for every resident, as at the river's
 * reeds for a starter), so a new kind never makes the weights jump.
 */
function visitorShares(hosts: number, guests: number): { guest: number; spare: number } {
	if (guests === 0) return { guest: 0, spare: 0 };
	const guest = Math.min(VISITORS_WEIGHT / guests, (1 + VISITORS_WEIGHT) / (hosts + guests));
	return { guest, spare: Math.max(0, VISITORS_WEIGHT - guests * guest) };
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
 * other species lives in the sea. Every resident (a species whose habitats
 * include the biome) is listed, whatever its tier, and weighs its tier's bell
 * (`tierWeight` of its distance from the lead's tier) divided by how many
 * animals of its tier live there: a tier's residents together weigh its bell,
 * however many kinds they are. In a visited biome (the river, the mountains)
 * where a resident is bigger than the lead, every species of the lead's tier
 * that doesn't live there is listed too, as a visitor; together they add
 * `VISITORS_WEIGHT` bells to the lead's tier near home, however many kinds
 * they are, shared as `visitorShares` says, and that weight thins out by
 * `1 − danger` to none at the wild radius: near home the lead's size is four
 * times as common there as the bell alone would make it. The weights are then
 * normalised, so a tier the biome doesn't hold never comes out there and the
 * others share its place. Empty only where nothing of the realm lives in the
 * biome.
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
	// What is left of the visitors' weight here: all of it near home, none from the wild radius.
	const near =
		VISITED_BIOMES.includes(biome) && residents.some((a) => a.tier > leadTier)
			? 1 - danger(distance)
			: 0;
	// The animals of a tier living here split its bell evenly; the visitors, and the residents
	// of the lead's size beside them, share what `visitorShares` gives them on top.
	const living = new Map<Tier, number>();
	for (const a of residents) living.set(a.tier, (living.get(a.tier) ?? 0) + 1);
	const isGuest = (a: AnimalSpec) =>
		near > 0 && lives(a) && a.tier === leadTier && !a.habitats.includes(biome);
	const { guest, spare } = visitorShares(
		living.get(leadTier) ?? 0,
		ANIMALS.filter(isGuest).length
	);
	const raw = ANIMALS.flatMap((species) => {
		const bell = tierWeight(species.tier - leadTier, distance);
		if (lives(species) && species.habitats.includes(biome)) {
			const extra = species.tier === leadTier ? spare * near : 0;
			return [{ species, weight: (bell * (1 + extra)) / living.get(species.tier)! }];
		}
		if (isGuest(species)) return [{ species, weight: bell * guest * near }];
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
 * wherever anything of the tile's realm lives in its biome; where nothing
 * does, the roll is `null` without a draw. On a hit, the animal is picked from
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
