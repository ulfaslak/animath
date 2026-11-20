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
			const n = face.numbers;
			const gaps = n.slice(1).map((x, i) => x - (n[i] as number));
			return JSON.stringify(gaps) === JSON.stringify(hint.gaps) ? null : 'gaps';
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

/** The prompt's own sum, as a hint would write it: `[a, op, b]`. */
function promptSum(face: PuzzleFace): HintToken[] | null {
	const op = { add: '+', sub: '−', mul: '×', div: '÷' }[face.kind as string] as
		HintToken | undefined;
	return op ? [face.numbers[0] as number, op, face.numbers[1] as number] : null;
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
					// Not the prompt's own sum again.
					const own = promptSum(face);
					if (own && hint.form === 'equation') {
						const side = hint.tokens.slice(hint.tokens.indexOf('=') + 1);
						if (JSON.stringify(side) === JSON.stringify(own))
							bad.push(`${puzzle.prompt}: the prompt again`);
					}
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
		for (const [kind, solve] of kinds) {
			const top = kind === 'mul' || kind === 'div' ? 60 : 130;
			for (let a = 0; a <= top; a++) {
				for (let b = 0; b <= top; b++) {
					const answer = solve(a, b);
					if (answer === null) continue;
					const face: PuzzleFace = { kind, numbers: [a, b] };
					const hint = puzzleHint(face);
					const why = hint && wrong(face, answer, hint);
					if (why) bad.push(`${facePrompt(face)}: ${why}`);
				}
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});
});
