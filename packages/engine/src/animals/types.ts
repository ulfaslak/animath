import type { PuzzleKind } from '../puzzles/types.js';

/** 1 = squirrel-easy, 5 = bear-hard. Drives HP, catch rate and puzzle difficulty. */
export type Tier = 1 | 2 | 3 | 4 | 5;

/**
 * A party holds at most this many animals. The authority lets a catch beyond
 * it go back into the grass, and the server refuses a save with more.
 */
export const MAX_PARTY = 6;

export const ATTACK_LEVELS = [1, 2, 3] as const;
export type AttackLevel = (typeof ATTACK_LEVELS)[number];

export interface AttackSpec {
	id: string;
	name: string;
	/** Puzzle kinds this attack can ask. The engine picks one that fits the difficulty. */
	kinds: readonly PuzzleKind[];
	/** Base damage at level 1. Must increase with attack index within a species. */
	power: number;
}

export interface AnimalSpec {
	id: string;
	name: string;
	tier: Tier;
	maxHp: number;
	/** Probability multiplier for leash success, 0..1. Lower = harder to catch. */
	catchRate: number;
	/** 1 to 4 attacks, ordered weakest to strongest. */
	attacks: readonly AttackSpec[];
	/** Biomes where this species spawns in the wild. */
	habitats: readonly Biome[];
}

export type Biome = 'meadow' | 'forest' | 'river' | 'mountain';

/** An animal the player owns (or a wild one in a battle). */
export interface AnimalInstance {
	/** Unique per instance (uuid on the server; any unique string locally). */
	id: string;
	speciesId: string;
	nickname?: string;
	hp: number;
}
