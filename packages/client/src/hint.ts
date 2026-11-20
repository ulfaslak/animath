import { puzzleFace, puzzleHint, type Puzzle, type PuzzleHint } from '@mathgame/engine';
import type { AnswerKey } from './input/answer';

/**
 * A puzzle's hint, from what is on screen (the engine's `puzzleHint` of its
 * face), or null when it has none. Asking for it is no intent: it changes
 * nothing in the game, so the screen that asks the puzzle shows it at once,
 * and nobody else ever sees it.
 */
export function hintOf(puzzle: Pick<Puzzle, 'kind' | 'prompt'>): PuzzleHint | null {
	const face = puzzleFace(puzzle);
	return face ? puzzleHint(face) : null;
}

/**
 * Whether a key typed into a puzzle's answer brings up its hint now: the key
 * asks for it, the puzzle has one, and it is not up yet.
 */
export function bringsHint(
	typed: AnswerKey,
	puzzle: Pick<Puzzle, 'kind' | 'prompt'> | null,
	hinted: boolean
): boolean {
	return typed.hint === true && !hinted && puzzle !== null && hintOf(puzzle) !== null;
}
