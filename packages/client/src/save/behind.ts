/**
 * A page is *behind* when the browser's save has moved on past the game it
 * shows (`Autosave.behind`). Such a page never takes the kid's play: its
 * input is off and nothing it did could be saved. It catches up by reloading
 * into the newest game, and never behind the kid's back ([[DECISIONS]] §
 * Saves).
 */

/** Why a page is behind. */
export type BehindCause =
	/** Another window played on in this page's game: saved progress this page does not have. */
	| 'window'
	/** The save holds another game now: this page, or another, took a bigger one from the server. */
	| 'replaced'
	/** The save was removed from under the page (site data cleared). */
	| 'gone'
	/**
	 * The account's save on the server is one this build cannot read (a newer
	 * build wrote it, or it does not pass this build's checks): nothing is
	 * written over, here or there, and the page waits for the kid to load the
	 * newer build. It never reloads by itself: only a new build can read it.
	 */
	| 'newer';

/** What a page does this frame. */
export type BehindAction =
	/** Not behind: play as usual. */
	| 'play'
	/** Behind and hidden: wait, and catch up when shown. */
	| 'wait'
	/** Behind and it may catch up now: reload. */
	| 'reload'
	/** Behind, on screen, and it should not or may not reload by itself: say so, and wait for the kid. */
	| 'card';

export interface PageState {
	behind: BehindCause | null;
	/** `document.visibilityState === 'visible'` */
	visible: boolean;
	/** `document.hasFocus()`: the window the kid is using. */
	focused: boolean;
	/** Whether a reload now stays within `RELOADS_PER_MINUTE` (`mayReloadNow`). */
	mayReload: boolean;
}

/**
 * Behind another window, a page reloads only when it is the window in use:
 * one on screen while the kid plays in the other waits for them, with the
 * card. Another game in its place, or none, is not the kid playing
 * elsewhere, and happens once: the page catches up as soon as it is on screen.
 */
export function behindAction(page: PageState): BehindAction {
	if (page.behind === null) return 'play';
	if (!page.visible) return 'wait';
	// A reload helps only once a newer build is there to load: the kid asks for it.
	if (page.behind === 'newer') return 'card';
	const inUse = page.behind === 'window' ? page.focused : true;
	return inUse && page.mayReload ? 'reload' : 'card';
}

/**
 * A key pressed while the page is behind: Enter catches up, and so does
 * Space, unless a text box has the focus (a Space there is a letter being
 * typed). Any other key does nothing, and never reaches the game.
 */
export function behindKey(key: string, typing: boolean): 'reload' | 'ignore' {
	if (key === 'Enter') return 'reload';
	return key === ' ' && !typing ? 'reload' : 'ignore';
}

/** How many times a minute a page may reload itself without being asked. */
export const RELOADS_PER_MINUTE = 3;

/**
 * The reloads, at `times` (ms), that still count at `now`: the last
 * minute's, none from the future. A page may reload itself while there are
 * fewer than `RELOADS_PER_MINUTE` of them. The limit stops any bug from
 * trapping a kid in a loop of reloads; a reload the kid asked for (Enter, the
 * card's button) does not count against it.
 */
export function recentReloads(times: readonly number[], now: number): number[] {
	return times.filter((t) => t <= now && now - t < 60_000);
}

const RELOADS_KEY = 'animath.reloads';
const CAUGHT_UP_KEY = 'animath.caughtUp';

/**
 * This tab's own reloads, kept in sessionStorage, which a reload keeps. None
 * when there is no sessionStorage or the record is unreadable (the next
 * reload writes a good one).
 */
function storedReloads(): number[] {
	try {
		const parsed: unknown = JSON.parse(sessionStorage.getItem(RELOADS_KEY) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((t): t is number => typeof t === 'number') : [];
	} catch {
		return [];
	}
}

/** Without sessionStorage there is no limit to keep, and the page says "Welcome back!". */
function remember(key: string, value: string): void {
	try {
		sessionStorage.setItem(key, value);
	} catch {
		// Nothing to do.
	}
}

/** Whether this page may reload itself now. */
export function mayReloadNow(now = Date.now()): boolean {
	return recentReloads(storedReloads(), now).length < RELOADS_PER_MINUTE;
}

/**
 * Reload into the newest game. `onItsOwn` counts it against the limit;
 * `caughtUp` makes the reloaded page say "You were playing in another window.
 * Here's your newest game!" instead of "Welcome back!".
 */
export function reloadIntoNewestGame(options: { onItsOwn: boolean; caughtUp: boolean }): void {
	if (options.onItsOwn) {
		const now = Date.now();
		remember(RELOADS_KEY, JSON.stringify([...recentReloads(storedReloads(), now), now]));
	}
	if (options.caughtUp) remember(CAUGHT_UP_KEY, '1');
	location.reload();
}

/** Whether this page load is one `reloadIntoNewestGame` asked to say so. Reads the note once. */
export function takeCaughtUp(): boolean {
	try {
		const caughtUp = sessionStorage.getItem(CAUGHT_UP_KEY) === '1';
		sessionStorage.removeItem(CAUGHT_UP_KEY);
		return caughtUp;
	} catch {
		return false;
	}
}
