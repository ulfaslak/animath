import type { Rng } from '../../rng.js';
import { BLOCKS, facePrompt } from '../face.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';
import type { Band } from './arithmetic.js';

/**
 * One way a step of the ice-block ladder asks: count the blocks of a stack
 * `l` long, `w` deep and `h` layers high (`count`: a row when `w` and `h`
 * are 1, a flat layer when `h` is 1, else a box), or how many layers high a
 * box is from its bottom layer and the blocks it holds (`high`: `h` is the
 * answer, and the picture never shows it).
 */
export interface BlocksForm {
	how: keyof typeof BLOCKS;
	l: Band;
	w: Band;
	h: Band;
}

/**
 * Index = difficulty − 1, on the school-year scale ([[DECISIONS]] §
 * Gameplay). A row counted at 1 (age 6); a flat layer at 2–4, the very
 * times table `mul` asks at its step as rows of blocks (two rows of 2–5,
 * then 2–5 rows, then 3–5 rows of 6–9); boxes at 5–8 (ages 9–10), the
 * hidden blocks counted by the rule a kid learns, layer by layer: the
 * bottom layer's blocks times the layers; at 9 the biggest boxes and, as at
 * 10 (ages 11–12), how many layers high a box is from the blocks it holds.
 * Every product stays in the head: a box's bottom layer is 30 blocks at
 * most, counted up to 6 times, and a box asked for its layers holds 270 at
 * most, 9 layers. Within a form (a row, a flat layer, a box, how high)
 * neither end of a band ever falls (`puzzle-kinds.test.ts`).
 */
export const BLOCKS_LADDER: readonly (readonly BlocksForm[])[] = [
	[{ how: 'count', l: [2, 5], w: [1, 1], h: [1, 1] }],
	[{ how: 'count', l: [2, 5], w: [2, 2], h: [1, 1] }],
	[{ how: 'count', l: [2, 5], w: [2, 5], h: [1, 1] }],
	[{ how: 'count', l: [6, 9], w: [3, 5], h: [1, 1] }],
	[{ how: 'count', l: [2, 4], w: [2, 3], h: [2, 3] }],
	[{ how: 'count', l: [3, 5], w: [2, 4], h: [2, 4] }],
	[{ how: 'count', l: [3, 6], w: [3, 4], h: [3, 5] }],
	[{ how: 'count', l: [4, 6], w: [3, 5], h: [3, 6] }],
	[
		{ how: 'count', l: [4, 6], w: [4, 5], h: [4, 6] },
		{ how: 'high', l: [3, 6], w: [2, 4], h: [3, 6] }
	],
	[{ how: 'high', l: [4, 6], w: [3, 5], h: [4, 9] }]
];

/**
 * Ice blocks ([[PRODUCT]] §4 "Puzzles"): volume, "rumfang", as a stack of
 * the Arctic's own ice blocks. A row is counted, a flat layer is rows times
 * the blocks in a row, a box is its bottom layer times its layers, and a box
 * whose blocks are told has its layers found from its bottom layer. Each of
 * a step's forms is asked as often.
 */
export const blocks: PuzzleGenerator = {
	kind: 'blocks',
	minDifficulty: 1,
	maxDifficulty: 10,
	topics: () => ['blocks'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const form = rng.pick(BLOCKS_LADDER[difficulty - 1]!);
		const l = rng.int(...form.l);
		const w = rng.int(...form.w);
		const h = rng.int(...form.h);
		if (form.how === 'high') return puzzle(difficulty, [BLOCKS.high, l, w, l * w * h], h);
		return puzzle(difficulty, [BLOCKS.count, l, w, h], l * w * h);
	}
};

function puzzle(difficulty: number, numbers: number[], answer: number): Puzzle {
	return { kind: 'blocks', difficulty, prompt: facePrompt({ kind: 'blocks', numbers }), answer };
}
