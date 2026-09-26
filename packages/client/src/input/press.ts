import type { AttackLevel } from '@mathgame/engine';

/**
 * The pointer's way into the game: a tap or a click becomes a key press on
 * `window`, the same event a keyboard sends, so it reaches the same
 * listeners, guards and handlers a real key does (`main.ts` sends it to the
 * screen that is up; explore's `Keyboard` hears it too). A pointer is never
 * a second path to an action: Go is Enter, Back is Escape, the number pad's
 * 7 is the 7 key, the D-pad's arrow is the arrow key held down.
 *
 * A pointer can also name what it touched, which no key can: three key
 * names of its own, read by the screens that have such things.
 * - `row:<i>`: row `i` of the list on screen. What that does is the
 *   screen's to say: the doctor and the pause menu do the row at once; the
 *   battle, where a pick spends the turn, only highlights it, and Go
 *   (Enter) does it.
 * - `level:<n>`: a level button on the highlighted attack (1 easy, 2
 *   medium, 3 hard). It sets the level; it does not attack.
 * - `language:<code>`: a language on the pause menu's Language row.
 *
 * No keyboard sends these names: a key's `key` is one character or a named
 * key such as `ArrowUp`.
 */

const ROW = /^row:(\d+)$/;
const LEVEL = /^level:([1-3])$/;
const LANGUAGE = /^language:([a-z]{2,3})$/;

/** The key name of a tap on row `i` of the list on screen. */
export function rowKey(i: number): string {
	return `row:${i}`;
}

/** The row a key name taps, or undefined for any other key. */
export function tappedRow(key: string): number | undefined {
	const m = ROW.exec(key);
	return m ? Number(m[1]) : undefined;
}

/** The key name of a tap on the highlighted attack's level button. */
export function levelKey(level: AttackLevel): string {
	return `level:${level}`;
}

/** The level a key name taps, or undefined for any other key. */
export function tappedLevel(key: string): AttackLevel | undefined {
	const m = LEVEL.exec(key);
	return m ? (Number(m[1]) as AttackLevel) : undefined;
}

/** The key name of a tap on a language in the pause menu. */
export function languageKey(code: string): string {
	return `language:${code}`;
}

/** The language code a key name taps, or undefined for any other key. */
export function tappedLanguage(key: string): string | undefined {
	return LANGUAGE.exec(key)?.[1];
}

function send(type: 'keydown' | 'keyup', key: string): void {
	window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
}

/** Press a key and let it go at once, as a quick tap on a keyboard would. */
export function press(key: string): void {
	send('keydown', key);
	send('keyup', key);
}

/** Press a key and keep it down until `release`: the D-pad, held. */
export function hold(key: string): void {
	send('keydown', key);
}

/** Let go of a key pressed with `hold`. */
export function release(key: string): void {
	send('keyup', key);
}

/**
 * For every button the pointer presses: it never keeps the focus. Keys reach
 * the screen through `main.ts`, so a focused button would take a second,
 * native press from Enter or Space and do its thing twice. Tab skips it too.
 */
export function unfocusable(node: HTMLElement): () => void {
	node.tabIndex = -1;
	const blur = () => node.blur();
	node.addEventListener('focus', blur);
	return () => node.removeEventListener('focus', blur);
}
