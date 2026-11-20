import type { Rng } from '../../rng.js';
import { facePrompt } from '../face.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';
import { step, type Band } from './arithmetic.js';

/**
 * The skills of square roots, easiest first: the squares of the times table
 * (√49), of whole tens (√4900: the table with two noughts), and of 15 and 25
 * (√225: between √100 and √400, and ending in 5). A step of `ROOT_LADDER`
 * never asks a skill before one the step below it asks.
 */
export const ROOT_SKILLS = ['table', 'tens', 'fives'] as const;
export type RootSkill = (typeof ROOT_SKILLS)[number];

/**
 * One skill at a step. `of` is a band of `k`, and the root is `k` itself for
 * `table` (never 10: "√100" is a freebie), `10k` for `tens` and `10k + 5`
 * for `fives`.
 */
export interface RootForm {
	skill: RootSkill;
	of: Band;
}

/** The root a form's `k` stands for. */
export function rootOf(skill: RootSkill, k: number): number {
	return skill === 'table' ? k : skill === 'tens' ? 10 * k : 10 * k + 5;
}

/**
 * Square roots on the school-year scale ([[DECISIONS]] § Gameplay; index =
 * difficulty − 1). Only difficulties ≥ 3 offer them; the first two rows are
 * unused. The squares of the small tables first, then of the hard corner,
 * then 11² and 12², then whole tens, and at 10 also 15² and 25², which a kid
 * finds by reasoning and checks with a teen times a teen. Never a root a kid
 * can only guess at ("√196", "√2025"). Within a skill neither end of a band
 * ever falls.
 */
export const ROOT_LADDER: readonly (readonly RootForm[])[] = [
	[{ skill: 'table', of: [2, 5] }], //  (1: unused)
	[{ skill: 'table', of: [2, 5] }], //  (2: unused)
	[{ skill: 'table', of: [2, 5] }], //  3: √4 to √25
	[{ skill: 'table', of: [2, 5] }], //  4
	[{ skill: 'table', of: [6, 9] }], //  5: √36 to √81
	[{ skill: 'table', of: [6, 9] }], //  6
	[{ skill: 'table', of: [6, 12] }], // 7: and √121, √144
	[{ skill: 'tens', of: [2, 5] }], //   8: √400 to √2500
	[{ skill: 'tens', of: [2, 7] }], //   9: to √4900
	[
		{ skill: 'tens', of: [3, 7] }, //   10: √900 to √4900,
		{ skill: 'fives', of: [1, 2] } //       √225 and √625
	]
];

/** Every root a step can ask, each once. */
export function rootsAt(difficulty: number): number[] {
	return step(ROOT_LADDER, difficulty).flatMap(({ skill, of: [lo, hi] }) => {
		const roots: number[] = [];
		for (let k = lo; k <= hi; k++) if (skill !== 'table' || k !== 10) roots.push(rootOf(skill, k));
		return roots;
	});
}

/** "√144 = ?" — always a perfect square, always a whole answer, every root of its step as likely. */
export const sqrt: PuzzleGenerator = {
	kind: 'sqrt',
	minDifficulty: 3,
	maxDifficulty: 10,
	topics: () => ['sqrt'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const root = rng.pick(rootsAt(difficulty));
		return {
			kind: 'sqrt',
			difficulty,
			prompt: facePrompt({ kind: 'sqrt', numbers: [root * root] }),
			answer: root
		};
	}
};
