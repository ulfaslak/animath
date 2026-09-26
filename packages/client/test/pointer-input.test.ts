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
import { Taps, type Pressable } from '../src/input/taps';
import { touchAfter } from '../src/input/touch.svelte';

/**
 * The small rules of pointer input: the pointer's own key names, which arrow
 * of the D-pad a finger presses, when the touch controls show, and what a
 * tap is.
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

/**
 * A tap is a press that begins and ends on one button, on one screen, each
 * pointer on its own (`input/taps.ts`). The buttons are stand-ins that know
 * what they contain, as elements do.
 */
describe('taps', () => {
	/** A button, and a part of it (a level button in a row, the text in a pill). */
	class Box implements Pressable {
		constructor(private parts: Pressable[] = []) {}
		contains(other: Pressable | null): boolean {
			return other === this || this.parts.some((p) => p === other || p.contains(other));
		}
	}
	const inner = new Box();
	const run = new Box([inner]);
	const go = new Box();
	const menu = new Box();
	const dpad = new Box();

	it('a finger that goes down on a button and lifts over it presses its key, once', () => {
		const taps = new Taps();
		taps.down(1, 'Enter', go, 7);
		expect(taps.up(1, go, 7)).toBe('Enter');
		expect(taps.up(1, go, 7)).toBeUndefined();
		taps.down(2, rowKey(4), run, 7);
		expect(taps.up(2, inner, 7)).toBe(rowKey(4)); // lifted over a part of it
	});

	it('a finger lifted over a button it did not go down on presses nothing there (#39)', () => {
		// A thumb held on the D-pad as a battle takes the screen, lifted over Run.
		const taps = new Taps();
		taps.down(1, undefined, null, 3); // the D-pad walks by itself: no key to tap
		expect(taps.up(1, run, 4)).toBeUndefined();
		// Down on a button, up somewhere else: slid off, nothing.
		taps.down(2, 'Enter', go, 4);
		expect(taps.up(2, run, 4)).toBeUndefined();
		expect(taps.up(3, go, 4)).toBeUndefined(); // up with no down at all
	});

	it('a press counts only on the screen it began on', () => {
		// Down on Go! while the turn plays, lifted once the menu is back.
		const taps = new Taps();
		taps.down(1, 'Enter', go, 11);
		expect(taps.up(1, go, 12)).toBeUndefined();
	});

	it('follows each finger on its own: a thumb on the D-pad never stops a tap on Menu (#40)', () => {
		const taps = new Taps();
		taps.down(1, undefined, dpad, 5); // walking, and staying down
		taps.down(2, 'Escape', menu, 5);
		expect(taps.up(2, menu, 5)).toBe('Escape');
		expect(taps.up(1, dpad, 5)).toBeUndefined();
		// Two taps at once, lifted in either order.
		taps.down(3, 'Enter', go, 5);
		taps.down(4, 'Escape', menu, 5);
		expect(taps.up(4, menu, 5)).toBe('Escape');
		expect(taps.up(3, go, 5)).toBe('Enter');
	});

	it('a pointer the browser takes for a scroll taps nothing, and a new press forgets an old one', () => {
		const taps = new Taps();
		taps.down(1, rowKey(2), run, 2);
		taps.cancel(1);
		expect(taps.up(1, run, 2)).toBeUndefined();
		// The mouse (always pointer 1): down on Go!, released off it, then down elsewhere and
		// dragged back over Go!: nothing.
		taps.down(1, 'Enter', go, 2);
		expect(taps.up(1, run, 2)).toBeUndefined();
		taps.down(1, undefined, null, 2);
		expect(taps.up(1, go, 2)).toBeUndefined();
	});
});
