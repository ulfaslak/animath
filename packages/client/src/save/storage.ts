/**
 * The browser's localStorage, where the game keeps its save (the primary
 * copy) and the player's identity. Every access is wrapped: a blocked or full
 * storage must never stop the game, only the saving.
 */

/** Every key the game keeps. Other per-device settings get keys of their own, never the save's. */
export const KEYS = {
	/** The save document (`SaveV1`). */
	save: 'animath.save',
	/** `{ id, secret }` for the server backup. */
	player: 'animath.player',
	/** A save this build could not read, moved here before a new game took its place. */
	unreadable: 'animath.save.unreadable',
	/** The game in this browser that gave way to a bigger one found on the server. */
	replaced: 'animath.save.replaced',
	/** An identity the server stopped recognising, kept in case it was the server that was wrong. */
	previousPlayer: 'animath.player.previous'
} as const;

/** A string key-value store: localStorage in the browser, a map in tests. */
export interface KeyValueStore {
	/** The value, or null when there is none or it cannot be read. */
	get(key: string): string | null;
	/** False when the write failed (full, blocked). */
	set(key: string, value: string): boolean;
	remove(key: string): void;
}

/**
 * localStorage, or null when this browser will not let the page use it at
 * all (blocked cookies make even touching `window.localStorage` throw).
 */
export function browserStore(): KeyValueStore | null {
	let storage: Storage;
	try {
		storage = window.localStorage;
		storage.getItem(KEYS.save);
	} catch {
		return null;
	}
	return {
		get(key) {
			try {
				return storage.getItem(key);
			} catch {
				return null;
			}
		},
		set(key, value) {
			try {
				storage.setItem(key, value);
				return true;
			} catch {
				return false;
			}
		},
		remove(key) {
			try {
				storage.removeItem(key);
			} catch {
				// Nothing to do: the key stays, and the next read sees it.
			}
		}
	};
}

/** Parsed JSON, or undefined when the text is not JSON. */
export function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}
