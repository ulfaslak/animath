import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { inlineScripts } from '../browsers';
import {
	NEWEST_SYNTAX,
	RELOADED_KEY,
	failureOf,
	forgetReload,
	readsTheGame,
	reloadOnce,
	type TabStore
} from '../src/boot-failure';
import { COPY, LANGUAGES } from '../src/copy/languages';

/**
 * A game whose code did not download at the start gets one more try by
 * itself, then a card to try again from; it never reloads itself twice in a
 * row. `boot.ts` does it for the game's code, `index.html`'s inline script for
 * `boot.ts`'s own, with the same mark in the tab.
 */

/** A tab's sessionStorage that keeps what it is given, and says which keys it was given. */
function tabStore(): TabStore & { kept: Map<string, string> } {
	const kept = new Map<string, string>();
	return {
		kept,
		getItem: (key) => kept.get(key) ?? null,
		setItem: (key, value) => void kept.set(key, value),
		removeItem: (key) => void kept.delete(key)
	};
}

describe('why the game did not start', () => {
	it('is a file that did not download, as each browser and Vite say it', () => {
		for (const error of [
			new TypeError(
				'Failed to fetch dynamically imported module: https://animath.xyz/immutable/main-B2m7u-RL.js'
			),
			new TypeError(
				'error loading dynamically imported module: https://animath.xyz/immutable/main-B2m7u-RL.js'
			),
			new TypeError('Importing a module script failed.'),
			new Error('Unable to preload CSS for /immutable/hint-BEwXXVNA.css')
		]) {
			expect(failureOf(error, true), error.message).toBe('not-loaded');
		}
	});

	it('is the browser when its renderer was refused, or it cannot read the game', () => {
		expect(failureOf(new Error('Error creating WebGL context.'), true)).toBe('no-webgl');
		expect(failureOf(new SyntaxError('Unexpected token'), true)).toBe('too-old');
		// A Safari before 15 says it as it says a file did not download: the browser is asked.
		expect(failureOf(new TypeError('Importing a module script failed.'), false)).toBe('too-old');
	});

	it('is a file that did not download when what was thrown cannot say what it is', () => {
		const mute = {
			toString() {
				throw new Error('no');
			}
		};
		expect(failureOf(mute, true)).toBe('not-loaded');
	});

	it("asks this browser about the game's newest syntax, the line index.html asks about", () => {
		expect(readsTheGame()).toBe(true);
		const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
		expect(page).toContain(`new Function('${NEWEST_SYNTAX}')`);
	});
});

describe('reloading once', () => {
	it('reloads once, then not again until the game has loaded', () => {
		const tab = tabStore();
		expect(reloadOnce(() => tab)).toBe(true);
		expect([...tab.kept.keys()]).toEqual([RELOADED_KEY]);
		expect(reloadOnce(() => tab)).toBe(false);
		expect(reloadOnce(() => tab)).toBe(false);
		forgetReload(() => tab);
		expect(tab.kept.size).toBe(0);
		expect(reloadOnce(() => tab)).toBe(true);
	});

	it('never reloads by itself in a tab that keeps nothing', () => {
		const blocked = () => {
			throw new DOMException('The operation is insecure.', 'SecurityError');
		};
		expect(reloadOnce(blocked)).toBe(false);
		expect(() => forgetReload(blocked)).not.toThrow();
		const full: TabStore = {
			getItem: () => null,
			setItem: () => {
				throw new DOMException('Quota exceeded', 'QuotaExceededError');
			},
			removeItem: () => {}
		};
		expect(reloadOnce(() => full)).toBe(false);
		// One that takes the mark and keeps nothing.
		const forgetful: TabStore = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
		expect(reloadOnce(() => forgetful)).toBe(false);
	});
});

