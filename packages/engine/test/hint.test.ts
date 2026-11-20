import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng.js';
import { BLOCKS, UNITS, facePrompt, puzzleFace, type PuzzleFace } from '../src/puzzles/face.js';
import { DOUBLE, DOUBLE_LADDER, numbersOf } from '../src/puzzles/generators/double.js';
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
		// clock and a bar chart ask the kid to read a picture, and a row of ice blocks to count
		// it, which no sum makes easier.
		const read = (key: string) =>
			key.startsWith('clock') || key.startsWith('barchart') || key === 'blocks 1';
		const few = Object.entries(shown).filter(([key, share]) =>
			read(key) ? share !== 0 : share < 0.6
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
		// A hundred and a thousand, which have no table in them: times a number, and as an answer.
		for (const round of [100, 1000]) {
			for (let b = 2; b <= 99; b++) {
				check('mul', round, b, round * b);
				check('mul', b, round, round * b);
				check('div', round * b, b, round);
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

	it('writes in how many small units make a big one, and has none for one whole big unit', () => {
		const tokens = (numbers: number[]) => {
			const hint = puzzleHint({ kind: 'units', numbers });
			return hint?.form === 'equation' ? hint.tokens.join(' ') : hint;
		};
		// 3 m = ? cm; 2 hours and 35 minutes = ? minutes; 1 hour and 20 minutes; 360 minutes = ? hours;
		// 130 minutes = 2 hours and ? minutes; 70 minutes = 1 hour and ? minutes.
		expect(tokens([UNITS.whole, 6, 3, 0])).toBe('? = 3 × 100');
		expect(tokens([UNITS.mixed, 2, 2, 35])).toBe('? = ( 2 × 60 ) + 35');
		expect(tokens([UNITS.mixed, 2, 1, 20])).toBe('? = 60 + 20');
		expect(tokens([UNITS.back, 2, 360, 0])).toBe('? = 360 ÷ 60');
		expect(tokens([UNITS.rest, 2, 130, 2])).toBe('? = 130 − ( 2 × 60 )');
		expect(tokens([UNITS.rest, 2, 70, 1])).toBe('? = 70 − 60');
		// 1 hour = ? minutes: 1 × 60 changes nothing; nor does 60 ÷ 60, nor 100 ÷ 100.
		expect(tokens([UNITS.whole, 2, 1, 0])).toBeNull();
		expect(tokens([UNITS.back, 2, 60, 0])).toBeNull();
		expect(tokens([UNITS.back, 6, 100, 0])).toBeNull();
	});

	it("adds up a flat layer of ice blocks row by row, times a box's bottom layer by its layers, and counts a row", () => {
		const tokens = (numbers: number[]) => {
			const hint = puzzleHint({ kind: 'blocks', numbers });
			return hint?.form === 'equation' ? hint.tokens.join(' ') : hint;
		};
		// 4 long and 3 deep: three rows of 4, never four of 3; 2 long and 5 deep: two of 5.
		expect(tokens([BLOCKS.count, 4, 3, 1])).toBe('? = 4 + 4 + 4');
		expect(tokens([BLOCKS.count, 2, 5, 1])).toBe('? = 5 + 5');
		expect(tokens([BLOCKS.count, 4, 3, 2])).toBe('? = ( 4 × 3 ) × 2');
		expect(tokens([BLOCKS.high, 4, 3, 36])).toBe('( 4 × 3 ) × ? = 36');
		// A row is counted; a wall one block deep is its row, layer on layer.
		expect(tokens([BLOCKS.count, 5, 1, 1])).toBeNull();
		expect(tokens([BLOCKS.count, 5, 1, 3])).toBe('? = 5 × 3');
		expect(tokens([BLOCKS.count, 1, 1, 4])).toBeNull();
	});

	it('holds for every number doubling and halving can show, and each has a hint', () => {
		const bad: string[] = [];
		for (const forms of DOUBLE_LADDER)
			for (const form of forms)
				for (const n of numbersOf(form)) {
					const face: PuzzleFace = { kind: 'double', numbers: [DOUBLE[form.how], n] };
					const answer = form.how === 'double' ? n + n : n / 2;
					const hint = puzzleHint(face);
					const why = hint ? wrong(face, answer, hint) : 'no hint';
					if (why) bad.push(`${facePrompt(face)}: ${why}`);
				}
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('doubles as adding a number to itself, and halves place by place', () => {
		const text = (how: keyof typeof DOUBLE, n: number) => {
			const hint = puzzleHint({ kind: 'double', numbers: [DOUBLE[how], n] });
			if (hint?.form === 'dots') return `dots ${hint.a} + ${hint.b}`;
			return hint?.form === 'equation' ? hint.tokens.join(' ') : String(hint);
		};
		expect(text('double', 4)).toBe('dots 4 + 4');
		expect(text('double', 7)).toBe('? = 7 + 3 + 4');
		expect(text('double', 37)).toBe('? = ( 30 + 30 ) + ( 7 + 7 )');
		expect(text('double', 40)).toBe('? = ( 4 + 4 ) × 10');
		expect(text('half', 8)).toBe('? + ? = 8');
		expect(text('half', 14)).toBe('? + ? = 14');
		expect(text('half', 76)).toBe('? = ( 60 ÷ 2 ) + ( 16 ÷ 2 )');
		expect(text('half', 70)).toBe('? = ( 60 ÷ 2 ) + ( 10 ÷ 2 )');
	});

	it('halves only what is a double the kid knows: an even count of ones, tens or hundreds, to 18', () => {
		// Half of 30 is split as (20 ÷ 2) + (10 ÷ 2), so no other hint may hand over 30 ÷ 2 as a step.
		const bad: string[] = [];
		for (const forms of DOUBLE_LADDER)
			for (const form of forms) {
				if (form.how !== 'half') continue;
				for (const n of numbersOf(form)) {
					const hint = puzzleHint({ kind: 'double', numbers: [DOUBLE.half, n] });
					if (hint?.form !== 'equation') continue;
					for (const pill of pills(hint.tokens)) {
						let count = pill[0] as number;
						while (count % 10 === 0) count /= 10;
						if (count !== 1 && (count % 2 !== 0 || count > 18)) bad.push(`${n}: ${pill.join(' ')}`);
					}
				}
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
