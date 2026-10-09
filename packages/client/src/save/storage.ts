/**
 * The browser's localStorage, where the game keeps its save (the primary
 * copy). Every access is wrapped: a blocked or full storage must never stop
 * the game, only the saving.
 *
 * A browser that played before the anonymous backup was retired also holds
 * `animath.player` (`{ id, secret }`, its backup's) and maybe
 * `animath.player.previous` (`.2`, …): ids set aside there when the kid made
 * an account (the game that moved in), or when the server stopped knowing
 * one, and `animath.player` may then be a later guest game's. The game no
 * longer reads or writes any of them; they stay as they are, since the ids
 * are how `admin export-local-save` finds that browser's old games
 * ([[DEVELOPMENT]] § Moving a kid's game to production).
 */

/**
 * The keys one game's saves live under in this browser: the guest game's
 * (`KEYS`), or an account's (`accountKeys`), so the two never share a key.
 */
export interface SaveKeys {
	save: string;
	upgraded: string;
	unreadable: string;
	replaced: string;
	previous: string;
}

/**
 * Every key the guest game keeps: a player with no account, the game every
 * browser starts with. Other per-device settings get keys of their own,
 * never the save's.
 */
export const KEYS = {
	/** The save document (`SaveV5`). */
	save: 'animath.save',
	/**
	 * A save an older build wrote, kept as it was, text and all, before this
	 * build's first save of the game took its place (the game itself goes on,
	 * upgraded, in `save`).
	 */
	upgraded: 'animath.save.upgraded',
	/** A save this build could not read, moved here before a new game took its place. */
	unreadable: 'animath.save.unreadable',
	/**
	 * A game in this browser that gave way to another: a bigger one found on
	 * the server, or a save another tab wrote in the same instant, unseen.
	 */
	replaced: 'animath.save.replaced',
	/** The game that was saved here when the kid started a new one from the title. */
	previous: 'animath.save.previous'
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
 * `nameKey`, which every way of typing the name shares). The server knows
 * the account by the session cookie.
 */
export function accountKeys(key: string): SaveKeys {
	const base = `animath.account.${encodeURIComponent(key)}`;
	return {
		save: `${base}.save`,
		upgraded: `${base}.save.upgraded`,
		unreadable: `${base}.save.unreadable`,
		replaced: `${base}.save.replaced`,
		previous: `${base}.save.previous`
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
 * localStorage (or this tab's sessionStorage, `session`), or null when this
 * browser will not let the page use it at all (blocked cookies make even
 * touching `window.localStorage` throw).
 */
export function browserStore(which: 'local' | 'session' = 'local'): KeyValueStore | null {
	let storage: Storage;
	try {
		storage = which === 'session' ? window.sessionStorage : window.localStorage;
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

/**
 * Whether two JSON values are the same document, whatever the order of their
 * keys (the server's `jsonb` keeps its own).
 */
export function sameJson(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a)) {
		const other = b as unknown[];
		return a.length === other.length && a.every((v, i) => sameJson(v, other[i]));
	}
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left).filter((k) => left[k] !== undefined);
	const others = Object.keys(right).filter((k) => right[k] !== undefined);
	return (
		keys.length === others.length && keys.every((k) => k in right && sameJson(left[k], right[k]))
	);
}
