import { KRONER, THERMOMETER, UNITS, UNIT_PAIRS, type PuzzleFace } from './face.js';
import { DOUBLE } from './generators/double.js';

/**
 * One piece of a hint's sum: a number, a sign, the unknown (`?`, or `□` on
 * a balance) or a bracket. A pair of brackets is a part to work out first:
 * the page draws it as a pill, never as the brackets themselves.
 */
export type HintToken = number | '+' | '−' | '×' | '÷' | '=' | '?' | '□' | '(' | ')';

/**
 * Help with a puzzle: the same question, made easier to see. Worked out
 * from the numbers on screen alone (`PuzzleFace`), so it never holds the
 * answer and any screen that shows a puzzle can show its hint.
 *
 * - `equation`: a sum the answer makes true, in easier parts:
 *   "? = (10 × 8) + (3 × 8)" for 13 × 8, "? = 12 − 7" for 7 + ? = 12,
 *   "□ = (5 + 6) − 8" for 8 + □ = 5 + 6. The unknown stands where the
 *   answer goes, and the other side is never a bare number, nor the answer
 *   beside a step worth nothing (no 0, no 10 − 10, no × 1).
 * - `gaps`: a number pattern's jumps, how much each number is more than the
 *   one before ("+3 +5 +7" over 1, 4, 9, 16): the next jump is the puzzle.
 * - `dots`: a sum small enough to count, `a` dots and `b` more, or `a` dots
 *   with `b` of them taken away (`take`).
 */
export type PuzzleHint =
	| { form: 'equation'; tokens: readonly HintToken[] }
	| { form: 'gaps'; gaps: readonly number[] }
	| { form: 'dots'; a: number; b: number; take: boolean };

/**
 * The hint for a puzzle, or null when there is none: the sum is already as
 * easy as it gets ("10 + 7", "40 + 30"), or the kind asks the kid to read
 * something (a clock, a bar chart), which no sum makes easier.
 */
export function puzzleHint(face: PuzzleFace): PuzzleHint | null {
	const at = (i: number) => face.numbers[i] as number;
	switch (face.kind) {
		case 'add':
			return addHint(at(0), at(1));
		case 'sub':
			return subHint(at(0), at(1));
		case 'mul':
			return mulHint(at(0), at(1));
		case 'div':
			return divHint(at(0), at(1));
		case 'missing':
			return equation(['?', '=', at(1), face.times ? '÷' : '−', at(0)]);
		case 'sequence': {
			const n = face.numbers;
			return { form: 'gaps', gaps: n.slice(1).map((x, i) => x - (n[i] as number)) };
		}
		case 'sqrt':
			return equation(['?', '×', '?', '=', at(0)]);
		case 'double':
			return at(0) === DOUBLE.half ? halfHint(at(1)) : doubleHint(at(1));
		case 'balance':
			return balanceHint(at(0), at(1), at(2), at(3));
		case 'thermometer':
			return thermometerHint(at(0), at(1), at(2));
		case 'kroner':
			return kronerHint(face.numbers);
		case 'fraction':
			return at(0) === 1
				? equation(['?', '=', at(2), '÷', at(1)])
				: equation(['?', '=', '(', at(2), '÷', at(1), ')', '×', at(0)]);
		case 'shape':
			return shapeHint(at(0), at(1), at(2), at(3), at(4), at(5));
		case 'units':
			return unitsHint(at(0), at(1), at(2), at(3));
		case 'barchart':
		case 'clock':
			return null;
	}
}

function equation(tokens: HintToken[]): PuzzleHint {
	return { form: 'equation', tokens };
}

/** The sum on the right of "? =": the unknown first, then the easier sum. */
function same(tokens: HintToken[]): PuzzleHint {
	return equation(['?', '=', ...tokens]);
}

/**
 * A whole number's places that are not 0, the biggest first, each as much as
 * it is worth: 4507 is 4000, 500 and 7. The thousands stay together, as the
 * number is read: 12640 is twelve thousand (12000), 600 and 40, so the
 * druid's biggest token sums stay a few parts long.
 */
function places(n: number): number[] {
	const digits = String(n);
	const parts = [...digits].map((d, i) => Number(d) * 10 ** (digits.length - 1 - i));
	const thousands = parts.filter((p) => p >= 1000).reduce((sum, p) => sum + p, 0);
	return [thousands, ...parts.filter((p) => p < 1000)].filter((part) => part > 0);
}

/** The parts joined with a sign, each part of more than one number in a pill. */
function joined(parts: readonly HintToken[][], sign: '+' | '−'): HintToken[] {
	return parts.flatMap((part, i) => [
		...(i > 0 ? [sign] : []),
		...(part.length > 1 ? ['(' as const, ...part, ')' as const] : part)
	]);
}

