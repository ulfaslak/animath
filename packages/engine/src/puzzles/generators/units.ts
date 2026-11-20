import type { Rng } from '../../rng.js';
import { UNITS, UNIT_PAIRS, facePrompt, type UnitId } from '../face.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';
import type { Band } from './arithmetic.js';

/** A pair of units by name, big then small: `UNIT_PAIRS`' entries. */
export type PairName = `${UnitId}-${UnitId}`;

/**
 * One skill of a units step: a pair of units, how many big units there are
 * (`big`), and for a mixed amount or one with something left over how many
 * small units (`small`, each a multiple of `every`, 1 unless said).
 */
export interface UnitsSkill {
	pair: PairName;
	big: Band;
	small?: Band;
	every?: number;
}

/**
 * One step of the units ladder ([[PRODUCT]] §4 "Puzzles"): the skills each
 * thing it asks draws from. A puzzle asks one of the things the step has,
 * each as often, then one of its skills, each as often.
 */
export interface UnitsStep {
	/** "3 m = ? cm": a whole number of big units in small ones. */
	whole?: readonly UnitsSkill[];
	/** "2 m 35 cm = ? cm": big and small units together, in small ones. */
	mixed?: readonly UnitsSkill[];
	/** "300 cm = ? m": small units in big ones, always a whole number of them. */
	back?: readonly UnitsSkill[];
	/** "130 minutes = 2 hours and ? minutes": what is left over. */
	rest?: readonly UnitsSkill[];
}

/** The difficulty the units ladder starts at: measuring is taught from age 8 (2. klasse). */
export const UNITS_MIN_DIFFICULTY = 3;

/**
 * Index = difficulty − `UNITS_MIN_DIFFICULTY`. Whole conversions first, the
 * facts a kid of 8 knows (a week, an hour, a metre), then a kilo and a litre
 * at 5 and every pair at 6, where a unit of 10, 100 or 1000 small ones is
 * also turned back ("300 cm = ? m"): further up that is only reading digits.
 * Mixed amounts at 7 and 8 (age 10); at 9 bigger ones, and time turned back
 * ("360 minutes = ? hours"); at 10 bigger ones back and what is left over,
 * in time alone, where each is a sum in the head. Within a skill (a pair and
 * what is asked) no band's end ever falls and no band narrows, and a pair's
 * fewest big units never fall from one step to the next
 * (`puzzle-kinds.test.ts`).
 */
