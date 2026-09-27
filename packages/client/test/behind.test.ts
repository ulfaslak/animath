import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	RELOADS_PER_MINUTE,
	behindAction,
	behindKey,
	mayReloadNow,
	recentReloads,
	reloadIntoNewestGame,
	takeCaughtUp,
	type BehindCause,
	type PageState
} from '../src/save/behind';

/**
 * A page that is behind the browser's save (issue #26): it never takes play.
 * Behind another window, it catches up at once when it is the window in use,
 * and otherwise shows the card and waits for the kid. Behind for any other
 * reason, it catches up as soon as it is on screen. Hidden, it waits. Past
 * the reload limit, it shows the card.
 */

const CAUSES: BehindCause[] = ['window', 'replaced', 'gone', 'newer'];
const page = (over: Partial<PageState>): PageState => ({
	behind: 'window',
	visible: true,
	focused: true,
	mayReload: true,
	...over
});
const everyPage = function* (behind: BehindCause | null) {
	for (const visible of [true, false]) {
		for (const focused of [true, false]) {
			for (const mayReload of [true, false]) yield { behind, visible, focused, mayReload };
		}
	}
};

describe('behindAction', () => {
	it('while a login, a registration or a logout is on its way, it waits for the answer, behind or not', () => {
		for (const cause of CAUSES) {
			for (const state of everyPage(cause)) {
				expect(behindAction({ ...state, holding: true }), cause).toBe('wait');
			}
		}
		for (const state of everyPage(null))
			expect(behindAction({ ...state, holding: true })).toBe('play');
	});

	it('a page that is not behind plays, whatever else is true', () => {
		for (const state of everyPage(null)) expect(behindAction(state)).toBe('play');
	});

	it('never plays while behind, and reloads by itself only when on screen and within the limit', () => {
		for (const cause of CAUSES) {
			for (const state of everyPage(cause)) {
				const action = behindAction(state);
				expect(action).not.toBe('play');
				if (action === 'reload') expect(state.visible && state.mayReload).toBe(true);
			}
		}
	});

	it('behind and hidden: waits to be shown', () => {
		for (const cause of CAUSES) {
			expect(behindAction(page({ behind: cause, visible: false }))).toBe('wait');
			expect(behindAction(page({ behind: cause, visible: false, focused: false }))).toBe('wait');
		}
	});

	it('behind another window, in use: catches up now', () => {
		expect(behindAction(page({}))).toBe('reload');
	});

	it('behind another window, on screen while the kid uses another: the card, never a reload', () => {
		expect(behindAction(page({ focused: false }))).toBe('card');
	});

	it('behind for another reason: catches up as soon as it is on screen, in use or not', () => {
		// A newer version's save among them: the reload fetches the new version.
		for (const cause of ['replaced', 'gone', 'newer'] as const) {
			expect(behindAction(page({ behind: cause }))).toBe('reload');
			expect(behindAction(page({ behind: cause, focused: false }))).toBe('reload');
		}
	});

	it('on screen, when it has reloaded by itself as often as it may: the card', () => {
		for (const cause of CAUSES) {
			expect(behindAction(page({ behind: cause, mayReload: false }))).toBe('card');
		}
	});
});

describe('behindKey', () => {
	it('Enter and Space catch up; every other key does nothing', () => {
		expect(behindKey('Enter', false)).toBe('reload');
		expect(behindKey(' ', false)).toBe('reload');
		for (const key of ['ArrowLeft', 'a', 'w', 'Escape', '1', 'Backspace', 'Tab', 'Shift']) {
			expect(behindKey(key, false)).toBe('ignore');
		}
	});

	it('in a text box, Space is a letter, and only Enter catches up', () => {
		expect(behindKey(' ', true)).toBe('ignore');
		expect(behindKey('Enter', true)).toBe('reload');
	});
});

describe('recentReloads', () => {
	const now = 1_000_000;

	it('keeps the last minute of reloads, and none from the future', () => {
		expect(recentReloads([now - 61_000, now - 60_000, now - 59_999, now, now + 1], now)).toEqual([
			now - 59_999,
			now
		]);
	});
});

describe('the reload limit, in sessionStorage', () => {
	let session: Map<string, string>;
	const reload = vi.fn();

	beforeEach(() => {
		session = new Map();
		reload.mockClear();
		vi.stubGlobal('sessionStorage', {
			getItem: (key: string) => session.get(key) ?? null,
			setItem: (key: string, value: string) => void session.set(key, value),
			removeItem: (key: string) => void session.delete(key)
		});
		vi.stubGlobal('location', { reload });
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it(`a page may reload itself ${RELOADS_PER_MINUTE} times a minute, then not until the first is a minute old`, () => {
		vi.useFakeTimers({ now: 1_000_000 });
		for (let i = 0; i < RELOADS_PER_MINUTE; i++) {
			expect(mayReloadNow()).toBe(true);
			reloadIntoNewestGame({ onItsOwn: true, caughtUp: false });
			vi.advanceTimersByTime(1_000);
		}
		expect(reload).toHaveBeenCalledTimes(RELOADS_PER_MINUTE);
		expect(mayReloadNow()).toBe(false);
		expect(mayReloadNow()).toBe(false);
		vi.advanceTimersByTime(60_000 - RELOADS_PER_MINUTE * 1_000);
		expect(mayReloadNow()).toBe(true);
	});

	it('a reload the kid asked for does not count, and works past the limit', () => {
		vi.useFakeTimers({ now: 1_000_000 });
		for (let i = 0; i < 10; i++) reloadIntoNewestGame({ onItsOwn: false, caughtUp: false });
		expect(reload).toHaveBeenCalledTimes(10);
		expect(mayReloadNow()).toBe(true);
	});

	it('asking leaves no note; a reload to catch up with another window leaves one, read once', () => {
		reloadIntoNewestGame({ onItsOwn: true, caughtUp: false });
		expect(takeCaughtUp()).toBe(false);
		reloadIntoNewestGame({ onItsOwn: false, caughtUp: true });
		expect(takeCaughtUp()).toBe(true);
		expect(takeCaughtUp()).toBe(false);
	});

	it('without sessionStorage, the page may reload, reloads, and says nothing special', () => {
		const broken = () => {
			throw new Error('blocked');
		};
		vi.stubGlobal('sessionStorage', { getItem: broken, setItem: broken, removeItem: broken });
		expect(mayReloadNow()).toBe(true);
		reloadIntoNewestGame({ onItsOwn: true, caughtUp: true });
		expect(reload).toHaveBeenCalledTimes(1);
		expect(takeCaughtUp()).toBe(false);
	});

	it('an unreadable record of reloads does not stop a reload, and the next reloads replace it', () => {
		session.set('animath.reloads', '"text"');
		expect(mayReloadNow()).toBe(true);
		session.set('animath.reloads', '{oops');
		expect(mayReloadNow()).toBe(true);
		for (let i = 0; i < RELOADS_PER_MINUTE; i++) {
			reloadIntoNewestGame({ onItsOwn: true, caughtUp: i === 0 });
		}
		expect(mayReloadNow()).toBe(false);
		expect(takeCaughtUp()).toBe(true);
	});
});
