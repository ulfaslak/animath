/**
 * What start-up found about the save, for the message line, and what the
 * title says about it: copy keys, so the words follow the language on
 * screen ([[DECISIONS]] § Copy and languages). The autosave's start plan
 * names one, and the HUD says it; `Autosave.titleNotice` names the title's.
 */
export const SAVE_NOTICES = [
	/** A saved game was picked up, from this browser or from the server. */
	'save.welcomeBack',
	/** The saved game could not be read; it is kept aside, and this is a new game. */
	'save.couldNotLoad',
	/** The saved game was written by a newer build than this page. */
	'save.newerGame',
	/** This browser will not let the page store anything. */
	'save.cannotSave',
	/** Writing the save failed (storage full): the title says so. */
	'save.storageFull',
	/** This page had fallen behind another window of the game, and reloaded into the newest game. */
	'save.caughtUp',
	/** The player logged out: the title, with the guest game if there is one; the account's game waits. */
	'save.loggedOut',
	/**
	 * The server says this page's account is logged out (a new password, a
	 * year unused): the game saves only in this browser until the player logs
	 * in again.
	 */
	'save.sessionEnded'
] as const;

export type SaveNotice = (typeof SAVE_NOTICES)[number];
