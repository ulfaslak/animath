import { describe, expect, it } from 'vitest';
import { ANIMALS, canRide } from '../src/animals/catalog.js';
import { ATTACK_LEVELS } from '../src/animals/types.js';
import { catchProbability } from '../src/battle/catch.js';
import { attackDamage } from '../src/battle/damage.js';

describe('animal catalog', () => {
	it('every species has 1–4 attacks with strictly increasing power, none below 1', () => {
		for (const a of ANIMALS) {
			expect(a.attacks.length).toBeGreaterThanOrEqual(1);
			expect(a.attacks.length).toBeLessThanOrEqual(4);
			// A wild animal that doesn't miss hits for its attack's power, so ≥ 1 is what makes every battle end.
			expect((a.attacks[0] as { power: number }).power, `${a.id}: attack 1`).toBeGreaterThanOrEqual(
				1
			);
			for (let i = 1; i < a.attacks.length; i++) {
				expect(
					(a.attacks[i] as { power: number }).power,
					`${a.id}: attack ${i + 1} must out-power attack ${i}`
				).toBeGreaterThan((a.attacks[i - 1] as { power: number }).power);
			}
			expect(a.catchRate).toBeGreaterThan(0);
			expect(a.catchRate).toBeLessThanOrEqual(1);
			expect(a.habitats.length).toBeGreaterThan(0);
		}
	});

	it('only a big land animal carries a kid, and only for a kid with the harness', () => {
		const carriers = ANIMALS.filter((a) => a.carries).map((a) => a.id);
		expect(carriers.sort()).toEqual(
			['bear', 'deer', 'european-bison', 'moose', 'wild-boar', 'wolf'].sort()
		);
		for (const a of ANIMALS) {
			if (a.carries) {
				expect(a.tier, a.id).toBeGreaterThanOrEqual(3);
				expect(a.realms, a.id).toContain('land');
			}
			expect(canRide({ items: ['harness'] }, a.id), a.id).toBe(a.carries === true);
			expect(canRide({ items: ['boat', 'glider'] }, a.id), a.id).toBe(false);
		}
	});

	it('ids are unique', () => {
		expect(new Set(ANIMALS.map((a) => a.id)).size).toBe(ANIMALS.length);
	});
});

describe('attackDamage', () => {
	it('grows with attack index and with level; attack N level 3 is the max, attack 1 level 1 the min', () => {
		for (const a of ANIMALS) {
			const grid = a.attacks.map((_, i) =>
				ATTACK_LEVELS.map((l) => attackDamage(a, i + 1, l, true))
			);
			for (let n = 0; n < grid.length; n++) {
				for (let l = 0; l < 3; l++) {
					const v = (grid[n] as number[])[l] as number;
					if (l < 2) expect((grid[n] as number[])[l + 1]).toBeGreaterThan(v);
					if (n < grid.length - 1) expect((grid[n + 1] as number[])[l]).toBeGreaterThan(v);
				}
			}
			const all = grid.flat();
			expect(Math.max(...all)).toBe((grid[grid.length - 1] as number[])[2]);
			expect(Math.min(...all)).toBe((grid[0] as number[])[0]);
		}
	});

	it('is zero when the puzzle was not solved', () => {
		const a = ANIMALS[0]!;
		expect(attackDamage(a, 1, 3, false)).toBe(0);
	});
});

describe('catchProbability', () => {
	it('is non-increasing in HP fraction', () => {
		for (const rate of [0.2, 0.5, 0.9]) {
			let prev = Infinity;
			for (let hp = 0; hp <= 1.0001; hp += 0.05) {
				const p = catchProbability(hp, rate);
				expect(p).toBeLessThanOrEqual(prev);
				prev = p;
			}
		}
	});

	it('halves every 20% of HP', () => {
		expect(catchProbability(0.2, 0.8)).toBeCloseTo(0.4, 6);
		expect(catchProbability(0.4, 0.8)).toBeCloseTo(0.2, 6);
	});

	it('stays in (0, 0.95] and rewards a better leash', () => {
		expect(catchProbability(0, 1, 5)).toBe(0.95);
		expect(catchProbability(1, 0.01)).toBeGreaterThan(0);
		expect(catchProbability(0.3, 0.5, 2)).toBeGreaterThan(catchProbability(0.3, 0.5, 1));
	});

	it('a squirrel is much easier than a bear at the same HP', () => {
		expect(catchProbability(0.1, 0.9)).toBeGreaterThan(3 * catchProbability(0.1, 0.2));
	});
});
