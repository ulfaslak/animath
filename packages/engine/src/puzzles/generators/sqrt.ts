import type { Rng } from '../../rng.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';

// Largest root asked at each difficulty (index = difficulty - 1). Only
// difficulties ≥ 3 offer square roots; the first two slots are unused.
const ROOT_MAX = [0, 0, 5, 10, 12, 15, 20, 25, 30, 50] as const;

/** "√144 = ?" — always a perfect square, always a whole answer. */
export const sqrt: PuzzleGenerator = {
	kind: 'sqrt',
	minDifficulty: 3,
	maxDifficulty: 10,
	generate(rng: Rng, difficulty: number): Puzzle {
		const max = ROOT_MAX[Math.min(Math.max(difficulty, 3), 10) - 1] as number;
		const root = rng.int(1, max);
		return { kind: 'sqrt', difficulty, prompt: `√${root * root} = ?`, answer: root };
	}
};
