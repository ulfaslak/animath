import { clampDifficulty } from './registry.js';

/**
 * Maps where an attack sits — the animal's tier, the attack's index n (1-based)
 * and the chosen level (1..3) — to a puzzle difficulty. Fiercer animals ask
 * harder questions; within an animal, later attacks and higher levels are
 * harder. This is the single knob that ties "how strong" to "how hard".
 */
const TIER_BASE = [1, 2, 4, 5, 7] as const; // index = tier - 1
const PER_ATTACK = 0.75;
const PER_LEVEL = 1;

export function puzzleDifficulty(tier: number, attackIndex: number, level: number): number {
	const base = TIER_BASE[Math.min(Math.max(tier, 1), TIER_BASE.length) - 1] as number;
	return clampDifficulty(base + (attackIndex - 1) * PER_ATTACK + (level - 1) * PER_LEVEL);
}

/** Healing puzzles at the doctor: scale with the animal's tier only. */
export function healingDifficulty(tier: number): number {
	const base = TIER_BASE[Math.min(Math.max(tier, 1), TIER_BASE.length) - 1] as number;
	return clampDifficulty(base + 1);
}