describe("index.html, when boot.ts's own script did not run", () => {
	const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
	const [script] = inlineScripts(page);

	interface Run {
		reloads: number;
		/** The cards on screen. */
		readonly shown: string[];
		/** The page's scripts have run: DOMContentLoaded. */
		load(): void;
		/** A key goes down; how many listeners took it (`preventDefault`). */
		press(key: string, more?: { repeat?: boolean; ctrlKey?: boolean }): number;
		/** A click or a tap on the card's button. */
		tap(): void;
	}

	/** Runs the page's inline script against a page `started` or not, a tab, and a browser that reads the game or not. */
	function run(options: { started: boolean; tab: () => TabStore; reads?: boolean }): Run {
		const listeners: Record<string, ((event: unknown) => void)[]> = {};
		const card = () => ({ style: { display: 'none' }, querySelectorAll: () => [] });
		const cards: Record<string, { style: { display: string } }> = {
			'too-old': card(),
			'not-loaded': card()
		};
		const button: { onclick: null | (() => void) } = { onclick: null };
		const result: Run = {
			reloads: 0,
			get shown() {
				return Object.keys(cards).filter((id) => cards[id]!.style.display !== 'none');
			},
			load: () => listeners.DOMContentLoaded?.forEach((listen) => listen({})),
			press(key, more = {}) {
				let prevented = 0;
				const event = { key, ...more, preventDefault: () => void prevented++ };
				listeners.keydown?.forEach((listen) => listen(event));
				return prevented;
			},
			tap: () => button.onclick?.()
		};
		const document = {
			documentElement: {
				hasAttribute: (name: string) => name === 'data-started' && options.started
			},
			addEventListener: (type: string, listen: (event: unknown) => void) =>
				(listeners[type] ??= []).push(listen),
			getElementById: (id: string) => (id === 'not-loaded-retry' ? button : (cards[id] ?? null)),
			querySelector: () => null
		};
		const window = {
			get sessionStorage() {
				return options.tab();
			}
		};
		const context = {
			document,
			window,
			navigator: { userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 0 },
			location: { reload: () => void result.reloads++ },
			...(options.reads === false
				? {
						Function: function () {
							throw new SyntaxError('Unexpected private name');
						}
					}
				: {})
		};
		runInNewContext(script!, context);
		return result;
	}

	it('does nothing on a page boot.ts started', () => {
		const tab = tabStore();
		const page = run({ started: true, tab: () => tab });
		page.load();
		expect([page.reloads, page.shown, tab.kept.size]).toEqual([0, [], 0]);
	});

	it('loads the page again once, with the mark boot.ts reads, then shows the card', () => {
		const tab = tabStore();
		const first = run({ started: false, tab: () => tab });
		first.load();
		expect([first.reloads, first.shown]).toEqual([1, []]);
		expect([...tab.kept.keys()]).toEqual([RELOADED_KEY]);
		// boot.ts reads the same mark: it would not reload again either.
		expect(reloadOnce(() => tab)).toBe(false);

		const second = run({ started: false, tab: () => tab });
		second.load();
		expect([second.reloads, second.shown]).toEqual([0, ['not-loaded']]);
	});

	it("tries again on the card's button, Enter or Space, and no other key", () => {
		const tab = tabStore();
		tab.setItem(RELOADED_KEY, '1');
		const page = run({ started: false, tab: () => tab });
		page.load();
		expect(page.press('Escape')).toBe(0);
		expect(page.press('Enter', { repeat: true })).toBe(0);
		expect(page.press('Enter', { ctrlKey: true })).toBe(0);
		expect(page.reloads).toBe(0);
		page.tap();
		expect(page.press('Enter')).toBe(1);
		expect(page.press(' ')).toBe(1);
		expect(page.reloads).toBe(3);
	});

	it('shows the card at once, and never reloads by itself, in a tab that keeps nothing', () => {
		const page = run({
			started: false,
			tab: () => {
				throw new DOMException('The operation is insecure.', 'SecurityError');
			}
		});
		page.load();
		expect([page.reloads, page.shown]).toEqual([0, ['not-loaded']]);
	});

	it('shows the too-old card, not this one, to a browser that cannot read the game', () => {
		const tab = tabStore();
		const page = run({ started: false, tab: () => tab, reads: false });
		page.load();
		expect([page.reloads, page.shown, tab.kept.size]).toEqual([0, ['too-old'], 0]);
	});

	it("says app.notLoaded's title and button in every language the game speaks", () => {
		const card = /<div\s+id="not-loaded"[\s\S]*?<\/button>/.exec(page)?.[0] ?? '';
		const said = card.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
		for (const lang of LANGUAGES) {
			const copy = COPY[lang] as unknown as { app: { notLoaded: Record<string, string> } };
			const notLoaded = copy.app.notLoaded;
			expect(said, lang).toContain(notLoaded.title);
			expect(said, lang).toContain(notLoaded.retry);
		}
	});
});
