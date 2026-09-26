/**
 * Whether the screen shows the touch controls: the D-pad and its buttons in
 * explore, the number pad beside a puzzle, rows tall enough for a finger, and
 * hints that say "tap" instead of naming keys. The pointer works the same
 * either way (`press.ts`); this only decides what is drawn.
 *
 * It starts on where the main pointer is a finger (`pointer: coarse`: a
 * tablet or a phone), then follows the latest input: a touch or a pen turns
 * it on, a key pressed on a real keyboard turns it off. A mouse changes
 * nothing, since a laptop with a mouse has its keyboard too. Keys typed into
 * the name box (a tablet's own keyboard) and the pointer's pretend keys
 * don't count.
 */
class TouchView {
	on = $state(false);
	/** On a touch screen, taller than wide: the game asks to be turned sideways. */
	portrait = $state(false);
}

export const touch = new TouchView();

/** One input, as far as the choice of controls cares. */
export type SeenInput =
	| { kind: 'pointer'; pointerType: string }
	| { kind: 'key'; key: string; trusted: boolean; typing: boolean };

/** Keys that are only ever held with another key, and names a keyboard sends for no key at all. */
const NOT_A_PRESS = new Set([
	'Shift',
	'Control',
	'Alt',
	'AltGraph',
	'Meta',
	'CapsLock',
	'Fn',
	'Unidentified',
	'Process',
	'Dead'
]);

/** Whether the touch controls show after `input`, given whether they showed before. */
export function touchAfter(on: boolean, input: SeenInput): boolean {
	if (input.kind === 'pointer') {
		return input.pointerType === 'touch' || input.pointerType === 'pen' ? true : on;
	}
	if (!input.trusted || input.typing || NOT_A_PRESS.has(input.key)) return on;
	return false;
}

function isTyping(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/**
 * Start watching the page's input. The `touch` class on `<html>` switches the
 * touch sizes in the CSS; the battle scene's camera reads the same choice, so
 * a change is announced as a resize.
 */
export function watchInput(win: Window): void {
	const set = (on: boolean) => {
		if (touch.on === on) return;
		touch.on = on;
		win.document.documentElement.classList.toggle('touch', on);
		win.dispatchEvent(new Event('resize'));
	};
	const measure = () => {
		touch.portrait = win.innerHeight > win.innerWidth;
	};
	set(win.matchMedia?.('(pointer: coarse)').matches ?? false);
	measure();
	win.addEventListener(
		'pointerdown',
		(e) => set(touchAfter(touch.on, { kind: 'pointer', pointerType: e.pointerType })),
		{ capture: true }
	);
	win.addEventListener(
		'keydown',
		(e) =>
			set(
				touchAfter(touch.on, {
					kind: 'key',
					key: e.key,
					trusted: e.isTrusted,
					typing: isTyping(e.target)
				})
			),
		{ capture: true }
	);
	win.addEventListener('resize', measure);
}
