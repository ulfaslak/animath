import type { Rng } from '../../rng.js';
import { NUMBERLINE, facePrompt } from '../face.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';

/**
 * One kind of line a step of the number line's ladder draws ([[PRODUCT]] §4
 * "Puzzles"): a mark every `step`, `gaps` gaps long (so one mark more), a
 * number written every `every` marks from the first, on both ends and in
 * the middle. The line starts at `from[0]`, `from[0] + from[2]`, and so on
 * up to `from[1]`, each as likely.
 */
export interface NumberLineForm {
	step: number;
	gaps: number;
	every: number;
	from: readonly [number, number, number];
}

/**
 * One step of the ladder: its lines, each as likely, and where the arrow is:
 * on a mark with no number (`half` false), or halfway between two marks.
 */
export interface NumberLineStep {
	forms: readonly NumberLineForm[];
	half: boolean;
}

/** Ten gaps, a number on every fifth mark: the two ends and the middle. */
function line(step: number, from: readonly [number, number, number]): NumberLineForm {
	return { step, gaps: 10, every: 5, from };
}

/** A line that starts at 0. */
const AT_0 = [0, 0, 1] as const;

/**
 * Index = difficulty − 1, on the school-year scale: what one mark is worth
 * and how big the numbers are climb, the arrow on a mark to 8 and halfway
 * between two from 9. The arrow is never on a number already written, and
 * never more than two marks and a half from one.
 */
export const NUMBERLINE_LADDER: readonly NumberLineStep[] = [
	// 1, age 6: ones to 10 (0, 5, 10).
	{ forms: [line(1, AT_0)], half: false },
	// 2, age 7: tens to 100 (0, 50, 100), twos to 20 (0, 10, 20).
	{ forms: [line(10, AT_0), line(2, AT_0)], half: false },
	// 3, age 8: ones within 100, a ten long (30, 35, 40).
	{ forms: [line(1, [10, 90, 10])], half: false },
	// 4: fives (0, 25, 50 or 50, 75, 100) and twos (40, 50, 60) within 100.
	{ forms: [line(5, [0, 50, 50]), line(2, [10, 80, 10])], half: false },
	// 5, age 9: hundreds to 1000 (0, 500, 1000), tens within 1000 (300, 350, 400).
	{ forms: [line(100, AT_0), line(10, [100, 900, 100])], half: false },
	// 6: twenties (200, 300, 400) and fives (300, 325, 350) within 1000.
	{ forms: [line(20, [0, 800, 100]), line(5, [100, 950, 50])], half: false },
	// 7, age 10: twenty-fives (300, 400, 500: eight gaps, a number every fourth mark), fifties (0, 250, 500).
	{
		forms: [{ step: 25, gaps: 8, every: 4, from: [0, 800, 100] }, line(50, [0, 500, 500])],
		half: false
	},
	// 8: thousands to 10,000 (0, 5000, 10,000), hundreds within it (3000, 3500, 4000).
	{ forms: [line(1000, AT_0), line(100, [1000, 9000, 1000])], half: false },
	// 9, age 11: halfway between marks of 10 (345), 20 (between 340 and 360: 350) or 100 (450).
	{ forms: [line(10, [100, 900, 100]), line(20, [0, 800, 100]), line(100, AT_0)], half: true },
	// 10, age 12: halfway between marks of 2 (347), 50 (175) or 1000 (3500).
	{ forms: [line(2, [100, 980, 10]), line(50, [0, 500, 500]), line(1000, AT_0)], half: true }
];

/** The marks an arrow can be at on a line: those with no number, or (halfway) each gap by the mark before it. */
export function arrowMarks(form: NumberLineForm, half: boolean): number[] {
	const marks: number[] = [];
	for (let k = 0; k < form.gaps; k++) if (half || (k > 0 && k % form.every !== 0)) marks.push(k);
	return marks;
}

/** Where a number line face's arrow is: `NUMBERLINE` says what its numbers are. */
export function numberLineAnswer(numbers: readonly number[]): number {
	const [from, step, , , mark, half] = numbers as number[];
	return from! + mark! * step! + (half === NUMBERLINE.half ? step! / 2 : 0);
}

/**
 * "Which number is the arrow at?" A line with a few of its numbers written
 * on, and an arrow at a mark between them, or halfway between two marks.
 */
export const numberline: PuzzleGenerator = {
	kind: 'numberline',
	minDifficulty: 1,
	maxDifficulty: 10,
	topics: () => ['numberline'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const step = NUMBERLINE_LADDER[difficulty - 1]!;
		const form = rng.pick(step.forms);
		const [lo, hi, by] = form.from;
		const from = lo + by * rng.int(0, (hi - lo) / by);
		const mark = rng.pick(arrowMarks(form, step.half));
		const numbers = [
			from,
			form.step,
			form.gaps,
			form.every,
			mark,
			step.half ? NUMBERLINE.half : NUMBERLINE.on
		];
		return {
			kind: 'numberline',
			difficulty,
			prompt: facePrompt({ kind: 'numberline', numbers }),
			answer: numberLineAnswer(numbers)
		};
	}
};
