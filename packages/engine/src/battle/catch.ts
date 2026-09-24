/**
 * Chance that a leash throw succeeds.
 *
 * Geometric in HP: every `HALF_LIFE` of remaining HP fraction halves the
 * chance. At 0% HP the chance is the species' full `catchRate` (times the
 * leash quality); at 100% HP it is `catchRate × 2^-5 ≈ 3%` of it. So a
 * squirrel (0.9) at 10% HP is ~64%, a bear (0.2) at 10% HP is ~14%, and a
 * bear at half HP is ~3.5%.
 *
 * `leashQuality` is the hook for better ropes from the (future) shop: 1 is
 * the starter leash. The result is capped so a catch is never a certainty.
 */
const HALF_LIFE = 0.2;
const MAX_CHANCE = 0.95;

export function catchProbability(hpFraction: number, catchRate: number, leashQuality = 1): number {
	const hp = Math.min(1, Math.max(0, hpFraction));
	const p = catchRate * leashQuality * Math.pow(2, -hp / HALF_LIFE);
	return Math.min(MAX_CHANCE, Math.max(0, p));
}
