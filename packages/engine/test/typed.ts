import { answerText } from '../src/puzzles/registry.js';
import type { Puzzle } from '../src/puzzles/types.js';

/**
 * What a scripted player types for `puzzle`: its answer as a kid types it
 * (`answerText`: a number, or a clock's "3:15"), or, for a wrong one, the
 * answer one more, typed the same way (a minute later on a clock). Not a
 * test file itself.
 */
export function typed(puzzle: Pick<Puzzle, 'kind' | 'answer'>, right = true): string {
	return answerText({ ...(puzzle as Puzzle), answer: right ? puzzle.answer : puzzle.answer + 1 });
}
