import { describe, expect, it } from 'vitest';
import {
	BLOCKS,
	MAX_BIG_UNITS,
	MAX_BLOCKS,
	MAX_DOUBLED,
	UNITS,
	UNIT_PAIRS,
	puzzleFace
} from '../src/puzzles/face.js';
import { BALANCE_LADDER } from '../src/puzzles/generators/balance.js';
import { BARCHART, BARCHART_LADDER } from '../src/puzzles/generators/barchart.js';
import { TIMES_LADDER } from '../src/puzzles/generators/arithmetic.js';
import { BLOCKS_LADDER, type BlocksForm } from '../src/puzzles/generators/blocks.js';
import { CLOCK, CLOCK_LADDER } from '../src/puzzles/generators/clock.js';
import { DOUBLE, DOUBLE_LADDER } from '../src/puzzles/generators/double.js';
import { FRACTION_LADDER } from '../src/puzzles/generators/fraction.js';
import { KRONER_LADDER } from '../src/puzzles/generators/kroner.js';
import { SHAPE_LADDER } from '../src/puzzles/generators/shape.js';
import { THERMOMETER_LADDER } from '../src/puzzles/generators/thermometer.js';
import {
	UNITS_LADDER,
	UNITS_MIN_DIFFICULTY,
	pairIndex,
	type UnitsStep
} from '../src/puzzles/generators/units.js';
import { generatePuzzle, getGenerator } from '../src/puzzles/registry.js';
import type { PuzzleKind } from '../src/puzzles/types.js';
import { Rng } from '../src/rng.js';

/**
 * The kinds that climb by skill, the Arctic's (#191) and doubling and
 * halving: each climbs its own ladder, a table per kind ([[PRODUCT]] §4
 * "Puzzles"), and keeps the promises a kid relies on. Their answers against
 * an independent solver are in `puzzles.test.ts`.
 */

type Band = readonly [number, number];

/** Every band's two ends, row by row, never fall over the difficulties given (index = difficulty − 1). */
function climbs(rows: readonly Band[], from = 1, to = rows.length): string[] {
	const bad: string[] = [];
	for (let d = from + 1; d <= to; d++) {
		const [lo, hi] = rows[d - 1]!;
		const [plo, phi] = rows[d - 2]!;
		if (lo < plo || hi < phi) bad.push(`d${d}: [${lo}, ${hi}] after [${plo}, ${phi}]`);
		if (lo > hi) bad.push(`d${d}: [${lo}, ${hi}] is empty`);
	}
	return bad;
}

/** A band, row by row, never narrower than the row before: a step only makes room for more. */
function narrows(rows: readonly Band[]): string[] {
	const bad: string[] = [];
	for (let i = 1; i < rows.length; i++) {
		const [[plo, phi], [lo, hi]] = [rows[i - 1]!, rows[i]!];
		if (hi - lo < phi - plo) bad.push(`row ${i + 1}: [${lo}, ${hi}] after [${plo}, ${phi}]`);
	}
	return bad;
}

/** The numbers of `count` puzzles of a kind at a difficulty, as their faces hold them. */
function faces(kind: PuzzleKind, d: number, count = 400): number[][] {
	const rng = new Rng(4000 + 100 * d);
	const g = getGenerator(kind);
	return Array.from({ length: count }, () => {
		const p = g.generate(rng, d);
		const face = puzzleFace(p);
		if (!face) throw new Error(`no face for ${p.prompt}`);
		return [...face.numbers, p.answer];
	});
}

