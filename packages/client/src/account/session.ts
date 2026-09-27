import { nameKey, readSave, saveLineage, saveSeq } from '@mathgame/engine';
import {
	ACCOUNT_KEYS,
	KEYS,
	MAX_PUT_AWAY,
	accountKeys,
	parseJson,
	setAside,
	type KeyValueStore,
	type SaveKeys
} from '../save/storage';

/**
 * Which game this browser plays: the guest game, or the game of the account
 * it is logged in to ([[DECISIONS]] § Accounts). The two live under keys of
 * their own (`KEYS`, `accountKeys`), so logging in never swaps one game for
 * another behind a kid's back, and every move between them here keeps what
 * it moves: registering takes the guest game into the account, logging in
 * leaves the guest game where it is, and logging out leaves the account's
 * game where it is, for the next login.
 */

/** The account this browser is logged in to: its name as the server keeps it. */
export interface CurrentAccount {
	name: string;
}

/** The account this browser is logged in to, or null for a guest. */
export function currentAccount(store: KeyValueStore | null): CurrentAccount | null {
	const text = store?.get(ACCOUNT_KEYS.current) ?? null;
	const parsed = text === null ? undefined : parseJson(text);
	const name =
		typeof parsed === 'object' && parsed !== null
			? (parsed as Record<string, unknown>).name
			: undefined;
	return typeof name === 'string' && name !== '' ? { name } : null;
}

/** The keys this browser's game lives under: the account's, else the guest game's. */
export function gameKeys(account: CurrentAccount | null): SaveKeys {
	return account ? accountKeys(nameKey(account.name)) : KEYS;
}

/** Log this browser in to `name` (its game is the account's from the next start). */
export function logInHere(store: KeyValueStore, name: string): boolean {
	return store.set(ACCOUNT_KEYS.current, JSON.stringify({ name }));
}

/** Log this browser out: its game is the guest game again from the next start. */
export function logOutHere(store: KeyValueStore): void {
	store.remove(ACCOUNT_KEYS.current);
}

/**
 * The guest game's newest save, with the account's name on it: what a new
 * account takes along. Null when there is none this build can read.
 */
export function guestGameFor(store: KeyValueStore, name: string): Record<string, unknown> | null {
	const text = store.get(KEYS.save);
	if (text === null) return null;
	const doc = parseJson(text);
	if (!readSave(doc).ok || typeof doc !== 'object' || doc === null) return null;
	return { ...(doc as Record<string, unknown>), name };
}

/**
 * The account `name` was just made with the guest game: that game is the
 * account's now. This browser is logged in first; then the guest game's
 * newest save (another tab may have played on since it went to the server)
 * moves to the account's keys with the account's name, and the guest's key
 * is emptied, its text kept among the games put away (`KEYS.previous`), so
 * logging out later leads to the title rather than to an old copy of this
 * game; the guest game's anonymous backup identity is kept aside with it.
 * Anything the account's keys held here before is kept aside first.
 *
 * False when this browser could not even be logged in (its storage refuses
 * writes): nothing moved, and the guest game plays on. When only the move
 * fails, the account's game is the copy the server took at registration,
 * which the next start picks up, and the guest game stays where it was.
 */
export function moveGuestGameIn(store: KeyValueStore, name: string): boolean {
	if (!logInHere(store, name)) return false;
	const keys = gameKeys({ name });
	const guest = store.get(KEYS.save);
	const game = guestGameFor(store, name);
	if (guest === null || game === null) return true;
	const there = store.get(keys.save);
	if (there !== null && !setAside(store, keys.replaced, there)) return true;
	if (!store.set(keys.save, JSON.stringify(game))) return true;
	setAside(store, KEYS.previous, guest, MAX_PUT_AWAY);
	store.remove(KEYS.save);
	// The guest game's anonymous backup (development only) is this game's too: its
	// identity is kept aside, so a guest start after logging out does not bring an
	// old copy of the account's game back from it.
	const identity = store.get(KEYS.player);
	if (identity !== null && setAside(store, KEYS.previousPlayer, identity))
		store.remove(KEYS.player);
	return true;
}

/**
 * Just logged in to `name`, which holds `theirs` on the server (null: no
 * save there yet): this browser's copy of the account's game becomes the
 * one that is further along, as the autosave settles it (the higher `seq`;
 * a tie between two games goes to the server's). The one that gives way is
 * kept aside (`replaced`, or `unreadable` when this build could not read
 * it). A copy this browser holds from a newer build is never written over,
 * and a server copy this build cannot read is left on the server.
 */
export function takeAccountGame(store: KeyValueStore, name: string, theirs: unknown): void {
	const keys = gameKeys({ name });
	if (theirs === null || !readSave(theirs).ok) return;
	const text = JSON.stringify(theirs);
	const mine = store.get(keys.save);
	if (mine === null) {
		store.set(keys.save, text);
		return;
	}
	if (mine === text) return;
	const doc = parseJson(mine);
	const read = readSave(doc);
	if (!read.ok && read.reason === 'newer') return;
	const ours = read.ok ? saveSeq(doc) : 0;
	const serverSeq = saveSeq(theirs);
	const serverAhead =
		serverSeq > ours ||
		(serverSeq === ours && serverSeq > 0 && saveLineage(theirs) !== saveLineage(doc));
	if (!read.ok || serverAhead) {
		if (setAside(store, read.ok ? keys.replaced : keys.unreadable, mine))
			store.set(keys.save, text);
	}
}

/** A logout the server did not hear (it was out of reach), to send again at the next start. */
export function rememberLogout(store: KeyValueStore): void {
	store.set(ACCOUNT_KEYS.logoutPending, '1');
}

/** Whether a logout waits to be sent; the note stays until `forgetLogout`. */
export function logoutPending(store: KeyValueStore | null): boolean {
	return store?.get(ACCOUNT_KEYS.logoutPending) === '1';
}

export function forgetLogout(store: KeyValueStore): void {
	store.remove(ACCOUNT_KEYS.logoutPending);
}
