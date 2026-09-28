import { describe, expect, it } from 'vitest';
import { ANIMALS } from '../src/animals/catalog.js';
import { ATTACK_LEVELS, type AttackLevel } from '../src/animals/types.js';
import { attackDamage } from '../src/battle/damage.js';
import { Rng } from '../src/rng.js';
import { healingDifficulty, puzzleDifficulty } from '../src/puzzles/difficulty.js';
import {
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

/** Every number a kid reads in a prompt; the answer hides behind the "?". */
function numbersIn(prompt: string): number[] {
	return (prompt.match(/\d+/g) ?? []).map(Number);
}

/**
 * The ladder climbs (#7): a difficulty-3 attack once asked "4 + 1" because
 * operands had a ceiling but no floor. Every band's ends must be
 * non-decreasing in difficulty, and two steps up must be out of reach.
 */
describe('difficulty ladder', () => {
	const SAMPLES = 300;

	for (const kind of ALL_PUZZLE_KINDS.filter((k) => k !== 'sequence')) {
		const g = getGenerator(kind);
		it(`${kind}: the smallest and the largest number shown both climb with difficulty`, () => {
			// Per operation, because `missing` mixes "+ ?" and "× ?" from difficulty 4
			// and a missing factor is harder than a missing addend of the same size.
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

	it('ten is never a factor: "10 × 7" is a freebie at any difficulty', () => {
		// Collected and asserted once: an `expect` per sample cost more than the rule
		// (1 s alone, 2 s with two browsers drawing beside it).
		const tens: string[] = [];
		for (const kind of ['mul', 'div', 'missing'] as const) {
			const g = getGenerator(kind);
			for (let d = g.minDifficulty; d <= g.maxDifficulty; d++) {
				const rng = new Rng(9900 + d);
				for (let i = 0; i < SAMPLES; i++) {
					const p = g.generate(rng, d);
					const [a, b] = numbersIn(p.prompt) as [number, number];
					// mul shows both factors; div and the missing factor hide one in the answer.
					const factors = p.prompt.includes('÷')
						? [b, p.answer]
						: p.prompt.includes('× ?')
							? [a, p.answer]
							: p.prompt.includes('×')
								? [a, b]
								: [];
					if (factors.includes(10)) tens.push(`${kind} d=${d}: ${p.prompt}`);
				}
			}
		}
		expect(tens).toEqual([]);
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
		for (let d = g.minDifficulty; d <= g.maxDifficulty; d++) {
			const rng = new Rng(9000 + d);
			for (let i = 0; i < SAMPLES * 3; i++) {
				const p = g.generate(rng, d);
				const t = numbersIn(p.prompt);
				const r = readings(t);
				expect(r.size, `d=${d}: ${p.prompt} reads as ${[...r.keys()]}`).toBe(1);
				const [pattern] = [...r.keys()] as [string];
				const byD = seen.get(pattern) ?? new Map<number, Seen>();
				const s = byD.get(d) ?? { firstLo: Infinity, firstHi: -Infinity, answerLo: Infinity };
				byD.set(d, {
					firstLo: Math.min(s.firstLo, t[0]!),
					firstHi: Math.max(s.firstHi, t[0]!),
					answerLo: Math.min(s.answerLo, p.answer)
				});
				seen.set(pattern, byD);
			}
		}
		expect([...seen.keys()].sort()).toEqual([
			'add-last-two',
			'counting',
			'doubling-or-tripling',
			'squares',
			'triangle-numbers'
		]);
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
		out.set('doubling-or-tripling', last * ratio);
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
