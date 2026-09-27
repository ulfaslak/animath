import { isGuestId } from '@mathgame/engine';
import { WORLD_SEED } from '../authority/local';
import { KEYS, parseJson, type KeyValueStore } from '../save/storage';

/**
 * Who this browser is to the other players, and which world it is in: the
 * one small adapter between presence and the game's own state.
 *
 * - **The guest id**: a random id this browser keeps (`animath.guest`),
 *   made the first time. The server knows a guest by it and never tells
 *   anyone else (they see a public id of the socket's own), so it is one
 *   presence per browser, whatever tab it plays in.
 * - **The name and the world** come with `feat/worlds-names`, which puts
 *   the character's name and world number into the game. Until it lands,
 *   the name is read from the save's own `name` field when it has one (a
 *   game without a name stays out of sight: every player the others see has
 *   one), and every game is in World 1, the only world there is.
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

/** The character's name and the world number, as far as this build knows them. */
export interface WhoAndWhere {
	name: string | null;
	world: number | null;
}

/** STAND-IN until `feat/worlds-names`: the save's `name`, and World 1 for the one world there is. */
export function whoAndWhere(store: KeyValueStore | null, seed: number): WhoAndWhere {
	const doc = parseJson(store?.get(KEYS.save) ?? '');
	const name =
		typeof doc === 'object' && doc !== null && typeof (doc as { name?: unknown }).name === 'string'
			? (doc as { name: string }).name
			: null;
	return { name, world: seed === WORLD_SEED ? 1 : null };
}

/** 16 random bytes in base64url: 22 characters. */
function randomId(): string {
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
	let text = '';
	for (const b of bytes) text += String.fromCharCode(b);
	return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
