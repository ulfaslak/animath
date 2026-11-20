import { describe, expect, it } from 'vitest';
import { puzzleFace } from '../src/puzzles/face.js';
import { BALANCE_LADDER } from '../src/puzzles/generators/balance.js';
import { BARCHART, BARCHART_LADDER } from '../src/puzzles/generators/barchart.js';
import { CLOCK, CLOCK_LADDER } from '../src/puzzles/generators/clock.js';
import { FRACTION_LADDER } from '../src/puzzles/generators/fraction.js';
import { KRONER_LADDER } from '../src/puzzles/generators/kroner.js';
import { SHAPE_LADDER } from '../src/puzzles/generators/shape.js';
import { THERMOMETER_LADDER } from '../src/puzzles/generators/thermometer.js';
import { getGenerator } from '../src/puzzles/registry.js';
import type { PuzzleKind } from '../src/puzzles/types.js';
import { Rng } from '../src/rng.js';

/**
 * The Arctic's puzzle kinds (#191): each climbs its own ladder, a table per
 * kind ([[PRODUCT]] §4 "Puzzles"), and keeps the promises a kid relies on.
 * Their answers against an independent solver are in `puzzles.test.ts`.
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
			CLOCK_LADDER
		])
			expect(ladder).toHaveLength(10);
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

	it('clock: reading finer marks first, then time passing, longer and longer', () => {
		expect(CLOCK_LADDER.map((s) => s.minutes)).toEqual([60, 60, 30, 15, 15, 5, 5, 1, 1, 1]);
		const asks = (d: number) => CLOCK_LADDER[d - 1]!.asks;
		// Time passing from 6, back in time only at 10.
		expect(DS.map((d) => asks(d).includes(CLOCK.later))).toEqual([
			...Array(5).fill(false),
			...Array(5).fill(true)
		]);
		expect(DS.map((d) => asks(d).includes(CLOCK.earlier))).toEqual([...Array(9).fill(false), true]);
		// Whole hours later at 6–7; hours and minutes from 8, within the hour, then across it.
		expect(CLOCK_LADDER.slice(5, 7).map((s) => s.step)).toEqual([60, 60]);
		expect(CLOCK_LADDER.slice(7).map((s) => s.hour)).toEqual(['within', 'across', undefined]);
		for (const [from, to] of [
			[6, 7],
			[8, 10]
		] as const)
			expect(
				climbs(
					CLOCK_LADDER.map((s) => s.passing),
					from,
					to
				)
			).toEqual([]);
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
