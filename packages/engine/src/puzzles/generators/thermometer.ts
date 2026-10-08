import type { Rng } from '../../rng.js';
import { THERMOMETER, facePrompt } from '../face.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';
import type { Band } from './arithmetic.js';

/**
 * One step of the thermometer's ladder ([[PRODUCT]] §4 "Puzzles"): how far
 * from 0 a temperature may be (`reach`), how many degrees it changes by
 * (`change`), whether the change must cross 0 (`cross`; at difficulty 1
 * everything stays at 0 or above), and what is asked: a temperature after
 * it gets colder or warmer (`turn`), or the degrees between two
 * temperatures (`between`).
 */
export interface ThermometerStep {
	reach: number;
	change: Band;
	cross: boolean;
	turn: boolean;
	between: boolean;
}

/** Index = difficulty − 1. Both ends of `change` and `reach` never fall. */
export const THERMOMETER_LADDER: readonly ThermometerStep[] = [
	{ reach: 10, change: [2, 5], cross: false, turn: true, between: false },
	{ reach: 10, change: [2, 6], cross: true, turn: true, between: false },
	{ reach: 15, change: [5, 12], cross: true, turn: true, between: false },
	{ reach: 15, change: [5, 15], cross: true, turn: false, between: true },
	{ reach: 20, change: [8, 20], cross: true, turn: true, between: true },
	{ reach: 25, change: [10, 25], cross: true, turn: true, between: true },
	{ reach: 30, change: [12, 30], cross: true, turn: true, between: true },
	{ reach: 35, change: [15, 35], cross: true, turn: true, between: true },
	{ reach: 40, change: [18, 40], cross: true, turn: true, between: true },
	{ reach: 40, change: [25, 60], cross: true, turn: true, between: true }
];

/**
 * "It is 3°. It gets 5° colder." → −2. A temperature and how much it
 * changes, or two temperatures and how far apart they are. From difficulty 2
 * every puzzle crosses 0: one temperature above it and one below, neither on
 * it, so the minus is the point.
 */
export const thermometer: PuzzleGenerator = {
	kind: 'thermometer',
	minDifficulty: 1,
	maxDifficulty: 10,
	topics: () => ['thermometer'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const step = THERMOMETER_LADDER[difficulty - 1]!;
		const hows: number[] = [];
		if (step.turn) hows.push(THERMOMETER.colder, THERMOMETER.warmer);
		if (step.between) hows.push(THERMOMETER.rose, THERMOMETER.fell);
		const how = rng.pick(hows);
		// Going up: warmer, or how far it rose. Going down is an upward pair turned round.
		const up = how === THERMOMETER.warmer || how === THERMOMETER.rose;
		const { from, to } = upward(rng, step);
		const [a, b] = up ? [from, to] : step.cross ? [-from, -to] : [to, from];
		const change = Math.abs(b - a);
		const shown =
			how === THERMOMETER.colder || how === THERMOMETER.warmer ? [how, a, change] : [how, a, b];
		return {
			kind: 'thermometer',
			difficulty,
			prompt: facePrompt({ kind: 'thermometer', numbers: shown }),
			answer: how === THERMOMETER.colder || how === THERMOMETER.warmer ? b : change
		};
	}
};

/**
 * Two temperatures, `from` below `to` by a change from the step's band,
 * both within `reach` of 0. Crossing, `from` is below 0 and `to` above it,
 * so the pair turned round (`−to`, `−from` read the other way) crosses too;
 * otherwise both are 0 or above, and the pair read backwards goes down.
 */
function upward(rng: Rng, step: ThermometerStep): { from: number; to: number } {
	const change = rng.int(step.change[0], Math.min(step.change[1], 2 * step.reach - 2));
	if (step.cross) {
		// from in [−reach, −1], to = from + change in [1, reach].
		const from = rng.int(Math.max(-step.reach, 1 - change), Math.min(-1, step.reach - change));
		return { from, to: from + change };
	}
	const from = rng.int(0, step.reach - change);
	return { from, to: from + change };
}
