import type { Rng } from '../rng.js';

/**
 * Puzzle kinds. Adding a kind means: add it here, write a generator in
 * `generators/`, register it in `registry.ts`. Attacks reference kinds by name.
 */
export type PuzzleKind = 'add' | 'sub' | 'mul' | 'div' | 'missing' | 'sequence' | 'sqrt';

export const ALL_PUZZLE_KINDS: readonly PuzzleKind[] = [
	'add',
	'sub',
	'mul',
	'div',
	'missing',
	'sequence',
	'sqrt'
];

/** Difficulty is an integer scalar. 1 is a first-grader's warm-up, 10 is hard. */
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;

export interface Puzzle {
	kind: PuzzleKind;
	difficulty: number;
	/**
	 * Human-readable prompt, e.g. "7 × 8 = ?" or "2, 4, 8, 16, ?". Plain text
	 * for now; the UI renders it verbatim. If a kind ever needs richer layout
	 * (fractions, grids) this becomes a structured type — keep prompt building
	 * inside the generator so that change stays local.
	 */
	prompt: string;
	/** Every puzzle in the game evaluates to a whole number. */
	answer: number;
}

export interface PuzzleGenerator {
	kind: PuzzleKind;
	/** Inclusive difficulty range this generator can produce sensibly. */
	minDifficulty: number;
	maxDifficulty: number;
	generate(rng: Rng, difficulty: number): Puzzle;
}
