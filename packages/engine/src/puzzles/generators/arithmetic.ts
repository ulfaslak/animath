import type { Rng } from '../../rng.js';
import { facePrompt } from '../face.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';

/**
 * A closed band `[lo, hi]` a number is drawn from, so each difficulty has a
 * floor as well as a ceiling: a difficulty-3 attack can never ask "4 + 1"
 * (#7). [[PRODUCT]] §4 "Puzzles" states every table here in prose.
 */
export type Band = readonly [lo: number, hi: number];

/**
 * add / sub (index = difficulty − 1): both numbers the kid combines come from
 * the same band, so sums at difficulty d start above every sum at d − 1, and
 * both ends never fall; `puzzles.test.ts` pins what a kid sees because of it
 * (the smallest and the largest number in a prompt never fall, and d shows a
 * bigger number than anything at d − 2). The doctor's token sums size
 * themselves by it too (`doctor/tokens.ts`).
 */
export const ADD_BAND: readonly Band[] = [
	[1, 5], //      1: within 10
	[6, 10], //     2: crossing 10
	[11, 20], //    3: teens
	[21, 50], //    4: two-digit
	[51, 100], //   5: up to 200
	[101, 200], //  6: three-digit
	[201, 500],
	[501, 1000],
	[1001, 5000],
	[5001, 10000]
];

/**
 * The skills of the times tables, easiest first. A step of `TIMES_LADDER`
 * never asks a skill before one the step below it asks.
 */
export const TIMES_SKILLS = ['table', 'teen', 'two-digit', 'three-digit', 'teen-by-teen'] as const;
export type TimesSkill = (typeof TIMES_SKILLS)[number];

/** One way to multiply at a step: a big factor from `big` times a small one from `small`. */
export interface TimesForm {
	skill: TimesSkill;
	big: Band;
	small: Band;
}

/**
 * mul / div / the missing factor, on the school-year scale ([[DECISIONS]] §
 * Gameplay; index = difficulty − 1): what a kid of that age multiplies in
 * their head. The small tables first, the hard corner (6–9 × 6–9) at 5–6,
 * a teen or two digits by one at 7–8, and at the top a teen by a teen or
 * three digits by one, never anything that needs paper. Within a skill
 * neither end of any band ever falls, no two neighbouring steps are the same
 * (a harder level never asks the very sums of the one below, #32), and no
 * factor is a multiple of ten ("10 × 7" is a freebie, and "40 × 7" is the
 * times table with a nought on). Difficulty 1 is below `mul.minDifficulty`;
 * its row keeps the table aligned. Today's animals ask multiplication up to
 * 9 (a bear's Swipe on hard) and division up to 10.
 */
export const TIMES_LADDER: readonly (readonly TimesForm[])[] = [
	[{ skill: 'table', big: [2, 5], small: [2, 2] }], //       (1: unused)
	[{ skill: 'table', big: [2, 5], small: [2, 2] }], //       2: the two-times table
	[{ skill: 'table', big: [2, 5], small: [2, 5] }], //       3: the small tables
	[{ skill: 'table', big: [6, 9], small: [3, 5] }], //       4: 6–9 in the 3-, 4- and 5-times tables
	[{ skill: 'table', big: [6, 9], small: [6, 7] }], //       5: the 6- and 7-times tables
	[{ skill: 'table', big: [6, 9], small: [6, 9] }], //       6: the whole hard corner
	[{ skill: 'teen', big: [12, 19], small: [3, 9] }], //      7: a teen by a digit
	[{ skill: 'two-digit', big: [21, 49], small: [3, 9] }], // 8: two digits by one
	[
		{ skill: 'three-digit', big: [112, 199], small: [3, 4] }, // 9: three digits by one
		{ skill: 'teen-by-teen', big: [12, 19], small: [12, 13] } //    or a teen by a teen
	],
	[
		{ skill: 'three-digit', big: [112, 199], small: [3, 5] }, // 10: 199 × 5 at most
		{ skill: 'teen-by-teen', big: [12, 19], small: [12, 15] } //     18 × 15
	]
];

/**
 * The forms division and the missing factor ask at a step: the times table
 * backwards, never by more than 9, since "270 ÷ 15" is a guess, not a sum a
 * kid does in their head.
 */
export function backwardsForms(difficulty: number): readonly TimesForm[] {
	return step(TIMES_LADDER, difficulty).filter((f) => f.small[1] <= 9);
}

/** One step of the missing addend: the number shown beside the "?" from `part`, the "?" from `answer`. */
export interface AddendStep {
	part: Band;
	answer: Band;
}

/**
 * The missing addend ("37 + ? = 81": a take-away in disguise), on the
 * school-year scale (index = difficulty − 1). Within 10, then across the
 * ten, at 1–2; two-digit numbers at 2. klasse (3–4); across a hundred with a
 * two-digit "?" at 3. klasse (5–6: the shown number's last two digits and the
 * "?" are both 51 or more, so the sum always passes the next hundred);
 * three-digit numbers at 4. klasse (7–8); across a thousand at 5.–6. klasse
 * (9–10, both 501 or more). Neither end of either band ever falls, no two
 * neighbouring steps are the same, and neither the number shown nor the "?"
 * is a multiple of ten ("20 + ? = 37" asks nothing). Today's animals ask
 * missing numbers up to 6.
 */
