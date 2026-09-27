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
	/** This browser will not let the page store anything. */
	'save.cannotSave',
	/** Writing the save failed (storage full): the title says so. */
	'save.storageFull',
	/** This page had fallen behind another window of the game, and reloaded into the newest game. */
	'save.caughtUp'
] as const;

export type SaveNotice = (typeof SAVE_NOTICES)[number];
