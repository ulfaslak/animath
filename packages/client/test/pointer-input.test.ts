import { describe, expect, it } from 'vitest';
import { padDirection } from '../src/input/dpad';
import {
	languageKey,
	levelKey,
	rowKey,
	tappedLanguage,
	tappedLevel,
	tappedRow
} from '../src/input/press';
import { touchAfter } from '../src/input/touch.svelte';

/**
 * The small rules of pointer input: the pointer's own key names, which arrow
 * of the D-pad a finger presses, and when the touch controls show.
 */
describe("the pointer's keys", () => {
	it('name a row, a level or a language, and nothing a keyboard sends', () => {
		expect(tappedRow(rowKey(0))).toBe(0);
		expect(tappedRow(rowKey(12))).toBe(12);
		expect(tappedLevel(levelKey(3))).toBe(3);
		expect(tappedLanguage(languageKey('da'))).toBe('da');
		// What a keyboard sends is never one of them: one character, or a key's name.
		for (const key of ['Enter', ' ', '1', 'r', 'ArrowUp', 'Escape', 'Backspace', '-', 'Process']) {
			expect([tappedRow(key), tappedLevel(key), tappedLanguage(key)]).toEqual([
				undefined,
				undefined,
				undefined
			]);
		}
		expect(tappedLevel('level:4')).toBeUndefined();
		expect(tappedRow('row:-1')).toBeUndefined();
	});
});

describe('the D-pad', () => {
	it('presses the arrow the finger is furthest along, and none at the centre', () => {
		expect(padDirection(0, 0, 20)).toBeNull();
		expect(padDirection(12, -12, 20)).toBeNull();
		expect(padDirection(0, -60, 20)).toBe('up');
		expect(padDirection(0, 60, 20)).toBe('down');
		expect(padDirection(-60, 10, 20)).toBe('left');
		expect(padDirection(60, -10, 20)).toBe('right');
		// Screen y grows downward, as the grid's does: below the centre is down.
		expect(padDirection(5, 30, 20)).toBe('down');
		// A finger slid far off the pad keeps its arrow.
		expect(padDirection(900, 40, 20)).toBe('right');
	});
});

describe('the touch controls', () => {
	const key = (k: string, trusted = true, typing = false) =>
		({ kind: 'key', key: k, trusted, typing }) as const;
	const pointer = (pointerType: string) => ({ kind: 'pointer', pointerType }) as const;

	it('show after a touch or a pen, and a mouse changes nothing', () => {
		expect(touchAfter(false, pointer('touch'))).toBe(true);
		expect(touchAfter(false, pointer('pen'))).toBe(true);
		expect(touchAfter(false, pointer('mouse'))).toBe(false);
		expect(touchAfter(true, pointer('mouse'))).toBe(true);
	});

	it('go after a key on a real keyboard, but not for the pointer’s own keys, typing or a modifier', () => {
		expect(touchAfter(true, key('ArrowUp'))).toBe(false);
		expect(touchAfter(true, key('Enter'))).toBe(false);
		// Go, the number pad, the D-pad: key presses the page made itself.
		expect(touchAfter(true, key('Enter', false))).toBe(true);
		expect(touchAfter(true, key('row:2', false))).toBe(true);
		// The tablet's own keyboard, typing a name into the name box.
		expect(touchAfter(true, key('p', true, true))).toBe(true);
		expect(touchAfter(true, key('Shift'))).toBe(true);
		expect(touchAfter(true, key('Unidentified'))).toBe(true);
		expect(touchAfter(false, key('ArrowUp'))).toBe(false);
	});
});
