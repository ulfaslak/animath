import type { Rng } from '../../rng.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';
import { band, type Band } from './arithmetic.js';

/**
 * Root band per difficulty (index = difficulty − 1). Only difficulties ≥ 3
 * offer square roots; the first two rows are unused. Bands overlap so the
 * squares a kid has just learned keep coming back while the next few arrive,
 * but both ends climb: √4 is never asked at difficulty 10 (#7).
 */
const ROOT_BAND: readonly Band[] = [
	[2, 5], //     (1: unused)
	[2, 5], //     (2: unused)
	[2, 5], //     3: squares to 25
	[4, 8], //     4
	[6, 10], //    5: squares to 100
	[9, 12], //    6
	[11, 15], //   7
	[13, 20], //   8: squares to 400
	[16, 30], //   9
	[21, 50] //    10
];

/** "√144 = ?" — always a perfect square, always a whole answer. */
export const sqrt: PuzzleGenerator = {
	kind: 'sqrt',
	minDifficulty: 3,
	maxDifficulty: 10,
	generate(rng: Rng, difficulty: number): Puzzle {
		const [lo, hi] = band(ROOT_BAND, difficulty);
		const root = rng.int(lo, hi);
		return { kind: 'sqrt', difficulty, prompt: `√${root * root} = ?`, answer: root };
	}
};
