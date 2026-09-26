import { battle } from '../state/battle.svelte';
import { doctor } from '../state/doctor.svelte';
import { pause } from '../state/pause.svelte';
import { isShortcut, keyName } from './keyboard';

/**
 * The M key: sound off and on, over any screen (UI_SPEC § Sound and juice).
 * `main.ts` asks these two before it hands a key to a screen.
 */

/** M, with Caps Lock or Shift or neither, and never with Ctrl, Cmd or Alt (those are the browser's). */
export function isSoundKey(
	e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>
): boolean {
	return keyName(e) === 'm' && !isShortcut(e);
}

/**
 * Whether a key pressed now is typing: an answer in a battle or at the
 * doctor, a name in the pause menu's name box, or anything in a text box.
 * There M is a letter (or nothing), never the sound key.
 */
export function typingNow(target: EventTarget | null): boolean {
	return (
		(typeof HTMLInputElement !== 'undefined' && target instanceof HTMLInputElement) ||
		(battle.active && battle.screen === 'puzzle') ||
		(doctor.active && doctor.screen === 'puzzle') ||
		(pause.open && pause.screen === 'naming')
	);
}
