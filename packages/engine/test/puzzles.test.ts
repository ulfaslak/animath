import { describe, expect, it } from 'vitest';
import { ANIMALS } from '../src/animals/catalog.js';
import { ATTACK_LEVELS, type AttackLevel } from '../src/animals/types.js';
import { attackDamage } from '../src/battle/damage.js';
import { Rng } from '../src/rng.js';
import { UNIT_PAIRS } from '../src/puzzles/face.js';
import { healingDifficulty, puzzleDifficulty } from '../src/puzzles/difficulty.js';
import {
	ADDEND_LADDER,
	TIMES_LADDER,
	TIMES_SKILLS,
	backwardsForms,
	type Band,
	type TimesForm
} from '../src/puzzles/generators/arithmetic.js';
import { ROOT_LADDER, ROOT_SKILLS, type RootForm } from '../src/puzzles/generators/sqrt.js';
import {
	answerText,
	checkAnswer,
	generatePuzzle,
	getGenerator,
	puzzleTopics
} from '../src/puzzles/registry.js';
import {
	ALL_PUZZLE_KINDS,
	MAX_DIFFICULTY,
	MIN_DIFFICULTY,
	type PuzzleKind
} from '../src/puzzles/types.js';

/** Recompute the answer from the prompt, independently of the generator. */
function solve(prompt: string): number {
	const picture = solvePicture(prompt);
	if (picture !== null) return picture;
	const box = prompt.match(/^\d+ [+−×] □/);
	if (box) return solveBalance(prompt);
	const seq = prompt.match(/^([\d, ]+), \?$/);
	if (seq) {
		const terms = (seq[1] as string).split(', ').map(Number);
		return nextInSequence(terms);
	}
	const root = prompt.match(/^√(\d+) = \?$/);
	if (root) return Math.sqrt(Number(root[1]));
	const missing = prompt.match(/^(\d+) ([+×]) \? = (\d+)$/);
	if (missing) {
		const [, a, op, c] = missing;
		return op === '+' ? Number(c) - Number(a) : Number(c) / Number(a);
	}
	const bin = prompt.match(/^(\d+) ([+−×÷]) (\d+) = \?$/);
	if (!bin) throw new Error(`unparseable prompt: ${prompt}`);
	const [, a, op, b] = bin;
	const x = Number(a);
	const y = Number(b);
	switch (op) {
		case '+':
			return x + y;
		case '−':
			return x - y;
		case '×':
			return x * y;
		case '÷':
			return x / y;
	}
	throw new Error(`unknown op ${op}`);
}

/**
 * A picture kind's prompt (`thermometer(0, 3, 5)`), or a kind of words'
 * (`units(0, 6, 3, 0)`), solved from its numbers as the kid reads the
 * picture and the words: a thermometer counted along, money added up coin
 * by coin, a shape's squares and fence pieces counted cell by cell, a
 * clock's hands turned, units counted out one big unit at a time. Null for
 * any other prompt.
 */
function solvePicture(prompt: string): number | null {
	const m = prompt.match(/^([a-z]+)\((-?\d+(?:, -?\d+)*)\)$/);
	if (!m) return null;
	const n = (m[2] as string).split(', ').map(Number);
	const at = (i: number) => n[i] as number;
	switch (m[1]) {
		case 'thermometer': {
			// Walk the mercury a degree at a time.
			const [how, a, b] = [at(0), at(1), at(2)];
			if (how === 0 || how === 1) {
				let t = a;
				for (let k = 0; k < b; k++) t += how === 1 ? 1 : -1;
				return t;
			}
			let steps = 0;
			for (let t = a; t !== b; t += b > a ? 1 : -1) steps++;
			return steps;
		}
		case 'kroner': {
			const values = [1, 2, 5, 10, 20, 50, 100, 200];
			let money = 0;
			for (let k = 0; k < values.length; k++)
				for (let c = 0; c < at(k + 1); c++) money += values[k]!;
			return money - at(9) - at(10);
		}
		case 'fraction': {
			// Deal the amount out into d piles, one at a time, and take n of them.
			const [num, den, amount] = [at(0), at(1), at(2)];
			const piles = Array.from({ length: den }, () => 0);
			for (let k = 0; k < amount; k++) piles[k % den]! += 1;
			return piles.slice(0, num).reduce((s, v) => s + v, 0);
		}
		case 'shape': {
			const [how, w, h, cw, ch] = [at(0), at(1), at(2), at(3), at(4)];
			if (how === 2 || how === 3) {
				// The side that makes the floor's squares, or the fence's length, come out right.
				for (let side = 1; side <= 1000; side++) {
					if ((how === 2 ? w * side : 2 * (w + side)) === h) return side;
				}
				throw new Error(`no side fits ${prompt}`);
			}
			// The floor's squares: the rectangle's cells but the cut corner at the top right.
			const inside = (x: number, y: number) =>
				x >= 0 && x < w && y >= 0 && y < h && !(x >= w - cw && y < ch);
			let cells = 0;
			let fence = 0;
			for (let x = 0; x < w; x++) {
				for (let y = 0; y < h; y++) {
					if (!inside(x, y)) continue;
					cells++;
					for (const [dx, dy] of [
						[1, 0],
						[-1, 0],
						[0, 1],
						[0, -1]
					] as const)
						if (!inside(x + dx, y + dy)) fence++;
				}
			}
			return how === 0 ? cells : fence;
		}
		case 'barchart': {
			const [how, , i, j, bars] = [at(0), at(1), at(2), at(3), at(4)];
			const v = n.slice(5, 5 + bars);
			if (how === 0) return v[i]!;
			if (how === 1) return v[i]! - v[j]!;
			if (how === 2) return v[i]! + v[j]!;
			return v.reduce((s, x) => s + x, 0);
		}
		case 'units': {
			// The facts a kid learns by heart, by name, and units counted out one big one at a time.
			const pair = UNIT_PAIRS[at(1)]!;
			const per = UNIT_FACTS[`${pair.big}-${pair.small}`]!;
			const [how, a, b] = [at(0), at(2), at(3)];
			if (how === 0 || how === 1) {
				let small = how === 1 ? b : 0;
				for (let k = 0; k < a; k++) small += per;
				return small;
			}
			// Back, or what is left over: take a big unit's worth away until less than one is left.
			let left = a;
			let big = 0;
			while (left >= per) {
				left -= per;
				big++;
			}
			if (how === 2) return left === 0 ? big : NaN;
			return big === b ? left : NaN;
		}
		case 'double': {
			// Double: the number counted on by itself. Half: the number that, counted on by itself, makes it.
			const [how, shown] = [at(0), at(1)];
			if (how === 0) {
				let total = shown;
				for (let k = 0; k < shown; k++) total += 1;
				return total;
			}
			for (let half = 0; half <= shown; half++) if (half + half === shown) return half;
			throw new Error(`no half of ${prompt}`);
		}
		case 'numberline': {
			// Walk the line from its start, a mark at a time, and half a mark more: the number
			// that, added to itself, makes a mark.
			const [from, step, , , mark, half] = [at(0), at(1), at(2), at(3), at(4), at(5)];
			let value = from;
			for (let k = 0; k < mark; k++) value += step;
			if (half === 1) {
				let halfStep = 0;
				while (halfStep + halfStep < step) halfStep++;
				if (halfStep + halfStep !== step) throw new Error(`no half a mark in ${prompt}`);
				value += halfStep;
			}
			return value;
		}
		case 'clock': {
			// Turn the minute hand a minute at a time, round a twelve-hour face.
			const [how, h, mins, dh, dm] = [at(0), at(1), at(2), at(3), at(4)];
			let t = (h === 12 ? 0 : h) * 60 + mins;
			for (let k = 0; k < dh * 60 + dm; k++) t = (t + (how === 2 ? 719 : 1)) % 720;
			return t;
		}
		case 'blocks': {
			// Count the stack block by block. How high: lay layer on layer until the blocks run out.
			const [how, l, w, n] = [at(0), at(1), at(2), at(3)];
			if (how === 0) {
				let count = 0;
				for (let z = 0; z < n; z++) for (let y = 0; y < w; y++) for (let x = 0; x < l; x++) count++;
				return count;
			}
			let left = n;
			let layers = 0;
			while (left > 0) {
				for (let y = 0; y < w; y++) for (let x = 0; x < l; x++) left--;
				layers++;
			}
			return left === 0 ? layers : NaN;
		}
	}
	throw new Error(`unknown picture kind ${prompt}`);
}

