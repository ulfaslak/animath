import type { Rng } from '../../rng.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';

/**
 * Operand bands per difficulty (index = difficulty − 1). Every operand is
 * drawn from a closed band `[lo, hi]`, so each difficulty has a floor as well
 * as a ceiling: a difficulty-3 attack can never ask "4 + 1" (#7). Both ends of
 * every band are non-decreasing in difficulty; `puzzles.test.ts` pins what a
 * kid sees because of it (the smallest and the largest number in a prompt
 * never fall), so a retuned band that breaks the ladder fails the suite.
 * [[PRODUCT]] §4 "Puzzles" states the same tables in prose.
 */
export type Band = readonly [lo: number, hi: number];

/**
 * add / sub / missing: both numbers the kid combines come from the same band.
 * Sums at difficulty d therefore start above every sum at d − 1.
 */
export const ADD_BAND: readonly Band[] = [
	[1, 5], //      1: within 10
	[6, 10], //     2: crossing 10
	[11, 20], //    3: teens
	[21, 50], //    4: two-digit
	[51, 100], //   5: up to 200
	[101, 200], //  6: three-digit
	[201, 500],
	[501, 1000],
	[1001, 5000],
	[5001, 10000]
];

/**
 * mul / div / missing-×: a big factor times a small one. The small factor is
 * the times table (2–9 at first), the big one is what grows past it. Ten is
 * never a factor: "10 × 7" is a freebie, not a difficulty-3 or -4 question.
 * Difficulty 1 is below `mul.minDifficulty`; its row keeps the tables aligned.
 */
export const MUL_BIG_BAND: readonly Band[] = [
	[2, 5], //      (1: unused)
	[2, 5], //      2: small tables
	[6, 9], //      3: tables 6–9 by 2–5
	[6, 9], //      4: tables 6–9 by 6–9
	[11, 20], //    5: teens by a digit
	[21, 50], //    6: two-digit by a digit
	[21, 50], //    7: two-digit by teens
	[51, 100], //   8
	[51, 100], //   9: two-digit by two-digit
	[101, 500] //   10: three-digit by two-digit
];
export const MUL_SMALL_BAND: readonly Band[] = [
	[2, 5],
	[2, 5],
	[2, 5],
	[6, 9], //      4–6
	[6, 9],
	[6, 9],
	[11, 20],
	[11, 20],
	[21, 50],
	[21, 50]
];

export function band(table: readonly Band[], difficulty: number): Band {
	return table[Math.min(Math.max(difficulty, 1), table.length) - 1] as Band;
}

function draw(rng: Rng, [lo, hi]: Band): number {
	return rng.int(lo, hi);
}

export const add: PuzzleGenerator = {
	kind: 'add',
	minDifficulty: 1,
	maxDifficulty: 10,
	generate(rng: Rng, difficulty: number): Puzzle {
		const b = band(ADD_BAND, difficulty);
		const x = draw(rng, b);
		const y = draw(rng, b);
		return { kind: 'add', difficulty, prompt: `${x} + ${y} = ?`, answer: x + y };
	}
};

/** The same fact family as `add`, read backwards: `(x + y) − x = y`. */
export const sub: PuzzleGenerator = {
	kind: 'sub',
	minDifficulty: 1,
	maxDifficulty: 10,
	generate(rng: Rng, difficulty: number): Puzzle {
		const b = band(ADD_BAND, difficulty);
		const x = draw(rng, b);
		const y = draw(rng, b);
		return { kind: 'sub', difficulty, prompt: `${x + y} − ${x} = ?`, answer: y };
	}
};

export const mul: PuzzleGenerator = {
	kind: 'mul',
	minDifficulty: 2,
	maxDifficulty: 10,
	generate(rng: Rng, difficulty: number): Puzzle {
		const big = draw(rng, band(MUL_BIG_BAND, difficulty));
		const small = draw(rng, band(MUL_SMALL_BAND, difficulty));
		return { kind: 'mul', difficulty, prompt: `${big} × ${small} = ?`, answer: big * small };
	}
};

/** The same fact family as `mul`, read backwards: `(big × small) ÷ small = big`. */
export const div: PuzzleGenerator = {
	kind: 'div',
	minDifficulty: 3,
	maxDifficulty: 10,
	generate(rng: Rng, difficulty: number): Puzzle {
		const big = draw(rng, band(MUL_BIG_BAND, difficulty));
		const small = draw(rng, band(MUL_SMALL_BAND, difficulty));
		return {
			kind: 'div',
			difficulty,
			prompt: `${big * small} ÷ ${small} = ?`,
			answer: big
		};
	}
};

/** "7 + ? = 12" / "4 × ? = 20": solve for the missing operand. */
export const missing: PuzzleGenerator = {
	kind: 'missing',
	minDifficulty: 1,
	maxDifficulty: 10,
	generate(rng: Rng, difficulty: number): Puzzle {
		if (difficulty <= 3 || rng.chance(0.5)) {
			const b = band(ADD_BAND, difficulty);
			const x = draw(rng, b);
			const answer = draw(rng, b);
			return {
				kind: 'missing',
				difficulty,
				prompt: `${x} + ? = ${x + answer}`,
				answer
			};
		}
		const small = draw(rng, band(MUL_SMALL_BAND, difficulty));
		const answer = draw(rng, band(MUL_BIG_BAND, difficulty));
		return {
			kind: 'missing',
			difficulty,
			prompt: `${small} × ? = ${small * answer}`,
			answer
		};
	}
};
