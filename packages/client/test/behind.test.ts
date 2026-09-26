import { describe, expect, it } from 'vitest';
import {
	RELOADS_PER_MINUTE,
	behindAction,
	behindKey,
	reloadAllowed,
	type PageState
} from '../src/save/behind';

/**
 * A page that another window has played past (issue #26): it never takes
 * play, catches up at once when it is the page in use, shows the card when it
 * is on screen but not in use or has reloaded too often, and waits when hidden.
 */

const page = (over: Partial<PageState>): PageState => ({
	behind: true,
	visible: true,
	focused: true,
	mayReload: true,
	...over
});

describe('behindAction', () => {
	it('a page that is not behind plays, whatever else is true', () => {
		for (const visible of [true, false]) {
			for (const focused of [true, false]) {
				for (const mayReload of [true, false]) {
					expect(behindAction({ behind: false, visible, focused, mayReload })).toBe('play');
				}
			}
		}
	});

	it('behind and hidden: waits to be shown, even when it may reload', () => {
		expect(behindAction(page({ visible: false }))).toBe('wait');
		expect(behindAction(page({ visible: false, focused: false }))).toBe('wait');
	});

	it('behind and in use: catches up now', () => {
		expect(behindAction(page({}))).toBe('reload');
	});

	it('behind, on screen but another window in use: shows the card, never reloads by itself', () => {
		expect(behindAction(page({ focused: false }))).toBe('card');
	});

	it('behind and in use, but it has reloaded as often as it may: shows the card', () => {
		expect(behindAction(page({ mayReload: false }))).toBe('card');
	});

	it('never plays while behind', () => {
		for (const visible of [true, false]) {
			for (const focused of [true, false]) {
				for (const mayReload of [true, false]) {
					expect(behindAction({ behind: true, visible, focused, mayReload })).not.toBe('play');
				}
			}
		}
	});
});

describe('behindKey', () => {
	it('Enter and Space catch up; every other key does nothing', () => {
		expect(behindKey('Enter')).toBe('reload');
		expect(behindKey(' ')).toBe('reload');
		for (const key of ['ArrowLeft', 'a', 'w', 'Escape', '1', 'Backspace', 'Tab', 'Shift']) {
			expect(behindKey(key)).toBe('ignore');
		}
	});
});

describe('reloadAllowed', () => {
	const now = 1_000_000;

	it(`allows ${RELOADS_PER_MINUTE} reloads a minute and remembers each`, () => {
		let times: number[] = [];
		for (let i = 0; i < RELOADS_PER_MINUTE; i++) {
			const verdict = reloadAllowed(times, now + i);
			expect(verdict.allowed).toBe(true);
			times = verdict.times;
		}
		expect(times).toHaveLength(RELOADS_PER_MINUTE);
		expect(reloadAllowed(times, now + 10).allowed).toBe(false);
	});

	it('forgets reloads older than a minute, and any from the future', () => {
		const old = [now - 61_000, now - 60_000, now - 70_000];
		expect(reloadAllowed(old, now)).toEqual({ allowed: true, times: [now] });
		const skewed = [now + 5_000, now + 6_000, now + 7_000];
		expect(reloadAllowed(skewed, now).allowed).toBe(true);
	});
});
