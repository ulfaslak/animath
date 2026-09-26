import type { AttackLevel } from '@mathgame/engine';
import { DOCTOR_TABS, type DoctorTab } from '../doctor/tabs';

/**
 * The pointer's way into the game: a tap or a click (`input/taps.ts`)
 * becomes a key press on `window`, the same event a keyboard sends, so it
 * reaches the same listeners, guards and handlers a real key does (`main.ts`
 * sends it to the screen that is up, explore's `Keyboard` included). A pointer is never
 * a second path to an action: Go is Enter, Back is Escape, the number pad's
 * 7 is the 7 key, the D-pad's arrow is the arrow key held down.
 *
 * A pointer can also name what it touched, which no key can: four key
 * names of its own, read by the screens that have such things.
 * - `row:<i>`: row `i` of the list on screen. What that does is the
 *   screen's to say: the doctor and the pause menu do the row at once; the
 *   battle, where a pick spends the turn, only highlights it, and Go
 *   (Enter) does it.
 * - `option:<i>`: option `i` of a second list beside the rows: the animal
 *   picked in the pause menu, the doctor's confirm before a hand-over. A key
 *   says what it touched, never where it sits, so two lists a pointer can
 *   reach at once never share one (#45: the team's `row:0` was read as the
 *   options' first, Go first).
 * - `level:<n>`: a level button on the highlighted attack (1 easy, 2
 *   medium, 3 hard). It sets the level; it does not attack.
 * - `language:<code>`: a language on a Language row (the pause menu's, the
 *   title's).
 * - `tab:<id>`: a tab of the doctor's card (`heal`, `home`, `shop`).
 *
 * No keyboard sends these names: a key's `key` is one character or a named
 * key such as `ArrowUp`.
 */

const ROW = /^row:(\d+)$/;
const OPTION = /^option:(\d+)$/;
const LEVEL = /^level:([1-3])$/;
const LANGUAGE = /^language:([a-z]{2,3})$/;
const TAB = /^tab:([a-z]+)$/;

/** The key name of a tap on row `i` of the list on screen. */
export function rowKey(i: number): string {
	return `row:${i}`;
}

/** The row a key name taps, or undefined for any other key. */
export function tappedRow(key: string): number | undefined {
	const m = ROW.exec(key);
	return m ? Number(m[1]) : undefined;
}

/** The key name of a tap on option `i` of the pause menu's picked animal. */
export function optionKey(i: number): string {
	return `option:${i}`;
}

/** The option a key name taps, or undefined for any other key. */
export function tappedOption(key: string): number | undefined {
	const m = OPTION.exec(key);
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

/** The key name of a tap on a language on a Language row. */
export function languageKey(code: string): string {
	return `language:${code}`;
}

/** The language code a key name taps, or undefined for any other key. */
export function tappedLanguage(key: string): string | undefined {
	return LANGUAGE.exec(key)?.[1];
}

/** The key name of a tap on a tab of the doctor's card. */
export function tabKey(tab: DoctorTab): string {
	return `tab:${tab}`;
}

/** The doctor's tab a key name taps, or undefined for any other key. */
export function tappedTab(key: string): DoctorTab | undefined {
	const tab = TAB.exec(key)?.[1];
	return (DOCTOR_TABS as readonly string[]).includes(tab ?? '') ? (tab as DoctorTab) : undefined;
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
