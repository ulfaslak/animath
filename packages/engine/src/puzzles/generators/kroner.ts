import type { Rng } from '../../rng.js';
import { KRONER, facePrompt } from '../face.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';
import type { Band } from './arithmetic.js';

type Krone = (typeof KRONER)[number];

/**
 * One step of the kroner ladder ([[PRODUCT]] §4 "Puzzles"): the money in
 * the picture (`pieces` coins and notes, each one of `money`, adding up to
 * a sum in `total`), and what is asked of it: how much it is (`things` 0),
 * the change when it pays for one thing (1) or for two (2), each thing's
 * price in `price`.
 */
export interface KronerStep {
	things: 0 | 1 | 2;
	money: readonly Krone[];
	pieces: Band;
	total: Band;
	price: Band;
}

/**
 * Index = difficulty − 1. Counting first (1–4), then the change from one
 * thing (5–7), then from two (8–10). Within each, every band's ends never fall.
 */
export const KRONER_LADDER: readonly KronerStep[] = [
	{ things: 0, money: [1, 2, 5, 10], pieces: [2, 4], total: [5, 20], price: [0, 0] },
	{ things: 0, money: [1, 2, 5, 10, 20], pieces: [3, 5], total: [15, 50], price: [0, 0] },
	{ things: 0, money: [2, 5, 10, 20, 50], pieces: [4, 6], total: [40, 100], price: [0, 0] },
	{ things: 0, money: [5, 10, 20, 50, 100, 200], pieces: [4, 7], total: [100, 500], price: [0, 0] },
	{ things: 1, money: [20, 50, 100], pieces: [1, 1], total: [20, 100], price: [11, 95] },
	{ things: 1, money: [50, 100, 200], pieces: [1, 2], total: [100, 300], price: [35, 290] },
	{ things: 1, money: [10, 20, 50, 100, 200], pieces: [2, 4], total: [150, 500], price: [60, 480] },
	{ things: 2, money: [100, 200], pieces: [1, 2], total: [100, 400], price: [15, 190] },
	{ things: 2, money: [50, 100, 200], pieces: [2, 4], total: [200, 600], price: [40, 280] },
	{ things: 2, money: [20, 50, 100, 200], pieces: [3, 5], total: [300, 1000], price: [75, 450] }
];

/** Draws before a step takes the last money it drew, in or out of its band: never in the ladder's own steps. */
const TRIES = 200;

/**
 * Danish money ([[PRODUCT]] §4 "Puzzles"): coins of 1, 2, 5, 10 and 20
 * kroner and notes of 50, 100 and 200, never øre. Count what is in the
 * picture; then pay with it for one thing, or two, and say the change.
 */
export const kroner: PuzzleGenerator = {
	kind: 'kroner',
	minDifficulty: 1,
	maxDifficulty: 10,
	topics: () => ['kroner'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const step = KRONER_LADDER[difficulty - 1]!;
		let counts: number[] = [];
		let prices: number[] | null = null;
		for (let i = 0; i < TRIES && prices === null; i++) {
			counts = money(rng, step);
			prices = pricesFor(rng, step, counts);
		}
		// Never reached by the ladder's steps (`puzzles.test.ts` asks every one many times).
		if (prices === null) throw new Error(`kroner: no prices fit at difficulty ${difficulty}`);
		const paid = counts.reduce((sum, c, i) => sum + c * KRONER[i]!, 0);
		const [p = 0, q = 0] = prices;
		return {
			kind: 'kroner',
			difficulty,
			prompt: facePrompt({ kind: 'kroner', numbers: [step.things, ...counts, p, q] }),
			answer: paid - p - q
		};
	}
};

/** How many of each coin and note, in `KRONER`'s order: a handful whose sum is in the step's band. */
function money(rng: Rng, step: KronerStep): number[] {
	let counts: number[] = [];
	for (let i = 0; i < TRIES; i++) {
		counts = KRONER.map(() => 0);
		const n = rng.int(step.pieces[0], step.pieces[1]);
		for (let k = 0; k < n; k++) counts[KRONER.indexOf(rng.pick(step.money))]! += 1;
		const total = counts.reduce((sum, c, j) => sum + c * KRONER[j]!, 0);
		if (total >= step.total[0] && total <= step.total[1]) return counts;
	}
	return counts;
}

/**
 * The price of each thing bought, from the step's band: together less than
 * what is paid, and by less than the smallest coin or note paid with, so
 * every piece in the picture is needed, as when a grown-up pays. Null when
 * no prices from the band fit this money.
 */
function pricesFor(rng: Rng, step: KronerStep, counts: readonly number[]): number[] | null {
	if (step.things === 0) return [];
	const paid = counts.reduce((sum, c, i) => sum + c * KRONER[i]!, 0);
	const smallest = KRONER[counts.findIndex((c) => c > 0)]!;
	// What the things cost together: from paid − smallest + 1 to paid − 1.
	const [lo, hi] = step.price;
	const [least, most] = [paid - smallest + 1, paid - 1];
	if (step.things === 1) {
		const [from, to] = [Math.max(lo, least), Math.min(hi, most)];
		return from > to ? null : [rng.int(from, to)];
	}
	const p = rng.int(lo, hi);
	const [from, to] = [Math.max(lo, least - p), Math.min(hi, most - p)];
	return from > to ? null : [p, rng.int(from, to)];
}
