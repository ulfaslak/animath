import type { Rng } from '../rng.js';
import { add, div, missing, mul, sub } from './generators/arithmetic.js';
import { sequence } from './generators/sequence.js';
import { sqrt } from './generators/sqrt.js';
import {
	ALL_PUZZLE_KINDS,
	MAX_DIFFICULTY,
	MIN_DIFFICULTY,
	type Puzzle,
	type PuzzleGenerator,
	type PuzzleKind
} from './types.js';

const GENERATORS: Record<PuzzleKind, PuzzleGenerator> = {
	add,
	sub,
	mul,
	div,
	missing,
	sequence,
	sqrt
};

export function getGenerator(kind: PuzzleKind): PuzzleGenerator {
	return GENERATORS[kind];
}

export function clampDifficulty(d: number): number {
	return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, Math.round(d)));
}

/**
 * Generate a puzzle at `difficulty`, choosing uniformly among `kinds` that
 * support that difficulty. If none of the requested kinds support it, the
 * generator whose range is nearest is used at the edge of its range — an
 * attack that only knows `sqrt` still yields a puzzle at difficulty 1.
 */
export function generatePuzzle(
	rng: Rng,
	difficulty: number,
	kinds: readonly PuzzleKind[] = ALL_PUZZLE_KINDS
): Puzzle {
	if (kinds.length === 0) throw new Error('generatePuzzle: no kinds given');
	const d = clampDifficulty(difficulty);
	const eligible = kinds.filter((k) => {
		const g = GENERATORS[k];
		return d >= g.minDifficulty && d <= g.maxDifficulty;
	});
	if (eligible.length > 0) return GENERATORS[rng.pick(eligible)].generate(rng, d);

	// Fall back to the nearest supported difficulty of the first kind.
	const g = GENERATORS[kinds[0] as PuzzleKind];
	const nearest = Math.min(g.maxDifficulty, Math.max(g.minDifficulty, d));
	return g.generate(rng, nearest);
}

/**
 * The one place an answer is judged. The UI never compares numbers itself.
 * Accepts strings so keypad input can be passed straight through; whitespace
 * and a leading "+" are tolerated, anything non-integer is wrong.
 */
export function checkAnswer(puzzle: Puzzle, input: string | number): boolean {
	const text = String(input).trim().replace(/^\+/, '');
	if (!/^-?\d+$/.test(text)) return false;
	return Number(text) === puzzle.answer;
}
