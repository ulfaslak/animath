/**
 * Taps and clicks on the overlay's buttons, each turned into the key press
 * its button stands for (`input/press.ts`), which then goes where a key
 * goes, behind the same guards. A button names its key in
 * `data-press` (`data-press="Enter"`, `data-press={rowKey(2)}`); the
 * innermost one under the pointer is the one pressed, so a level button in
 * an attack's row presses its level, not the row.
 *
 * A tap is a press that begins and ends on one button, on one screen: the
 * pointer goes down on the button and comes up again while the same screen
 * takes keys, still on the button or hardly moved (the button holds the
 * pointer, so a finger whose button changes shape under it — the first touch
 * after the keyboard brings the touch controls and their bigger panels —
 * still presses it), and the button still stands for the key it had when
 * the pointer landed: a team row that another finger moved (Move up, Go
 * first) is a different row by then, and presses nothing, rather than the
 * row its old place now names. Each pointer is followed on its own, by `pointerId`, so
 * a thumb held on the D-pad never stops the other thumb's tap on Talk. The
 * browser's own `click` is not used for a pointer: it waits for every finger
 * to lift before it comes, and it lands on whatever is under a finger lifted
 * after the screen changed (a thumb held on the D-pad into a battle would
 * otherwise tap the battle row under it). A click with no pointer behind it
 * (`detail` 0: a screen reader, or a keyboard on a focused button) still
 * presses. The number pad and the D-pad don't take part: they press as the
 * finger lands.
 */

/** CSS pixels a pointer may move and still tap the button it left: a finger's wobble. */
export const TAP_SLOP_PX = 20;

/** Where a pointer is, in CSS pixels. */
export interface Point {
	x: number;
	y: number;
}

/** A pointer down on a button: the key it presses, the button, the screen and the spot. */
interface Down<B> {
	key: string;
	button: B;
	screen: number;
	at: Point;
}

/** Anything a pointer lands on and lifts over: an element in the page, a stand-in in tests. */
export interface Pressable {
	contains(other: Pressable | null): boolean;
}

/**
 * The pointers down on buttons, by `pointerId`. Pure: `watchTaps` feeds it
 * the page's pointer events; tests feed it their own. `keyOf` reads the key
 * a button presses as it stands (`data-press`), asked as the pointer lands
 * and again as it lifts.
 */
export class Taps<B extends Pressable = Pressable> {
	private downs = new Map<number, Down<B>>();

	constructor(private keyOf: (button: B) => string | undefined) {}

	/**
	 * Pointer `id` went down at `at` on `button` (none: on no button), while
	 * screen `screen` took keys.
	 */
	down(id: number, button: B | null, screen: number, at: Point): void {
		const key = button === null ? undefined : this.keyOf(button);
		if (key === undefined || button === null) this.downs.delete(id);
		else this.downs.set(id, { key, button, screen, at });
	}

	/**
	 * Pointer `id` came up at `at`, on `target`, while screen `screen` takes
	 * keys: the key its tap presses, if it went down on a button that
	 * `target` is part of (the button keeps a pointer it holds, and loses it
	 * when it leaves the page), on this screen, it is still on that button
	 * (`onButton`) or hardly moved, and the button still presses the key it
	 * did when the pointer landed.
	 */
	up(
		id: number,
		target: B | null,
		screen: number,
		at: Point,
		onButton: (button: B) => boolean
	): string | undefined {
		const down = this.downs.get(id);
		this.downs.delete(id);
		if (!down || down.screen !== screen || !down.button.contains(target)) return undefined;
		const moved = Math.hypot(at.x - down.at.x, at.y - down.at.y);
		if (moved > TAP_SLOP_PX && !onButton(down.button)) return undefined;
		// A row whose place changed under the finger (another finger moved an animal)
		// stands for another row now; which one the finger meant, nobody can say.
		if (this.keyOf(down.button) !== down.key) return undefined;
		return down.key;
	}

	/** The browser took pointer `id` for itself (a scroll): no tap. */
	cancel(id: number): void {
		this.downs.delete(id);
	}
}

/**
 * The button an event happened on (the innermost with a key), found along
 * the path the event took when it began. A listener before this one may
 * already have redrawn the page: the first touch after keys brings the touch
 * controls, which takes Go!'s key cap, the very element the finger landed
 * on, off the page before this listener runs.
 */
function pressableIn(e: Event): HTMLElement | null {
	for (const node of e.composedPath()) {
		if (node instanceof HTMLElement && node.dataset.press !== undefined) return node;
	}
	return null;
}

/**
 * Turn taps and clicks on the page's buttons into key presses. `screen` says
 * which screen takes keys now (`main.ts` counts every change), and `press`
 * presses a key. Every pointer is heard, wherever it goes down or up, so a
 * pointer never keeps a button it left, and before any button's own
 * handler, so the screen a press begins on is the one the finger saw.
 */
export function watchTaps(target: Window, screen: () => number, press: (key: string) => void) {
	const taps = new Taps<HTMLElement>((button) => button.dataset.press);
	const early = { capture: true };
	target.addEventListener(
		'pointerdown',
		(e) => {
			const button = e.button === 0 ? pressableIn(e) : null;
			// The button holds the pointer until it lifts, whatever is drawn under it meanwhile.
			try {
				button?.setPointerCapture(e.pointerId);
			} catch {
				// Not a pointer the page can hold, or a button already off the page.
			}
			taps.down(e.pointerId, button, screen(), {
				x: e.clientX,
				y: e.clientY
			});
		},
		early
	);
	target.addEventListener(
		'pointerup',
		(e) => {
			const at = { x: e.clientX, y: e.clientY };
			const key = taps.up(
				e.pointerId,
				e.target instanceof HTMLElement ? e.target : null,
				screen(),
				at,
				(button) => {
					const box = button.getBoundingClientRect();
					return at.x >= box.left && at.x <= box.right && at.y >= box.top && at.y <= box.bottom;
				}
			);
			if (key !== undefined) press(key);
		},
		early
	);
	target.addEventListener('pointercancel', (e) => taps.cancel(e.pointerId), early);
	target.addEventListener('click', (e) => {
		if (e.detail !== 0) return; // a pointer's click: its tap has pressed, or must not
		const key = pressableIn(e)?.dataset.press;
		if (key !== undefined) press(key);
	});
}
