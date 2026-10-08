import type { Rng } from '../../rng.js';
import { facePrompt } from '../face.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';
import type { Band } from './arithmetic.js';

/** The balance's forms, as `face.ts` writes them. */
export const BALANCE = {
	/** `a + □ = b + c` */
	plus: 0,
	/** `a − □ = b − c` */
	minus: 1,
	/** `a × □ = b × c` */
	times: 2,
	/** `a × □ + b = c` */
	timesPlus: 3,
	/** `a × □ − b = c` */
	timesMinus: 4
} as const;

type Form = (typeof BALANCE)[keyof typeof BALANCE];

/**
 * One step of the balance ladder ([[PRODUCT]] §4 "Puzzles"): the forms it
 * asks, and its bands. For `plus` and `minus` every number shown and the box
 * come from `sum`; for the forms with a times, the factor before the box
 * from `factor`, the box from `box`, and the number added or taken away
 * from `extra`.
 */
export interface BalanceStep {
	forms: readonly Form[];
	sum: Band;
	factor: Band;
	box: Band;
	extra: Band;
}

const { plus, minus, times, timesPlus, timesMinus } = BALANCE;

/** Index = difficulty − 1. Each band's ends never fall. */
export const BALANCE_LADDER: readonly BalanceStep[] = [
	{ forms: [plus], sum: [1, 9], factor: [2, 5], box: [2, 5], extra: [1, 10] },
	{ forms: [plus], sum: [5, 20], factor: [2, 5], box: [2, 5], extra: [1, 10] },
	{ forms: [plus, minus], sum: [10, 30], factor: [2, 5], box: [2, 5], extra: [1, 10] },
	{ forms: [plus, minus], sum: [20, 60], factor: [2, 5], box: [2, 5], extra: [1, 10] },
	{ forms: [plus, minus, times], sum: [50, 100], factor: [2, 5], box: [2, 9], extra: [1, 10] },
	{ forms: [timesPlus], sum: [50, 100], factor: [2, 5], box: [2, 9], extra: [1, 20] },
	{ forms: [timesPlus, timesMinus], sum: [50, 100], factor: [2, 9], box: [2, 9], extra: [5, 30] },
	{ forms: [timesPlus, timesMinus], sum: [50, 100], factor: [3, 9], box: [6, 15], extra: [10, 50] },
	{
		forms: [times, timesPlus, timesMinus],
		sum: [50, 100],
		factor: [6, 12],
		box: [11, 20],
		extra: [20, 80]
	},
	{
		forms: [timesPlus, timesMinus],
		sum: [50, 100],
		factor: [11, 20],
		box: [11, 25],
		extra: [30, 100]
	}
];

/** Draws of a pair of factors for `times` before the step asks another form instead. */
const TRIES = 50;

/**
 * "8 + □ = 5 + 6", later "3 × □ + 4 = 25": both sides weigh the same, and
 * the box is the number that makes them. Words-free: the prompt is the
 * puzzle, as a sum's is.
 */
export const balance: PuzzleGenerator = {
	kind: 'balance',
	minDifficulty: 1,
	maxDifficulty: 10,
	topics: () => ['balance'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const step = BALANCE_LADDER[difficulty - 1]!;
		const form = rng.pick(step.forms);
		const [drawn, numbers, answer] = draw(rng, step, form);
		return {
			kind: 'balance',
			difficulty,
			prompt: facePrompt({ kind: 'balance', numbers: [drawn, ...numbers] }),
			answer
		};
	}
};

function draw(rng: Rng, step: BalanceStep, form: Form): [Form, number[], number] {
	const int = (band: Band) => rng.int(band[0], band[1]);
	switch (form) {
		case plus: {
			// a + x = b + c, every one of them from the band, a never b or c (that would give x away).
			for (;;) {
				const [a, x, b] = [int(step.sum), int(step.sum), int(step.sum)];
				const c = a + x - b;
				if (c >= step.sum[0] && c <= step.sum[1] && a !== b && a !== c) return [plus, [a, b, c], x];
			}
		}
		case minus: {
			// a − x = b − c with b > c, every one of them from the band (so a − x is at least 1), a
			// never b and the box never c (either would give it away).
			for (;;) {
				const [b, c, x] = [int(step.sum), int(step.sum), int(step.sum)];
				const a = b - c + x;
				if (b > c && a <= step.sum[1] && a !== b && x !== c) return [minus, [a, b, c], x];
			}
		}
		case times: {
			// a × x = b × c, with {b, c} another pair than {a, x}: the box is not read off.
			for (let i = 0; i < TRIES; i++) {
				const [a, x] = [int(step.factor), int(step.box)];
				const pairs = otherPairs(a * x, a, x);
				if (pairs.length > 0) {
					const [b, c] = rng.pick(pairs);
					return [times, [a, b, c], x];
				}
			}
			return draw(rng, step, timesPlus);
		}
		case timesPlus: {
			const [a, x, b] = [int(step.factor), int(step.box), int(step.extra)];
			return [timesPlus, [a, b, a * x + b], x];
		}
		case timesMinus: {
			// a × x − b stays above 0.
			const [a, x] = [int(step.factor), int(step.box)];
			const top = Math.min(step.extra[1], a * x - 1);
			const b = rng.int(Math.min(step.extra[0], top), top);
			return [timesMinus, [a, b, a * x - b], x];
		}
	}
}

/** Every pair `[b, c]`, each from 2 up, with `b × c = product`, other than `a` and `x` either way round. */
function otherPairs(product: number, a: number, x: number): [number, number][] {
	const out: [number, number][] = [];
	for (let b = 2; b * 2 <= product; b++) {
		if (product % b !== 0) continue;
		const c = product / b;
		if (c < 2 || b === a || b === x) continue;
		out.push([b, c]);
	}
	return out;
}
