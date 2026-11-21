import type { Rng } from '../../rng.js';
import { facePrompt } from '../face.js';
import type { Puzzle, PuzzleGenerator, PuzzleTopic } from '../types.js';
import type { Band } from './arithmetic.js';

/** What a `double` face asks: a number doubled, or halved. */
export const DOUBLE = { double: 0, half: 1 } as const;

/**
 * One kind of puzzle on a step of the ladder: double a number, or halve one,
 * the number shown drawn from `shown` in steps of `every`: 1 for any number
 * (from 11 up never a round ten, which is a skill of its own), 10 for round
 * tens, 100 for round hundreds. Every half is whole: a number halved is
 * even, and a round one an odd number of tens or hundreds ("half of 70" is
 * 35, "half of 300" 150), since half of 80 is only half of 8 in disguise.
 */
export interface DoubleForm {
	how: keyof typeof DOUBLE;
	every: 1 | 10 | 100;
	shown: Band;
}

/**
 * Doubling and halving in the head, by school year ([[PRODUCT]] §4
 * "Puzzles", [[DECISIONS]]'s school-year scale): index = difficulty − 1, each
 * step's forms asked as often as each other. Within a form (`how` and
 * `every`), neither end of `shown` ever falls.
 */
export const DOUBLE_LADDER: readonly (readonly DoubleForm[])[] = [
	// 1 (age 6): doubles to 5 + 5.
	[{ how: 'double', every: 1, shown: [1, 5] }],
	// 2 (age 7): doubles to 10 + 10, across ten, and the halves of 4 to 18.
	[
		{ how: 'double', every: 1, shown: [6, 10] },
		{ how: 'half', every: 1, shown: [4, 18] }
	],
	// 3 (age 8): two digits to 25 and to 38, and round tens doubled.
	[
		{ how: 'double', every: 1, shown: [11, 25] },
		{ how: 'half', every: 1, shown: [12, 38] },
		{ how: 'double', every: 10, shown: [20, 50] }
	],
	// 4 (age 8): doubles to 49 and halves of 22 to 48, and of odd tens ("half of 70").
	[
		{ how: 'double', every: 1, shown: [21, 49] },
		{ how: 'half', every: 1, shown: [22, 48] },
		{ how: 'half', every: 10, shown: [30, 90] }
	],
	// 5 (age 9): doubles past 100, halves to 98, and round hundreds doubled past 1000.
	[
		{ how: 'double', every: 1, shown: [26, 75] },
		{ how: 'half', every: 1, shown: [42, 98] },
		{ how: 'double', every: 100, shown: [200, 900] }
	],
	// 6 (age 9): 51 to 99 doubled, halves to 148, and of odd hundreds ("half of 300").
	[
		{ how: 'double', every: 1, shown: [51, 99] },
		{ how: 'half', every: 1, shown: [52, 148] },
		{ how: 'half', every: 100, shown: [300, 900] }
	],
	// 7 (age 10): three digits to 249, and round tens to 490 doubled.
	[
		{ how: 'double', every: 1, shown: [101, 249] },
		{ how: 'half', every: 1, shown: [102, 248] },
		{ how: 'double', every: 10, shown: [110, 490] }
	],
	// 8 (age 10): doubles to 499 and halves to 498, and odd tens to 990 halved.
	[
		{ how: 'double', every: 1, shown: [126, 499] },
		{ how: 'half', every: 1, shown: [202, 498] },
		{ how: 'half', every: 10, shown: [110, 990] }
	],
	// 9 (age 11): three digits, doubled and halved.
	[
		{ how: 'double', every: 1, shown: [201, 699] },
		{ how: 'half', every: 1, shown: [252, 998] }
	],
	// 10 (age 12): the biggest three digits, doubled past 1000 and halved.
	[
		{ how: 'double', every: 1, shown: [501, 999] },
		{ how: 'half', every: 1, shown: [502, 998] }
	]
];

/**
 * "Double 8", "Half of 14" ([[PRODUCT]] §4 "Puzzles"): a step before the
 * times tables, worded by the client from the face (`double(0, 8)`), so
 * doubling and halving are each a topic of their own in the kid's record.
 */
export const double: PuzzleGenerator = {
	kind: 'double',
	minDifficulty: 1,
	maxDifficulty: 10,
	topics: (difficulty) => {
		const forms = DOUBLE_LADDER[difficulty - 1]!;
		const topics: PuzzleTopic[] = [];
		if (forms.some((f) => f.how === 'double')) topics.push('double');
		if (forms.some((f) => f.how === 'half')) topics.push('half');
		return topics;
	},
	generate(rng: Rng, difficulty: number): Puzzle {
		const form = rng.pick(DOUBLE_LADDER[difficulty - 1]!);
		const shown = rng.pick(numbersOf(form));
		return {
			kind: 'double',
			difficulty,
			prompt: facePrompt({ kind: 'double', numbers: [DOUBLE[form.how], shown] }),
			answer: form.how === 'double' ? shown * 2 : shown / 2
		};
	}
};

/**
 * Every number a form can show: on its steps; halved, an even number, or an
 * odd number of its tens or hundreds; and from 11 up never a round ten
 * unless round tens are the point.
 */
export function numbersOf(form: DoubleForm): number[] {
	const [lo, hi] = form.shown;
	const numbers: number[] = [];
	for (let n = Math.ceil(lo / form.every) * form.every; n <= hi; n += form.every) {
		if (form.how === 'half' && (form.every === 1 ? n % 2 !== 0 : (n / form.every) % 2 !== 1))
			continue;
		if (form.every === 1 && n > 10 && n % 10 === 0) continue;
		numbers.push(n);
	}
	return numbers;
}
