/**
 * Taps and clicks on the overlay's buttons, each turned into the key press
 * its button stands for (`input/press.ts`), which then goes where a key
 * goes, behind the same guards. A button names its key in
 * `data-press` (`data-press="Enter"`, `data-press={rowKey(2)}`); the
 * innermost one under the pointer is the one pressed, so a level button in
 * an attack's row presses its level, not the row.
 *
 * A tap is a press that begins and ends on one button, on one screen: the
 * pointer goes down on the button and comes up over it again, while the same
 * screen takes keys. Each pointer is followed on its own, by `pointerId`, so a
 * thumb held on the D-pad never stops the other thumb's tap on Talk. The
 * browser's own `click` is not used for a pointer: it waits for every finger
 * to lift before it comes, and it lands on whatever is under a finger lifted
 * after the screen changed (a thumb held on the D-pad into a battle would
 * otherwise tap the battle row under it). A click with no pointer behind it
 * (`detail` 0: a screen reader, or a keyboard on a focused button) still
 * presses. The number pad and the D-pad don't take part: they press as the
 * finger lands.
 */

/** A pointer down on a button: the key it presses, the button, and the screen it went down on. */
interface Down<B> {
	key: string;
	button: B;
	screen: number;
}

/** Anything a pointer lands on and lifts over: an element in the page, a stand-in in tests. */
export interface Pressable {
	contains(other: Pressable | null): boolean;
}

/**
 * The pointers down on buttons, by `pointerId`. Pure: `watchTaps` feeds it
 * the page's pointer events; tests feed it their own.
 */
export class Taps<B extends Pressable = Pressable> {
	private downs = new Map<number, Down<B>>();

	/**
	 * Pointer `id` went down on `button`, which presses `key` (none: it is on
	 * no button), while screen `screen` took keys.
	 */
	down(id: number, key: string | undefined, button: B | null, screen: number): void {
		if (key === undefined || button === null) this.downs.delete(id);
		else this.downs.set(id, { key, button, screen });
	}

	/**
	 * Pointer `id` came up over `over` while screen `screen` takes keys: the key
	 * its tap presses, if it went down on the button it lifts over, on this screen.
	 */
	up(id: number, over: B | null, screen: number): string | undefined {
		const down = this.downs.get(id);
		this.downs.delete(id);
		if (!down || down.screen !== screen || !down.button.contains(over)) return undefined;
		return down.key;
	}

	/** The browser took pointer `id` for itself (a scroll): no tap. */
	cancel(id: number): void {
		this.downs.delete(id);
	}
}

/** The button a pointer is on (the innermost with a key), and its key. */
function pressableAt(target: EventTarget | null): HTMLElement | null {
	return target instanceof Element ? target.closest<HTMLElement>('[data-press]') : null;
}

/**
 * Turn taps and clicks on the page's buttons into key presses. `screen` says
 * which screen takes keys now (`main.ts` counts every change), and `press`
 * presses a key. Every pointer is heard, wherever it goes down or up, so a
 * pointer never keeps a button it left.
 */
export function watchTaps(target: Window, screen: () => number, press: (key: string) => void) {
	const taps = new Taps<HTMLElement>();
	target.addEventListener('pointerdown', (e) => {
		const button = e.button === 0 ? pressableAt(e.target) : null;
		taps.down(e.pointerId, button?.dataset.press, button, screen());
	});
	target.addEventListener('pointerup', (e) => {
		// What the pointer is over as it lifts: a finger is held by the button it
		// landed on (implicit capture), so ask the page, not the event.
		const over = target.document.elementFromPoint(e.clientX, e.clientY);
		const key = taps.up(e.pointerId, over instanceof HTMLElement ? over : null, screen());
		if (key !== undefined) press(key);
	});
	target.addEventListener('pointercancel', (e) => taps.cancel(e.pointerId));
	target.addEventListener('click', (e) => {
		if (e.detail !== 0) return; // a pointer's click: its tap has pressed, or must not
		const key = pressableAt(e.target)?.dataset.press;
		if (key !== undefined) press(key);
	});
}
