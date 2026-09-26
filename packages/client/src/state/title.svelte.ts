import type { SavedGame } from '@mathgame/engine';
import type { SaveNotice } from '../save/notices';

/**
 * What the title shows and which screen the keys drive ([[UI_SPEC]] §
 * Title). Written only by `TitleController`, except `draft`, which the name
 * box binds as the player types.
 *
 * `screen`: `menu` is Continue, New game and the settings; `confirm` asks
 * before a new game puts a saved one away; `starter` is the starters side by
 * side; `naming` is the name box for the one picked.
 */
export type TitleScreen = 'menu' | 'confirm' | 'starter' | 'naming';

/**
 * The menu's rows, in order. `continue` shows only when there is a game to
 * pick up. A new row (Sound) is a new id here, its label in
 * `TitleScreen.svelte` and its case in `TitleController.chooseRow`.
 */
export const TITLE_ROWS = ['continue', 'new', 'language'] as const;
export type TitleRow = (typeof TITLE_ROWS)[number];

/** The confirm's choices, in order: the safe one first, where the cursor starts. */
export const CONFIRM_CHOICES = ['back', 'yes'] as const;
export type ConfirmChoice = (typeof CONFIRM_CHOICES)[number];

class TitleView {
	/** True while the title is up: at load, and after Quit to title, until a game starts. */
	open = $state(false);
	screen = $state<TitleScreen>('menu');
	/** The lit row of `rows`. */
	cursor = $state(0);
	/** The game Continue picks up: its lead and its size are shown on the row. Null: no Continue. */
	saved = $state.raw<SavedGame | null>(null);
	/** Something start-up found about the save that the title says (a newer build's save, no storage). */
	notice = $state<SaveNotice | null>(null);
	/** The lit choice of the confirm, an index into `CONFIRM_CHOICES`. */
	confirm = $state(0);
	/** The lit starter, an index into the engine's `STARTERS`. */
	starter = $state(0);
	/** The name typed so far. */
	draft = $state('');
	/** Where each starter's feet are on screen, as fractions of the canvas, for the name tags. */
	spots = $state.raw<readonly { x: number; y: number }[]>([]);

	/** The rows the menu shows now. */
	get rows(): TitleRow[] {
		return TITLE_ROWS.filter((row) => row !== 'continue' || this.saved !== null);
	}
}

export const title = new TitleView();
