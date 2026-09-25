/**
 * Every line the save system shows a player, in one place, so the move to
 * per-language text files touches one file. Kids read these ([[DESIGN]] §
 * Voice): short, warm, nothing scary.
 */
export const SAVE_TEXT = {
	/** A saved game was picked up, from this browser or from the server. */
	welcomeBack: 'Welcome back!',
	/** The saved game could not be read; it is kept aside, and this is a new game. */
	couldNotLoad: "Your saved game didn't load, so here is a new one.",
	/** The saved game was written by a newer build than the one in this tab. */
	newerGame: 'Your game was saved by a newer Animath. Reload the page to play it!',
	/** This browser will not let the page store anything. */
	cannotSave: "This browser can't keep your game, so it starts new every time."
} as const;