/**
 * Adding: a sum to 10 is counted on dots; two numbers under 10 make a ten
 * first, the bigger filled up to it (8 + 7 is 8 + 2 + 5); anything bigger
 * adds place by place, the hundreds with the hundreds, the tens with the
 * tens, the ones with the ones (83 + 132 is 100 + (80 + 30) + (3 + 2)).
 */
function addHint(a: number, b: number): PuzzleHint | null {
	if (a < 1 || b < 1) return null;
	if (a + b <= 10) return { form: 'dots', a, b, take: false };
	if (a < 10 && b < 10) {
		const big = Math.max(a, b);
		const fill = 10 - big;
		return same([big, '+', fill, '+', Math.min(a, b) - fill]);
	}
	const pa = places(a);
	const pb = places(b);
	const units = [...new Set([...pa, ...pb].map(unitOf))].sort((x, y) => y - x);
	const parts = units.map((unit) =>
		[pa.find((p) => unitOf(p) === unit), pb.find((p) => unitOf(p) === unit)]
			.filter((p): p is number => p !== undefined)
			.flatMap((p, i): HintToken[] => (i > 0 ? ['+', p] : [p]))
	);
	// Nothing to add up in a place of its own (40 + 30), or nothing sharing a place (30 + 4).
	if (parts.length < 2 || parts.every((part) => part.length === 1)) return null;
	return same(joined(parts, '+'));
}

/**
 * Doubling is adding a number to itself, so it breaks down as that sum does
 * (dots to 5 + 5, 7 + 7 through the ten, 37 + 37 place by place: (30 + 30) +
 * (7 + 7)); a round number doubles its digit and puts the zeros back on
 * (double 40 is (4 + 4) × 10), and 10 is 10 + 10.
 */
function doubleHint(n: number): PuzzleHint | null {
	if (n < 1) return null;
	const added = addHint(n, n);
	if (added) return added;
	const unit = unitOf(n);
	const digit = n / unit;
	if (!Number.isInteger(digit)) return null;
	return digit === 1 ? same([n, '+', n]) : same(['(', digit, '+', digit, ')', '×', unit]);
}

/**
 * Halving: to 18, the double the kid knows backwards (half of 14 is
 * ? + ? = 14); bigger, place by place, each place an even number of its
 * tens or hundreds, so each halves as a double the kid knows. A place with
 * an odd count passes one of them down to the next: half of 76 is
 * (60 ÷ 2) + (16 ÷ 2), half of 70 is (60 ÷ 2) + (10 ÷ 2), half of 348 is
 * (200 ÷ 2) + (140 ÷ 2) + (8 ÷ 2). The ones of an even number are even, so
 * what reaches them always halves whole.
 */
function halfHint(n: number): PuzzleHint | null {
	if (n < 2 || n % 2 !== 0) return null;
	const knownDouble = equation(['?', '+', '?', '=', n]);
	if (n <= 18) return knownDouble;
	const digits = [...String(n)].map(Number);
	const parts: number[] = [];
	let carried = 0;
	digits.forEach((digit, i) => {
		const unit = 10 ** (digits.length - 1 - i);
		const count = carried * 10 + digit;
		carried = unit > 1 && count % 2 === 1 ? 1 : 0;
		if (count - carried > 0) parts.push((count - carried) * unit);
	});
	// A number whose halving is one such step (20, 100, 160) is a double the kid knows.
	if (parts.length < 2) return knownDouble;
	return same(
		joined(
			parts.map((part): HintToken[] => [part, '÷', 2]),
			'+'
		)
	);
}

/** The place a part sits in: 1, 10, 100, or the thousands (`places`). */
function unitOf(part: number): number {
	return part >= 1000 ? 1000 : 10 ** (String(part).length - 1);
}

/**
 * Taking away: from 10 or less it is counted on dots; a number under 10
 * goes through the ten below (15 − 7 is 15 − 5 − 2, 48 − 6 is
 * 40 + (8 − 6), 40 − 7 is 30 + (10 − 7)); a bigger one is taken away a
 * place at a time (132 − 83 is 132 − 80 − 3), so no step goes below 0.
 */
