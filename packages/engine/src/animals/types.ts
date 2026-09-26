import type { PuzzleKind } from '../puzzles/types.js';

/** 1 = squirrel-easy, 5 = bear-hard. Drives HP, catch rate and puzzle difficulty. */
export type Tier = 1 | 2 | 3 | 4 | 5;

export const ATTACK_LEVELS = [1, 2, 3] as const;
export type AttackLevel = (typeof ATTACK_LEVELS)[number];

/** An attack. Its name, in every language, is in the client's copy files under its id. */
export interface AttackSpec {
	/** Unique within its species; the copy key `species.<species id>.attacks.<id>`. */
	id: string;
	/** Puzzle kinds this attack can ask. The engine picks one that fits the difficulty. */
	kinds: readonly PuzzleKind[];
	/** Base damage at level 1. Must increase with attack index within a species. */
	power: number;
}

/** A species. Its names (and "a …", "the wild …") are in the client's copy files under its id. */
export interface AnimalSpec {
	id: string;
	tier: Tier;
	maxHp: number;
	/** Probability multiplier for leash success, 0..1. Lower = harder to catch. */
	catchRate: number;
	/** 1 to 4 attacks, ordered weakest to strongest. */
	attacks: readonly AttackSpec[];
	/** Biomes where this species spawns in the wild. */
	habitats: readonly Biome[];
	/**
	 * Where it can go, and so where it can fight and be met: `['land']` for
	 * most, `['land', 'water']` for an amphibious animal (the frog, the
	 * otter), `['water']` for a sea animal that lives out on the water only.
	 * An animal fights only where the player stands in one of its realms
	 * (`canFightIn`): out on the water, in the boat, only the ones that swim.
	 */
	realms: readonly Realm[];
	/**
	 * The ground it favours around the tall grass it comes out of: the more of
	 * it nearby, the more often it comes out ([[PRODUCT]] §4 "Wild encounters",
	 * `world/habitat.ts`).
	 */
	favours: Terrain;
}

/**
 * Where a species lives in the wild: the meadow, the forest, the river banks,
 * the mountains, or the sea, which is the deep water out in the middle of the
 * lakes (`deepwater` tiles), reached only by boat.
 */
export type Biome = 'meadow' | 'forest' | 'river' | 'mountain' | 'sea';

/**
 * Land or water: where the player stands (`tileRealm`: water tiles, reached
 * by boat, are water; every other tile is land), where an animal can go and
 * fight (`AnimalSpec.realms`), and where an encounter happens
 * (`encounterRealm`: on land in the tall grass and the river's reeds).
 */
export type Realm = 'land' | 'water';


/** Every realm, land first. */
export const REALMS: readonly Realm[] = ['land', 'water'];

/**
 * A kind of ground around an encounter tile that a species can favour:
 * water, trees, rocks (the mountains' boulders and peaks), or open ground
 * with none of those three nearby.
 */
export type Terrain = 'water' | 'trees' | 'rocks' | 'open';

/** Every terrain, in the order the rules name them. */
export const TERRAINS: readonly Terrain[] = ['water', 'trees', 'rocks', 'open'];

/** An animal the player owns (or a wild one in a battle). */
export interface AnimalInstance {
	/** Unique per instance (uuid on the server; any unique string locally). */
	id: string;
	speciesId: string;
	nickname?: string;
	hp: number;
}
