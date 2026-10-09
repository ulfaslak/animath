import {
	ATTACK_LEVELS,
	type AnimalInstance,
	type AnimalSpec,
	type AttackLevel
} from '../animals/types.js';
import { puzzleDifficulty } from '../puzzles/difficulty.js';
import { bonusOf, type TopicBonus } from '../puzzles/record.js';
import { generatePuzzle, puzzleTopics } from '../puzzles/registry.js';
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
 * (`attackDamage`, solved, with the solved puzzle's topic's `bonus`), and the
 * target with its HP after it, never below 0. With `hitSpan`, the functions
 * of this file that `index.ts` re-exports: a screen that shows what a hit
 * would do (the battle panel's damage preview, the puzzle's reward, and a
 * target left at 0 HP as "That would tire it out!") calls them on the state
 * it shows, so the preview can never disagree with the hit.
 */
export function landHit(
	spec: AnimalSpec,
	attackIndex: number,
	level: AttackLevel,
	target: AnimalInstance,
	bonus = 1
): { damage: number; target: AnimalInstance } {
	const damage = attackDamage(spec, attackIndex, level, true, bonus);
	return { damage, target: { ...target, hp: Math.max(0, target.hp - damage) } };
}

/**
 * What a right answer to `spec`'s attack `attackIndex` at `level` can hit
 * for, before its puzzle is drawn: the softest and the hardest hit over
 * every topic its puzzle can be there (`puzzleTopics`), each with its
 * `bonus`. One number (`low` = `high`) when they all hit alike, as they
 * always do in a friendly match, which has no bonus.
 */
export function hitSpan(
	spec: AnimalSpec,
	attackIndex: number,
	level: AttackLevel,
	bonus?: TopicBonus
): { low: number; high: number } {
	const attack = spec.attacks[attackIndex - 1];
	if (!attack) throw new Error(`${spec.id} has no attack ${attackIndex}`);
	const difficulty = puzzleDifficulty(spec.tier, attackIndex, level);
	const hits = puzzleTopics(attack.kinds, difficulty).map((topic) =>
		attackDamage(spec, attackIndex, level, true, bonusOf(bonus, topic))
	);
	return { low: Math.min(...hits), high: Math.max(...hits) };
}