function subHint(a: number, b: number): PuzzleHint | null {
	if (b < 1 || b > a) return null;
	if (a <= 10) return { form: 'dots', a, b, take: true };
	if (b < 10) {
		const ones = a % 10;
		if (ones === 0) return same([a - 10, '+', '(', 10, '−', b, ')']);
		if (b > ones) return same([a, '−', ones, '−', b - ones]);
		if (b < ones) return same([a - ones, '+', '(', ones, '−', b, ')']);
		return null;
	}
	const parts = places(b);
	if (parts.length > 1) return same([a, ...parts.flatMap((p): HintToken[] => ['−', p])]);
	// A round number goes from the round part of the other (72 − 30 is (70 − 30) + 2), but
	// not when that part is the round number itself: (10 − 10) + 6 would say 16 − 10 is 6.
	const rest = a % unitOf(b);
	return rest > 0 && a - rest !== b ? same(['(', a - rest, '−', b, ')', '+', rest]) : null;
}

/**
 * Times: a small table is the bigger number added up (4 × 3 is
 * 4 + 4 + 4); the hard corner of the table goes through 5 (8 × 7 is
 * (8 × 5) + (8 × 2)); with a number past 10 that number is split into its
 * places, the smaller one when both are (13 × 8 is (10 × 8) + (3 × 8),
 * 67 × 14 is (67 × 10) + (67 × 4)), and a round one takes its zeros off
 * (20 × 6 is (2 × 6) × 10). The factors keep their sides.
 */
function mulHint(a: number, b: number): PuzzleHint | null {
	if (a < 2 || b < 2) return null;
	const big = Math.max(a, b);
	const small = Math.min(a, b);
	if (big <= 10 && small <= 5) {
		return same(
			Array.from({ length: small }, () => big).flatMap((x, i) => (i > 0 ? ['+', x] : [x]))
		);
	}
	// Which factor is split: `a` (the left one) when `left` is true. A part of 1 is the other
	// factor itself, never "× 1" (8 × 6 is (8 × 5) + 8).
	const splitting = (left: boolean, parts: readonly number[]) =>
		same(
			joined(
				parts.map((p) => (p === 1 ? [left ? b : a] : left ? [p, '×', b] : [a, '×', p])),
				'+'
			)
		);
	if (big < 10) {
		const left = a <= b;
		return splitting(left, [5, small - 5]);
	}
	const smallParts = places(small);
	const bigParts = places(big);
	if (small >= 10 && smallParts.length > 1) return splitting(a === small && a !== b, smallParts);
	if (bigParts.length > 1) return splitting(a === big, bigParts);
	// A table and a round number: the zeros come off and go back on (20 × 6 is (2 × 6) × 10).
	// A hundred or a thousand has no table to take off: 100 × 7 is as easy as it gets.
	const tens = unitOf(big);
	const digit = big / tens;
	if (small < 10 && big >= 20 && digit > 1) {
		const table: HintToken[] = a === big ? [digit, '×', b] : [a, '×', digit];
		return same(['(', ...table, ')', '×', tens]);
	}
	return null;
}

/**
 * Sharing: a table turns round into its times (24 ÷ 3 is 3 × ? = 24); an
 * answer of 10 or more is shared out a place of the answer at a time
 * (126 ÷ 7 is (70 ÷ 7) + (56 ÷ 7)), and a round one takes its zeros off
 * (1710 ÷ 19 is (171 ÷ 19) × 10).
 */
function divHint(a: number, b: number): PuzzleHint | null {
	if (b < 2 || a % b !== 0 || a / b < 2) return null;
	const answer = a / b;
	const parts = places(answer);
	if (parts.length > 1)
		return same(
			joined(
				parts.map((p) => [p * b, '÷', b]),
				'+'
			)
		);
	// A round answer: the zeros come off and go back on (1710 ÷ 19 is (171 ÷ 19) × 10); an
	// answer of 100 or 1000 would be (24 ÷ 24) × 100, the answer itself, so it turns round.
	const tens = unitOf(answer);
	if (answer >= 20 && answer / tens > 1) return same(['(', a / tens, '÷', b, ')', '×', tens]);
	return equation([b, '×', '?', '=', a]);
}

/**
 * The balance: the box alone on one side, the rest worked out on the other
 * ("8 + □ = 5 + 6" is □ = (5 + 6) − 8), or, with a times and a plus or
 * minus, one step towards it ("4 × □ + 7 = 35" is 4 × □ = 35 − 7).
 */
function balanceHint(form: number, a: number, b: number, c: number): PuzzleHint | null {
	switch (form) {
		case 0:
			return equation(['□', '=', '(', b, '+', c, ')', '−', a]);
		case 1:
			return equation(['□', '=', a, '−', '(', b, '−', c, ')']);
		case 2:
			return equation(['□', '=', '(', b, '×', c, ')', '÷', a]);
		case 3:
			return equation([a, '×', '□', '=', c, '−', b]);
		case 4:
			return equation([a, '×', '□', '=', c, '+', b]);
		default:
			return null;
	}
}

