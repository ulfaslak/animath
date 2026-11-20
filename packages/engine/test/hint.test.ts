import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng.js';
import { facePrompt, puzzleFace, type PuzzleFace } from '../src/puzzles/face.js';
import { puzzleHint, type HintToken, type PuzzleHint } from '../src/puzzles/hint.js';
import { generatePuzzle, getGenerator } from '../src/puzzles/registry.js';
import { ALL_PUZZLE_KINDS, type PuzzleKind } from '../src/puzzles/types.js';

/**
 * A puzzle's hint is the same question made easier (`hint.ts`). Checked
 * here with a solver of its own: put the answer in for the unknown and the
 * hint's two sides come out the same, every step a whole number.
 */

/** A side of a hint worked out with × and ÷ first, a pill first of all; null if a step is not whole, or below 0 where `negatives` is false. */
function evaluate(tokens: readonly HintToken[], negatives: boolean): number | null {
	let i = 0;
	let broken = false;
	const step = (x: number): number => {
		if (!Number.isInteger(x) || (!negatives && x < 0)) broken = true;
		return x;
	};
	const atom = (): number => {
		const t = tokens[i++];
		if (t === '(') {
			const x = sum();
			if (tokens[i++] !== ')') throw new Error(`unclosed pill in ${tokens.join(' ')}`);
			return x;
		}
		if (typeof t !== 'number') throw new Error(`a number expected in ${tokens.join(' ')}`);
		return t;
	};
	const product = (): number => {
		let x = atom();
		while (tokens[i] === '×' || tokens[i] === '÷') {
			const op = tokens[i++];
			const y = atom();
			x = step(op === '×' ? x * y : x / y);
		}
		return x;
	};
	const sum = (): number => {
		let x = product();
		while (tokens[i] === '+' || tokens[i] === '−') {
			const op = tokens[i++];
			const y = product();
			x = step(op === '+' ? x + y : x - y);
		}
		return x;
	};
	const value = sum();
	if (i !== tokens.length) throw new Error(`left over in ${tokens.join(' ')}`);
	return broken ? null : value;
}

const SIGNS: readonly HintToken[] = ['+', '−', '×', '÷'];

/** What is wrong with a hint for a puzzle with this answer, or null. */
function wrong(face: PuzzleFace, answer: number, hint: PuzzleHint): string | null {
	const negatives = face.kind === 'thermometer';
	switch (hint.form) {
		case 'gaps': {
			// One jump between each two numbers shown, none to the answer: from the first
			// number, the jumps walk through every other.
			const n = face.numbers;
			if (hint.gaps.length !== n.length - 1) return 'a jump too many or too few';
			let at = n[0] as number;
			for (let k = 0; k < hint.gaps.length; k++) {
				at += hint.gaps[k] as number;
				if (at !== n[k + 1]) return 'a jump that misses its number';
			}
			return null;
		}
		case 'dots': {
			if (hint.a < 1 || hint.b < 1) return 'a dot count below 1';
			if (hint.take ? hint.a > 10 || hint.b > hint.a : hint.a + hint.b > 10) {
				return 'too many dots to count';
			}
			return (hint.take ? hint.a - hint.b : hint.a + hint.b) === answer ? null : 'dots';
		}
		case 'equation': {
			const tokens = hint.tokens;
			const eq = tokens.indexOf('=');
			if (eq < 0 || tokens.lastIndexOf('=') !== eq) return 'not one =';
			const sides = [tokens.slice(0, eq), tokens.slice(eq + 1)];
			const unknown = (t: HintToken) => t === '?' || t === '□';
			const known = sides.find((s) => !s.some(unknown));
			if (!known || sides.every((s) => !s.some(unknown))) return 'no side without the unknown';
			// The hint never just says the answer: an unknown alone has a sum to work out beside it.
			const other = sides.find((s) => s !== known) as HintToken[];
			if (other.length === 1 && !known.some((t) => SIGNS.includes(t))) return 'a bare number';
			// A pill is a part to work out first: never nested, never empty of a sign.
			let open = -1;
			for (let k = 0; k < tokens.length; k++) {
				if (tokens[k] === '(') {
					if (open >= 0) return 'a pill in a pill';
					open = k;
				} else if (tokens[k] === ')') {
					if (open < 0) return 'a pill closed and never opened';
					if (!tokens.slice(open + 1, k).some((t) => SIGNS.includes(t)))
						return 'a pill with no sign';
					open = -1;
				}
			}
			if (open >= 0) return 'a pill never closed';
			if (tokens.some((t) => typeof t === 'number' && !Number.isSafeInteger(t))) return 'not whole';
			if (!negatives && tokens.some((t) => typeof t === 'number' && t < 0)) return 'below 0';
			// Nothing in it is worth nothing: no 0, no pill that comes to 0 (10 − 10).
			if (tokens.some((t) => t === 0)) return 'a 0';
			// Nor a step that changes nothing: times 1, or shared by 1 (1 × 7, 24 ÷ 24 is fine).
			for (let k = 1; k < tokens.length - 1; k++)
				if (
					(tokens[k] === '×' || tokens[k] === '÷') &&
					(tokens[k - 1] === 1 || tokens[k + 1] === 1)
				)
					return 'a times 1';
			for (const pill of pills(tokens))
				if (evaluate(pill, negatives) === 0) return `a pill worth 0: ${pill.join(' ')}`;
			// Nor does it say the answer with the rest coming to nothing beside it: the answer as a
			// number of its own (outside a pill) that, taken out, leaves 0 with no work in what is
			// left, a pill of two different numbers (−4 + 4 + 7 for 7; 3 − 3 − 2 for −2;
			// (24 ÷ 24) × 100 for 100; but −3 + 3 + (6 − 3) has 6 − 3 still to work out).
			const work = pills(known).some(
				(pill) => new Set(pill.filter((t) => typeof t === 'number')).size > 1
			);
			if (answer !== 0 && !work) {
				let depth = 0;
				for (let k = 0; k < known.length; k++) {
					const t = known[k];
					if (t === '(') depth++;
					else if (t === ')') depth--;
					else if (depth === 0 && typeof t === 'number' && Math.abs(t) === Math.abs(answer)) {
						const without = known.map((u, j) => (j === k ? 0 : u));
						if (evaluate(without, true) === 0) return 'the answer, with nothing beside it';
					}
				}
			}
			// Nor is it the prompt's own sum again, in any order (? = b + a for a + b).
			const op = PROMPT_SIGN[face.kind];
			const numbers = (s: readonly HintToken[]) =>
				s.filter((t): t is number => typeof t === 'number').sort((x, y) => x - y);
			if (
				op &&
				known.every((t) => typeof t === 'number' || t === op) &&
				JSON.stringify(numbers(known)) === JSON.stringify([...face.numbers].sort((x, y) => x - y))
			)
				return 'the prompt again';
			const [left, right] = sides.map((s) =>
				evaluate(
					s.map((t) => (unknown(t) ? answer : t)),
					negatives
				)
			);
			if (left === null || right === null) return 'a step that is not whole, or below 0';
			return left === right ? null : `${left} ≠ ${right}`;
		}
	}
}

