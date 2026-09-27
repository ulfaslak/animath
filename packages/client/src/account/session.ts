import { nameKey, readSave, saveSeq } from '@mathgame/engine';
import {
	ACCOUNT_KEYS,
	KEYS,
	MAX_PUT_AWAY,
	accountKeys,
	parseJson,
	sameJson,
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

/**
 * Log this browser out of `name`: its game is the guest game again from the
 * next start. A pointer that names another account now (another tab logged
 * in to it meanwhile) is that account's, and stays.
 */
export function logOutHere(store: KeyValueStore, name: string): void {
	const now = currentAccount(store);
	if (now === null || nameKey(now.name) === nameKey(name)) store.remove(ACCOUNT_KEYS.current);
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
 * game. Anything the account's keys held here before is kept aside first.
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
	return true;
}

/**
 * Just logged in to `name`, which holds `theirs` on the server (null: no
 * save there yet): this browser's copy of the account's game becomes the
 * one that is further along, as the autosave settles it (the higher `seq`;
 * a tie goes to the server's when the two saves differ: another game, or
 * this one played on another device). The one that gives way is
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
	// A tie goes to the server's: another game, or this one played on another device.
	const serverAhead =
		serverSeq > ours || (serverSeq === ours && serverSeq > 0 && !sameJson(theirs, doc));
	if (!read.ok || serverAhead) {
		if (setAside(store, read.ok ? keys.replaced : keys.unreadable, mine))
			store.set(keys.save, text);
	}
}

/**
 * How long a logout note a login or a registration holds keeps a starting
 * page from sending it: longer than either can take. A held note older than
 * that belongs to a page that went away mid-request, and is sent again.
 */
export const LOGOUT_HOLD_MS = 2 * 60_000;

interface LogoutNote {
	name: string;
	/** When a login or a registration took it (ms), while it waits for the server. */
	held?: number;
}

function logoutNote(store: KeyValueStore): LogoutNote | null {
	const text = store.get(ACCOUNT_KEYS.logoutPending);
	const note = text === null ? undefined : parseJson(text);
	if (typeof note !== 'object' || note === null) return null;
	const { name, held } = note as Record<string, unknown>;
	if (typeof name !== 'string' || name === '') return null;
	return typeof held === 'number' ? { name, held } : { name };
}

/**
 * A logout from `name`'s account the server did not hear (it was out of
 * reach), to send again at the next start. A note this build cannot read is
 * no note.
 */
export function rememberLogout(store: KeyValueStore, name: string): void {
	store.set(ACCOUNT_KEYS.logoutPending, JSON.stringify({ name }));
}

/**
 * The account whose logout waits to be sent, if one does, and no login or
 * registration holds it; the note stays until `forgetLogout`.
 */
export function logoutPending(store: KeyValueStore | null, now = Date.now()): string | null {
	const note = store ? logoutNote(store) : null;
	if (note === null) return null;
	const held = note.held !== undefined && note.held <= now && now - note.held < LOGOUT_HOLD_MS;
	return held ? null : note.name;
}

/**
 * A login or a registration is on its way, and either ends the session this
 * browser had: the logout waiting is held, so a page starting meanwhile does
 * not send it and end the session being made. Its name, or null for none.
 */
export function holdLogout(store: KeyValueStore, now = Date.now()): string | null {
	const note = logoutNote(store);
	if (note === null) return null;
	store.set(ACCOUNT_KEYS.logoutPending, JSON.stringify({ name: note.name, held: now }));
	return note.name;
}

/** The login or the registration failed: the held logout waits to be sent again. */
export function releaseLogout(store: KeyValueStore, name: string | null): void {
	const note = logoutNote(store);
	if (name !== null && note?.name === name && note.held !== undefined) rememberLogout(store, name);
}

export function forgetLogout(store: KeyValueStore): void {
	store.remove(ACCOUNT_KEYS.logoutPending);
}
