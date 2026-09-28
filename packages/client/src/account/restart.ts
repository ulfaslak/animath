/**
 * Logging in, logging out and making an account change which game this
 * browser plays, so the page starts again in it: with a note, read once by
 * the next start, of what to say and whether to go straight into the game.
 */

/**
 * - `saved`: an account was made with the guest game; back into it.
 * - `welcome`: logged in; into the account's game.
 * - `movedAhead`: another device got further in the account's game, whose
 *   newer save this page took; into it.
 * - `loggedOut`: logged out; the title, with the guest game if there is one,
 *   saying the account's game is safe and offering to log in to it again.
 */
export const ACCOUNT_NOTES = ['saved', 'welcome', 'movedAhead', 'loggedOut'] as const;
export type AccountNote = (typeof ACCOUNT_NOTES)[number];

/** A note for the next start, and the account it is about when it names one. */
export interface StartNote {
	note: AccountNote;
	name: string | null;
}

const NOTE_KEY = 'animath.accountNote';
/** The account a note is about (the one just logged out of), kept beside it. */
const NAME_KEY = 'animath.accountNote.name';

/**
 * Leave `note` for the next start of this tab (sessionStorage, which a reload
 * keeps), and `name`, the account it is about, when there is one.
 */
export function noteNextStart(note: AccountNote, name?: string): void {
	try {
		sessionStorage.setItem(NOTE_KEY, note);
		if (name) sessionStorage.setItem(NAME_KEY, name);
		else sessionStorage.removeItem(NAME_KEY);
	} catch {
		// Without sessionStorage the next start says nothing and shows the title.
	}
}

/** Start the page again, saying `note` (about the account `name`, when given). */
export function restartWith(note: AccountNote, name?: string): void {
	noteNextStart(note, name);
	location.reload();
}

/** The note this start was left, if any, with the account it names. Read once. */
export function takeAccountNote(): StartNote | null {
	try {
		const note = sessionStorage.getItem(NOTE_KEY);
		const name = sessionStorage.getItem(NAME_KEY);
		sessionStorage.removeItem(NOTE_KEY);
		sessionStorage.removeItem(NAME_KEY);
		if (!(ACCOUNT_NOTES as readonly string[]).includes(note ?? '')) return null;
		return { note: note as AccountNote, name: name === '' ? null : name };
	} catch {
		return null;
	}
}
