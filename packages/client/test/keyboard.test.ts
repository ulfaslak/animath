import { describe, expect, it } from 'vitest';
import { Keyboard, keyName } from '../src/input/keyboard';

/**
 * Explore's keyboard against key events as browsers send them: W A S D walk
 * whatever Caps Lock, Shift or the keyboard's alphabet say, letting go of a
 * key always stops what it started, and a shortcut (Ctrl, Cmd, Alt) is left
 * to the browser. The window is a stand-in that records the listeners.
 */
interface Press {
	key: string;
	code?: string;
	repeat?: boolean;
	shiftKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
}

function setup() {
	const listeners = new Map<string, (e: unknown) => void>();
	const target = {
		addEventListener: (type: string, listener: (e: unknown) => void) =>
			listeners.set(type, listener)
	} as unknown as Window;
	const keyboard = new Keyboard(target);
	/** Send one key event; whether the page kept the key from the browser. */
	const send = (type: 'keydown' | 'keyup', press: Press): boolean => {
		let prevented = false;
		listeners.get(type)!({
			repeat: false,
			shiftKey: false,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			code: '',
			...press,
			preventDefault() {
				prevented = true;
			}
		});
		return prevented;
	};
	const down = (press: Press) => send('keydown', press);
	const up = (press: Press) => send('keyup', press);
	/** Everything the keyboard has for explore this frame, taken as explore takes it. */
	const take = () => ({
		tap: keyboard.takeTap(),
		held: keyboard.heldDirection(),
		interact: keyboard.takeInteract(),
		slot: keyboard.takeSlot()
	});
	const fire = (type: string) => listeners.get(type)!({});
	return { keyboard, down, up, take, fire };
}

const nothing = { tap: undefined, held: undefined, interact: false, slot: undefined };

describe('keyName', () => {
	it('reads a letter the same whatever Caps Lock and Shift say, and W A S D by place on other alphabets', () => {
		const cases: [Pick<KeyboardEvent, 'key' | 'code'>, string][] = [
			[{ key: 'd', code: 'KeyD' }, 'd'],
			[{ key: 'D', code: 'KeyD' }, 'd'], // Caps Lock, or Shift
			[{ key: 'W', code: 'KeyW' }, 'w'],
			[{ key: 'ц', code: 'KeyW' }, 'w'], // a Russian keyboard
			[{ key: 'ς', code: 'KeyW' }, 'w'], // a Greek one
			[{ key: 'в', code: 'KeyD' }, 'd'],
			[{ key: 'Ф', code: 'KeyA' }, 'a'],
			[{ key: 'z', code: 'KeyW' }, 'z'], // a French keyboard: the letter on the key
			[{ key: 'w', code: 'KeyZ' }, 'w'],
			[{ key: 'ø', code: 'Quote' }, 'ø'],
			[{ key: 'Enter', code: 'Enter' }, 'Enter'],
			[{ key: ' ', code: 'Space' }, ' '],
			[{ key: '3', code: 'Digit3' }, '3'],
			[{ key: '7', code: 'Numpad7' }, '7'],
			[{ key: 'ArrowUp', code: 'ArrowUp' }, 'ArrowUp'],
			[{ key: 'Escape', code: 'Escape' }, 'Escape'],
			[{ key: 'S', code: '' }, 's'], // no code at all (a synthetic event)
			[{ key: 'Process', code: 'KeyW' }, 'Process'], // an input method at work: not a W
			[{ key: 'Unidentified', code: 'KeyA' }, 'Unidentified'],
			[{ key: 'Dead', code: 'KeyD' }, 'Dead']
		];
		expect(cases.map(([e]) => keyName(e))).toEqual(cases.map(([, name]) => name));
	});
});

