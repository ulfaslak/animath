import {
	ALL_PUZZLE_KINDS,
	MAX_DIFFICULTY,
	MIN_DIFFICULTY,
	PICTURE_KINDS,
	Rng,
	answerForm,
	checkAnswer,
	generatePuzzle,
	type Puzzle,
	type PuzzleKind
} from '@mathgame/engine';
import { answerKey } from '../input/answer';

/**
 * The puzzle preview (`?puzzle=clock&d=5`, `flags.ts`): a page of its own,
 * for a grown-up or an agent to look at any kind of puzzle at any
 * difficulty, the Arctic's above all, which nothing in the game asks yet.
 * Not a screen of the game: no world, no save, no authority. A puzzle comes
 * from the engine's own generator and an answer is judged by the engine's
 * own `checkAnswer`, as the battle's authority judges one; the keys type an
 * answer by the battle's rules (`input/answer.ts`).
 *
 * The keys: type and Enter to answer, Enter (or Space) again for the next
 * puzzle; ← → the difficulty, ↑ ↓ the kind; Escape another puzzle.
 */

/** The kinds in the order ↑ ↓ goes through them: the picture kinds, the balance, then the sums. */
export const PREVIEW_KINDS: readonly PuzzleKind[] = [
	...PICTURE_KINDS,
	'balance',
	...ALL_PUZZLE_KINDS.filter(
		(k) => k !== 'balance' && !(PICTURE_KINDS as readonly string[]).includes(k)
	)
];

class PreviewView {
	kind = $state<PuzzleKind>('thermometer');
	difficulty = $state(1);
	puzzle = $state.raw<Puzzle | null>(null);
	input = $state('');
	judged = $state<{ correct: boolean } | null>(null);
	/** How many puzzles have been drawn: each from its own seed. */
	private drawn = 0;
	private readonly seed = Math.floor(Math.random() * 2 ** 31);

	/** A new puzzle of the kind and difficulty on screen. */
	next(): void {
		const rng = new Rng(this.seed + this.drawn++);
		this.puzzle = generatePuzzle(rng, this.difficulty, [this.kind]);
		this.input = '';
		this.judged = null;
	}

	/** What a key does on the preview; false for a key it does not use. */
	key(key: string): boolean {
		switch (key) {
			case 'ArrowLeft':
			case 'ArrowRight':
				this.difficulty = Math.min(
					MAX_DIFFICULTY,
					Math.max(MIN_DIFFICULTY, this.difficulty + (key === 'ArrowRight' ? 1 : -1))
				);
				this.next();
				return true;
			case 'ArrowUp':
			case 'ArrowDown': {
				const at = PREVIEW_KINDS.indexOf(this.kind);
				const step = key === 'ArrowDown' ? 1 : -1;
				this.kind = PREVIEW_KINDS[(at + step + PREVIEW_KINDS.length) % PREVIEW_KINDS.length]!;
				this.next();
				return true;
			}
			case 'Escape':
				this.next();
				return true;
		}
		const puzzle = this.puzzle;
		if (!puzzle) return false;
		if (this.judged) {
			if (key === 'Enter' || key === ' ') this.next();
			return key === 'Enter' || key === ' ';
		}
		const typed = answerKey(this.input, key, answerForm(puzzle.kind));
		this.input = typed.input;
		if (typed.submit) this.judged = { correct: checkAnswer(puzzle, typed.input) };
		return typed.handled;
	}
}

export const preview = new PreviewView();