export const UNITS_LADDER: readonly UnitsStep[] = [
	// 3
	{
		whole: [
			{ pair: 'week-day', big: [1, 3] },
			{ pair: 'hour-minute', big: [1, 2] },
			{ pair: 'm-cm', big: [1, 5] }
		]
	},
	// 4
	{
		whole: [
			{ pair: 'week-day', big: [2, 4] },
			{ pair: 'hour-minute', big: [1, 3] },
			{ pair: 'm-cm', big: [2, 9] },
			{ pair: 'day-hour', big: [1, 2] }
		]
	},
	// 5
	{
		whole: [
			{ pair: 'week-day', big: [2, 5] },
			{ pair: 'hour-minute', big: [2, 4] },
			{ pair: 'm-cm', big: [2, 9] },
			{ pair: 'day-hour', big: [1, 3] },
			{ pair: 'year-month', big: [1, 3] },
			{ pair: 'kg-g', big: [1, 5] },
			{ pair: 'l-dl', big: [1, 9] }
		]
	},
	// 6
	{
		whole: [
			{ pair: 'week-day', big: [3, 8] },
			{ pair: 'hour-minute', big: [2, 5] },
			{ pair: 'm-cm', big: [3, 10] },
			{ pair: 'day-hour', big: [2, 4] },
			{ pair: 'year-month', big: [2, 5] },
			{ pair: 'kg-g', big: [2, 9] },
			{ pair: 'l-dl', big: [2, 10] },
			{ pair: 'minute-second', big: [1, 3] },
			{ pair: 'cm-mm', big: [2, 9] },
			{ pair: 'km-m', big: [1, 5] }
		],
		back: [
			{ pair: 'm-cm', big: [2, 9] },
			{ pair: 'kg-g', big: [2, 9] },
			{ pair: 'l-dl', big: [2, 9] },
			{ pair: 'cm-mm', big: [2, 9] },
			{ pair: 'km-m', big: [2, 9] }
		]
	},
	// 7
	{
		mixed: [
			{ pair: 'week-day', big: [3, 6], small: [1, 6] },
			{ pair: 'hour-minute', big: [2, 3], small: [5, 55], every: 5 },
			{ pair: 'm-cm', big: [3, 6], small: [5, 95], every: 5 },
			{ pair: 'year-month', big: [2, 4], small: [1, 11] },
			{ pair: 'kg-g', big: [2, 6], small: [50, 950], every: 50 }
		]
	},
	// 8
	{
		mixed: [
			{ pair: 'week-day', big: [3, 8], small: [1, 6] },
			{ pair: 'hour-minute', big: [2, 4], small: [5, 59] },
			{ pair: 'm-cm', big: [3, 9], small: [5, 99] },
			{ pair: 'year-month', big: [2, 5], small: [1, 11] },
			{ pair: 'kg-g', big: [2, 9], small: [50, 995], every: 5 },
			{ pair: 'day-hour', big: [2, 3], small: [1, 23] },
			{ pair: 'minute-second', big: [1, 3], small: [5, 55], every: 5 },
			{ pair: 'km-m', big: [2, 5], small: [50, 950], every: 50 }
		]
	},
	// 9
	{
		mixed: [
			{ pair: 'week-day', big: [3, 9], small: [1, 6] },
			{ pair: 'hour-minute', big: [2, 5], small: [5, 59] },
			{ pair: 'm-cm', big: [3, 12], small: [5, 99] },
			{ pair: 'day-hour', big: [2, 4], small: [1, 23] },
			{ pair: 'kg-g', big: [3, 10], small: [50, 995], every: 5 },
			{ pair: 'minute-second', big: [2, 4], small: [5, 59] }
		],
		back: [
			{ pair: 'week-day', big: [3, 9] },
			{ pair: 'hour-minute', big: [3, 6] },
			{ pair: 'day-hour', big: [3, 5] },
			{ pair: 'year-month', big: [3, 6] },
			{ pair: 'minute-second', big: [3, 6] }
		]
	},
	// 10
	{
		back: [
			{ pair: 'week-day', big: [5, 12] },
			{ pair: 'hour-minute', big: [3, 9] },
			{ pair: 'day-hour', big: [3, 7] },
			{ pair: 'year-month', big: [3, 10] },
			{ pair: 'minute-second', big: [3, 10] }
		],
		rest: [
			{ pair: 'week-day', big: [3, 8], small: [1, 6] },
			{ pair: 'hour-minute', big: [2, 4], small: [5, 59] },
			{ pair: 'day-hour', big: [2, 3], small: [1, 23] },
			{ pair: 'year-month', big: [3, 6], small: [1, 11] },
			{ pair: 'minute-second', big: [2, 4], small: [5, 59] }
		]
	}
];

/** What a step asks, in `UNITS`' order. */
const ASKS = ['whole', 'mixed', 'back', 'rest'] as const;

/** The index of a pair in `UNIT_PAIRS`: the number a face names it by. */
export function pairIndex(name: PairName): number {
	const i = UNIT_PAIRS.findIndex((p) => `${p.big}-${p.small}` === name);
	if (i < 0) throw new Error(`units: no pair ${name}`);
	return i;
}

/**
 * Measuring (Fælles Mål's "måling"): "3 m = ? cm", "2 hours = ? minutes",
 * "2 m 35 cm = ? cm", "3000 g = ? kg". A kind of words with no picture:
 * its prompt is its face written out, which the client words in the
 * language on screen. Every answer is a whole number of the unit asked for.
 */
export const units: PuzzleGenerator = {
	kind: 'units',
	minDifficulty: UNITS_MIN_DIFFICULTY,
	maxDifficulty: 10,
	topics: () => ['units'],
	generate(rng: Rng, difficulty: number): Puzzle {
		const step = UNITS_LADDER[difficulty - UNITS_MIN_DIFFICULTY]!;
		const ask = rng.pick(ASKS.filter((a) => step[a] !== undefined));
		const skill = rng.pick(step[ask]!);
		const pair = pairIndex(skill.pair);
		const per = UNIT_PAIRS[pair]!.per;
		const big = rng.int(...skill.big);
		const every = skill.every ?? 1;
		const small = skill.small
			? every * rng.int(Math.ceil(skill.small[0] / every), Math.floor(skill.small[1] / every))
			: 0;
		const how = UNITS[ask];
		const [numbers, answer] =
			ask === 'whole'
				? [[how, pair, big, 0], big * per]
				: ask === 'mixed'
					? [[how, pair, big, small], big * per + small]
					: ask === 'back'
						? [[how, pair, big * per, 0], big]
						: [[how, pair, big * per + small, big], small];
		return {
			kind: 'units',
			difficulty,
			prompt: facePrompt({ kind: 'units', numbers }),
			answer
		};
	}
};