describe('explore keyboard', () => {
	it('walks with W A S D in capitals, as Caps Lock sends them', () => {
		const t = setup();
		expect(t.down({ key: 'D', code: 'KeyD' })).toBe(true);
		expect(t.take()).toMatchObject({ tap: 'right', held: 'right' });
		t.up({ key: 'D', code: 'KeyD' });
		expect(t.keyboard.heldDirection()).toBeUndefined();
		for (const [key, dir] of [
			['W', 'up'],
			['A', 'left'],
			['S', 'down']
		] as const) {
			t.down({ key, code: `Key${key}` });
			expect(t.take().tap).toBe(dir);
			t.up({ key, code: `Key${key}` });
		}
	});

	it('stops when a key is let go with Shift down, though the release names the key in capitals', () => {
		const t = setup();
		t.down({ key: 'd', code: 'KeyD' });
		t.down({ key: 'Shift', code: 'ShiftLeft', shiftKey: true });
		expect(t.keyboard.heldDirection()).toBe('right');
		t.up({ key: 'D', code: 'KeyD', shiftKey: true });
		expect(t.keyboard.heldDirection()).toBeUndefined();
		t.up({ key: 'Shift', code: 'ShiftLeft' });
		expect(t.keyboard.heldDirection()).toBeUndefined();
	});

	it('walks with Shift held, like Caps Lock', () => {
		const t = setup();
		t.down({ key: 'Shift', code: 'ShiftLeft', shiftKey: true });
		t.down({ key: 'A', code: 'KeyA', shiftKey: true });
		expect(t.take()).toMatchObject({ tap: 'left', held: 'left' });
	});

	it('walks with the W A S D keys of a keyboard that types another alphabet', () => {
		const t = setup();
		t.down({ key: 'ц', code: 'KeyW' });
		expect(t.take()).toMatchObject({ tap: 'up', held: 'up' });
		t.up({ key: 'ц', code: 'KeyW' });
		expect(t.keyboard.heldDirection()).toBeUndefined();
	});

	it('holds what is still down when one of two keys for the same way is let go', () => {
		const t = setup();
		t.down({ key: 'ArrowRight', code: 'ArrowRight' });
		t.down({ key: 'd', code: 'KeyD' });
		t.up({ key: 'ArrowRight', code: 'ArrowRight' });
		expect(t.keyboard.heldDirection()).toBe('right');
		t.up({ key: 'd', code: 'KeyD' });
		expect(t.keyboard.heldDirection()).toBeUndefined();
	});

	it('leaves Ctrl, Cmd and Alt shortcuts to the browser: no step, no talk, no pick', () => {
		const t = setup();
		const shortcuts: Press[] = [
			{ key: 'd', code: 'KeyD', metaKey: true }, // bookmark
			{ key: 's', code: 'KeyS', ctrlKey: true }, // save the page
			{ key: 's', code: 'KeyS', metaKey: true },
			{ key: 'a', code: 'KeyA', metaKey: true }, // select all
			{ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }, // back
			{ key: 'ArrowRight', code: 'ArrowRight', metaKey: true }, // forward
			{ key: 'Enter', code: 'Enter', ctrlKey: true },
			{ key: ' ', code: 'Space', altKey: true },
			{ key: '2', code: 'Digit2', metaKey: true }, // the second tab
			{ key: 'w', code: 'KeyW', ctrlKey: true, altKey: true } // AltGr on Windows
		];
		const prevented = shortcuts.map((press) => t.down(press));
		expect(prevented).toEqual(shortcuts.map(() => false));
		expect(t.take()).toEqual(nothing);
	});

	it('stops walking when Cmd goes down, since macOS sends no keyup for a key let go under it', () => {
		const t = setup();
		t.down({ key: 'a', code: 'KeyA' });
		expect(t.take()).toMatchObject({ tap: 'left', held: 'left' });
		t.down({ key: 'Meta', code: 'MetaLeft', metaKey: true });
		// The A is let go with Cmd still down: macOS sends nothing. Then Cmd comes up.
		t.up({ key: 'Meta', code: 'MetaLeft' });
		expect(t.take()).toEqual(nothing);
		// Cmd+A pressed and let go in the other order, A last and never reported.
		t.down({ key: 'Meta', code: 'MetaLeft', metaKey: true });
		t.down({ key: 'a', code: 'KeyA', metaKey: true });
		t.up({ key: 'Meta', code: 'MetaLeft' });
		expect(t.take()).toEqual(nothing);
	});

	it('lets go of everything when the window loses focus or the page is hidden', () => {
		for (const type of ['blur', 'visibilitychange']) {
			const t = setup();
			t.down({ key: 'ArrowUp', code: 'ArrowUp' });
			t.fire(type);
			expect(t.take()).toEqual(nothing);
		}
	});
});
