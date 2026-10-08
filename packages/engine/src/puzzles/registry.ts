import type { Rng } from '../rng.js';
import { add, div, missing, mul, sub } from './generators/arithmetic.js';
import { sequence } from './generators/sequence.js';
import { sqrt } from './generators/sqrt.js';
import { balance } from './generators/balance.js';
import { barchart } from './generators/barchart.js';
import { CLOCK_MINUTES, clock } from './generators/clock.js';
import { fraction } from './generators/fraction.js';
import { kroner } from './generators/kroner.js';
import { shape } from './generators/shape.js';
import { thermometer } from './generators/thermometer.js';
import {
	ALL_PUZZLE_KINDS,
	type AnswerForm,
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
	sqrt,
	thermometer,
	kroner,
	fraction,
	shape,
	barchart,
	clock,
	balance
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

/** How a kind's answer is typed: a number, or a time of day (`clock`). */
export function answerForm(kind: PuzzleKind): AnswerForm {
	return GENERATORS[kind].answerForm ?? 'number';
}

/**
 * The one place an answer is judged. The UI never compares numbers itself.
 * Accepts strings so keypad input can be passed straight through; whitespace
 * and a leading "+" are tolerated, anything non-integer is wrong.
 *
 * A time (a `clock`'s answer) is hours, then a colon (or a dot, as Danish
 * writes "kl. 3.15"; or nothing), then two digits of minutes: "3:15",
 * "03.15", "315", "15:15". Hours run 0 to 23 and minutes 0 to 59, and a time
 * is right when it is the answer on a clock face, morning or afternoon: a
 * clock cannot tell them apart, so 3:15 and 15:15 are both right for a
 * quarter past three (and 12:20 and 0:20 for twenty past twelve). A time
 * with one digit of minutes ("3:5") is wrong: it could be 3:05 or 3:50.
 */
export function checkAnswer(puzzle: Puzzle, input: string | number): boolean {
	if (answerForm(puzzle.kind) === 'time') {
		const time = String(input)
			.trim()
			.match(/^(\d{1,2})[:.]?(\d{2})$/);
		if (!time) return false;
		const [hours, minutes] = [Number(time[1]), Number(time[2])];
		if (hours > 23 || minutes > 59) return false;
		return (hours * 60 + minutes) % CLOCK_MINUTES === puzzle.answer;
	}
	const text = String(input).trim().replace(/^\+/, '');
	if (!/^-?\d+$/.test(text)) return false;
	return Number(text) === puzzle.answer;
}

/**
 * An answer as a kid would type it: the number, or a clock's time as
 * hours and minutes ("3:15", never "0:15" but "12:15"). For tests and the
 * development preview, which need a right answer to type; never shown.
 */
export function answerText(puzzle: Puzzle): string {
	if (answerForm(puzzle.kind) !== 'time') return String(puzzle.answer);
	const hours = Math.floor(puzzle.answer / 60);
	return `${hours === 0 ? 12 : hours}:${String(puzzle.answer % 60).padStart(2, '0')}`;
}
