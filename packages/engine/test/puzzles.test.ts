import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng.js';
import { healingDifficulty, puzzleDifficulty } from '../src/puzzles/difficulty.js';
import { checkAnswer, generatePuzzle, getGenerator } from '../src/puzzles/registry.js';
import { ALL_PUZZLE_KINDS, MAX_DIFFICULTY, MIN_DIFFICULTY } from '../src/puzzles/types.js';

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
});
