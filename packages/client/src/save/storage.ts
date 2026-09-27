/**
 * The browser's localStorage, where the game keeps its save (the primary
 * copy) and the player's identity. Every access is wrapped: a blocked or full
 * storage must never stop the game, only the saving.
 */

/**
 * The keys one game's saves live under in this browser: the guest game's
 * (`KEYS`), or an account's (`accountKeys`), so the two never share a key.
 */
export interface SaveKeys {
	save: string;
	upgraded: string;
	player: string;
	unreadable: string;
	replaced: string;
	previous: string;
	previousPlayer: string;
}

/**
 * Every key the guest game keeps: a player with no account, the game every
 * browser starts with. Other per-device settings get keys of their own,
 * never the save's.
 */
export const KEYS = {
	/** The save document (`SaveV2`). */
	save: 'animath.save',
	/**
	 * A save an older build wrote, kept as it was, text and all, before this
	 * build's first save of the game took its place (the game itself goes on,
	 * upgraded, in `save`).
	 */
	upgraded: 'animath.save.upgraded',
	/** `{ id, secret }` for the server backup. */
	player: 'animath.player',
	/** A save this build could not read, moved here before a new game took its place. */
	unreadable: 'animath.save.unreadable',
	/**
	 * A game in this browser that gave way to another: a bigger one found on
	 * the server, or a save another tab wrote in the same instant, unseen.
	 */
	replaced: 'animath.save.replaced',
	/** The game that was saved here when the kid started a new one from the title. */
	previous: 'animath.save.previous',
	/** An identity the server stopped recognising, kept in case it was the server that was wrong. */
	previousPlayer: 'animath.player.previous'
} as const satisfies SaveKeys;

/** The account this browser is logged in to (`account/session.ts`). */
export const ACCOUNT_KEYS = {
	/** `{ name }`: the account this browser is logged in to, whose game it plays; none for a guest. */
	current: 'animath.account',
	/** A logout the server has not heard yet (it was out of reach): sent again at the next start. */
	logoutPending: 'animath.logout.pending'
} as const;

/**
 * Where an account's game lives in this browser, apart from the guest game:
 * its own save and set-asides, under the account's name key (the engine's
 * `nameKey`, which every way of typing the name shares). `player` is never
 * written: an account's save is the account's, known to the server by the
 * session cookie, with no identity of its own.
 */
export function accountKeys(key: string): SaveKeys {
	const base = `animath.account.${encodeURIComponent(key)}`;
	return {
		save: `${base}.save`,
		upgraded: `${base}.save.upgraded`,
		player: `${base}.player`,
		unreadable: `${base}.save.unreadable`,
		replaced: `${base}.save.replaced`,
		previous: `${base}.save.previous`,
		previousPlayer: `${base}.player.previous`
	};
}

/** How many saves each set-aside key can keep (`animath.save.unreadable`, `.2`, … `.20`). */
export const MAX_SET_ASIDE = 20;
/**
 * How many games `animath.save.previous` can keep. Those are put away on
 * purpose, and a kid trying the starters one after another puts one away
 * per try, so the key has room for far more than the accidents above.
 */
export const MAX_PUT_AWAY = 200;

/**
 * Keep `text` in the first free slot of `prefix` (`prefix`, then
 * `prefix.2`, … up to `slots`), never over one kept before. True when it is
 * kept there, or was already; false when every slot is taken or the write
 * failed, and then nothing was written over.
 */
export function setAside(
	store: KeyValueStore,
	prefix: string,
	text: string,
	slots = MAX_SET_ASIDE
): boolean {
	for (let n = 1; n <= slots; n++) {
		const key = n === 1 ? prefix : `${prefix}.${n}`;
		const there = store.get(key);
		if (there === text) return true;
		if (there === null) return store.set(key, text);
	}
	return false;
}

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