/** How many of the small unit make one of the big, as a kid learns it: by name, not from the generator. */
const UNIT_FACTS: Record<string, number> = {
	'week-day': 7,
	'day-hour': 24,
	'hour-minute': 60,
	'minute-second': 60,
	'year-month': 12,
	'km-m': 1000,
	'm-cm': 100,
	'cm-mm': 10,
	'kg-g': 1000,
	'l-dl': 10
};

/** "8 + □ = 5 + 6", solved by trying every box from 1 up until both sides weigh the same. */
function solveBalance(prompt: string): number {
	const [left, right] = prompt.split(' = ') as [string, string];
	const value = (side: string, box: number) => {
		const t = side.replace('□', String(box)).split(' ');
		let total = Number(t[0]);
		let k = 1;
		// × before + and −: fold a times into the number before it first.
		if (t[1] === '×') {
			total *= Number(t[2]);
			k = 3;
		}
		for (; k < t.length; k += 2) total += (t[k] === '+' ? 1 : -1) * Number(t[k + 1]);
		return total;
	};
	for (let box = 1; box <= 10_000; box++) if (value(left, box) === value(right, box)) return box;
	throw new Error(`no box fits ${prompt}`);
}

function nextInSequence(t: number[]): number {
	const d = t.map((v, i) => (i ? v - (t[i - 1] as number) : 0)).slice(1);
	if (d.every((v) => v === d[0])) return (t[t.length - 1] as number) + (d[0] as number);
	const r = (t[1] as number) / (t[0] as number);
	if (t.every((v, i) => i === 0 || v === (t[i - 1] as number) * r))
		return (t[t.length - 1] as number) * r;
	if (t.every((v, i) => i < 2 || v === (t[i - 1] as number) + (t[i - 2] as number)))
		return (t[t.length - 1] as number) + (t[t.length - 2] as number);
	// squares / triangular: second difference constant
	const dd = d.map((v, i) => (i ? v - (d[i - 1] as number) : 0)).slice(1);
	if (dd.every((v) => v === dd[0]))
		return (t[t.length - 1] as number) + (d[d.length - 1] as number) + (dd[0] as number);
	throw new Error(`unrecognised sequence: ${t.join(', ')}`);
}

describe('puzzle generators', () => {
	for (const kind of ALL_PUZZLE_KINDS) {
		const g = getGenerator(kind);
		it(`${kind}: every puzzle in its range has a whole-number answer that matches its prompt`, () => {
			for (let d = g.minDifficulty; d <= g.maxDifficulty; d++) {
				const rng = new Rng(1000 + d);
				for (let i = 0; i < 200; i++) {
					const p = g.generate(rng, d);
					expect(Number.isInteger(p.answer), `${kind} d=${d}: ${p.prompt} → ${p.answer}`).toBe(
						true
					);
					expect(solve(p.prompt), `${kind} d=${d}: ${p.prompt}`).toBe(p.answer);
					expect(p.difficulty).toBe(d);
				}
			}
		});
	}

	it('is deterministic for a given seed', () => {
		const a = generatePuzzle(new Rng(5), 4);
		const b = generatePuzzle(new Rng(5), 4);
		expect(a).toEqual(b);
	});

	it('gets harder: mean answer magnitude grows with difficulty for add', () => {
		const means = [];
		for (let d = 1; d <= 10; d++) {
			const rng = new Rng(d);
			let sum = 0;
			for (let i = 0; i < 300; i++) sum += generatePuzzle(rng, d, ['add']).answer;
			means.push(sum / 300);
		}
		for (let i = 1; i < means.length; i++) expect(means[i]).toBeGreaterThan(means[i - 1] as number);
	});

	it('falls back to the nearest supported difficulty when no kind fits', () => {
		const p = generatePuzzle(new Rng(1), 1, ['sqrt']);
		expect(p.kind).toBe('sqrt');
		expect(p.difficulty).toBe(getGenerator('sqrt').minDifficulty);
	});

	it('clamps out-of-range difficulty', () => {
		expect(generatePuzzle(new Rng(1), 99, ['add']).difficulty).toBe(MAX_DIFFICULTY);
		expect(generatePuzzle(new Rng(1), -3, ['add']).difficulty).toBe(MIN_DIFFICULTY);
	});
});

