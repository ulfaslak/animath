import type { Rng } from '../../rng.js';
import { MAX_BARS, facePrompt } from '../face.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';

/** What a bar chart asks: one bar, how many more one has than another, two together, or all of them. */
export const BARCHART = { read: 0, more: 1, both: 2, all: 3 } as const;

type Ask = (typeof BARCHART)[keyof typeof BARCHART];

/**
 * One step of the bar chart ladder ([[PRODUCT]] §4 "Puzzles"): how many bars
 * (`bars`), the lines across the chart every `scale`, the tallest a bar may
 * be in lines (`lines`, so up to `lines × scale`), whether a bar may end
 * halfway between two lines (`half`), the fewest lines a bar reaches
 * (`least`), and what is asked (`asks`).
 */
export interface BarchartStep {
	bars: number;
	scale: 1 | 2 | 5 | 10;
	least: number;
	lines: number;
	half: boolean;
	asks: readonly Ask[];
}

const { read, more, both, all } = BARCHART;

/**
 * Index = difficulty − 1. A chart counted in ones, then in twos, fives and
 * tens; a bar between two lines from difficulty 5 (in twos) and 9 (in tens).
 */
export const BARCHART_LADDER: readonly BarchartStep[] = [
	{ bars: 3, scale: 1, least: 1, lines: 6, half: false, asks: [read] },
	{ bars: 4, scale: 1, least: 1, lines: 9, half: false, asks: [read, more] },
	{ bars: 4, scale: 1, least: 2, lines: 10, half: false, asks: [more, both] },
	{ bars: 4, scale: 2, least: 1, lines: 10, half: false, asks: [read, more, both] },
	{ bars: 4, scale: 2, least: 1, lines: 10, half: true, asks: [read, more, both] },
	{ bars: 4, scale: 5, least: 2, lines: 10, half: false, asks: [read, more, both] },
	{ bars: 5, scale: 5, least: 2, lines: 10, half: false, asks: [more, both, all] },
	{ bars: 4, scale: 10, least: 2, lines: 10, half: false, asks: [more, both] },
	{ bars: 5, scale: 10, least: 2, lines: 10, half: true, asks: [read, more, both] },
	{ bars: 5, scale: 10, least: 3, lines: 10, half: true, asks: [more, both, all] }
];

/**
 * "How many fish did each animal catch?": a bar chart of three to five
 * bars, told apart by their picture and colour (never a word), read off
 * against the lines across it. Read one bar, then how many more one caught
 * than another, both together, or all of them. Two bars compared are never
 * as tall as each other.
 */
export const barchart: PuzzleGenerator = {
	kind: 'barchart',
	minDifficulty: 1,
	maxDifficulty: 10,
	topics: () => ['barchart'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const step = BARCHART_LADDER[difficulty - 1]!;
		// In half lines: a bar ends on a line, or with `half` between two.
		const unit = step.half ? step.scale / 2 : step.scale;
		const per = step.half ? 2 : 1;
		const values = Array.from(
			{ length: step.bars },
			() => unit * rng.int(step.least * per, step.lines * per)
		);
		const ask = rng.pick(step.asks);
		const order = rng.shuffle(values.map((_, k) => k));
		let [i, j] = [order[0]!, order[1]!];
		if (ask === more) {
			// The taller first; two as tall are made apart by a line's step.
			if (values[i] === values[j])
				values[i] = values[i]! + unit * (values[i]! < step.scale * step.lines ? 1 : -1);
			if (values[i]! < values[j]!) [i, j] = [j, i];
		}
		if (ask === read) j = 0;
		if (ask === all) [i, j] = [0, 0];
		const answer =
			ask === read
				? values[i]!
				: ask === more
					? values[i]! - values[j]!
					: ask === both
						? values[i]! + values[j]!
						: values.reduce((s, v) => s + v, 0);
		const padded = [...values, ...Array.from({ length: MAX_BARS - values.length }, () => 0)];
		return {
			kind: 'barchart',
			difficulty,
			prompt: facePrompt({
				kind: 'barchart',
				numbers: [ask, step.scale, i, j, step.bars, ...padded]
			}),
			answer
		};
	}
};
