/**
 * What start-up found about the save, for the message line: a copy key, so
 * the words follow the language on screen ([[DECISIONS]] § Copy and
 * languages). The HUD shows it until the authority's first message takes
 * the line. Written only by `main.ts`, from the autosave's start plan.
 */
export const SAVE_NOTICES = [
	/** A saved game was picked up, from this browser or from the server. */
	'save.welcomeBack',
	/** The saved game could not be read; it is kept aside, and this is a new game. */
	'save.couldNotLoad',
	/** The saved game was written by a newer build than this page. */
	'save.newerGame',
	/** This browser will not let the page store anything. */
	'save.cannotSave'
] as const;

export type SaveNotice = (typeof SAVE_NOTICES)[number];

class NoticeView {
	key = $state<SaveNotice | null>(null);
}

export const notice = new NoticeView();