/**
 * Adding and taking away: their numbers climb with difficulty band by band
 * (#7). Times tables, sharing, missing numbers and square roots climb by
 * skill instead (§ the skill ladders below).
 */
const SUMS: readonly PuzzleKind[] = ['add', 'sub'];

/** Every number a kid reads in a prompt; the answer hides behind the "?". */
function numbersIn(prompt: string): number[] {
	return (prompt.match(/\d+/g) ?? []).map(Number);
}

/**
 * The ladder climbs (#7): a difficulty-3 attack once asked "4 + 1" because
 * operands had a ceiling but no floor. For adding and taking away every
 * band's ends must be non-decreasing in difficulty, and two steps up must be
 * out of reach.
 */
describe('difficulty ladder', () => {
	const SAMPLES = 300;

	// Adding and taking away. The other sums climb by skill (below); the picture
	// kinds and the balance by their own ladders (`puzzle-kinds.test.ts`).
	for (const kind of ALL_PUZZLE_KINDS.filter((k) => SUMS.includes(k))) {
		const g = getGenerator(kind);
		it(`${kind}: the smallest and the largest number shown both climb with difficulty`, () => {
			const floor = new Map<string, Map<number, number>>();
			const ceiling = new Map<string, Map<number, number>>();
			const highest: number[] = []; // largest number shown at d, any operation
			const lowestTop: number[] = []; // smallest "largest number shown" at d
			for (let d = g.minDifficulty; d <= g.maxDifficulty; d++) {
				const rng = new Rng(7000 + d);
				let hi = -Infinity;
				let top = Infinity;
				for (let i = 0; i < SAMPLES; i++) {
					const prompt = g.generate(rng, d).prompt;
					const op = prompt.match(/[+−×÷√]/)?.[0] ?? '';
					const nums = numbersIn(prompt);
					const lo = Math.min(...nums);
					// Above difficulty 1 nothing is "+ 1", "− 1", "× 1" or "÷ 1".
					if (d >= 2) expect(lo, `${kind} d=${d}: ${prompt}`).toBeGreaterThanOrEqual(2);
					const f = floor.get(op) ?? new Map<number, number>();
					const c = ceiling.get(op) ?? new Map<number, number>();
					f.set(d, Math.min(f.get(d) ?? Infinity, lo));
					c.set(d, Math.max(c.get(d) ?? -Infinity, ...nums));
					floor.set(op, f);
					ceiling.set(op, c);
					hi = Math.max(hi, ...nums);
					top = Math.min(top, Math.max(...nums));
				}
				highest.push(hi);
				lowestTop.push(top);
			}
			for (const [op, f] of floor) {
				const c = ceiling.get(op)!;
				const ds = [...f.keys()].sort((a, b) => a - b);
				for (let i = 1; i < ds.length; i++) {
					const d = ds[i]!;
					const prev = ds[i - 1]!;
					expect(f.get(d), `${kind} "${op}": floor fell at d=${d}`).toBeGreaterThanOrEqual(
						f.get(prev)!
					);
					expect(c.get(d), `${kind} "${op}": ceiling fell at d=${d}`).toBeGreaterThanOrEqual(
						c.get(prev)!
					);
				}
			}
			// Every puzzle at d shows a bigger number than any puzzle at d − 2.
			for (let i = 2; i < highest.length; i++) {
				const d = g.minDifficulty + i;
				expect(lowestTop[i], `${kind}: d=${d} overlaps d=${d - 2}`).toBeGreaterThan(
					highest[i - 2]!
				);
			}
		});
	}

	it('no factor is a multiple of ten: "10 × 7" is a freebie, "40 × 7" the times table with a nought on', () => {
		// Collected and asserted once: an `expect` per sample cost more than the rule
		// (1 s alone, 2 s with two browsers drawing beside it).
		const round: string[] = [];
		for (const kind of ['mul', 'div', 'missing'] as const) {
			const g = getGenerator(kind);
			for (let d = g.minDifficulty; d <= g.maxDifficulty; d++) {
				const rng = new Rng(9900 + d);
				for (let i = 0; i < SAMPLES; i++) {
					const p = g.generate(rng, d);
					const [a, b] = numbersIn(p.prompt) as [number, number];
					// mul shows both factors; div and the missing factor hide one in the answer;
					// a missing addend's two numbers are its parts ("20 + ? = 37" asks nothing).
					const factors = p.prompt.includes('÷')
						? [b, p.answer]
						: p.prompt.includes('× ?')
							? [a, p.answer]
							: p.prompt.includes('×')
								? [a, b]
								: [a, p.answer];
					if (factors.some((f) => f % 10 === 0)) round.push(`${kind} d=${d}: ${p.prompt}`);
				}
			}
		}
		expect(round).toEqual([]);
	}, 30_000);

	it('sequence: counting steps climb with difficulty; only difficulty 1 counts by ones', () => {
		const g = getGenerator('sequence');
		const minStep: number[] = [];
		for (let d = g.minDifficulty; d <= g.maxDifficulty; d++) {
			const rng = new Rng(8000 + d);
			let lo = Infinity;
			for (let i = 0; i < SAMPLES; i++) {
				const t = numbersIn(g.generate(rng, d).prompt);
				const diffs = t.slice(1).map((v, j) => v - t[j]!);
				if (diffs.every((v) => v === diffs[0])) lo = Math.min(lo, diffs[0]!);
			}
			expect(lo, `no counting sequence seen at d=${d}`).toBeLessThan(Infinity);
			minStep.push(lo);
		}
		expect(minStep[0]).toBe(1);
		for (let i = 1; i < minStep.length; i++) {
			expect(minStep[i], `step floor fell at d=${i + 1}`).toBeGreaterThanOrEqual(minStep[i - 1]!);
			expect(minStep[i]).toBeGreaterThanOrEqual(2);
		}
	});

	it('sequence: a pattern never asks at difficulty d what it asks two difficulties down', () => {
		// Per pattern, both ends of the first term climb, the smallest first term
		// at d is above the largest at d − 2 (so no prompt repeats two steps
		// apart), and the smallest answer never falls. On main "0, 10, 20, 30, ?"
		// could be asked at every difficulty from 4 to 10, and "1, 1, 2, 3, ?"
		// at 10. Sampled: 900 fixed seeds per difficulty.
		const g = getGenerator('sequence');
		type Seen = { firstLo: number; firstHi: number; answerLo: number };
		const seen = new Map<string, Map<number, Seen>>();
		const countingShare: number[] = [];
		for (let d = g.minDifficulty; d <= g.maxDifficulty; d++) {
			const rng = new Rng(9000 + d);
			let counting = 0;
			for (let i = 0; i < SAMPLES * 3; i++) {
				const p = g.generate(rng, d);
				const t = numbersIn(p.prompt);
				const r = readings(t);
				expect(r.size, `d=${d}: ${p.prompt} reads as ${[...r.keys()]}`).toBe(1);
				const [pattern] = [...r.keys()] as [string];
				if (pattern === 'counting') counting++;
				const byD = seen.get(pattern) ?? new Map<number, Seen>();
				const s = byD.get(d) ?? { firstLo: Infinity, firstHi: -Infinity, answerLo: Infinity };
				byD.set(d, {
					firstLo: Math.min(s.firstLo, t[0]!),
					firstHi: Math.max(s.firstHi, t[0]!),
					answerLo: Math.min(s.answerLo, p.answer)
				});
				seen.set(pattern, byD);
			}
			countingShare.push(counting / (SAMPLES * 3));
		}
		// Every pattern is found from the gaps: nothing triples or adds the
		// last two, which kids who got their sums right could not find (#236).
		expect([...seen.keys()].sort()).toEqual([
			'counting',
			'doubling',
			'squares',
			'triangle-numbers'
		]);
		const firstAsked = Object.fromEntries(
			[...seen].map(([pattern, byD]) => [pattern, Math.min(...byD.keys())])
		);
		expect(firstAsked).toEqual({ counting: 1, doubling: 4, 'triangle-numbers': 6, squares: 7 });
		// A textbook opening ("1, 2, 4, 8", "1, 3, 6, 10") only at the difficulty that brings it:
		// the next one up starts every pattern further along.
		for (const [pattern, byD] of seen) {
			const d = firstAsked[pattern] as number;
			expect(byD.get(d + 1)!.firstLo, `${pattern} at d=${d + 1}`).toBeGreaterThan(
				byD.get(d)!.firstLo
			);
		}
		// Up to 3 every sequence counts; from 4 about half of them do (900 draws a difficulty).
		countingShare.forEach((share, i) => {
			if (i < 3) {
				expect(share, `d=${i + 1}`).toBe(1);
			} else {
				expect(share, `d=${i + 1}`).toBeGreaterThan(0.45);
				expect(share, `d=${i + 1}`).toBeLessThan(0.55);
			}
		});
		for (const [pattern, byD] of seen) {
			for (const [d, s] of byD) {
				const prev = byD.get(d - 1);
				if (prev) {
					expect(s.firstLo, `${pattern}: first-term floor fell at d=${d}`).toBeGreaterThanOrEqual(
						prev.firstLo
					);
					expect(s.firstHi, `${pattern}: first-term ceiling fell at d=${d}`).toBeGreaterThanOrEqual(
						prev.firstHi
					);
					expect(s.answerLo, `${pattern}: answer floor fell at d=${d}`).toBeGreaterThanOrEqual(
						prev.answerLo
					);
				}
				const twoDown = byD.get(d - 2);
				if (twoDown)
					expect(s.firstLo, `${pattern}: d=${d} repeats d=${d - 2}`).toBeGreaterThan(
						twoDown.firstHi
					);
			}
		}
		// About 0.3 s alone (9,000 sequences, each read every way it fits); 3.5 s at a load
		// average of 40.
		// 0.5 s alone at a load average of 10 and 2.4 s in the whole suite at 33 (2026-09-28), which
		// scales to 11 s at 150.
	}, 60_000);

	it('sequence: no prompt fits two patterns with different answers', () => {
		// "2, 3, 5, 8, ?" is 13 by adding the last two and 12 by "the gaps grow
		// by one"; "4, 4, 8, 12, ?" is 20 by adding the last two and 16 to a kid
		// who counts on from the end. Either kid is not wrong. Sampled: 900
		// fixed seeds per difficulty.
		const g = getGenerator('sequence');
		for (let d = g.minDifficulty; d <= g.maxDifficulty; d++) {
			const rng = new Rng(9500 + d);
			for (let i = 0; i < SAMPLES * 3; i++) {
				const p = g.generate(rng, d);
				const t = numbersIn(p.prompt);
				const answers = new Set(readings(t).values());
				const tail = countingAtTheEnd(t);
				if (tail !== null) answers.add(tail);
				expect([...answers], `d=${d}: ${p.prompt}`).toEqual([p.answer]);
			}
		}
		// About 0.35 s alone (9,000 sequences, each read every way a kid might); 4.7 s at a
		// load average of 40.
		// 0.9 s alone at a load average of 10 and 2.5 s in the whole suite at 34 (2026-09-28), which
		// scales to 11 s at 150.
	}, 60_000);
});

