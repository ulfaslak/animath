import type { Rng } from '../rng.js';

/**
 * Puzzle kinds. Attacks reference kinds by name. What adding a kind takes
 * (here, a generator, `registry.ts`, its topics and its face) is listed in
 * [[ARCHITECTURE]]'s `registry.ts` row.
 */
export type PuzzleKind =
	'add' | 'sub' | 'mul' | 'div' | 'missing' | 'sequence' | 'sqrt' | PictureKind | 'balance';

/**
 * The kinds the puzzle panel draws a picture for (#191): the client words
 * their question and draws their picture from the face's numbers, so their
 * prompt is the face written out (`facePrompt`), never shown as it is.
 */
export type PictureKind = 'thermometer' | 'kroner' | 'fraction' | 'shape' | 'barchart' | 'clock';

export const PICTURE_KINDS: readonly PictureKind[] = [
	'thermometer',
	'kroner',
	'fraction',
	'shape',
	'barchart',
	'clock'
];

export function isPictureKind(kind: PuzzleKind): kind is PictureKind {
	return (PICTURE_KINDS as readonly PuzzleKind[]).includes(kind);
}

export const ALL_PUZZLE_KINDS: readonly PuzzleKind[] = [
	'add',
	'sub',
	'mul',
	'div',
	'missing',
	'sequence',
	'sqrt',
	...PICTURE_KINDS,
	'balance'
];

/**
 * How a kind's answer is typed: a number (a minus allowed), or a time of
 * day (`clock`: hours, a colon, two digits of minutes), which the engine
 * reads into minutes (`checkAnswer`).
 */
export type AnswerForm = 'number' | 'time';

/**
 * What a puzzle looks like to the kid, for the words that describe an attack:
 * mostly its kind, except that a missing number in a times table
 * ("7 × ? = 56") is `mul` — times tables to the kid — while one in a sum
 * ("7 + ? = 12") stays `missing`.
 */
export type PuzzleTopic =
	| 'add'
	| 'sub'
	| 'mul'
	| 'div'
	| 'missing'
	| 'sequence'
	| 'sqrt'
	| 'thermometer'
	| 'kroner'
	| 'fraction'
	| 'area'
	| 'perimeter'
	| 'barchart'
	| 'balance'
	| 'clock';

export const ALL_PUZZLE_TOPICS: readonly PuzzleTopic[] = [
	'add',
	'sub',
	'mul',
	'div',
	'missing',
	'sequence',
	'sqrt',
	'thermometer',
	'kroner',
	'fraction',
	'area',
	'perimeter',
	'barchart',
	'balance',
	'clock'
];

/** Difficulty is an integer scalar. 1 is a first-grader's warm-up, 10 is hard. */
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;

export interface Puzzle {
	kind: PuzzleKind;
	difficulty: number;
	/**
	 * Human-readable prompt, e.g. "7 × 8 = ?" or "2, 4, 8, 16, ?", written by
	 * `facePrompt` from the puzzle's numbers (`face.ts`), which `puzzleFace`
	 * reads back: a puzzle shown to a player near a battle travels as those
	 * numbers, never as text. The UI shows a sum's verbatim ("8 + □ = 5 + 6"
	 * too); a picture kind's is its face written out, `clock(1, 3, 15, 1, 20)`,
	 * which the UI words and draws from the face and never shows.
	 */
	prompt: string;
	/**
	 * Every puzzle in the game evaluates to a whole number, below 0 on a
	 * thermometer; a clock's is a time of day as minutes past 12 o'clock,
	 * 0 to 719, which `checkAnswer` reads either way round the day.
	 */
	answer: number;
}

export interface PuzzleGenerator {
	kind: PuzzleKind;
	/** Inclusive difficulty range this generator can produce sensibly. */
	minDifficulty: number;
	maxDifficulty: number;
	generate(rng: Rng, difficulty: number): Puzzle;
	/** How the answer is typed; a number unless said. */
	answerForm?: AnswerForm;
	/**
	 * Every topic `generate` can produce at `difficulty` (inside its range),
	 * and no other: what an attack's description promises the kid.
	 */
	topics(difficulty: number): readonly PuzzleTopic[];
}
