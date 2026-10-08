import {
	leadIndex,
	editedTileAt,
	isEditsText,
	WorldEdits,
	tileRealm,
	landSeed,
	type AnimalInstance,
	type NameRejection,
	type SavedGame
} from '@mathgame/engine';
import { flags } from '../flags';
import type { SaveNotice } from '../save/notices';
import { account } from './account.svelte';

/**
 * What the title shows and which screen the keys drive ([[UI_SPEC]] §
 * Title). Written only by `TitleController`, except `draft` and `nameDraft`,
 * which the name boxes bind as the player types, and `room`, which the
 * starter screen measures.
 *
 * `screen`: `menu` is Continue, New game and the settings; `confirm` asks
 * before a new game puts a saved one away; `player` is the name box for the
 * player's own name (a new game's first question, and Continue's for a game
 * saved before names); `starter` is the starters side by side; `naming` is
 * the name box for the one picked.
 */
export type TitleScreen = 'menu' | 'confirm' | 'player' | 'starter' | 'naming';

/** Where the player's name box leads: to the starters of a new game, or into the saved game. */
export type NameFor = 'new' | 'continue';

/**
 * The menu's rows, in order. `continue` shows only when there is a game to
 * pick up. `login` ("I have an account → Log in") shows to a guest, and to a
 * player whose session has ended, while the server says it can keep an
 * account (`account.ready`), but never on a throwaway page (`?new` and
 * the like), which keeps nothing: a login there would switch every other tab
 * to the account and reload this one into a throwaway game again. `language`
 * and `sound` are the settings
 * the pause menu has too, on the same stores. A new row is a new id here, its
 * label in `TitleScreen.svelte` and its cases in `TitleController`.
 */
export const TITLE_ROWS = ['continue', 'new', 'login', 'language', 'sound'] as const;
export type TitleRow = (typeof TITLE_ROWS)[number];

/**
 * The rows just after a logout: logging in to the account again comes first,
 * under the words that say its game is safe there.
 */
const LOGGED_OUT_ROWS: readonly TitleRow[] = ['login', 'continue', 'new', 'language', 'sound'];

/** Just logged out: `name` is the account left, when the page knows it. */
export interface LoggedOut {
	name: string | null;
}

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
	/**
	 * The title just after a logout: it says the account's game is safe, and
	 * its first row logs in to that account again. Null on every other title.
	 */
	loggedOut = $state.raw<LoggedOut | null>(null);
	/**
	 * The row the cursor goes to when it comes, until the kid moves the cursor:
	 * after a logout, the login row, which waits for the server's word.
	 */
	awaited = $state<TitleRow | null>(null);
	/** What the title says about the save: this page cannot keep the game (no storage, a write that failed). */
	notice = $state<SaveNotice | null>(null);
	/**
	 * Whether this page keeps its game, so New game puts the one Continue
	 * offers away. False on a page that saves nothing: its confirm says so.
	 */
	keeps = $state(true);
	/** The lit choice of the confirm, an index into `CONFIRM_CHOICES`. */
	confirm = $state(0);
	/** The lit starter, an index into the engine's `STARTERS`. */
	starter = $state(0);
	/** The starter's name typed so far. */
	draft = $state('');
	/** The player's own name typed so far. */
	nameDraft = $state('');
	/** Where the player's name box leads. */
	nameFor = $state<NameFor>('new');
	/** Why the last name the player gave did not go (`checkName`), until they type again. */
	nameRefused = $state<NameRejection | null>(null);
	/** The player's name for the new game, once the name box took it: sent with `new-game`. */
	playerName = $state<string | null>(null);
	/** Where each starter's feet are on screen, as fractions of the canvas, for the name tags. */
	spots = $state.raw<readonly { x: number; y: number }[]>([]);
	/**
	 * The band of the screen the starters keep to, in CSS pixels from its top,
	 * measured by the starter screen: the animals' tops below `top` (the
	 * heading, or the card when it is at the top), their feet above `bottom`
	 * (the card at the bottom, less the name tags under the feet). Null while
	 * no starter screen is up. The stage moves the row into it
	 * (`StarterScene.setRoom`).
	 */
	room = $state.raw<{ top: number; bottom: number } | null>(null);

	/** The rows the menu shows now. */
	get rows(): TitleRow[] {
		return this.order.filter((row) => {
			if (row === 'continue') return this.saved !== null;
			if (row === 'login') return this.offersLogin && account.ready;
			return true;
		});
	}

	/**
	 * The rows as they stand once the server has said whether it can keep an
	 * account: `rows`, and, until its first word, the login row it would add
	 * on a yes, whose place the menu keeps (`loginPending`) so that nothing
	 * moves when it comes.
	 */
	get slots(): TitleRow[] {
		const rows = this.rows;
		const pending = this.loginPending;
		return this.order.filter((row) => rows.includes(row) || (row === 'login' && pending));
	}

	/** The login row would show but for the server's word, which has not come yet. */
	get loginPending(): boolean {
		return this.offersLogin && !account.ready && !account.readyHeard;
	}

	/** Who the login row is for: a guest, or a player whose session has ended, on a page that keeps its game. */
	private get offersLogin(): boolean {
		return !flags.throwaway && (account.name === null || account.session === 'ended');
	}

	private get order(): readonly TitleRow[] {
		return this.loggedOut ? LOGGED_OUT_ROWS : TITLE_ROWS;
	}

	/**
	 * The one Continue names: the saved team's first animal that is standing
	 * and can fight where the game stands (out on the water, one that swims);
	 * out on the water with none that swims, the one in the boat, the first
	 * standing, as the game shows it.
	 */
	get lead(): AnimalInstance | null {
		const saved = this.saved;
		if (!saved) return null;
		const party = saved.party;
		const seed = landSeed(saved.land, saved.world);
		const edits = isEditsText(saved.edits) ? WorldEdits.decode(saved.edits) : WorldEdits.none;
		const realm = tileRealm(editedTileAt(seed, edits, saved.pos.x, saved.pos.y).kind);
		return party[leadIndex(party, realm)] ?? party[leadIndex(party)] ?? party[0] ?? null;
	}
}

export const title = new TitleView();