/** The sign of a prompt that is one sum of its two numbers. */
const PROMPT_SIGN: Partial<Record<PuzzleKind, HintToken>> = {
	add: '+',
	sub: '−',
	mul: '×',
	div: '÷'
};

/** What each pill of an equation holds. */
function pills(tokens: readonly HintToken[]): HintToken[][] {
	const out: HintToken[][] = [];
	let open = -1;
	tokens.forEach((t, k) => {
		if (t === '(') open = k;
		else if (t === ')' && open >= 0) {
			out.push(tokens.slice(open + 1, k));
			open = -1;
		}
	});
	return out;
}

const SEEDS = 200;

describe('puzzleHint', () => {
	it('holds with the answer in, never says it, and every step is whole', () => {
		const bad: string[] = [];
		const shown: Record<string, number> = {};
		for (const kind of ALL_PUZZLE_KINDS) {
			const g = getGenerator(kind);
			for (let d = g.minDifficulty; d <= g.maxDifficulty; d++) {
				const rng = new Rng(1000 * d + kind.length);
				let hinted = 0;
				for (let s = 0; s < SEEDS; s++) {
					const puzzle = generatePuzzle(rng, d, [kind]);
					const face = puzzleFace(puzzle);
					if (!face) {
						bad.push(`${puzzle.prompt}: no face`);
						continue;
					}
					const hint = puzzleHint(face);
					if (!hint) continue;
					hinted++;
					const why = wrong(face, puzzle.answer, hint);
					if (why) bad.push(`${puzzle.prompt} (${puzzle.answer}): ${why}`);
				}
				shown[`${kind} ${d}`] = hinted / SEEDS;
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
		// Every kind with sums has a hint for most puzzles at every difficulty (the fewest at
		// difficulty 2, where a 10 makes about a third of the sums freebies: 10 + 7, 17 − 10); a
		// clock and a bar chart ask the kid to read a picture, which no sum makes easier.
		const few = Object.entries(shown).filter(([key, share]) =>
			key.startsWith('clock') || key.startsWith('barchart') ? share !== 0 : share < 0.6
		);
		expect(few).toEqual([]);
	});

	it('holds for the sums the druid asks too: any two numbers', () => {
		const bad: string[] = [];
		const kinds: [PuzzleKind, (a: number, b: number) => number | null][] = [
			['add', (a, b) => a + b],
			['sub', (a, b) => (a >= b ? a - b : null)],
			['mul', (a, b) => a * b],
			['div', (a, b) => (b > 0 && a % b === 0 ? a / b : null)]
		];
		const check = (kind: PuzzleKind, a: number, b: number, answer: number | null) => {
			if (answer === null) return;
			const face: PuzzleFace = { kind, numbers: [a, b] };
			const hint = puzzleHint(face);
			const why = hint && wrong(face, answer, hint);
			if (why) bad.push(`${facePrompt(face)}: ${why}`);
		};
		// Every pair of small numbers, where each rule has its edges (10, 20, a 0 in a place).
		for (const [kind, solve] of kinds) {
			const top = kind === 'mul' || kind === 'div' ? 60 : 130;
			for (let a = 0; a <= top; a++) {
				for (let b = 0; b <= top; b++) check(kind, a, b, solve(a, b));
			}
		}
		// Token sums run to five digits (a hand-over of 999 bears brings 29,970), and their
		// thousands stay together: round numbers among them, as a price or a balance can be.
		const rng = new Rng(17);
		const big = () => (rng.int(0, 3) === 0 ? rng.int(1, 99) * 1000 : rng.int(1000, 99_999));
		for (let i = 0; i < 4000; i++) {
			const [a, b] = [big(), rng.int(0, 1) === 0 ? big() : rng.int(1, 999)];
			check('add', a, b, a + b);
			check('sub', Math.max(a, b), Math.min(a, b), Math.max(a, b) - Math.min(a, b));
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('keeps the thousands together, so a token sum is a few parts long', () => {
		// The druid's longest sum: 12640 + 29970 is the thousands, the hundreds and the tens.
		const hint = puzzleHint({ kind: 'add', numbers: [12640, 29970] });
		const pills = hint?.form === 'equation' ? hint.tokens.filter((t) => t === '(').length : 0;
		expect(pills).toBe(3);
	});
});
