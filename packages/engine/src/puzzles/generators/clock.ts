import type { Rng } from '../../rng.js';
import { facePrompt } from '../face.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';
import type { Band } from './arithmetic.js';

/** What a clock asks: what time it shows, what time it will be a while later, or was a while before. */
export const CLOCK = { read: 0, later: 1, earlier: 2 } as const;

/** Minutes on a clock face: twelve hours, so 3:15 and 15:15 are the same face. */
export const CLOCK_MINUTES = 12 * 60;

type Ask = (typeof CLOCK)[keyof typeof CLOCK];

/**
 * One step of the clock ladder ([[PRODUCT]] §4 "Puzzles"): the minutes the
 * clock may show (`minutes`, every one a multiple of it: 60 for whole hours,
 * 30 for half, 15 for quarters, 5, then 1), what is asked (`asks`), and for
 * time passing how long passes (`passing`, in minutes, a multiple of `step`).
 */
export interface ClockStep {
	minutes: 60 | 30 | 15 | 5 | 1;
	asks: readonly Ask[];
	passing: Band;
	step: number;
	/** The time passing takes the minute hand past 12: from 4:45, 25 minutes later. */
	cross?: true;
}

const { read, later, earlier } = CLOCK;

/**
 * Index = difficulty − 1. Reading the face first (whole hours to any
 * minute), then time passing: a quarter, a half or three quarters of an hour, minutes across the
 * hour, hours and minutes, then back in time too.
 */
export const CLOCK_LADDER: readonly ClockStep[] = [
	{ minutes: 60, asks: [read], passing: [0, 0], step: 1 },
	{ minutes: 30, asks: [read], passing: [0, 0], step: 1 },
	{ minutes: 15, asks: [read], passing: [0, 0], step: 1 },
	{ minutes: 5, asks: [read], passing: [0, 0], step: 1 },
	{ minutes: 1, asks: [read], passing: [0, 0], step: 1 },
	{ minutes: 5, asks: [later], passing: [15, 45], step: 15 },
	{ minutes: 5, asks: [later], passing: [20, 55], step: 5, cross: true },
	{ minutes: 5, asks: [later], passing: [65, 175], step: 5 },
	{ minutes: 1, asks: [later, earlier], passing: [65, 235], step: 5 },
	{ minutes: 1, asks: [later, earlier], passing: [65, 299], step: 1 }
];

/**
 * Reading an analogue clock, then time passing on it. The answer is a time
 * of day, typed as hours and minutes ("3:15"), and kept as minutes past 12
 * o'clock (0 to 719): a clock face cannot say morning or afternoon, so
 * `checkAnswer` takes either reading of it, 3:15 or 15:15.
 * Every puzzle that reads the face alone at difficulty 2 and 3 shows the
 * new mark (half past, a quarter past or to) at least half the time, so a
 * harder clock is not mostly whole hours.
 */
export const clock: PuzzleGenerator = {
	kind: 'clock',
	minDifficulty: 1,
	maxDifficulty: 10,
	answerForm: 'time',
	topics: () => ['clock'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const step = CLOCK_LADDER[difficulty - 1]!;
		const h = rng.int(1, 12);
		const ask = rng.pick(step.asks);
		const passing =
			ask === read
				? 0
				: step.step *
					rng.int(Math.ceil(step.passing[0] / step.step), Math.floor(step.passing[1] / step.step));
		// Across the hour: the hand starts late enough in the hour that the time passing goes past 12.
		const m = step.cross
			? step.minutes * rng.int(Math.ceil((60 - passing) / step.minutes), 60 / step.minutes - 1)
			: shownMinutes(rng, step.minutes);
		const shown = (h % 12) * 60 + m;
		const answer =
			(((ask === earlier ? shown - passing : shown + passing) % CLOCK_MINUTES) + CLOCK_MINUTES) %
			CLOCK_MINUTES;
		return {
			kind: 'clock',
			difficulty,
			prompt: facePrompt({
				kind: 'clock',
				numbers: [ask, h, m, Math.floor(passing / 60), passing % 60]
			}),
			answer
		};
	}
};

/** The minute hand's place: a multiple of `every`, and when that is 30 or 15, on the new mark half the time. */
function shownMinutes(rng: Rng, every: number): number {
	if (every === 30 || every === 15) {
		const marks = Array.from({ length: 60 / every }, (_, k) => k * every);
		return rng.chance(0.5) ? rng.pick(marks.filter((x) => x % (every * 2) !== 0)) : rng.pick(marks);
	}
	return every * rng.int(0, 60 / every - 1);
}
