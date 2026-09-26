import type { AnimalSpec, Terrain } from '../animals/types.js';
import { tileAtWorld } from './generate.js';
import type { GridPos, TileKind } from './types.js';

/**
 * Habitat: the ground around a tall-grass tile decides which of the animals
 * that may come out there is likely to.
 *
 * `surroundings` counts the water, trees and rocks among the tiles within
 * `HABITAT_RADIUS` of the tile; everything else there (grass, tall grass,
 * reeds, sand, a tent) is open ground. Every species favours one terrain
 * (`AnimalSpec.favours`), and `habitatFactor` is how many times as often it
 * comes out here as where none of that terrain is near: 1 with none of it, up
 * to `HABITAT_BOOST` with plenty. The encounter table multiplies each
 * species' biome × tier weight by it (`encounterTableAt` in `encounters.ts`),
 * so the ground changes which animal comes out, never whether one does, nor
 * which ones could. [[PRODUCT]] §4 "Wild encounters" states the rule in prose;
 * it must agree with the constants below.
 *
 * A terrain's share of the surroundings runs from 0 to 1. Water, trees and
 * rocks each count fully from `HABITAT_FULL` tiles of them. Open ground counts
 * fully when none of the three is near, and not at all once they make
 * `HABITAT_FULL` tiles together. A species comes out `HABITAT_BOOST ^ share`
 * times as often: twice with half as much of its terrain, four times with
 * plenty.
 *
 * Adding a terrain (the boat's deep water, say) is a `Terrain` value, a case
 * in `coverOf`, a count in `Surroundings` and a share in `terrainShares`; the
 * compiler finds the last two.
 */

/** How far around the encounter tile the ground is read, in tiles, as the crow flies. */
export const HABITAT_RADIUS = 3;

/** Water, trees or rocks count fully from this many of the tiles within the radius. */
export const HABITAT_FULL = 7;

/** With plenty of its favourite terrain near, a species comes out this many times as often as with none. */
export const HABITAT_BOOST = 4;

/** How many of the tiles within `HABITAT_RADIUS` of a tile, not counting the tile itself, are water, trees and rocks. */
export interface Surroundings {
	water: number;
	trees: number;
	rocks: number;
}

/** The offsets within the radius, the tile itself left out. */
const AROUND: readonly (readonly [number, number])[] = (() => {
	const out: [number, number][] = [];
	const r = HABITAT_RADIUS;
	for (let dy = -r; dy <= r; dy++) {
		for (let dx = -r; dx <= r; dx++) {
			if ((dx !== 0 || dy !== 0) && dx * dx + dy * dy <= r * r) out.push([dx, dy]);
		}
	}
	return out;
})();

/** How many tiles `surroundings` reads: 28. */
export const HABITAT_TILES = AROUND.length;

/** What a tile of this kind counts as around an encounter; null is open ground. */
function coverOf(kind: TileKind): keyof Surroundings | null {
	switch (kind) {
		case 'water':
			return 'water';
		case 'tree':
			return 'trees';
		case 'rock':
			return 'rocks';
		default:
			return null;
	}
}

/**
 * What lies around `pos` in the world of `seed`. Like the world itself, a pure
 * function of its arguments: any authority with the seed counts the same.
 */
export function surroundings(seed: number, pos: GridPos): Surroundings {
	const around: Surroundings = { water: 0, trees: 0, rocks: 0 };
	for (const [dx, dy] of AROUND) {
		const cover = coverOf(tileAtWorld(seed, pos.x + dx, pos.y + dy).kind);
		if (cover !== null) around[cover] += 1;
	}
	return around;
}

const isCount = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/**
 * How much of each terrain is around, from 0 (none near) to 1 (plenty). Throws
 * on surroundings that are not counts, rather than guessing a table.
 */
export function terrainShares(around: Surroundings): Record<Terrain, number> {
	if (
		typeof around !== 'object' ||
		around === null ||
		!isCount(around.water) ||
		!isCount(around.trees) ||
		!isCount(around.rocks)
	) {
		throw new Error(`terrainShares: surroundings ${JSON.stringify(around)} are not tile counts`);
	}
	const full = (n: number) => Math.min(1, n / HABITAT_FULL);
	return {
		water: full(around.water),
		trees: full(around.trees),
		rocks: full(around.rocks),
		open: 1 - full(around.water + around.trees + around.rocks)
	};
}

/** The factor for a terrain share: `HABITAT_BOOST ^ share`, from 1 to `HABITAT_BOOST`. */
export function factorForShare(share: number): number {
	return Math.pow(HABITAT_BOOST, share);
}

/**
 * How many times as often `species` comes out where the ground is `around`
 * as where none of the terrain it favours is near: 1 to `HABITAT_BOOST`.
 */
export function habitatFactor(species: AnimalSpec, around: Surroundings): number {
	return factorForShare(terrainShares(around)[species.favours]);
}
