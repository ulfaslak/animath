/**
 * A page is *behind* when another page of the game has saved progress it
 * does not have (`Autosave.wantsReload`). Such a page never takes the kid's
 * play: its input is off and nothing it did could be saved. It catches up by
 * reloading into the newest game — at once when it is the page in use,
 * otherwise when the kid comes to it — and never behind the kid's back
 * ([[DECISIONS]] § Saves).
 */

/** What a page does this frame. */
export type BehindAction =
	/** Not behind: play as usual. */
	| 'play'
	/** Behind and hidden: wait, and catch up when shown. */
	| 'wait'
	/** Behind and in use (visible, focused): catch up now. */
	| 'reload'
	/** Behind and on screen but not in use, or it has reloaded too often: say so, and wait for Enter. */
	| 'card';

export interface PageState {
	behind: boolean;
	/** `document.visibilityState === 'visible'` */
	visible: boolean;
	/** `document.hasFocus()`: the window the kid is using. */
	focused: boolean;
	/** False once this page has reloaded itself as often as it may (`mayReload`). */
	mayReload: boolean;
}

export function behindAction(page: PageState): BehindAction {
	if (!page.behind) return 'play';
	if (!page.visible) return 'wait';
	return page.focused && page.mayReload ? 'reload' : 'card';
}

/**
 * A key pressed while the page is behind: Enter or Space catch up (the kid
 * asked, so no limit applies); any other key does nothing, and never
 * reaches the game.
 */
export function behindKey(key: string): 'reload' | 'ignore' {
	return key === 'Enter' || key === ' ' ? 'reload' : 'ignore';
}

/** How many times a minute a page may reload itself without being asked. */
export const RELOADS_PER_MINUTE = 3;

/**
 * Whether a page that has reloaded itself at `times` (ms) may do so again at
 * `now`, and the times to remember if it does: the ones from the last minute,
 * plus `now`. The limit is what stops any bug from trapping a kid in a loop
 * of reloads; a reload the kid asked for (Enter) does not count against it.
 */
export function reloadAllowed(
	times: readonly number[],
	now: number
): { allowed: boolean; times: number[] } {
	const recent = times.filter((t) => now - t < 60_000 && t <= now);
	if (recent.length >= RELOADS_PER_MINUTE) return { allowed: false, times: recent };
	return { allowed: true, times: [...recent, now] };
}

const RELOADS_KEY = 'animath.reloads';
const CAUGHT_UP_KEY = 'animath.caughtUp';

/**
 * The browser side of `reloadAllowed`: the times live in this tab's
 * sessionStorage, which a reload keeps. With no sessionStorage, a page may
 * always reload.
 */
export function mayReloadNow(now = Date.now()): boolean {
	try {
		const parsed: unknown = JSON.parse(sessionStorage.getItem(RELOADS_KEY) ?? '[]');
		const times = Array.isArray(parsed)
			? parsed.filter((t): t is number => typeof t === 'number')
			: [];
		const verdict = reloadAllowed(times, now);
		if (verdict.allowed) sessionStorage.setItem(RELOADS_KEY, JSON.stringify(verdict.times));
		return verdict.allowed;
	} catch {
		return true;
	}
}

/** Reload into the newest game, and say so after the reload ("Here's your newest game!"). */
export function reloadIntoNewestGame(): void {
	try {
		sessionStorage.setItem(CAUGHT_UP_KEY, '1');
	} catch {
		// Without the note the reloaded page says "Welcome back!" instead.
	}
	location.reload();
}

/** Whether this page load is one `reloadIntoNewestGame` asked for. Reads the note once. */
export function takeCaughtUp(): boolean {
	try {
		const caughtUp = sessionStorage.getItem(CAUGHT_UP_KEY) === '1';
		sessionStorage.removeItem(CAUGHT_UP_KEY);
		return caughtUp;
	} catch {
		return false;
	}
}
