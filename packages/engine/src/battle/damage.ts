import type { AnimalSpec, AttackLevel } from '../animals/types.js';

/** Damage multiplier per level (index = level - 1). Level 3 is a big hit. */
const LEVEL_MULTIPLIER = [1, 1.6, 2.4] as const;

/**
 * Damage dealt by `spec`'s attack `attackIndex` (1-based) at `level`, given
 * that the puzzle was solved. A wrong answer deals 0 — the attack misses.
 */
export function attackDamage(
	spec: AnimalSpec,
	attackIndex: number,
	level: AttackLevel,
	solved: boolean
): number {
	if (!solved) return 0;
	const attack = spec.attacks[attackIndex - 1];
	if (!attack) throw new Error(`${spec.id} has no attack ${attackIndex}`);
	return Math.round(attack.power * (LEVEL_MULTIPLIER[level - 1] as number));
}
