import { describe, expect, it } from 'vitest';
import { UNITS, UNIT_PAIRS, puzzleFace } from '../src/puzzles/face.js';
import { BALANCE_LADDER } from '../src/puzzles/generators/balance.js';
import { BARCHART_LADDER } from '../src/puzzles/generators/barchart.js';
import { CLOCK_LADDER } from '../src/puzzles/generators/clock.js';
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
			CLOCK_LADDER
		])
			expect(ladder).toHaveLength(10);
	});

	it('thermometer: how far from 0 and how much it changes never fall', () => {
		expect(climbs(THERMOMETER_LADDER.map((s) => s.change))).toEqual([]);
		expect(climbs(THERMOMETER_LADDER.map((s) => [s.reach, s.reach] as const))).toEqual([]);
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

	it('fraction: one piece, then several, each climbing', () => {
		for (const [from, to] of [
			[1, 4],
			[5, 10]
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

	it('shape: sides never shrink, the fence joins at 2, an L at 5 and from 7, a side missing from 6', () => {
		expect(climbs(SHAPE_LADDER.map((s) => s.side))).toEqual([]);
		expect(SHAPE_LADDER.map((s) => s.fence)).toEqual([false, ...Array(9).fill(true)]);
		expect(SHAPE_LADDER.map((s) => s.l > 0)).toEqual([
			false,
			false,
			false,
			false,
			true,
			false,
			true,
			true,
			true,
			true
		]);
		expect(SHAPE_LADDER.map((s) => s.missing > 0)).toEqual([
			...Array(5).fill(false),
			...Array(5).fill(true)
		]);
	});

	it('bar chart: the lines count in ones, twos, fives and tens, never back', () => {
		expect(climbs(BARCHART_LADDER.map((s) => [s.scale, s.scale] as const))).toEqual([]);
		expect(
			climbs(BARCHART_LADDER.map((s) => [s.least * s.scale, s.lines * s.scale] as const))
		).toEqual([]);
	});

	it('balance: every band climbs', () => {
		for (const band of ['sum', 'factor', 'box', 'extra'] as const)
			expect(climbs(BALANCE_LADDER.map((s) => s[band])), band).toEqual([]);
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

	it('clock: reading finer marks first, then time passing, longer and longer', () => {
		const marks = CLOCK_LADDER.slice(0, 5).map((s) => s.minutes);
		expect(marks).toEqual([60, 30, 15, 5, 1]);
		expect(
			climbs(
				CLOCK_LADDER.map((s) => s.passing),
				6,
				10
			)
		).toEqual([]);
	});
});

describe('what each kind promises a kid', () => {
	it('thermometer: from difficulty 2 the change crosses 0, never landing on it; at 1 nothing goes below 0', () => {
		const bad: string[] = [];
		for (const d of DS) {
			for (const [how, a, b, answer] of faces('thermometer', d)) {
				// The two temperatures the kid reads or works out.
				const [from, to] = how! <= 1 ? [a!, answer!] : [a!, b!];
				const crosses = Math.sign(from) * Math.sign(to) === -1;
				if (d === 1 ? from < 0 || to < 0 : !crosses) bad.push(`d${d}: ${[how, a, b]} → ${answer}`);
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
				if (d <= 4 && num !== 1) bad.push(`d${d}: ${num}/${den} is not one piece`);
				if (d === 2 && den === 3) bad.push('d2: thirds');
			}
		}
		expect(bad).toEqual([]);
	});

	it('shape: squares only while they fit the picture, an L never a sliver, and the floor alone at difficulty 1', () => {
		const bad: string[] = [];
		for (const d of DS) {
			for (const [how, w, h, cw, ch, grid] of faces('shape', d)) {
				if (grid === 1 && (w! > 10 || h! > 10)) bad.push(`d${d}: ${w}×${h} in squares`);
				// An L's corner is a quarter of each side or more, and leaves as much: never a sliver.
				const fits = (c: number, side: number) =>
					c >= Math.max(1, Math.round(side / 4)) && side - c >= Math.max(1, Math.round(side / 4));
				if (cw! > 0 && !(fits(cw!, w!) && fits(ch!, h!)))
					bad.push(`d${d}: ${w}×${h} cut ${cw}×${ch}`);
				if (d === 1 && how !== 0) bad.push(`d1 asks ${how}`);
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

	it('clock: the hand on its marks, the new mark at least half the time, and across the hour where it says', () => {
		const bad: string[] = [];
		for (const d of DS) {
			const every = CLOCK_LADDER[d - 1]!.minutes;
			const shown = faces('clock', d);
			if (shown.some(([, h, m]) => m! % every !== 0 || h! < 1 || h! > 12))
				bad.push(`d${d} off its marks`);
			if (every === 30 || every === 15) {
				const fresh = shown.filter(([, , m]) => m! % (2 * every) !== 0).length;
				if (fresh < shown.length / 2)
					bad.push(`d${d}: ${fresh} of ${shown.length} on the new mark`);
			}
			// Across the hour: the minute hand passes 12 on the way.
			if (CLOCK_LADDER[d - 1]!.cross && shown.some(([, , m, dh, dm]) => m! + 60 * dh! + dm! < 60))
				bad.push(`d${d}: not across the hour`);
		}
		expect(bad).toEqual([]);
	});
});
