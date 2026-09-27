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
 * - `loggedOut`: logged out; the title, with the guest game if there is one.
 */
export const ACCOUNT_NOTES = ['saved', 'welcome', 'movedAhead', 'loggedOut'] as const;
export type AccountNote = (typeof ACCOUNT_NOTES)[number];

const NOTE_KEY = 'animath.accountNote';

/** Leave `note` for the next start of this tab (sessionStorage, which a reload keeps). */
export function noteNextStart(note: AccountNote): void {
	try {
		sessionStorage.setItem(NOTE_KEY, note);
	} catch {
		// Without sessionStorage the next start says nothing and shows the title.
	}
}

/** Start the page again, saying `note`. */
export function restartWith(note: AccountNote): void {
	noteNextStart(note);
	location.reload();
}

/** The note this start was left, if any. Read once. */
export function takeAccountNote(): AccountNote | null {
	try {
		const note = sessionStorage.getItem(NOTE_KEY);
		sessionStorage.removeItem(NOTE_KEY);
		return (ACCOUNT_NOTES as readonly string[]).includes(note ?? '') ? (note as AccountNote) : null;
	} catch {
		return null;
	}
}