/** What a kid who only looks at the last three terms predicts, if they count. */
function countingAtTheEnd(t: number[]): number | null {
	const [x, y, z] = t.slice(-3) as [number, number, number];
	return z - y === y - x ? z + (z - y) : null;
}

/**
 * Every pattern a kid is taught that fits `t`, with the next number it
 * predicts. Independent of the generator's families on purpose: a prompt that
 * two of these fit is ambiguous whatever the generator meant.
 */
function readings(t: number[]): Map<string, number> {
	const out = new Map<string, number>();
	const last = t[t.length - 1]!;
	const gaps = t.slice(1).map((v, i) => v - t[i]!);
	if (gaps.every((v) => v === gaps[0])) out.set('counting', last + gaps[0]!);
	const ratio = t[1]! / t[0]!;
	if (
		Number.isInteger(ratio) &&
		ratio >= 2 &&
		t.every((v, i) => i === 0 || v === t[i - 1]! * ratio)
	)
		out.set(ratio === 2 ? 'doubling' : 'tripling-or-more', last * ratio);
	if (t.every((v, i) => i < 2 || v === t[i - 1]! + t[i - 2]!))
		out.set('add-last-two', last + t[t.length - 2]!);
	const growth = gaps.slice(1).map((v, i) => v - gaps[i]!);
	if (growth[0] !== 0 && growth.every((v) => v === growth[0])) {
		const next = last + gaps[gaps.length - 1]! + growth[0]!;
		const name = growth[0] === 2 ? 'squares' : growth[0] === 1 ? 'triangle-numbers' : 'gaps-grow';
		out.set(name, next);
	}
	return out;
}

