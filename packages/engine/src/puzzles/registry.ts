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
	type PuzzleKind,
	type PuzzleTopic
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
 * The generators `generatePuzzle` chooses among for `kinds` at `difficulty`,
 * and the difficulty they run at: every kind that supports the difficulty,
 * or — when none does — the first kind alone at the nearest difficulty it
 * supports (`fallback`). One rule, so `puzzleTopics` can never describe a
 * choice `generatePuzzle` would not make.
 */
function choices(
	kinds: readonly PuzzleKind[],
	difficulty: number
): { kinds: readonly PuzzleKind[]; difficulty: number; fallback: boolean } {
	if (kinds.length === 0) throw new Error('generatePuzzle: no kinds given');
	const d = clampDifficulty(difficulty);
	const eligible = kinds.filter((k) => {
		const g = GENERATORS[k];
		return d >= g.minDifficulty && d <= g.maxDifficulty;
	});
	if (eligible.length > 0) return { kinds: eligible, difficulty: d, fallback: false };
	const g = GENERATORS[kinds[0] as PuzzleKind];
	const nearest = Math.min(g.maxDifficulty, Math.max(g.minDifficulty, d));
	return { kinds: [g.kind], difficulty: nearest, fallback: true };
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
	const choice = choices(kinds, difficulty);
	// The fallback draws nothing to choose: its one kind is given.
	const kind = choice.fallback ? choice.kinds[0]! : rng.pick(choice.kinds);
	return GENERATORS[kind].generate(rng, choice.difficulty);
}

/**
 * Every topic a puzzle from `generatePuzzle(rng, difficulty, kinds)` can
 * have, each once, in the order of `kinds`: what an attack's description
 * names at a level ("adding, taking away, missing numbers or times tables").
 */
export function puzzleTopics(kinds: readonly PuzzleKind[], difficulty: number): PuzzleTopic[] {
	const choice = choices(kinds, difficulty);
	return [...new Set(choice.kinds.flatMap((k) => GENERATORS[k].topics(choice.difficulty)))];
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
