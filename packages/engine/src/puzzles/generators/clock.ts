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
	/**
	 * Where the minutes passing take the minute hand: never past 12
	 * (`within`: from 3:10, 1 hour and 20 minutes later is 4:30), or always
	 * past it (`across`: from 4:45, 25 minutes later is 5:10). Unset, either.
	 */
	hour?: 'within' | 'across';
}

const { read, later, earlier } = CLOCK;

/**
 * Index = difficulty − 1. Reading the face first (whole hours, half past,
 * a quarter past and to, five minutes, any minute), then time passing beside
 * it: whole hours later (6–7), hours and minutes later, the minute hand
 * staying before 12 (8), then taking it past 12 (9), then back in time too
 * (10). Two skills of time passing, whole hours and hours and minutes: within
 * each, both ends of `passing` never fall.
 */
export const CLOCK_LADDER: readonly ClockStep[] = [
	{ minutes: 60, asks: [read], passing: [0, 0], step: 1 },
	{ minutes: 60, asks: [read], passing: [0, 0], step: 1 },
	{ minutes: 30, asks: [read], passing: [0, 0], step: 1 },
	{ minutes: 15, asks: [read], passing: [0, 0], step: 1 },
	{ minutes: 15, asks: [read], passing: [0, 0], step: 1 },
	{ minutes: 5, asks: [read, later], passing: [60, 120], step: 60 },
	{ minutes: 5, asks: [read, later], passing: [60, 180], step: 60 },
	{ minutes: 1, asks: [read, later], passing: [20, 175], step: 5, hour: 'within' },
	{ minutes: 1, asks: [later], passing: [20, 235], step: 5, hour: 'across' },
	{ minutes: 1, asks: [later, earlier], passing: [20, 295], step: 5 }
];

/**
 * Reading an analogue clock, then time passing on it. The answer is a time
 * of day, typed as hours and minutes ("3:15"), and kept as minutes past 12
 * o'clock (0 to 719): a clock face cannot say morning or afternoon, so
 * `checkAnswer` takes either reading of it, 3:15 or 15:15.
 * Every puzzle that reads half or quarter hours shows the new mark (half
 * past, a quarter past or to) at least half the time, so a harder clock is
 * not mostly whole hours.
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
		const passing = ask === read ? 0 : rng.pick(passings(step));
		const m =
			ask === read || step.hour === undefined
				? shownMinutes(rng, step.minutes)
				: rng.pick(marksFor(step, ask, passing % 60));
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

/**
 * How long may pass at a step: every multiple of its `step` in its band, and
 * across the hour never whole hours, which leave the minute hand where it is.
 */
function passings(step: ClockStep): number[] {
	const out: number[] = [];
	for (
		let p = Math.ceil(step.passing[0] / step.step) * step.step;
		p <= step.passing[1];
		p += step.step
	)
		if (step.hour !== 'across' || p % 60 !== 0) out.push(p);
	return out;
}

/**
 * The marks the minute hand may start on, so that `minutes` passing (later,
 * or back for `earlier`) keeps it before 12 or takes it past 12, as the step
 * says: from 4:45, 25 minutes later goes past; from 4:45, 10 minutes later
 * does not.
 */
function marksFor(step: ClockStep, ask: Ask, minutes: number): number[] {
	const marks = Array.from({ length: 60 / step.minutes }, (_, k) => k * step.minutes);
	const across = (m: number) => (ask === earlier ? m - minutes < 0 : m + minutes >= 60);
	return marks.filter((m) => across(m) === (step.hour === 'across'));
}

/** The minute hand's place: a multiple of `every`, and when that is 30 or 15, on the new mark half the time. */
function shownMinutes(rng: Rng, every: number): number {
	if (every === 30 || every === 15) {
		const marks = Array.from({ length: 60 / every }, (_, k) => k * every);
		return rng.chance(0.5) ? rng.pick(marks.filter((x) => x % (every * 2) !== 0)) : rng.pick(marks);
	}
	return every * rng.int(0, 60 / every - 1);
}