type Skilled = { skill: string };

/**
 * For each skill, the steps that ask it in difficulty order: neither end of
 * any of its bands (`bands` names them) ever falls, and none is empty.
 */
function skillBandsFall<F extends Skilled>(
	rows: readonly (readonly F[])[],
	from: number,
	bands: (form: F) => Record<string, Band>
): string[] {
	const last = new Map<string, Record<string, Band>>();
	const bad: string[] = [];
	for (let d = from; d <= rows.length; d++) {
		for (const form of rows[d - 1]!) {
			const now = bands(form);
			const before = last.get(form.skill);
			for (const [name, [lo, hi]] of Object.entries(now)) {
				const prev = before?.[name];
				if (lo > hi) bad.push(`d${d} ${form.skill} ${name}: [${lo}, ${hi}] is empty`);
				if (prev && (lo < prev[0] || hi < prev[1]))
					bad.push(`d${d} ${form.skill} ${name}: [${lo}, ${hi}] after [${prev[0]}, ${prev[1]}]`);
			}
			last.set(form.skill, now);
		}
	}
	return bad;
}

/** Steps whose easiest or hardest skill comes before the step below's, in `order`. */
function skillsBackOff<F extends Skilled>(
	rows: readonly (readonly F[])[],
	from: number,
	order: readonly string[]
): string[] {
	const bad: string[] = [];
	const ranks = (d: number) => rows[d - 1]!.map((f) => order.indexOf(f.skill));
	for (let d = from + 1; d <= rows.length; d++) {
		const [now, prev] = [ranks(d), ranks(d - 1)];
		if (now.includes(-1)) bad.push(`d${d}: a skill not in the order`);
		if (Math.min(...now) < Math.min(...prev) || Math.max(...now) < Math.max(...prev))
			bad.push(
				`d${d}: ${rows[d - 1]!.map((f) => f.skill)} after ${rows[d - 2]!.map((f) => f.skill)}`
			);
	}
	return bad;
}

const inBand = (n: number, [lo, hi]: Band) => n >= lo && n <= hi;

/** Whether a band holds a number that is not a multiple of ten (`drawUnround` draws from those). */
const hasUnround = ([lo, hi]: Band) => {
	for (let n = lo; n <= hi; n++) if (n % 10 !== 0) return true;
	return false;
};

/** The roots a square-root form asks, worked out here from its skill and band. */
function rootFits({ skill, of }: RootForm, root: number): boolean {
	if (skill === 'table') return root !== 10 && inBand(root, of);
	if (skill === 'tens') return root % 10 === 0 && inBand(root / 10, of);
	return root % 10 === 5 && inBand((root - 5) / 10, of);
}

/**
 * Times tables, sharing, missing numbers and square roots climb by skill on
 * the school-year scale ([[DECISIONS]] § Gameplay): a harder step never asks
 * an easier skill, within a skill no band falls, every number is drawn from
 * its step's bands, and nothing at any difficulty needs paper. The tables
 * are read here; the puzzles are checked against them.
 */
