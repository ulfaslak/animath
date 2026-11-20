import type { Rng } from '../../rng.js';
import { FRACTION_PIECES as PIECES, facePrompt } from '../face.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';
import type { Band } from './arithmetic.js';

/**
 * One step of the fraction ladder ([[PRODUCT]] §4 "Puzzles"): the pieces a
 * whole is cut into (`pieces`, the denominator), whether the fraction is one
 * piece (`unit`, ½ ⅓ ¼) or several (⅗), and how big one piece of the amount
 * is (`share`), so the amount is `pieces × share` and the answer always whole.
 * `halving`: only the pieces a kid gets by halving, halves and quarters.
 */
export interface FractionStep {
	pieces: Band;
	unit: boolean;
	share: Band;
	halving?: true;
}

/**
 * Index = difficulty − 1. One piece of a half first (1–2), then of halves
 * and quarters (3–4), of thirds to fifths (5), to sixths (6) and quarters to
 * tenths (7); then several pieces (difficulty 8 on), each band's ends never
 * falling within each.
 */
export const FRACTION_LADDER: readonly FractionStep[] = [
	{ pieces: [2, 2], unit: true, share: [2, 5], halving: true },
	{ pieces: [2, 2], unit: true, share: [3, 6], halving: true },
	{ pieces: [2, 4], unit: true, share: [3, 8], halving: true },
	{ pieces: [2, 4], unit: true, share: [4, 10], halving: true },
	{ pieces: [3, 5], unit: true, share: [4, 10] },
	{ pieces: [3, 6], unit: true, share: [5, 10] },
	{ pieces: [4, 10], unit: true, share: [6, 10] },
	{ pieces: [3, 5], unit: false, share: [3, 9] },
	{ pieces: [3, 8], unit: false, share: [4, 10] },
	{ pieces: [4, 12], unit: false, share: [6, 12] }
];

/**
 * "½ of 8", later "⅗ of 35": a fraction of an amount, whose answer is always
 * whole. A fraction of several pieces is in its lowest terms (never ²⁄₄),
 * so it reads one way only; up to difficulty 4 it is a half or a quarter.
 */
export const fraction: PuzzleGenerator = {
	kind: 'fraction',
	minDifficulty: 1,
	maxDifficulty: 10,
	topics: () => ['fraction'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const step = FRACTION_LADDER[difficulty - 1]!;
		const d = rng.pick(
			PIECES.filter(
				(p) => p >= step.pieces[0] && p <= step.pieces[1] && (!step.halving || p === 2 || p === 4)
			)
		);
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
