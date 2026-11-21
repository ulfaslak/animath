import { Rng, UNITS, generatePuzzle, puzzleFace, type PuzzleFace } from '@mathgame/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { language } from '../src/copy';
import {
	questionParts,
	questionText,
	shownPrompt,
	wordedPrompt,
	wordedSum
} from '../src/puzzle-words';

/**
 * A measuring puzzle (`units`) is a sum in words the client writes from its
 * face, in the language on screen ([[DECISIONS]] § Copy and languages): the
 * engine sends numbers, and the words are picked when they are shown.
 */

afterEach(() => language.set('en'));

/** The sum as it reads, its no-break spaces as plain ones. */
function sum(numbers: number[]): string | null {
	return wordedSum({ kind: 'units', numbers })?.replace(/ /g, ' ') ?? null;
}

describe('a measuring puzzle in words', () => {
	it('reads as a sum in English and in Danish, time in words and the rest in signs', () => {
		const { whole, mixed, back, rest } = UNITS;
		// Pairs by their place in `UNIT_PAIRS`: 0 week-day, 2 hour-minute, 4 year-month, 6 m-cm, 8 kg-g.
		const cases: [number[], string, string][] = [
			[[whole, 0, 1, 0], '1 week = ? days', '1 uge = ? dage'],
			[[whole, 2, 2, 0], '2 hours = ? minutes', '2 timer = ? minutter'],
			[[whole, 6, 3, 0], '3 m = ? cm', '3 m = ? cm'],
			[
				[mixed, 2, 1, 20],
				'1 hour and 20 minutes = ? minutes',
				'1 time og 20 minutter = ? minutter'
			],
			[[mixed, 6, 2, 35], '2 m 35 cm = ? cm', '2 m 35 cm = ? cm'],
			[[mixed, 4, 2, 1], '2 years and 1 month = ? months', '2 år og 1 måned = ? måneder'],
			[[back, 8, 3000, 0], '3000 g = ? kg', '3000 g = ? kg'],
			[[back, 0, 14, 0], '14 days = ? weeks', '14 dage = ? uger'],
			[
				[rest, 2, 130, 2],
				'130 minutes = 2 hours and ? minutes',
				'130 minutter = 2 timer og ? minutter'
			],
			[[rest, 6, 250, 2], '250 cm = 2 m ? cm', '250 cm = 2 m ? cm']
		];
		for (const [numbers, en, da] of cases) {
			language.set('en');
			expect(sum(numbers), en).toBe(en);
			language.set('da');
			expect(sum(numbers), da).toBe(da);
		}
	});

	it('keeps each number with its unit, and the question mark with the unit it asks for', () => {
		const nbsp = (text: string) => text.replace(/_/g, '\u00a0');
		expect(wordedSum({ kind: 'units', numbers: [UNITS.mixed, 2, 1, 20] })).toBe(
			nbsp('1_hour and 20_minutes = ?_minutes')
		);
		language.set('da');
		expect(wordedSum({ kind: 'units', numbers: [UNITS.rest, 2, 130, 2] })).toBe(
			nbsp('130_minutter = 2_timer og ?_minutter')
		);
	});

	it('words every measuring puzzle the game asks, and nothing of another kind', () => {
		for (let d = 1; d <= 10; d++) {
			const rng = new Rng(d);
			for (let i = 0; i < 100; i++) {
				const face = puzzleFace(generatePuzzle(rng, d, ['units']))!;
				for (const lang of ['en', 'da'] as const) {
					language.set(lang);
					const text = wordedSum(face);
					// The panel shows it as any worded prompt, by the one function.
					expect(wordedPrompt(face)).toBe(text);
					// One question mark, and no key or placeholder showing in place of a word.
					expect(text, JSON.stringify(face)).toMatch(/^[^?]*\?[^?]*$/);
					expect(text).not.toMatch(/puzzle\.|\{|\}/);
				}
			}
		}
		const sumFace: PuzzleFace = { kind: 'add', numbers: [2, 3] };
		expect(wordedSum(sumFace)).toBeNull();
		expect(wordedSum({ kind: 'units', numbers: [0, 99, 1, 0] })).toBeNull();
	});
});

describe('the prompt in big type', () => {
	it('is a worded puzzle in words, a sum as written, and a "?" for a face this page cannot read', () => {
		const units = { kind: 'units' as const, prompt: 'units(0, 6, 3, 0)' };
		expect(shownPrompt(units, puzzleFace(units))).toBe('3\u00a0m = ?\u00a0cm');
		const sum = { kind: 'add' as const, prompt: '2 + 3 = ?' };
		expect(shownPrompt(sum, puzzleFace(sum))).toBe('2 + 3 = ?');
		// A pair of units, a way of asking and a picture this build does not know, from a newer one.
		for (const prompt of ['units(0, 10, 3, 0)', 'units(4, 6, 3, 0)']) {
			const newer = { kind: 'units' as const, prompt };
			expect(puzzleFace(newer)).toBeNull();
			expect(shownPrompt(newer, null), prompt).toBe('?');
		}
		expect(shownPrompt({ kind: 'clock', prompt: 'clock(9, 3, 0, 0, 0)' }, null)).toBe('?');
		expect(shownPrompt({ kind: 'double', prompt: 'double(5, 8)' }, null)).toBe('?');
	});
});

describe('a kroner question', () => {
	// Paying for two things: 200 + 100 kr. for 52 and 179 kr. (`kroner`'s face: kind, the
	// pieces by value from 1 kr. up, then the prices).
	const face: PuzzleFace = { kind: 'kroner', numbers: [2, 0, 0, 0, 0, 0, 0, 1, 1, 52, 179] };

	it('reads whole, and only how it is paid may step aside for a card with no room', () => {
		for (const [lang, whole, shown] of [
			[
				'en',
				'You buy a book for 52 kroner and a hat for 179 kroner. You pay with the money in the picture. How much do you get back?',
				'You buy a book for 52 kroner and a hat for 179 kroner. How much do you get back?'
			],
			[
				'da',
				'Du køber en bog til 52 kroner og en hue til 179 kroner. Du betaler med pengene på billedet. Hvor mange penge får du tilbage?',
				'Du køber en bog til 52 kroner og en hue til 179 kroner. Hvor mange penge får du tilbage?'
			]
		] as const) {
			language.set(lang);
			const parts = questionParts(face)!;
			expect(questionText(parts)).toBe(whole);
			const kept = parts.filter((p) => !('aside' in p && p.aside));
			expect(questionText(kept)).toBe(shown);
		}
	});
});
