import { FIRST_WORLD, LAST_WORLD, WORLD_ONE_SEED, isWorldNumber, worldSeed } from '../world/numbers.js';

/**
 * The lands' names and seeds ([[PRODUCT]] §4 "Lands", #191): a leaf module,
 * so the world's own modules can tell which land a seed is (`landOfSeed`)
 * without reading the registry of what each land holds (`lands.ts`).
 *
 * A land is a content pack laid over a world number: every world number has
 * every land, and a land's world is a pure function of its seed, as every
 * world is (`generateChunk(seed, cx, cy)`).
 */

/** A land, by id. Nordland is today's; more follow, each added to `LAND_IDS` and `LANDS`. */
export type LandId = 'nordland' | 'arctic';

/**
 * Every land, in the order they unlock (`order` in `LANDS`): Nordland first,
 * then The Arctic. A land's place here is its place in the seeds too
 * (`landSeed`), so a land is only ever added at the end.
 */
export const LAND_IDS: readonly LandId[] = ['nordland', 'arctic'];

/** The land every game starts in, open to everyone: Nordland. */
export const FIRST_LAND: LandId = 'nordland';

/** Whether `v` is a land this build has. */
export function isLandId(v: unknown): v is LandId {
	return typeof v === 'string' && (LAND_IDS as readonly string[]).includes(v);
}

/**
 * How many seeds each land's worlds take, one after the other from World 1's
 * seed: room for every world number, so no two lands ever share a seed and a
 * seed says which land it is (`landOfSeed`).
 */
export const SEEDS_PER_LAND = 10_000;

/**
 * The generator seed of world `world` in land `land`. Nordland's is exactly
 * `worldSeed(world)`, so every game saved before lands, World 1 included, is
 * in the world it was in, tile for tile. Every later land's worlds are the
 * next `SEEDS_PER_LAND` seeds after the land before it: The Arctic's world 1
 * is World 1's seed plus 10,000. Neighbouring seeds make unrelated worlds
 * (every seed goes through `hashInts`' avalanche before it shapes a tile), so
 * Arktis 42 has nothing to do with Nordland 42 but its number.
 */
export function landSeed(land: LandId, world: number): number {
	if (!isWorldNumber(world)) throw new Error(`landSeed: ${String(world)} is not a world number`);
	const order = LAND_IDS.indexOf(land);
	if (order < 0) throw new Error(`landSeed: ${String(land)} is not a land`);
	if (order === 0) return worldSeed(world);
	return (WORLD_ONE_SEED + order * SEEDS_PER_LAND + world - FIRST_WORLD) >>> 0;
}

/**
 * The land whose world `seed` makes: the land whose run of seeds holds it
 * (`landSeed`), and Nordland for any seed outside every land's run (a test's
 * random seed). What a land's generator is chosen by, so a chunk stays a pure
 * function of `(seed, cx, cy)`.
 */
export function landOfSeed(seed: number): LandId {
	const offset = (seed - WORLD_ONE_SEED) >>> 0;
	const order = Math.floor(offset / SEEDS_PER_LAND);
	const world = (offset % SEEDS_PER_LAND) + FIRST_WORLD;
	if (order >= LAND_IDS.length || world > LAST_WORLD) return FIRST_LAND;
	return LAND_IDS[order]!;
}
