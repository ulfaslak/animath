import { describe, expect, it } from 'vitest';
import { tokenPuzzle } from '../src/doctor/tokens.js';
import {
	FACE_NUMBERS,
	MAX_FACE_NUMBER,
	facePrompt,
	puzzleFace,
	readPuzzleFace,
	type PuzzleFace
} from '../src/puzzles/face.js';
import { generatePuzzle } from '../src/puzzles/registry.js';
import { ALL_PUZZLE_KINDS, MAX_DIFFICULTY, MIN_DIFFICULTY } from '../src/puzzles/types.js';
import { Rng } from '../src/rng.js';

/**
 * A puzzle's face ([[ARCHITECTURE]] `puzzles/face.ts`): the numbers every
 * prompt is written from, and all of a puzzle a player near a battle is
 * sent. The formatter and the reader must be each other's inverse over
 * everything the game asks, and neither may let anything but a sum through.
 */

describe('a puzzle and its face', () => {
	it('reads every prompt the game asks back to the numbers it was written from, and writes it again the same', () => {
		const bad: string[] = [];
		let biggest = 0;
		for (const kind of ALL_PUZZLE_KINDS) {
			for (let d = MIN_DIFFICULTY; d <= MAX_DIFFICULTY; d++) {
				// Every kind at every difficulty, its fallback edge included (a kind asked outside its range).
				const rng = new Rng(1000 * d + ALL_PUZZLE_KINDS.indexOf(kind));
				for (let i = 0; i < 60; i++) {
					const puzzle = generatePuzzle(rng, d, [kind]);
					const face = puzzleFace(puzzle);
					if (!face) {
						bad.push(`${kind}@${d}: no face for ${puzzle.prompt}`);
						continue;
					}
					if (face.kind !== kind || face.numbers.length !== FACE_NUMBERS[kind]) {
						bad.push(`${kind}@${d}: ${JSON.stringify(face)}`);
					}
					if (facePrompt(face) !== puzzle.prompt) bad.push(`${kind}@${d}: ${puzzle.prompt}`);
					if (
						JSON.stringify(readPuzzleFace(JSON.parse(JSON.stringify(face)))) !==
						JSON.stringify(face)
					) {
						bad.push(`${kind}@${d}: ${JSON.stringify(face)} does not read back`);
					}
					biggest = Math.max(biggest, ...face.numbers);
				}
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
		// Every number any puzzle shows fits a face: the bound is never what drops one.
		expect(biggest).toBeLessThanOrEqual(MAX_FACE_NUMBER);
		expect(biggest).toBeGreaterThan(MAX_FACE_NUMBER / 5);
	});

	it('writes the prompts the game has always written', () => {
		const cases: [PuzzleFace, string][] = [
			[{ kind: 'add', numbers: [7, 5] }, '7 + 5 = ?'],
			[{ kind: 'sub', numbers: [12, 5] }, '12 − 5 = ?'],
			[{ kind: 'mul', numbers: [7, 8] }, '7 × 8 = ?'],
			[{ kind: 'div', numbers: [56, 7] }, '56 ÷ 7 = ?'],
			[{ kind: 'missing', numbers: [7, 12] }, '7 + ? = 12'],
			[{ kind: 'missing', numbers: [4, 20], times: true }, '4 × ? = 20'],
			[{ kind: 'sequence', numbers: [2, 4, 8, 16] }, '2, 4, 8, 16, ?'],
			[{ kind: 'sequence', numbers: [0, 1, 2, 3] }, '0, 1, 2, 3, ?'],
			[{ kind: 'sqrt', numbers: [144] }, '√144 = ?'],
			[{ kind: 'balance', numbers: [0, 8, 5, 6] }, '8 + □ = 5 + 6'],
			[{ kind: 'balance', numbers: [1, 30, 25, 12] }, '30 − □ = 25 − 12'],
			[{ kind: 'balance', numbers: [2, 6, 4, 3] }, '6 × □ = 4 × 3'],
			[{ kind: 'balance', numbers: [3, 3, 4, 25] }, '3 × □ + 4 = 25'],
			[{ kind: 'balance', numbers: [4, 3, 2, 25] }, '3 × □ − 2 = 25'],
			[{ kind: 'thermometer', numbers: [0, 3, 5] }, 'thermometer(0, 3, 5)'],
			[{ kind: 'thermometer', numbers: [2, -4, 7] }, 'thermometer(2, -4, 7)'],
			[
				{ kind: 'kroner', numbers: [1, 0, 0, 0, 0, 0, 1, 0, 0, 37, 0] },
				'kroner(1, 0, 0, 0, 0, 0, 1, 0, 0, 37, 0)'
			],
			[{ kind: 'fraction', numbers: [3, 5, 35] }, 'fraction(3, 5, 35)'],
			[{ kind: 'shape', numbers: [1, 6, 4, 2, 1, 1] }, 'shape(1, 6, 4, 2, 1, 1)'],
			[
				{ kind: 'barchart', numbers: [1, 2, 0, 2, 3, 8, 5, 3, 0, 0] },
				'barchart(1, 2, 0, 2, 3, 8, 5, 3, 0, 0)'
			],
			[{ kind: 'clock', numbers: [1, 3, 15, 1, 20] }, 'clock(1, 3, 15, 1, 20)']
		];
		for (const [face, prompt] of cases) {
			expect(facePrompt(face)).toBe(prompt);
			expect(puzzleFace({ kind: face.kind, prompt })).toStrictEqual(face);
		}
		// The doctor's sums go through the same formatter.
		expect(tokenPuzzle(23, 5).prompt).toBe('23 + 5 = ?');
		expect(tokenPuzzle(23, -5).prompt).toBe('23 − 5 = ?');
	});

	it('reads no face from text the formatter did not write', () => {
		const notPrompts: [PuzzleFace['kind'], string][] = [
			['mul', '7 × 8 = ? hi'],
			['mul', 'Hi 7 × 8 = ?'],
			['mul', '7 × 8'],
			['mul', '7  × 8 = ?'],
			['mul', '7 + 8 = ?'],
			['add', '07 + 8 = ?'],
			['add', '100000 + 1 = ?'],
			['add', `${'9'.repeat(400)} + 1 = ?`],
			['sub', '-5 − 3 = ?'],
			['sequence', '1, 2, 3, ?'],
			['sequence', '1, 2, 3, 4, 5, ?'],
			['sqrt', '√144 = 12'],
			['missing', '7 − ? = 12'],
			['missing', 'Hello'],
			['sqrt', ''],
			['balance', '8 + □ = 5 + 6 = ?'],
			['balance', '8 ÷ □ = 5 + 6'],
			['balance', '2 + □ = 1 + 1'],
			['balance', '7 × □ = 2 × 3'],
			['thermometer', 'thermometer(0, 3)'],
			['thermometer', 'thermometer(4, 3, 5)'],
			['thermometer', 'thermometer(2, 7, -4)'],
			['thermometer', 'thermometer(0,3,5)'],
			['thermometer', 'kroner(0, 3, 5)'],
			['kroner', 'kroner(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)'],
			['kroner', 'kroner(0, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0)'],
			['kroner', 'kroner(1, 0, 0, 0, 0, 0, 1, 0, 0, 50, 0)'],
			['kroner', 'kroner(0, -1, 2, 0, 0, 0, 0, 0, 0, 0, 0)'],
			['fraction', 'fraction(3, 5, 34)'],
			['fraction', 'fraction(5, 5, 35)'],
			['fraction', 'fraction(1, 13, 26)'],
			['shape', 'shape(0, 11, 4, 0, 0, 1)'],
			['shape', 'shape(0, 6, 4, 6, 1, 0)'],
			['shape', 'shape(2, 5, 24, 0, 0, 0)'],
			['shape', 'shape(3, 5, 10, 0, 0, 0)'],
			['barchart', 'barchart(1, 2, 0, 2, 3, 3, 5, 8, 0, 0)'],
			['barchart', 'barchart(0, 3, 0, 0, 3, 3, 5, 8, 0, 0)'],
			['barchart', 'barchart(0, 1, 0, 0, 3, 3, 5, 11, 0, 0)'],
			['barchart', 'barchart(0, 1, 0, 0, 3, 3, 5, 8, 4, 0)'],
			['barchart', 'barchart(0, 1, 5, 0, 3, 3, 5, 8, 0, 0)'],
			['clock', 'clock(0, 13, 15, 0, 0)'],
			['clock', 'clock(0, 3, 60, 0, 0)'],
			['clock', 'clock(0, 3, 15, 1, 0)'],
			['clock', 'clock(1, 3, 15, 0, 0)'],
			['balance', '1 − □ = 2 − 9'],
			['barchart', 'barchart(0, 10, 0, 0, 2, 37, 0, 0, 0, 0)'],
			['shape', 'shape(2, 5, 0, 0, 0, 0)'],
			['fraction', 'fraction(2, 4, 8)'],
			['fraction', 'fraction(1, 7, 14)'],
			['thermometer', 'thermometer(1, 99, 99)'],
			['__proto__' as PuzzleFace['kind'], '1 + 1 = ?'],
			['constructor' as PuzzleFace['kind'], '1 + 1 = ?']
		];
		for (const [kind, prompt] of notPrompts)
			expect(puzzleFace({ kind, prompt }), prompt).toBeNull();
	});

	it('reads a face off the wire only as a kind and as many whole numbers in bounds as it shows', () => {
		const good: PuzzleFace = { kind: 'mul', numbers: [7, 8] };
		expect(readPuzzleFace(good)).toStrictEqual(good);
		// A thermometer is the one face that reads below 0.
		const cold: PuzzleFace = { kind: 'thermometer', numbers: [2, -4, 7] };
		expect(readPuzzleFace(cold)).toStrictEqual(cold);
		expect(readPuzzleFace({ kind: 'missing', numbers: [4, 20], times: true })).toStrictEqual({
			kind: 'missing',
			numbers: [4, 20],
			times: true
		});
		// A new object of the known fields: nothing added passes.
		const read = readPuzzleFace({ ...good, words: 'hello', prompt: 'hi' });
		expect(read).toStrictEqual(good);
		expect(read).not.toBe(good);
		for (const junk of [
			null,
			undefined,
			'7 × 8 = ?',
			[7, 8],
			{ kind: 'mul' },
			{ kind: 'mul', numbers: [7] },
			{ kind: 'mul', numbers: [7, 8, 9] },
			{ kind: 'mul', numbers: [7, 8.5] },
			{ kind: 'mul', numbers: [7, -8] },
			{ kind: 'mul', numbers: [7, MAX_FACE_NUMBER + 1] },
			{ kind: 'mul', numbers: [7, '8'] },
			{ kind: 'mul', numbers: [7, Number.NaN] },
			{ kind: 'mul', numbers: { 0: 7, 1: 8, length: 2 } },
			{ kind: 'mul', numbers: [7, 8], times: true },
			{ kind: 'missing', numbers: [4, 20], times: false },
			{ kind: 'missing', numbers: [4, 20], times: 'yes' },
			{ kind: 'divide', numbers: [7, 8] },
			{ kind: '__proto__', numbers: [7, 8] },
			{ kind: 'sequence', numbers: [1, 2, 3] },
			{ kind: 'mul', numbers: [-7, 8] },
			{ kind: 'thermometer', numbers: [0, 3] },
			{ kind: 'thermometer', numbers: [0, 3, -5] },
			{ kind: 'thermometer', numbers: [0, -MAX_FACE_NUMBER - 1, 5] },
			{ kind: 'kroner', numbers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
			{ kind: 'fraction', numbers: [3, 5, 34] },
			{ kind: 'shape', numbers: [0, 40, 4, 0, 0, 0] },
			{ kind: 'barchart', numbers: [0, 1, 0, 0, 3, 3, 5, 80, 0, 0] },
			{ kind: 'clock', numbers: [0, 0, 15, 0, 0] },
			{ kind: 'balance', numbers: [5, 1, 2, 3] }
		]) {
			expect(readPuzzleFace(junk), JSON.stringify(junk)).toBeNull();
		}
	});
});