const DS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('the ladders climb', () => {
	it('every kind has a step for each difficulty from 1 to 10', () => {
		for (const ladder of [
			THERMOMETER_LADDER,
			KRONER_LADDER,
			FRACTION_LADDER,
			SHAPE_LADDER,
			BARCHART_LADDER,
			BALANCE_LADDER,
			CLOCK_LADDER,
			DOUBLE_LADDER,
			BLOCKS_LADDER
		])
			expect(ladder).toHaveLength(10);
	});

	it('double: doubles alone at 1, halves from 2, and each form climbs wherever it is asked', () => {
		expect(DOUBLE_LADDER[0]!.map((f) => f.how)).toEqual(['double']);
		for (const forms of DOUBLE_LADDER.slice(1)) {
			expect(forms.map((f) => f.how)).toContain('double');
			expect(forms.map((f) => f.how)).toContain('half');
		}
		// A form is what is done and to what: any number, round tens or round hundreds.
		const rows = new Map<string, Band[]>();
		for (const forms of DOUBLE_LADDER)
			for (const f of forms) {
				const key = `${f.how} every ${f.every}`;
				rows.set(key, [...(rows.get(key) ?? []), f.shown]);
			}
		for (const [key, bands] of rows) expect(climbs(bands), key).toEqual([]);
		// A face takes no number bigger than the ladder shows (`faceFits`).
		expect(Math.max(...DOUBLE_LADDER.flat().map((f) => f.shown[1]))).toBe(MAX_DOUBLED);
	});

	it('thermometer: 0° and above to 4, across 0 from 5, how far from 0 and how much it changes never falling in each', () => {
		expect(THERMOMETER_LADDER.map((s) => s.cross)).toEqual([
			...Array(4).fill(false),
			...Array(6).fill(true)
		]);
		// The degrees between two temperatures join at 3, and across 0 at 6.
		expect(THERMOMETER_LADDER.map((s) => s.between)).toEqual([
			false,
			false,
			true,
			true,
			false,
			...Array(5).fill(true)
		]);
		for (const [from, to] of [
			[1, 4],
			[5, 10]
		] as const) {
			expect(
				climbs(
					THERMOMETER_LADDER.map((s) => s.change),
					from,
					to
				)
			).toEqual([]);
			expect(
				climbs(
					THERMOMETER_LADDER.map((s) => [s.reach, s.reach] as const),
					from,
					to
				)
			).toEqual([]);
		}
	});

	it('kroner: counting, then the change from one thing, then from two, each climbing', () => {
		// The three parts: 1–4, 5–7, 8–10.
		for (const [from, to] of [
			[1, 4],
			[5, 7],
			[8, 10]
		] as const) {
			const things = KRONER_LADDER.slice(from - 1, to).map((s) => s.things);
			expect(new Set(things).size, `d${from}–${to}`).toBe(1);
			for (const band of ['pieces', 'total', 'price'] as const)
				expect(
					climbs(
						KRONER_LADDER.map((s) => s[band]),
						from,
						to
					),
					band
				).toEqual([]);
		}
	});

	it('fraction: one piece, then several from 8, each climbing', () => {
		expect(FRACTION_LADDER.map((s) => s.unit)).toEqual([
			...Array(7).fill(true),
			...Array(3).fill(false)
		]);
		for (const [from, to] of [
			[1, 7],
			[8, 10]
		] as const) {
			expect(
				climbs(
					FRACTION_LADDER.map((s) => s.share),
					from,
					to
				)
			).toEqual([]);
			expect(
				climbs(
					FRACTION_LADDER.map((s) => s.pieces),
					from,
					to
				)
			).toEqual([]);
		}
	});

	it('shape: sides never shrink, in squares to 4, the fence joins at 4, an L from 7, a side missing from 9', () => {
		expect(climbs(SHAPE_LADDER.map((s) => s.side))).toEqual([]);
		expect(SHAPE_LADDER.map((s) => s.grid)).toEqual([
			...Array(4).fill(true),
			...Array(6).fill(false)
		]);
		expect(SHAPE_LADDER.map((s) => s.fence)).toEqual([
			...Array(3).fill(false),
			...Array(7).fill(true)
		]);
		expect(SHAPE_LADDER.map((s) => s.l > 0)).toEqual([
			...Array(6).fill(false),
			...Array(4).fill(true)
		]);
		expect(SHAPE_LADDER.map((s) => s.missing > 0)).toEqual([
			...Array(8).fill(false),
			...Array(2).fill(true)
		]);
	});

	it('bar chart: the lines count in ones, twos from 6, fives from 8 and tens at 10, never back; how many more from 4', () => {
		expect(BARCHART_LADDER.map((s) => s.scale)).toEqual([1, 1, 1, 1, 1, 2, 2, 5, 5, 10]);
		expect(BARCHART_LADDER.map((s) => s.asks.includes(BARCHART.more))).toEqual([
			...Array(3).fill(false),
			...Array(7).fill(true)
		]);
		expect(climbs(BARCHART_LADDER.map((s) => [s.scale, s.scale] as const))).toEqual([]);
		expect(
			climbs(BARCHART_LADDER.map((s) => [s.least * s.scale, s.lines * s.scale] as const))
		).toEqual([]);
	});

	it('balance: every band climbs; minus from 6, times from 8, two steps only at 10', () => {
		for (const band of ['sum', 'factor', 'box', 'extra'] as const)
			expect(climbs(BALANCE_LADDER.map((s) => s[band])), band).toEqual([]);
		// The forms, as `face.ts` numbers them: plus 0, minus 1, times 2, times-plus 3, times-minus 4.
		const first = (form: number) =>
			BALANCE_LADDER.findIndex((s) => s.forms.includes(form as never)) + 1;
		expect([0, 1, 2, 3, 4].map(first)).toEqual([1, 6, 8, 10, 10]);
		expect(BALANCE_LADDER[9]!.forms).toEqual([3, 4]);
	});

	it('units: whole conversions from 3, back at 6, mixed amounts at 7, time back at 9, what is left over at 10, each skill climbing', () => {
		expect(getGenerator('units').minDifficulty).toBe(UNITS_MIN_DIFFICULTY);
		expect(UNITS_MIN_DIFFICULTY).toBe(3);
		expect(UNITS_LADDER).toHaveLength(10 - UNITS_MIN_DIFFICULTY + 1);
		const asks = ['whole', 'mixed', 'back', 'rest'] as const;
		const at = (d: number) => UNITS_LADDER[d - UNITS_MIN_DIFFICULTY]!;
		expect(
			[3, 4, 5, 6, 7, 8, 9, 10].map((d) => asks.filter((a) => at(d)[a] !== undefined).join('+'))
		).toEqual([
			'whole',
			'whole',
			'whole',
			'whole+back',
			'mixed',
			'mixed',
			'mixed+back',
			'back+rest'
		]);
		// Within a skill (what is asked, of which pair), over the difficulties it is asked at.
		const bad: string[] = [];
		for (const ask of asks) {
			for (const pair of UNIT_PAIRS) {
				const name = `${pair.big}-${pair.small}`;
				const rows: { d: number; skill: NonNullable<UnitsStep[typeof ask]>[number] }[] = [];
				for (let d = UNITS_MIN_DIFFICULTY; d <= 10; d++) {
					const skill = at(d)[ask]?.find((s) => s.pair === name);
					if (skill) rows.push({ d, skill });
				}
				const span = rows.map((r) => r.d);
				if (span.some((d, i) => i > 0 && d !== span[i - 1]! + 1))
					bad.push(`${ask} ${name} skips a difficulty: ${span}`);
				const bands = (of: 'big' | 'small') => rows.map((r) => r.skill[of]!);
				bad.push(...climbs(bands('big')).map((b) => `${ask} ${name} big ${b}`));
				bad.push(...narrows(bands('big')).map((b) => `${ask} ${name} big ${b}`));
				if (ask === 'mixed' || ask === 'rest') {
					bad.push(...climbs(bands('small')).map((b) => `${ask} ${name} small ${b}`));
					bad.push(...narrows(bands('small')).map((b) => `${ask} ${name} small ${b}`));
				}
			}
		}
		expect(bad).toEqual([]);
	});

	it('ice blocks: a row at 1, a flat layer at 2–4, a box at 5–9, how high at 9–10, each form climbing', () => {
		// A form is what the stack is: a row, a flat layer, a box, or a box whose layers are asked.
		const form = (f: BlocksForm) =>
			f.how === 'high' ? 'high' : f.h[1] > 1 ? 'box' : f.w[1] > 1 ? 'flat' : 'row';
		expect(BLOCKS_LADDER.map((forms) => forms.map(form).join(' '))).toEqual([
			'row',
			'flat',
			'flat',
			'flat',
			'box',
			'box',
			'box',
			'box',
			'box high',
			'high'
		]);
		for (const name of ['row', 'flat', 'box', 'high']) {
			const steps = BLOCKS_LADDER.flatMap((forms) => forms.filter((f) => form(f) === name));
			for (const side of ['l', 'w', 'h'] as const)
				expect(climbs(steps.map((f) => f[side])), `${name} ${side}`).toEqual([]);
		}
	});

	it('clock: reading finer marks first, then time passing, longer and longer', () => {
		expect(CLOCK_LADDER.map((s) => s.minutes)).toEqual([60, 60, 30, 15, 15, 5, 5, 1, 1, 1]);
		const asks = (d: number) => CLOCK_LADDER[d - 1]!.asks;
		// Time passing at 2 and from 5, back in time only at 10.
		expect(DS.map((d) => asks(d).includes(CLOCK.later))).toEqual([
			false,
			true,
			false,
			false,
			...Array(6).fill(true)
		]);
		expect(DS.map((d) => asks(d).includes(CLOCK.earlier))).toEqual([...Array(9).fill(false), true]);
		// Whole hours later at 2 and 5–7; hours and minutes from 8, within the hour, then across it.
		const passing = DS.filter((d) => asks(d).includes(CLOCK.later));
		const hours = passing.filter((d) => CLOCK_LADDER[d - 1]!.step === 60);
		expect(hours).toEqual([2, 5, 6, 7]);
		expect(CLOCK_LADDER.slice(7).map((s) => s.hour)).toEqual(['within', 'across', undefined]);
		for (const skill of [hours, [8, 9, 10]])
			expect(climbs(skill.map((d) => CLOCK_LADDER[d - 1]!.passing)), `${skill}`).toEqual([]);
	});
});

