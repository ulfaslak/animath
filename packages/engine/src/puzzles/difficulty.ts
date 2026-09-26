import { ATTACK_LEVELS } from '../animals/types.js';
import { clampDifficulty } from './registry.js';
import { MAX_DIFFICULTY } from './types.js';

/**
 * Maps where an attack sits — the animal's tier, the attack's index n (1-based)
 * and the chosen level (1..3) — to a puzzle difficulty. Fiercer animals ask
 * harder questions; within an animal a later attack asks the same or harder
 * (the bear's last three share one ladder under the cap below), and each
 * higher level asks exactly one more. This is the single knob that ties "how
 * strong" to "how hard".
 */
const TIER_BASE = [1, 2, 4, 5, 7] as const; // index = tier - 1
const PER_ATTACK = 0.75;
const PER_LEVEL = 1;

/**
 * The hardest an attack's easy level may ask: low enough that every level
 * above it still has a step of its own to climb before the top. Without it
 * the top folded levels together: a bear's Maul and Crush asked 10 on medium
 * and on hard alike, so medium was the same sum for less damage (#32).
 */
const TOP_EASY_DIFFICULTY = MAX_DIFFICULTY - (ATTACK_LEVELS.length - 1) * PER_LEVEL;

/**
 * An attack's easy level asks `base[tier] + 0.75·(n − 1)`, rounded and at most
 * `TOP_EASY_DIFFICULTY`; each level up asks exactly one more. So every level
 * of an attack is harder than the one below it, all the way to the top.
 */
export function puzzleDifficulty(tier: number, attackIndex: number, level: number): number {
	const base = TIER_BASE[Math.min(Math.max(tier, 1), TIER_BASE.length) - 1] as number;
	const easy = Math.min(Math.round(base + (attackIndex - 1) * PER_ATTACK), TOP_EASY_DIFFICULTY);
	return clampDifficulty(easy + (level - 1) * PER_LEVEL);
}

/** Healing puzzles at the doctor: scale with the animal's tier only. */
export function healingDifficulty(tier: number): number {
	const base = TIER_BASE[Math.min(Math.max(tier, 1), TIER_BASE.length) - 1] as number;
	return clampDifficulty(base + 1);
}