/**
 * The thermometer as a sum, through 0 when it crosses it: 3° and 5° colder
 * is 3 − 3 − (5 − 3) (down to 0, then what is left of the 5), from −4° to
 * 7° is 4 + 7 degrees. A thermometer that starts or ends at 0° has nothing
 * easier in it, and no hint.
 */
function thermometerHint(how: number, a: number, b: number): PuzzleHint | null {
	if (a === 0 || ((how === THERMOMETER.rose || how === THERMOMETER.fell) && b === 0)) return null;
	switch (how) {
		case THERMOMETER.colder:
			return a > 0 && a - b < 0 ? same([a, '−', a, '−', '(', b, '−', a, ')']) : same([a, '−', b]);
		case THERMOMETER.warmer:
			return a < 0 && a + b > 0 ? same([a, '+', -a, '+', '(', b, '−', -a, ')']) : same([a, '+', b]);
		case THERMOMETER.rose:
			if (a < 0 && b > 0) return same([-a, '+', b]);
			return b < 0 ? same([-a, '−', -b]) : same([b, '−', a]);
		case THERMOMETER.fell:
			if (a > 0 && b < 0) return same([a, '+', -b]);
			return a < 0 ? same([-b, '−', -a]) : same([a, '−', b]);
		default:
			return null;
	}
}

/**
 * Units: the sum behind the conversion, with how many small units make a big
 * one written in ("2 hours and 35 minutes = ? minutes" is (2 × 60) + 35,
 * "360 minutes = ? hours" is 360 ÷ 60, "130 minutes = 2 hours and ?
 * minutes" is 130 − (2 × 60)). One whole big unit has none: "1 hour = ?
 * minutes" would be 1 × 60, a step that changes nothing.
 */
function unitsHint(how: number, pair: number, a: number, b: number): PuzzleHint | null {
	const per = UNIT_PAIRS[pair]?.per;
	if (per === undefined) return null;
	const big = (n: number): HintToken[] => (n > 1 ? ['(', n, '×', per, ')'] : [per]);
	switch (how) {
		case UNITS.whole:
			return a > 1 ? same([a, '×', per]) : null;
		case UNITS.mixed:
			return same([...big(a), '+', b]);
		case UNITS.back:
			return same([a, '÷', per]);
		case UNITS.rest:
			return same([a, '−', ...big(b)]);
		default:
			return null;
	}
}

/**
 * Danish money as a sum: the coins and notes in the picture, the biggest
 * first, and what the things cost taken away from them.
 */
function kronerHint(numbers: readonly number[]): PuzzleHint | null {
	const how = numbers[0] as number;
	const pieces = KRONER.flatMap((value, i) =>
		Array.from({ length: numbers[i + 1] as number }, () => value)
	).reverse();
	const money = pieces.flatMap((v, i): HintToken[] => (i > 0 ? ['+', v] : [v]));
	if (how === 0) return pieces.length > 1 ? same(money) : null;
	const prices = (how === 1 ? [numbers[9]] : [numbers[9], numbers[10]]) as number[];
	const paid: HintToken[] = pieces.length > 1 ? ['(', ...money, ')'] : money;
	return same([...paid, ...prices.flatMap((p): HintToken[] => ['−', p])]);
}

/**
 * A floor is its rows added up, or a times when its sides are written on
 * (an L is the rectangle with the corner taken away); a fence is its sides
 * added up, all the way round; a side missing is the times or the fence with
 * a "?" for that side.
 */
function shapeHint(
	how: number,
	w: number,
	h: number,
	cw: number,
	ch: number,
	grid: number
): PuzzleHint | null {
	const cut = cw > 0 && ch > 0;
	switch (how) {
		case 0:
			// A corner one tile wide is its row of tiles, never "1 × 2".
			if (cut)
				return same(joined([[w, '×', h], cw === 1 ? [ch] : ch === 1 ? [cw] : [cw, '×', ch]], '−'));
			if (w < 2 || h < 2) return null;
			// Drawn in squares: its rows added up, or its columns when there are fewer of them.
			if (grid === 1) {
				const [count, each] = h <= w ? [h, w] : [w, h];
				return same(
					Array.from({ length: count }, () => each).flatMap((x, i) => (i > 0 ? ['+', x] : [x]))
				);
			}
			return same([w, '×', h]);
		case 1: {
			// Clockwise from the top left, as the picture writes them.
			const sides = cut ? [w - cw, ch, cw, h - ch, w, h] : [w, h, w, h];
			return same(sides.flatMap((s, i): HintToken[] => (i > 0 ? ['+', s] : [s])));
		}
		case 2:
			return equation([w, '×', '?', '=', h]);
		case 3:
			return equation([w, '+', '?', '+', w, '+', '?', '=', h]);
		default:
			return null;
	}
}
