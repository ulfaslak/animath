import type { AnimalSpec, AttackLevel } from '../animals/types.js';

/** Damage multiplier per level (index = level - 1). Level 3 is a big hit. */
const LEVEL_MULTIPLIER = [1, 1.6, 2.4] as const;

/**
 * Damage dealt by `spec`'s attack `attackIndex` (1-based) at `level`, given
 * that the puzzle was solved. A wrong answer deals 0 — the attack misses.
 * `bonus` is the solved puzzle's topic's (`topicBonus`, a wild battle's
 * alone): 1 lands the attack's own damage, and the hit is rounded once,
 * after it, never below 1.
 */
export function attackDamage(
	spec: AnimalSpec,
	attackIndex: number,
	level: AttackLevel,
	solved: boolean,
	bonus = 1
): number {
	if (!solved) return 0;
	const attack = spec.attacks[attackIndex - 1];
	if (!attack) throw new Error(`${spec.id} has no attack ${attackIndex}`);
	return Math.max(1, Math.round(attack.power * (LEVEL_MULTIPLIER[level - 1] as number) * bonus));
}