export const ADDEND_LADDER: readonly AddendStep[] = [
	{ part: [1, 5], answer: [1, 5] }, //         1: within 10
	{ part: [6, 9], answer: [6, 9] }, //         2: across the ten
	{ part: [11, 19], answer: [11, 19] }, //     3: teens
	{ part: [21, 49], answer: [21, 49] }, //     4: within 100
	{ part: [51, 99], answer: [51, 99] }, //     5: across 100
	{ part: [151, 199], answer: [51, 99] }, //   6: across 200
	{ part: [151, 299], answer: [101, 249] }, // 7: three-digit
	{ part: [151, 499], answer: [101, 499] }, // 8: within 1000
	{ part: [501, 749], answer: [501, 749] }, // 9: across 1000
	{ part: [501, 999], answer: [501, 749] } //  10
];

/** Row `difficulty` of a table indexed by difficulty − 1, clamped to its ends. */
export function step<T>(table: readonly T[], difficulty: number): T {
	return table[Math.min(Math.max(difficulty, 1), table.length) - 1] as T;
}

export function band(table: readonly Band[], difficulty: number): Band {
	return step(table, difficulty);
}

function draw(rng: Rng, [lo, hi]: Band): number {
	return rng.int(lo, hi);
}

/**
 * A number from `[lo, hi]` that is not a multiple of ten, each as likely.
 * Every band it is given holds one (`puzzles.test.ts` § skill ladders).
 */
export function drawUnround(rng: Rng, [lo, hi]: Band): number {
	const unround: number[] = [];
	for (let n = lo; n <= hi; n++) if (n % 10 !== 0) unround.push(n);
	return rng.pick(unround);
}

/** A form of `forms`, each as likely, and its two factors. */
function drawTimes(rng: Rng, forms: readonly TimesForm[]): { big: number; small: number } {
	const form = rng.pick(forms);
	return { big: drawUnround(rng, form.big), small: drawUnround(rng, form.small) };
}

export const add: PuzzleGenerator = {
	kind: 'add',
	minDifficulty: 1,
	maxDifficulty: 10,
	topics: () => ['add'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const b = band(ADD_BAND, difficulty);
		const x = draw(rng, b);
		const y = draw(rng, b);
		return {
			kind: 'add',
			difficulty,
			prompt: facePrompt({ kind: 'add', numbers: [x, y] }),
			answer: x + y
		};
	}
};

/** The same fact family as `add`, read backwards: `(x + y) − x = y`. */
export const sub: PuzzleGenerator = {
	kind: 'sub',
	minDifficulty: 1,
	maxDifficulty: 10,
	topics: () => ['sub'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const b = band(ADD_BAND, difficulty);
		const x = draw(rng, b);
		const y = draw(rng, b);
		return {
			kind: 'sub',
			difficulty,
			prompt: facePrompt({ kind: 'sub', numbers: [x + y, x] }),
			answer: y
		};
	}
};

export const mul: PuzzleGenerator = {
	kind: 'mul',
	minDifficulty: 2,
	maxDifficulty: 10,
	topics: () => ['mul'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const { big, small } = drawTimes(rng, step(TIMES_LADDER, difficulty));
		return {
			kind: 'mul',
			difficulty,
			prompt: facePrompt({ kind: 'mul', numbers: [big, small] }),
			answer: big * small
		};
	}
};

/** The same fact family as `mul`, read backwards: `(big × small) ÷ small = big`. */
export const div: PuzzleGenerator = {
	kind: 'div',
	minDifficulty: 3,
	maxDifficulty: 10,
	topics: () => ['div'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const { big, small } = drawTimes(rng, backwardsForms(difficulty));
		return {
			kind: 'div',
			difficulty,
			prompt: facePrompt({ kind: 'div', numbers: [big * small, small] }),
			answer: big
		};
	}
};

/**
 * From this difficulty on, half of the missing-number puzzles hide a number in
 * a times table ("4 × ? = 20") instead of a sum.
 */
const MISSING_TIMES_FROM = 4;

/** "7 + ? = 12" / "4 × ? = 20": solve for the missing operand. */
export const missing: PuzzleGenerator = {
	kind: 'missing',
	minDifficulty: 1,
	maxDifficulty: 10,
	topics: (difficulty) => (difficulty < MISSING_TIMES_FROM ? ['missing'] : ['missing', 'mul']),
	generate(rng: Rng, difficulty: number): Puzzle {
		if (difficulty < MISSING_TIMES_FROM || rng.chance(0.5)) {
			const { part, answer: gap } = step(ADDEND_LADDER, difficulty);
			const x = drawUnround(rng, part);
			const answer = drawUnround(rng, gap);
			return {
				kind: 'missing',
				difficulty,
				prompt: facePrompt({ kind: 'missing', numbers: [x, x + answer] }),
				answer
			};
		}
		const { big: answer, small } = drawTimes(rng, backwardsForms(difficulty));
		return {
			kind: 'missing',
			difficulty,
			prompt: facePrompt({ kind: 'missing', numbers: [small, small * answer], times: true }),
			answer
		};
	}
};
