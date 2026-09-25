import type { Rng } from '../../rng.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';
import { band, type Band } from './arithmetic.js';

type Family = 'arithmetic' | 'geometric' | 'squares' | 'triangular' | 'fibonacci';

// Which families are available at which difficulty. Lower difficulties stay on
// small-step counting; higher ones mix in multiplicative and quadratic growth.
function familiesFor(difficulty: number): Family[] {
	if (difficulty <= 2) return ['arithmetic'];
	if (difficulty <= 4) return ['arithmetic', 'geometric'];
	if (difficulty <= 6) return ['arithmetic', 'geometric', 'squares'];
	return ['arithmetic', 'geometric', 'squares', 'triangular', 'fibonacci'];
}

const SHOWN = 4; // terms shown before the "?"

/**
 * Counting sequences (index = difficulty − 1): the step and the first term
 * both come from bands. The step floor stops difficulty 10 from asking
 * "12, 13, 14, 15, ?" (#7); the first-term bands don't overlap at all, so no
 * two difficulties ever ask the same counting sequence ("0, 10, 20, 30, ?"
 * used to be possible at every difficulty from 4 to 10).
 */
const STEP_BAND: readonly Band[] = [
	[1, 2],
	[2, 5],
	[3, 8],
	[4, 10],
	[5, 12],
	[6, 14],
	[7, 16],
	[8, 18],
	[9, 20],
	[10, 25]
];
const COUNTING_START: readonly Band[] = [
	[0, 5],
	[6, 10],
	[11, 15],
	[16, 20],
	[21, 25],
	[26, 30],
	[31, 35],
	[36, 40],
	[41, 45],
	[46, 50]
];

/**
 * Where the other patterns start (index = difficulty − 1; rows below the
 * difficulty that introduces a pattern are unused). Both ends climb, and each
 * floor sits above the ceiling two difficulties down, so a pattern never asks
 * at difficulty d what it asks at d − 2 or below: the textbook opening —
 * "1, 2, 4, 8", "1, 4, 9, 16", "1, 3, 6, 10" — stays near the difficulty that
 * introduces it, and the bear's hardest attack never asks what the rabbit
 * asks (#7).
 */
const GEOMETRIC_START: readonly Band[] = [
	[1, 4], //  (1–2: unused)
	[1, 4],
	[1, 4], //  3: doubling from 1–4
	[2, 5],
	[5, 8],
	[6, 9], //  6: ×3 joins
	[9, 12],
	[10, 14],
	[13, 20],
	[15, 25]
];
/** The first number squared. */
const SQUARES_START: readonly Band[] = [
	[1, 2], //  (1–4: unused)
	[1, 2],
	[1, 2],
	[1, 2],
	[1, 2], //  5: 1, 4, 9, 16 or 4, 9, 16, 25
	[1, 3],
	[3, 5],
	[4, 7],
	[6, 9],
	[8, 12] // 10: from 64, 81, 100, 121 up to 144, 169, 196, 225
];
/** Which triangle number comes first (1 → 1, 3, 6, 10). */
const TRIANGULAR_START: readonly Band[] = [
	[1, 3], //  (1–6: unused)
	[1, 3],
	[1, 3],
	[1, 3],
	[1, 3],
	[1, 3],
	[1, 3], //  7: 1, 3, 6, 10
	[2, 5],
	[4, 7],
	[6, 10]
];
/** The first term of an add-the-last-two sequence. */
const FIBONACCI_START: readonly Band[] = [
	[1, 3], //  (1–6: unused)
	[1, 3],
	[1, 3],
	[1, 3],
	[1, 3],
	[1, 3],
	[1, 3], //  7: 1, 2, 3, 5 · 1, 3, 4, 7 · 2, 4, 6, 10 · 3, 4, 7, 11 · 3, 5, 8, 13
	[2, 5],
	[4, 7],
	[6, 10]
];

function draw(rng: Rng, table: readonly Band[], difficulty: number): number {
	const [lo, hi] = band(table, difficulty);
	return rng.int(lo, hi);
}

function terms(family: Family, rng: Rng, difficulty: number): number[] {
	const out: number[] = [];
	switch (family) {
		case 'arithmetic': {
			const step = draw(rng, STEP_BAND, difficulty);
			const start = draw(rng, COUNTING_START, difficulty);
			for (let i = 0; i <= SHOWN; i++) out.push(start + i * step);
			return out;
		}
		case 'geometric': {
			const ratio = difficulty <= 5 ? 2 : rng.int(2, 3);
			const start = draw(rng, GEOMETRIC_START, difficulty);
			for (let i = 0; i <= SHOWN; i++) out.push(start * ratio ** i);
			return out;
		}
		case 'squares': {
			const start = draw(rng, SQUARES_START, difficulty);
			for (let i = 0; i <= SHOWN; i++) out.push((start + i) ** 2);
			return out;
		}
		case 'triangular': {
			const start = draw(rng, TRIANGULAR_START, difficulty);
			for (let i = 0; i <= SHOWN; i++) {
				const n = start + i;
				out.push((n * (n + 1)) / 2);
			}
			return out;
		}
		case 'fibonacci': {
			let a = draw(rng, FIBONACCI_START, difficulty);
			// a, b, a + b, a + 2b has gaps b − a, a, b, and a prompt must have one
			// right answer. b = a ("4, 4, 8, 12") ends in a counting run a kid
			// reads as 16, not 20; 2b = 3a ("2, 3, 5, 8": gaps 1, 2, 3) has gaps
			// that grow by one, which answers 12, not 13. Skip both.
			const gaps = [1, 2].filter((k) => 2 * (a + k) !== 3 * a);
			let b = a + rng.pick(gaps);
			for (let i = 0; i <= SHOWN; i++) {
				out.push(a);
				[a, b] = [b, a + b];
			}
			return out;
		}
	}
}

/** "2, 4, 8, 16, ?" — name the next number. */
export const sequence: PuzzleGenerator = {
	kind: 'sequence',
	minDifficulty: 1,
	maxDifficulty: 10,
	generate(rng: Rng, difficulty: number): Puzzle {
		const family = rng.pick(familiesFor(difficulty));
		const seq = terms(family, rng, difficulty);
		const answer = seq[SHOWN] as number;
		return {
			kind: 'sequence',
			difficulty,
			prompt: `${seq.slice(0, SHOWN).join(', ')}, ?`,
			answer
		};
	}
};
