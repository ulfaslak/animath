import { isGuestId } from '@mathgame/engine';
import type { KeyValueStore } from '../save/storage';

/**
 * Who this browser is to the other players: its guest id, a random id it
 * keeps (`animath.guest`), made the first time. The server knows a guest by
 * it and never tells anyone else (they see a public id of the socket's own),
 * so it is one presence per browser, whatever tab it plays in. The name the
 * others see and the world they see it in are the game's own (`welcome`,
 * `name-chosen`, `travelled`), which the presence controller follows.
 */
export const GUEST_KEY = 'animath.guest';

/** This browser's guest id: the one it keeps, or a new one, kept from now on (for this page alone if storage fails). */
export function guestId(store: KeyValueStore | null): string {
	const kept = store?.get(GUEST_KEY) ?? null;
	if (isGuestId(kept)) return kept;
	const fresh = randomId();
	store?.set(GUEST_KEY, fresh);
	return fresh;
}

/** 16 random bytes in base64url: 22 characters. */
function randomId(): string {
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
	let text = '';
	for (const b of bytes) text += String.fromCharCode(b);
	return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
