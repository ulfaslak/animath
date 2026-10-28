import type { Rng } from '../../rng.js';
import { facePrompt } from '../face.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';
import { band, type Band } from './arithmetic.js';

/**
 * Every pattern is one a kid finds by looking at the gaps between the
 * numbers: they are all the same (counting), each is twice the one before
 * (doubling), or each is one more (triangle numbers) or two more (squares)
 * than the one before. A sequence's difficulty is in its numbers, never in
 * knowing a trick: tripling and add-the-last-two, which no gap gives away,
 * were where kids who got their sums right 85–95% of the time got their
 * sequences right 26–54%.
 */
type Family = 'counting' | 'doubling' | 'triangular' | 'squares';

/**
 * The patterns other than counting at each difficulty. Up to 3 a sequence
 * only counts, so a tier-1 animal's hardest level asks a kid's first pattern
 * and no other; from 4 counting is half of them and the rest share the other
 * half.
 */
function othersFor(difficulty: number): Family[] {
	if (difficulty <= 3) return [];
	if (difficulty <= 5) return ['doubling'];
	if (difficulty <= 6) return ['doubling', 'triangular'];
	return ['doubling', 'triangular', 'squares'];
}

const COUNTING_SHARE = 0.5;

const SHOWN = 4; // terms shown before the "?"

/**
 * Counting sequences (index = difficulty − 1): the step and the first term
 * both come from bands. The step floor stops difficulty 10 from asking
 * "12, 13, 14, 15, ?" (#7); each first-term floor sits above the ceiling two
 * difficulties down, so no two difficulties that far apart ever ask the same
 * counting sequence ("0, 10, 20, 30, ?" used to be possible at every
 * difficulty from 4 to 10). From 6 the numbers climb the way the adding
 * ladder's do, a couple of rungs below it, since the kid does two sums (the
 * gap, then the next number), so a bear's counting is three-digit.
 */
const STEP_BAND: readonly Band[] = [
	[1, 2],
	[2, 5],
	[3, 8],
	[4, 10],
	[5, 12],
	[6, 15],
	[8, 20],
	[11, 30],
	[15, 45],
	[21, 60]
];
const COUNTING_START: readonly Band[] = [
	[0, 5],
	[6, 10],
	[11, 15],
	[16, 20],
	[21, 25],
	[26, 50],
	[51, 100],
	[101, 200],
	[201, 500],
	[501, 1000]
];

/**
 * Where the other patterns start (index = difficulty − 1; rows below the
 * difficulty that introduces a pattern are unused). Both ends climb, and each
 * floor sits above the ceiling two difficulties down, so a pattern never asks
 * at difficulty d what it asks at d − 2 or below: the textbook opening —
 * "1, 2, 4, 8", "1, 3, 6, 10", "1, 4, 9, 16" — stays near the difficulty that
 * introduces it, and the bear's hardest attack never asks what the rabbit
 * asks (#7).
 */
const DOUBLING_START: readonly Band[] = [
	[1, 4], //  (1–3: unused)
	[1, 4],
	[1, 4],
	[1, 4], //  4: 1, 2, 4, 8 up to 4, 8, 16, 32: the answer a sum of the 4's band
	[2, 5],
	[5, 8],
	[6, 9],
	[9, 12],
	[10, 14],
	[13, 20] // 10: up to 20, 40, 80, 160
];
/** Which triangle number comes first (1 → 1, 3, 6, 10: the gaps 2, 3, 4). */
const TRIANGULAR_START: readonly Band[] = [
	[1, 3], //  (1–5: unused)
	[1, 3],
	[1, 3],
	[1, 3],
	[1, 3],
	[1, 3], //  6: 1, 3, 6, 10 · 3, 6, 10, 15 · 6, 10, 15, 21
	[2, 5],
	[4, 7],
	[6, 9],
	[8, 12] // 10: up to 78, 91, 105, 120
];
/** The first number squared (1 → 1, 4, 9, 16: the gaps 3, 5, 7). */
const SQUARES_START: readonly Band[] = [
	[1, 3], //  (1–6: unused)
	[1, 3],
	[1, 3],
	[1, 3],
	[1, 3],
	[1, 3],
	[1, 3], //  7: 1, 4, 9, 16 · 4, 9, 16, 25 · 9, 16, 25, 36
	[2, 4],
	[4, 6],
	[5, 9] //  10: up to 81, 100, 121, 144
];

function draw(rng: Rng, table: readonly Band[], difficulty: number): number {
	const [lo, hi] = band(table, difficulty);
	return rng.int(lo, hi);
}

function terms(family: Family, rng: Rng, difficulty: number): number[] {
	const out: number[] = [];
	switch (family) {
		case 'counting': {
			const step = draw(rng, STEP_BAND, difficulty);
			const start = draw(rng, COUNTING_START, difficulty);
			for (let i = 0; i <= SHOWN; i++) out.push(start + i * step);
			return out;
		}
		case 'doubling': {
			const start = draw(rng, DOUBLING_START, difficulty);
			for (let i = 0; i <= SHOWN; i++) out.push(start * 2 ** i);
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
		case 'squares': {
			const start = draw(rng, SQUARES_START, difficulty);
			for (let i = 0; i <= SHOWN; i++) out.push((start + i) ** 2);
			return out;
		}
	}
}

/** "2, 4, 8, 16, ?" — name the next number. */
export const sequence: PuzzleGenerator = {
	kind: 'sequence',
	minDifficulty: 1,
	maxDifficulty: 10,
	topics: () => ['sequence'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const others = othersFor(difficulty);
		const family =
			others.length === 0 || rng.chance(COUNTING_SHARE) ? 'counting' : rng.pick(others);
		const seq = terms(family, rng, difficulty);
		const answer = seq[SHOWN] as number;
		return {
			kind: 'sequence',
			difficulty,
			prompt: facePrompt({ kind: 'sequence', numbers: seq.slice(0, SHOWN) }),
			answer
		};
	}
};
