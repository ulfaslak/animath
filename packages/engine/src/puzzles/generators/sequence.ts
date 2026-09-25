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
 * Step band for counting sequences (index = difficulty − 1). The floor is
 * what stops difficulty 10 from asking "12, 13, 14, 15, ?" (#7); the ceiling
 * keeps difficulty 1 at counting by ones and twos.
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

/**
 * Where the other patterns start (index = difficulty − 1; rows below the
 * difficulty that introduces a family are unused). The textbook opening —
 * "1, 2, 4, 8", "1, 4, 9, 16", "1, 3, 6, 10", "1, 1, 2, 3" — belongs to the
 * difficulty that introduces the pattern; later difficulties start further
 * along, so the bear's hardest attack never asks what the rabbit asks (#7).
 */
const GEOMETRIC_START: readonly Band[] = [
	[1, 5], //  (1–2: unused)
	[1, 5],
	[1, 5], //  3–4: doubling from 1–5
	[1, 5],
	[2, 6],
	[2, 6], //  6: ×3 joins
	[3, 8],
	[3, 8],
	[4, 10],
	[4, 10]
];
/** The first number squared. */
const SQUARES_START: readonly Band[] = [
	[1, 1], //  (1–4: unused)
	[1, 1],
	[1, 1],
	[1, 1],
	[1, 2], //  5: 1, 4, 9, 16 or 4, 9, 16, 25
	[1, 3],
	[2, 4],
	[3, 6],
	[4, 8],
	[5, 10] // 10: from 25, 36, 49, 64 up to 100, 121, 144, 169
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
	[3, 7],
	[4, 9]
];
/** The first term of an add-the-last-two sequence. */
const FIBONACCI_START: readonly Band[] = [
	[1, 3], //  (1–6: unused)
	[1, 3],
	[1, 3],
	[1, 3],
	[1, 3],
	[1, 3],
	[1, 3], //  7: 1, 1, 2, 3
	[2, 4],
	[3, 6],
	[4, 8]
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
			const start = rng.int(0, difficulty * 5);
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
			// a, b, a + b, a + 2b has gaps b − a, a, b. When 2b = 3a those gaps
			// grow by the same amount ("2, 3, 5, 8": gaps 1, 2, 3), so "the gaps
			// grow by one" answers 12 where adding the last two answers 13. A
			// prompt must have one right answer: skip the second gap that does it.
			const gaps = [0, 1, 2].filter((k) => 2 * (a + k) !== 3 * a);
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