describe('skill ladders: times tables, sharing, missing numbers and square roots', () => {
	const SAMPLES = 400;

	it('every number drawn is 2 or more above difficulty 1 (nothing is "× 1" or "+ 1"), and every band holds one that is not a round ten', () => {
		const bands: [string, Band][] = [
			...TIMES_LADDER.flatMap((forms, i) =>
				forms.flatMap((f) => [
					[`times d${i + 1} big`, f.big] as [string, Band],
					[`times d${i + 1} small`, f.small] as [string, Band]
				])
			),
			...ADDEND_LADDER.flatMap((s, i) => [
				[`addend d${i + 1} part`, s.part] as [string, Band],
				[`addend d${i + 1} answer`, s.answer] as [string, Band]
			])
		];
		for (const [name, b] of bands) {
			expect(hasUnround(b), name).toBe(true);
			if (!name.includes('d1 ')) expect(b[0], name).toBeGreaterThanOrEqual(2);
		}
		for (const [i, forms] of ROOT_LADDER.entries())
			for (const f of forms) expect(rootOfLowest(f), `roots d${i + 1}`).toBeGreaterThanOrEqual(2);
	});

	it('times tables: a step per difficulty, never an easier skill than the step below, and within a skill no band falls', () => {
		expect(TIMES_LADDER).toHaveLength(10);
		const from = getGenerator('mul').minDifficulty;
		expect(skillsBackOff(TIMES_LADDER, from, TIMES_SKILLS)).toEqual([]);
		expect(skillBandsFall(TIMES_LADDER, from, (f) => ({ big: f.big, small: f.small }))).toEqual([]);
	});

	it('sharing and the missing factor are the times tables backwards, never by more than 9', () => {
		for (let d = getGenerator('div').minDifficulty; d <= MAX_DIFFICULTY; d++) {
			const forms = backwardsForms(d);
			expect(forms.length, `d${d}`).toBeGreaterThan(0);
			for (const f of forms) {
				expect(TIMES_LADDER[d - 1], `d${d}`).toContain(f);
				expect(f.small[1], `d${d}`).toBeLessThanOrEqual(9);
			}
		}
	});

	it('missing addend: a step per difficulty, and neither band ever falls', () => {
		expect(ADDEND_LADDER).toHaveLength(10);
		const rows = ADDEND_LADDER.map((s) => [{ skill: 'take away', ...s }]);
		expect(skillBandsFall(rows, 1, (s) => ({ part: s.part, answer: s.answer }))).toEqual([]);
	});

	it('square roots: a step per difficulty, never an easier skill than the step below, and within a skill no band falls', () => {
		expect(ROOT_LADDER).toHaveLength(10);
		const from = getGenerator('sqrt').minDifficulty;
		expect(skillsBackOff(ROOT_LADDER, from, ROOT_SKILLS)).toEqual([]);
		expect(skillBandsFall(ROOT_LADDER, from, (f) => ({ of: f.of }))).toEqual([]);
	});

	it('no two neighbouring difficulties share a step: a harder level never asks the very sums of the one below (#32)', () => {
		const same: string[] = [];
		const check = (name: string, from: number, row: (d: number) => unknown) => {
			for (let d = from + 1; d <= MAX_DIFFICULTY; d++)
				if (JSON.stringify(row(d)) === JSON.stringify(row(d - 1)))
					same.push(`${name} d${d - 1}–${d}`);
		};
		check('times', getGenerator('mul').minDifficulty, (d) => TIMES_LADDER[d - 1]);
		check('backwards', getGenerator('div').minDifficulty, (d) => backwardsForms(d));
		check('addend', getGenerator('missing').minDifficulty, (d) => ADDEND_LADDER[d - 1]);
		check('roots', getGenerator('sqrt').minDifficulty, (d) => ROOT_LADDER[d - 1]);
		expect(same).toEqual([]);
	});

	it('the missing addend crosses where it says: the ten at 2, a hundred at 5, the next hundred at 6, a thousand at 9 and 10', () => {
		const passes = (part: number, sum: number, unit: number) =>
			Math.floor(sum / unit) > Math.floor(part / unit) && sum % unit !== 0;
		const unitAt: Record<number, number> = { 2: 10, 5: 100, 6: 100, 9: 1000, 10: 1000 };
		const stays: string[] = [];
		const g = getGenerator('missing');
		for (const [d, unit] of Object.entries(unitAt).map(([d, u]) => [Number(d), u] as const)) {
			const rng = new Rng(5900 + d);
			for (let i = 0; i < SAMPLES; i++) {
				const p = g.generate(rng, d);
				if (!p.prompt.includes('+')) continue;
				const [part, sum] = numbersIn(p.prompt) as [number, number];
				if (!passes(part, sum, unit)) stays.push(`d${d}: ${p.prompt}`);
			}
		}
		expect(stays).toEqual([]);
	});

	it('every puzzle comes from its step, and every form of a step comes up', () => {
		const strays: string[] = [];
		const unmet: string[] = [];
		for (const kind of ['mul', 'div', 'missing', 'sqrt'] as const) {
			const g = getGenerator(kind);
			for (let d = g.minDifficulty; d <= g.maxDifficulty; d++) {
				const times = TIMES_LADDER[d - 1]!;
				const backwards = times.filter((f) => f.small[1] <= 9);
				const addend = ADDEND_LADDER[d - 1]!;
				const roots = ROOT_LADDER[d - 1]!;
				const met = new Set<unknown>();
				const fits = (forms: readonly TimesForm[], big: number, small: number) =>
					forms.find((f) => inBand(big, f.big) && inBand(small, f.small));
				const rng = new Rng(5100 + 37 * d);
				for (let i = 0; i < SAMPLES; i++) {
					const p = g.generate(rng, d);
					const [a, b] = numbersIn(p.prompt) as [number, number];
					let form: unknown;
					if (kind === 'mul') form = fits(times, a, b);
					else if (kind === 'div') form = fits(backwards, p.answer, b);
					else if (p.prompt.includes('× ?')) form = fits(backwards, p.answer, a);
					else if (kind === 'missing')
						form = inBand(a, addend.part) && inBand(p.answer, addend.answer) ? addend : undefined;
					else form = roots.find((f) => rootFits(f, p.answer));
					if (form === undefined) strays.push(`${kind} d=${d}: ${p.prompt}`);
					met.add(form);
				}
				const expected: unknown[] =
					kind === 'mul'
						? [...times]
						: kind === 'div'
							? backwards
							: kind === 'sqrt'
								? [...roots]
								: d >= 4
									? [addend, ...backwards]
									: [addend];
				for (const form of expected)
					if (!met.has(form)) unmet.push(`${kind} d=${d}: ${JSON.stringify(form)}`);
			}
		}
		expect(strays).toEqual([]);
		expect(unmet).toEqual([]);
	}, 30_000);

	it('nothing needs paper: one factor of two digits or more but a teen by a teen, sharing by a digit, three digits only up to 199 and by 5 or less, a missing sum under 2000, and a root of the times table, a whole ten or 15 or 25', () => {
		const paper: string[] = [];
		const teen = (n: number) => n >= 11 && n <= 19;
		/** `big × small` a strong kid of 11–12 does in their head: 19 × 15 or 199 × 5 at most. */
		const inHead = (big: number, small: number) =>
			(teen(big) && teen(small) && Math.min(big, small) <= 15) ||
			(small <= 9 && (big <= 99 || (big <= 199 && small <= 5)));
		for (const kind of ['mul', 'div', 'missing', 'sqrt'] as const) {
			const g = getGenerator(kind);
			for (let d = g.minDifficulty; d <= g.maxDifficulty; d++) {
				const rng = new Rng(6100 + d);
				for (let i = 0; i < SAMPLES; i++) {
					const p = g.generate(rng, d);
					const [a, b] = numbersIn(p.prompt) as [number, number];
					const ok =
						kind === 'mul'
							? inHead(Math.max(a, b), Math.min(a, b))
							: kind === 'div'
								? b <= 9 && inHead(p.answer, b)
								: p.prompt.includes('× ?')
									? a <= 9 && inHead(p.answer, a)
									: kind === 'missing'
										? b < 2000
										: p.answer <= 12 ||
											(p.answer % 10 === 0 && p.answer <= 70) ||
											p.answer === 15 ||
											p.answer === 25;
					if (!ok) paper.push(`${kind} d=${d}: ${p.prompt}`);
				}
			}
		}
		expect(paper).toEqual([]);
	}, 30_000);
});

/** The smallest root a square-root form can ask. */
function rootOfLowest({ skill, of: [lo] }: RootForm): number {
	return skill === 'table' ? lo : skill === 'tens' ? 10 * lo : 10 * lo + 5;
}

