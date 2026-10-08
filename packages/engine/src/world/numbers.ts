import { hashString } from '../rng.js';

/**
 * World numbers ([[DECISIONS]] § Multiplayer): every world is a number from
 * `FIRST_WORLD` to `LAST_WORLD`. A leaf module, so the seeds of every land
 * (`lands/ids.ts`) and the rules of travel (`worlds.ts`) both read it without
 * reading each other.
 */

/** The lowest world number. */
export const FIRST_WORLD = 1;
/** The highest world number: four digits, so a kid can read it out and type it. */
export const LAST_WORLD = 9999;

/**
 * World 1's generator seed: the seed of the one world every game was played
 * in before worlds had numbers (`hashString('prototype')`, 821322741). Every
 * save from then is in World 1.
 */
export const WORLD_ONE_SEED = hashString('prototype');

/** Whether `n` is a world number: a whole number from `FIRST_WORLD` to `LAST_WORLD`. */
export function isWorldNumber(n: unknown): n is number {
	return Number.isSafeInteger(n) && (n as number) >= FIRST_WORLD && (n as number) <= LAST_WORLD;
}

/**
 * The generator seed of world `n` in the first land, Nordland: World 1's
 * seed, counted on by one for each world after it. Neighbouring seeds make
 * unrelated worlds (every seed goes through `hashInts`' avalanche before it
 * shapes a tile), and no two numbers share a seed. Another land's seed is
 * `landSeed`'s (`lands/ids.ts`), which is this one for Nordland.
 */
export function worldSeed(n: number): number {
	if (!isWorldNumber(n)) throw new Error(`worldSeed: ${String(n)} is not a world number`);
	return (WORLD_ONE_SEED + n - FIRST_WORLD) >>> 0;
}