describe('what each kind promises a kid', () => {
	it('thermometer: from difficulty 5 the change crosses 0, never landing on it; up to 4 nothing goes below 0', () => {
		const bad: string[] = [];
		for (const d of DS) {
			const step = THERMOMETER_LADDER[d - 1]!;
			for (const [how, a, b, answer] of faces('thermometer', d)) {
				// The two temperatures the kid reads or works out.
				const [from, to] = how! <= 1 ? [a!, answer!] : [a!, b!];
				const crosses = Math.sign(from) * Math.sign(to) === -1;
				if (d <= 4 ? from < 0 || to < 0 : !crosses) bad.push(`d${d}: ${[how, a, b]} → ${answer}`);
				// Colder or warmer (0, 1) only where the step turns, the degrees between (2, 3) where it asks them.
				if (how! <= 1 ? !step.turn : !step.between) bad.push(`d${d} asks ${how}`);
				const reach = THERMOMETER_LADDER[d - 1]!.reach;
				if (Math.abs(from) > reach || Math.abs(to) > reach) bad.push(`d${d}: past ±${reach}`);
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('kroner: a handful of money, each coin or note needed to pay, and never øre', () => {
		const values = [1, 2, 5, 10, 20, 50, 100, 200];
		const bad: string[] = [];
		for (const d of DS) {
			const step = KRONER_LADDER[d - 1]!;
			for (const n of faces('kroner', d)) {
				const counts = n.slice(1, 9);
				const pieces = counts.reduce((s, c) => s + c, 0);
				const money = counts.reduce((s, c, i) => s + c * values[i]!, 0);
				const used = values.filter((_, i) => counts[i]! > 0);
				const answer = n[11]!;
				if (pieces < step.pieces[0] || pieces > step.pieces[1]) bad.push(`d${d} pieces ${pieces}`);
				if (money < step.total[0] || money > step.total[1]) bad.push(`d${d} total ${money}`);
				if (used.some((v) => !step.money.includes(v as never))) bad.push(`d${d} money ${used}`);
				// Change, when there is any, is less than the smallest piece paid with.
				if (step.things > 0 && (answer < 1 || answer >= Math.min(...used)))
					bad.push(`d${d} change ${answer} from ${used}`);
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('fraction: in its lowest terms, of halves to twelfths but sevenths, ninths and elevenths', () => {
		const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
		const bad: string[] = [];
		for (const d of DS) {
			for (const [num, den] of faces('fraction', d)) {
				if (gcd(num!, den!) !== 1 || [7, 9, 11].includes(den!)) bad.push(`d${d}: ${num}/${den}`);
				if (d <= 7 && num !== 1) bad.push(`d${d}: ${num}/${den} is not one piece`);
				if (d >= 8 && num === 1) bad.push(`d${d}: ${num}/${den} is one piece`);
				// A half at 1–2; halves and quarters, never thirds, at 3–4.
				if (d <= 2 && den !== 2) bad.push(`d${d}: ${num}/${den} is not a half`);
				if (d <= 4 && den !== 2 && den !== 4) bad.push(`d${d}: ${num}/${den} past quarters`);
			}
		}
		expect(bad).toEqual([]);
	});

	it('shape: squares only while they fit the picture, an L never a sliver, the floor alone up to 3, an L and a side missing only where the step says', () => {
		const bad: string[] = [];
		for (const d of DS) {
			const step = SHAPE_LADDER[d - 1]!;
			for (const [how, w, h, cw, ch, grid] of faces('shape', d)) {
				if (grid === 1 && (w! > 10 || h! > 10)) bad.push(`d${d}: ${w}×${h} in squares`);
				if ((grid === 1) !== step.grid && how! <= 1) bad.push(`d${d}: grid ${grid}`);
				if (cw! > 0 && step.l === 0) bad.push(`d${d}: an L`);
				if (how! >= 2 && step.missing === 0) bad.push(`d${d}: a side missing`);
				// An L's corner is a quarter of each side or more, and leaves as much: never a sliver.
				const fits = (c: number, side: number) =>
					c >= Math.max(1, Math.round(side / 4)) && side - c >= Math.max(1, Math.round(side / 4));
				if (cw! > 0 && !(fits(cw!, w!) && fits(ch!, h!)))
					bad.push(`d${d}: ${w}×${h} cut ${cw}×${ch}`);
				if (!step.fence && how !== 0) bad.push(`d${d} asks ${how}`);
			}
		}
		expect(bad).toEqual([]);
	});

	it('bar chart: every bar ends on a line or halfway, and two bars compared are never as tall', () => {
		const bad: string[] = [];
		for (const d of DS) {
			const step = BARCHART_LADDER[d - 1]!;
			for (const n of faces('barchart', d)) {
				const [how, scale, i, j, bars] = n as [number, number, number, number, number];
				const values = n.slice(5, 5 + bars);
				const unit = step.half ? scale / 2 : scale;
				if (values.some((v) => v % unit !== 0 || v < step.least * scale || v > step.lines * scale))
					bad.push(`d${d}: ${values}`);
				if (scale !== step.scale || !step.asks.includes(how as never))
					bad.push(`d${d}: asks ${how}`);
				if (how === 1 && values[i]! <= values[j]!) bad.push(`d${d}: ${values} asks ${i} over ${j}`);
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('balance: the box is never the number beside it on the other side', () => {
		const bad: string[] = [];
		for (const d of DS) {
			for (const [form, a, b, c, answer] of faces('balance', d)) {
				// "8 + □ = 8 + 3" gives the box away: 3; so do "9 − □ = 9 − 4" and "9 − □ = 7 − 4"'s 4.
				if ((form === 0 || form === 2) && (a === b || a === c))
					bad.push(`d${d}: ${[form, a, b, c]}`);
				if (form === 1 && (a === b || answer === c)) bad.push(`d${d}: ${[form, a, b, c]}`);
				if (answer! < 1) bad.push(`d${d}: ${answer}`);
			}
		}
		expect(bad).toEqual([]);
	});

	it("balance: every number shown is from its step's bands", () => {
		const bad: string[] = [];
		const within = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;
		for (const d of DS) {
			const step = BALANCE_LADDER[d - 1]!;
			for (const [form, a, b, c, answer] of faces('balance', d)) {
				if (!step.forms.includes(form as never)) bad.push(`d${d}: form ${form}`);
				const ok =
					form === 0 || form === 1
						? [a!, b!, c!, answer!].every((v) => within(v, step.sum))
						: form === 2
							? within(a!, step.factor) && within(answer!, step.box)
							: within(a!, step.factor) && within(answer!, step.box) && b! <= step.extra[1];
				if (!ok) bad.push(`d${d}: ${[form, a, b, c]} → ${answer}`);
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('units: every pair it names is one there is, and a small amount is fewer than a big unit holds', () => {
		for (const step of UNITS_LADDER)
			for (const skills of [step.whole, step.mixed, step.back, step.rest])
				for (const skill of skills ?? []) {
					expect(() => pairIndex(skill.pair), skill.pair).not.toThrow();
					const per = UNIT_PAIRS[pairIndex(skill.pair)]!.per;
					if (skill.small) {
						expect(skill.small[0], skill.pair).toBeGreaterThanOrEqual(1);
						expect(skill.small[1], skill.pair).toBeLessThan(per);
					}
				}
		// A face takes no more big units than the ladder asks (`faceFits`).
		const most = UNITS_LADDER.flatMap((step) =>
			[step.whole, step.mixed, step.back, step.rest].flatMap((skills) =>
				(skills ?? []).map((skill) => skill.big[1])
			)
		);
		expect(Math.max(...most)).toBe(MAX_BIG_UNITS);
	});

	it('units: in the head, never on paper: a unit that is not 10, 100 or 1000 small ones is counted out at most 12 times', () => {
		const bad: string[] = [];
		for (let d = UNITS_MIN_DIFFICULTY; d <= 10; d++) {
			for (const [how, pair, a, b, answer] of faces('units', d)) {
				const per = UNIT_PAIRS[pair!]!.per;
				// How many big units the kid counts out: the number shown, or the answer back.
				const big = how === 0 || how === 1 ? a! : how === 2 ? answer! : b!;
				if (![10, 100, 1000].includes(per) && big > 12) bad.push(`d${d}: ${[how, pair, a, b]}`);
				if (answer! < 1) bad.push(`d${d}: ${[how, pair, a, b]} → ${answer}`);
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('units: a harder step never asks an easier puzzle, as the puzzles come', () => {
		// How many big units a puzzle is about: the number shown, or the answer back.
		const bigOf = ([how, , a, b, answer]: number[]) =>
			how === UNITS.whole || how === UNITS.mixed ? a! : how === UNITS.back ? answer! : b!;
		const fewest = new Map<number, { d: number; big: number }>();
		const bad: string[] = [];
		for (let d = UNITS_MIN_DIFFICULTY; d <= 10; d++) {
			const here = new Map<number, number>();
			for (const face of faces('units', d)) {
				const [how, pair] = face;
				here.set(pair!, Math.min(here.get(pair!) ?? Infinity, bigOf(face)));
				// Turned back or split, a unit of 10, 100 or 1000 small ones is only its digits
				// read ("500 cm = ? m", "7585 g = 7 kg ? g"): easier than a mixed amount, so
				// asked only where whole units are, at 6.
				const tens = [10, 100, 1000].includes(UNIT_PAIRS[pair!]!.per);
				if (tens && (how === UNITS.back || how === UNITS.rest) && d > 6)
					bad.push(`d${d}: ${face.slice(0, 4)} reads off digits`);
			}
			// A pair's fewest big units never fall from the last step that asked it: no
			// "1 week and 1 day = ? days" (8) at 7 after "3 weeks = ? days" (21) at 6.
			for (const [pair, big] of here) {
				const before = fewest.get(pair);
				if (before && big < before.big)
					bad.push(
						`d${d}: ${UNIT_PAIRS[pair]!.big} from ${big}, after ${before.big} at d${before.d}`
					);
				fewest.set(pair, { d, big });
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('units: below difficulty 3 an attack that asks only units asks the easiest step', () => {
		const rng = new Rng(9);
		for (const d of [1, 2]) {
			const p = generatePuzzle(rng, d, ['units']);
			expect(p.difficulty).toBe(UNITS_MIN_DIFFICULTY);
			expect(generatePuzzle(rng, d, ['thermometer', 'units']).kind).toBe('thermometer');
		}
	});

	it("double: every half whole, every number one of its step's forms shows, and every form asked", () => {
		const bad: string[] = [];
		for (const d of DS) {
			const forms = DOUBLE_LADDER[d - 1]!;
			const met = new Set<number>();
			for (const [how, shown, answer] of faces('double', d)) {
				if (how === DOUBLE.double ? answer !== shown! * 2 : answer! * 2 !== shown)
					bad.push(`d${d}: ${how} ${shown} → ${answer}`);
				// The form that shows it: in its band, on its steps; a half even, and a round
				// half an odd number of tens or hundreds; and a number from 11 up round only
				// in a round form.
				const i = forms.findIndex(
					(f) =>
						DOUBLE[f.how] === how &&
						shown! >= f.shown[0] &&
						shown! <= f.shown[1] &&
						shown! % f.every === 0 &&
						(f.every > 1 || shown! <= 10 || shown! % 10 !== 0) &&
						(f.how === 'double' ||
							(f.every === 1 ? shown! % 2 === 0 : (shown! / f.every) % 2 === 1))
				);
				if (i < 0) bad.push(`d${d}: ${how} ${shown} fits no form`);
				else met.add(i);
			}
			if (met.size !== forms.length)
				bad.push(`d${d}: only ${met.size} of ${forms.length} forms met`);
		}
		expect(bad).toEqual([]);
	});

	it('ice blocks: every stack as big as the picture draws and no bigger, a box at least 2 each way, every sum in the head', () => {
		const bad: string[] = [];
		const most = { long: 0, boxLong: 0, deep: 0, high: 0, layers: 0 };
		for (const d of DS)
			for (const [how, l, w, n, answer] of faces('blocks', d)) {
				most.deep = Math.max(most.deep, w!);
				if (how === BLOCKS.high) {
					most.boxLong = Math.max(most.boxLong, l!);
					most.layers = Math.max(most.layers, answer!);
					if (answer! < 2 || l! < 2 || w! < 2) bad.push(`d${d}: ${l}×${w}, ${answer} high`);
					continue;
				}
				const long = n === 1 ? 'long' : 'boxLong';
				most[long] = Math.max(most[long], l!);
				most.high = Math.max(most.high, n!);
				// A box is a box, never a wall or a tower one block thick.
				if (n! > 1 && (l! < 2 || w! < 2)) bad.push(`d${d}: ${l}×${w}×${n}`);
				// A box's bottom layer is a times table a kid knows, and its blocks that layer again and again.
				if (n! > 1 && (l! * w! > 30 || answer! > 270))
					bad.push(`d${d}: ${l}×${w}×${n} = ${answer}`);
			}
		expect(bad).toEqual([]);
		expect(most).toEqual(MAX_BLOCKS);
		// A flat layer of more than one row is the times table `mul` asks at its step, as blocks.
		for (const d of [2, 3, 4]) {
			const [flat] = BLOCKS_LADDER[d - 1]!;
			const [table] = TIMES_LADDER[d - 1]!;
			expect([flat!.l, flat!.w], `d${d}`).toEqual([table!.big, table!.small]);
		}
	});

	it('balance: a times asks both ends of its factor and box bands, as the step writes them', () => {
		// A band end no puzzle can reach is a step that says more than it asks: a box of 2 at 8 would
		// need a product of 2 × 2–5 that another pair makes too, and none does.
		const ends: string[] = [];
		for (const d of DS) {
			const step = BALANCE_LADDER[d - 1]!;
			const times = faces('balance', d, 2000).filter(([form]) => form! >= 2);
			if (times.length === 0) continue;
			const factors = times.map(([, a]) => a!);
			const boxes = times.map((n) => n[4]!);
			for (const [name, seen, [lo, hi]] of [
				['factor', factors, step.factor],
				['box', boxes, step.box]
			] as const)
				if (Math.min(...seen) !== lo || Math.max(...seen) !== hi)
					ends.push(
						`d${d} ${name} ${Math.min(...seen)}–${Math.max(...seen)}, step says ${lo}–${hi}`
					);
		}
		expect(ends).toEqual([]);
	});

	it('clock: the hand on its marks, the new mark at least half the time, and within or across the hour where it says', () => {
		const bad: string[] = [];
		for (const d of DS) {
			const step = CLOCK_LADDER[d - 1]!;
			const every = step.minutes;
			const shown = faces('clock', d);
			if (shown.some(([, h, m]) => m! % every !== 0 || h! < 1 || h! > 12))
				bad.push(`d${d} off its marks`);
			if (every === 30 || every === 15) {
				const fresh = shown.filter(([how, , m]) => how === 0 && m! % (2 * every) !== 0).length;
				const read = shown.filter(([how]) => how === 0).length;
				if (fresh < read / 2) bad.push(`d${d}: ${fresh} of ${read} on the new mark`);
			}
			for (const [how, , m, dh, dm] of shown) {
				if (!step.asks.includes(how as never)) bad.push(`d${d} asks ${how}`);
				if (how === 0) continue;
				const passing = 60 * dh! + dm!;
				if (passing < step.passing[0] || passing > step.passing[1] || passing % step.step !== 0)
					bad.push(`d${d}: ${dh}h ${dm}m passing`);
				// Across the hour: the minute hand passes 12 on the way (forwards, or back for earlier).
				const across = how === 1 ? m! + dm! >= 60 : m! - dm! < 0;
				if (step.hour !== undefined && across !== (step.hour === 'across'))
					bad.push(`d${d}: ${m} and ${dm} not ${step.hour} the hour`);
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});
});