describe('checkAnswer', () => {
	const p = { kind: 'add' as const, difficulty: 1, prompt: '1 + 1 = ?', answer: 2 };
	it('accepts the answer as number or string, with whitespace', () => {
		expect(checkAnswer(p, 2)).toBe(true);
		expect(checkAnswer(p, '2')).toBe(true);
		expect(checkAnswer(p, ' 2 ')).toBe(true);
		expect(checkAnswer(p, '+2')).toBe(true);
	});
	it('rejects wrong, empty and non-integer input', () => {
		expect(checkAnswer(p, 3)).toBe(false);
		expect(checkAnswer(p, '')).toBe(false);
		expect(checkAnswer(p, '2.0')).toBe(false);
		expect(checkAnswer(p, 'two')).toBe(false);
		expect(checkAnswer(p, '2e0')).toBe(false);
	});
	it('takes a minus on a thermometer', () => {
		const cold = {
			kind: 'thermometer' as const,
			difficulty: 2,
			prompt: 'thermometer(0, 3, 5)',
			answer: -2
		};
		expect(checkAnswer(cold, '-2')).toBe(true);
		expect(checkAnswer(cold, '2')).toBe(false);
	});
	// A clock face cannot say morning or afternoon: either reading of it is right (#191).
	it('reads a time, either way round the day, and nothing that is not one', () => {
		const quarterPast3 = {
			kind: 'clock' as const,
			difficulty: 3,
			prompt: 'clock(0, 3, 15, 0, 0)',
			answer: 195
		};
		for (const right of ['3:15', '03:15', '15:15', '3.15', '315', '1515', ' 3:15 '])
			expect(checkAnswer(quarterPast3, right), right).toBe(true);
		for (const wrong of [
			'3:5',
			'3:150',
			'15',
			'195',
			'3:16',
			'27:15',
			'3:75',
			'-3:15',
			'3:15:00',
			'',
			':15',
			'3:'
		])
			expect(checkAnswer(quarterPast3, wrong), wrong).toBe(false);
		const twentyPast12 = { ...quarterPast3, prompt: 'clock(0, 12, 20, 0, 0)', answer: 20 };
		for (const right of ['12:20', '0:20', '00:20'])
			expect(checkAnswer(twentyPast12, right), right).toBe(true);
		expect(checkAnswer(twentyPast12, '24:20')).toBe(false);
	});
	it('types every answer it asks in a form it takes', () => {
		const bad: string[] = [];
		for (const kind of ALL_PUZZLE_KINDS) {
			for (let d = MIN_DIFFICULTY; d <= MAX_DIFFICULTY; d++) {
				const rng = new Rng(300 + d);
				for (let i = 0; i < 40; i++) {
					const puzzle = generatePuzzle(rng, d, [kind]);
					if (!checkAnswer(puzzle, answerText(puzzle)))
						bad.push(`${puzzle.prompt}: ${answerText(puzzle)}`);
				}
			}
		}
		expect(bad).toEqual([]);
	});
});

describe('difficulty mapping', () => {
	it('is monotonic in tier, attack index and level', () => {
		for (let tier = 1; tier <= 5; tier++) {
			for (let n = 1; n <= 4; n++) {
				for (let l = 1; l <= 3; l++) {
					const d = puzzleDifficulty(tier, n, l);
					if (tier < 5) expect(puzzleDifficulty(tier + 1, n, l)).toBeGreaterThanOrEqual(d);
					if (n < 4) expect(puzzleDifficulty(tier, n + 1, l)).toBeGreaterThanOrEqual(d);
					if (l < 3) expect(puzzleDifficulty(tier, n, l + 1)).toBeGreaterThanOrEqual(d);
				}
			}
		}
	});
	it('spans the range: squirrel starts easy, bear ends hard', () => {
		expect(puzzleDifficulty(1, 1, 1)).toBe(MIN_DIFFICULTY);
		expect(puzzleDifficulty(5, 4, 3)).toBe(MAX_DIFFICULTY);
		expect(healingDifficulty(5)).toBeGreaterThan(healingDifficulty(1));
	});

	// A level that hits harder must ask at a higher difficulty, or it is a trap:
	// the bear's Maul and Crush once asked 10 on medium and on hard alike (#32).
	it('every attack in the catalog: a level that hits harder asks at a higher difficulty than the one below', () => {
		const problems: string[] = [];
		for (const spec of ANIMALS) {
			spec.attacks.forEach((attack, i) => {
				const n = i + 1;
				for (const level of ATTACK_LEVELS.slice(0, -1)) {
					const up = (level + 1) as AttackLevel;
					const hitsHarder = attackDamage(spec, n, up, true) > attackDamage(spec, n, level, true);
					const asksHarder =
						puzzleDifficulty(spec.tier, n, up) > puzzleDifficulty(spec.tier, n, level);
					if (hitsHarder && !asksHarder) {
						problems.push(
							`${spec.id}/${attack.id}: level ${up} hits harder but asks ${puzzleDifficulty(spec.tier, n, up)}, as level ${level} does`
						);
					}
				}
			});
		}
		expect(problems).toEqual([]);
	});

	// A higher difficulty is only harder if its kind's ladder asks something else there. Two equal
	// steps once made a tern's Long Trip ask the same clocks on easy and medium, medium hitting
	// harder; a step inside the one below (floors and fences' 3 in 2, 8 in 7 and 10 in 9) let a
	// medium attack ask only puzzles an easy one asks. Two checks, because a sample sees only so much:
	// - from the same seed two steps that ask alike draw the same puzzles, however many they hold;
	// - a step all of whose puzzles the step below draws too is inside it. A sample of the step
	//   below holds all its puzzles only where they are some thousands at most (a box of ice
	//   blocks, floors and fences), so a step inside one of a million sums is left to its kind's
	//   own ladder test (`skillBandsFall` above, `puzzle-kinds.test.ts`), and so is one form of a
	//   step inside the step below's while its other form asks something new (ice blocks' 9).
	it('every kind: each difficulty asks a puzzle the one below never does', () => {
		const [ABOVE, BELOW, MOST] = [400, 4_000, 250_000];
		const repeats: string[] = [];
		for (const kind of ALL_PUZZLE_KINDS) {
			const { minDifficulty, maxDifficulty } = getGenerator(kind);
			const draw = (at: number, seed: number, n: number) => {
				const rng = new Rng(seed);
				return Array.from({ length: n }, () => getGenerator(kind).generate(rng, at).prompt);
			};
			for (let d = minDifficulty + 1; d <= maxDifficulty; d++) {
				if (draw(d, 900 + d, 50).join() === draw(d - 1, 900 + d, 50).join()) {
					repeats.push(`${kind}: ${d} asks what ${d - 1} asks`);
					continue;
				}
				const above = draw(d, 7300 + d, ABOVE);
				const below = new Set(draw(d - 1, 7100 + d, BELOW));
				let fresh = above.filter((p) => !below.has(p));
				// The new ones may be the step below's that its sample missed. Draw more of the step
				// below, three times as many each round, while a round finds a fifth or more of
				// those left: a step inside the one below runs out of new ones in a few rounds, and
				// one that asks something else keeps them.
				for (let n = 2 * BELOW; fresh.length > 0 && fresh.length < ABOVE && n <= MOST; n *= 3) {
					for (const p of draw(d - 1, 7200 + d + n, n)) below.add(p);
					const left = fresh.filter((p) => !below.has(p));
					const found = fresh.length - left.length;
					fresh = left;
					if (found < fresh.length / 4) break;
				}
				if (fresh.length === 0) repeats.push(`${kind}: ${d - 1} asks every puzzle ${d} asks`);
			}
		}
		expect(repeats).toEqual([]);
	}, 60_000);

	it('any tier, any attack up to the eighth: each level is one step harder, and hard never passes the top', () => {
		const problems: string[] = [];
		for (let tier = 1; tier <= 5; tier++) {
			for (let n = 1; n <= 8; n++) {
				const ladder = ATTACK_LEVELS.map((level) => puzzleDifficulty(tier, n, level));
				const steps = ladder.slice(1).map((d, i) => d - ladder[i]!);
				if (
					steps.some((s) => s !== 1) ||
					ladder.at(-1)! > MAX_DIFFICULTY ||
					ladder[0]! < MIN_DIFFICULTY
				) {
					problems.push(`tier ${tier}, attack ${n}: ${ladder.join(', ')}`);
				}
			}
		}
		expect(problems).toEqual([]);
	});
});

