import type { Rng } from '../../rng.js';
import { facePrompt } from '../face.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';
import type { Band } from './arithmetic.js';

/**
 * One step of the fraction ladder ([[PRODUCT]] §4 "Puzzles"): the pieces a
 * whole is cut into (`pieces`, the denominator), whether the fraction is one
 * piece (`unit`, ½ ⅓ ¼) or several (⅗), and how big one piece of the amount
 * is (`share`), so the amount is `pieces × share` and the answer always whole.
 */
export interface FractionStep {
	pieces: Band;
	unit: boolean;
	share: Band;
}

/**
 * Index = difficulty − 1. One piece of halves and quarters first, then of
 * anything up to tenths; then several pieces (difficulty 5 on), each band's
 * ends never falling within each half.
 */
export const FRACTION_LADDER: readonly FractionStep[] = [
	{ pieces: [2, 2], unit: true, share: [2, 5] },
	{ pieces: [2, 4], unit: true, share: [3, 6] },
	{ pieces: [3, 5], unit: true, share: [3, 8] },
	{ pieces: [3, 10], unit: true, share: [4, 10] },
	{ pieces: [3, 5], unit: false, share: [2, 6] },
	{ pieces: [3, 8], unit: false, share: [3, 9] },
	{ pieces: [4, 10], unit: false, share: [4, 10] },
	{ pieces: [5, 12], unit: false, share: [6, 12] },
	{ pieces: [6, 12], unit: false, share: [8, 15] },
	{ pieces: [7, 12], unit: false, share: [11, 25] }
];

/**
 * The pieces a whole is cut into: the ones a kid meets at school, never
 * sevenths, ninths or elevenths.
 */
export const PIECES: readonly number[] = [2, 3, 4, 5, 6, 8, 10, 12];

/**
 * "½ of 8", later "⅗ of 35": a fraction of an amount, whose answer is always
 * whole. A fraction of several pieces is in its lowest terms (never ²⁄₄),
 * so it reads one way only; halves and quarters at difficulty 2 never go
 * past a unit fraction.
 */
export const fraction: PuzzleGenerator = {
	kind: 'fraction',
	minDifficulty: 1,
	maxDifficulty: 10,
	topics: () => ['fraction'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const step = FRACTION_LADDER[difficulty - 1]!;
		const d =
			step.unit && difficulty === 2
				? rng.pick([2, 4])
				: rng.pick(PIECES.filter((p) => p >= step.pieces[0] && p <= step.pieces[1]));
		const n = step.unit ? 1 : rng.pick(coprimeBelow(d));
		const share = rng.int(...step.share);
		return {
			kind: 'fraction',
			difficulty,
			prompt: facePrompt({ kind: 'fraction', numbers: [n, d, d * share] }),
			answer: n * share
		};
	}
};

/** Every numerator from 2 to d − 1 that makes a fraction in its lowest terms with d. */
function coprimeBelow(d: number): number[] {
	const out: number[] = [];
	for (let n = 2; n < d; n++) if (gcd(n, d) === 1) out.push(n);
	return out;
}

function gcd(a: number, b: number): number {
	return b === 0 ? a : gcd(b, a % b);
}
