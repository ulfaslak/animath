import {
	ATTACK_LEVELS,
	type AnimalInstance,
	type AnimalSpec,
	type AttackLevel
} from '../animals/types.js';
import { puzzleDifficulty } from '../puzzles/difficulty.js';
import { generatePuzzle } from '../puzzles/registry.js';
import type { Puzzle } from '../puzzles/types.js';
import type { Rng } from '../rng.js';
import { attackDamage } from './damage.js';

/**
 * One attack, as every fight plays it: a wild battle (`battle/reducer.ts`)
 * and a friendly match (`match/reducer.ts`). The formulas live in `damage.ts`
 * and `puzzles/`; this is the one place that strings them together, so a
 * match can never ask or hit differently from a wild battle.
 */

/** Why `spec` can't use attack `attackIndex` (1-based) at `level`, or null when it can. */
export function attackRefusal(
	spec: AnimalSpec,
	attackIndex: number,
	level: AttackLevel
): 'no-such-attack' | 'no-such-level' | null {
	if (!Number.isInteger(attackIndex) || !spec.attacks[attackIndex - 1]) return 'no-such-attack';
	if (!ATTACK_LEVELS.includes(level)) return 'no-such-level';
	return null;
}

/**
 * The puzzle `spec`'s attack `attackIndex` asks at `level`: at the difficulty
 * of the attacker's tier, attack and level (`puzzleDifficulty`), of a kind the
 * attack can ask. Draws from `rng` exactly as `generatePuzzle` does.
 */
export function attackPuzzle(
	rng: Rng,
	spec: AnimalSpec,
	attackIndex: number,
	level: AttackLevel
): Puzzle {
	const attack = spec.attacks[attackIndex - 1];
	if (!attack) throw new Error(`${spec.id} has no attack ${attackIndex}`);
	return generatePuzzle(rng, puzzleDifficulty(spec.tier, attackIndex, level), attack.kinds);
}

/**
 * A hit that lands: the damage `spec`'s attack `attackIndex` deals at `level`
 * (`attackDamage`, solved), and the target with its HP after it, never below 0.
 * The one function exported from `index.ts`: a screen that shows what a hit
 * would do before it is picked (the battle panel's damage preview, and a
 * target left at 0 HP as "That would tire it out!") calls it on the state it
 * shows, so the preview can never disagree with the hit.
 */
export function landHit(
	spec: AnimalSpec,
	attackIndex: number,
	level: AttackLevel,
	target: AnimalInstance
): { damage: number; target: AnimalInstance } {
	const damage = attackDamage(spec, attackIndex, level, true);
	return { damage, target: { ...target, hp: Math.max(0, target.hp - damage) } };
}
