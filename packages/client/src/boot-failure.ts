/**
 * What `boot.ts` does when the game's code does not load at the start.
 *
 * A file of the game that did not download (a dropped connection, a school
 * network) fails `import('./main')`: a script with "Failed to fetch
 * dynamically imported module" or its like, and a stylesheet the game needs
 * with Vite's "Unable to preload CSS" (its `vite:preloadError`, which nothing
 * prevents, so the game never starts without its styles). Nothing is loaded
 * lazily after that, so this is the one place a missing file shows.
 *
 * The page reloads itself once, then shows a card with a button to try again.
 * The tab remembers the reload (`sessionStorage`, which a reload keeps) until
 * the game has loaded, so a second failure in a row shows the card, and a page
 * never reloads itself twice in a row. `index.html`'s inline script does the
 * same, with the same key, when `boot.ts`'s own script did not download.
 */

/** The tab's mark that the page reloaded itself because the game did not load. */
export const RELOADED_KEY = 'animath.reloaded';

/** The tab's storage; reading it, or anything on it, may throw (blocked site data). */
export interface TabStore {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

/**
 * Whether the page may reload itself now, marking the tab when it may. Once
 * marked, it may not. A tab that keeps nothing never reloads by itself:
 * nothing would stop the reload after it.
 */
export function reloadOnce(tab: () => TabStore): boolean {
	try {
		const store = tab();
		if (store.getItem(RELOADED_KEY) !== null) return false;
		store.setItem(RELOADED_KEY, '1');
		return store.getItem(RELOADED_KEY) !== null;
	} catch {
		return false;
	}
}

/** The game loaded: the next time it does not, the page may reload once again. */
export function forgetReload(tab: () => TabStore): void {
	try {
		tab().removeItem(RELOADED_KEY);
	} catch {
		// The tab kept nothing to forget.
	}
}

/**
 * The newest syntax in the game's scripts, which Safari 15 was the first
 * Safari to read: a class's private method, and `#name in`. `index.html`'s
 * `readsTheGame` asks the browser about the same line.
 */
export const NEWEST_SYNTAX = 'class A { #a = 1; #b() { return #a in this; } }';

/** Whether this browser reads `NEWEST_SYNTAX`. */
export function readsTheGame(): boolean {
	try {
		new Function(NEWEST_SYNTAX);
		return true;
	} catch {
		return false;
	}
}

/**
 * Why the game did not start, from what its import was rejected with:
 * - `no-webgl`: the renderer was refused a context for its own settings
 *   (three.js says WebGL);
 * - `too-old`: the game's code is syntax this browser cannot read. A Safari
 *   before 15 can say so as it says a file did not download, so the browser
 *   is asked itself (`reads`);
 * - `not-loaded`: anything else, a file that did not download above all.
 */
export function failureOf(error: unknown, reads: boolean): 'no-webgl' | 'too-old' | 'not-loaded' {
	let said = '';
	try {
		said = String(error);
	} catch {
		// Something that cannot say what it is says nothing about WebGL.
	}
	if (said.includes('WebGL')) return 'no-webgl';
	if (error instanceof SyntaxError || !reads) return 'too-old';
	return 'not-loaded';
}