/**
 * What a kid sees in a prompt, read from the prompt alone: the operation, and
 * whether a number is missing from a sum. Independent of the generators, like
 * `solve`; the topics each generator declares must agree with it.
 */
function topicOf(prompt: string): string {
	const picture = prompt.match(/^([a-z]+)\((\d+)/);
	if (picture) {
		// A shape asks for its floor (0, or a side from the floor's squares: 2) or its fence (1, 3).
		if (picture[1] === 'shape') return Number(picture[2]) % 2 === 0 ? 'area' : 'perimeter';
		// Doubling (0) or halving (1).
		if (picture[1] === 'double') return Number(picture[2]) === 0 ? 'double' : 'half';
		return picture[1] as string;
	}
	if (prompt.includes('□')) return 'balance';
	if (/^([\d, ]+), \?$/.test(prompt)) return 'sequence';
	if (/^√\d+ = \?$/.test(prompt)) return 'sqrt';
	const missing = prompt.match(/^\d+ ([+×]) \? = \d+$/);
	if (missing) return missing[1] === '+' ? 'missing' : 'mul';
	const bin = prompt.match(/^\d+ ([+−×÷]) \d+ = \?$/);
	if (!bin) throw new Error(`unparseable prompt: ${prompt}`);
	return { '+': 'add', '−': 'sub', '×': 'mul', '÷': 'div' }[bin[1] as '+' | '−' | '×' | '÷'];
}

describe('what an attack says it asks', () => {
	const SEEDS_PER_CASE = 300;

	/** The topics met over many seeds, against what `puzzleTopics` promises. */
	function metAndPromised(kinds: readonly PuzzleKind[], difficulty: number) {
		const met = new Set<string>();
		for (let seed = 0; seed < SEEDS_PER_CASE; seed++) {
			met.add(topicOf(generatePuzzle(new Rng(seed), difficulty, kinds).prompt));
		}
		return { met: [...met].sort(), promised: [...puzzleTopics(kinds, difficulty)].sort() };
	}

	// An attack's description is `puzzleTopics` in words (BattlePanel). It must
	// name everything a puzzle at that level can be, and nothing it can't: the
	// starter's Scurry Kick on hard once said "adding, taking away or missing
	// numbers" and asked "7 × ? = 56".
	it('every attack of every species, at every level, promises exactly what it asks', () => {
		const problems: string[] = [];
		for (const spec of ANIMALS) {
			spec.attacks.forEach((attack, i) => {
				for (const level of ATTACK_LEVELS) {
					const d = puzzleDifficulty(spec.tier, i + 1, level);
					const { met, promised } = metAndPromised(attack.kinds, d);
					if (met.join() !== promised.join()) {
						problems.push(
							`${spec.id}/${attack.id} level ${level} (d${d}): asks ${met}, says ${promised}`
						);
					}
				}
			});
		}
		expect(problems).toEqual([]);
	});

	it('every kind alone, at every difficulty, promises exactly what it asks', () => {
		const problems: string[] = [];
		for (const kind of ALL_PUZZLE_KINDS) {
			for (let d = MIN_DIFFICULTY; d <= MAX_DIFFICULTY; d++) {
				const { met, promised } = metAndPromised([kind], d);
				if (met.join() !== promised.join())
					problems.push(`${kind} d${d}: asks ${met}, says ${promised}`);
			}
		}
		expect(problems).toEqual([]);
	});

	it('the hard Scurry Kick names times tables', () => {
		const squirrel = ANIMALS.find((a) => a.id === 'squirrel')!;
		const kick = squirrel.attacks.find((a) => a.id === 'scurry-kick')!;
		expect(puzzleTopics(kick.kinds, puzzleDifficulty(squirrel.tier, 2, 3))).toEqual([
			'add',
			'sub',
			'missing',
			'mul'
		]);
		expect(puzzleTopics(kick.kinds, puzzleDifficulty(squirrel.tier, 2, 1))).toEqual([
			'add',
			'sub',
			'missing'
		]);
	});
});
