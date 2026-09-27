import { describe, expect, it } from 'vitest';
import { WELCOME_KEY, forgetWelcome, takeWelcomeToken, welcomeFrom } from '../src/account/welcome';
import type { KeyValueStore } from '../src/save/storage';

/**
 * A welcome link's token logs in to an account once. It rides after `#`,
 * which a browser never sends, and leaves the page's address as the page
 * starts, the rest of the address as it was; the tab keeps it for its own
 * later starts (a reload, a tablet bringing a discarded tab back) until the
 * link is used, spent or put away.
 */

class MemoryStore implements KeyValueStore {
	data = new Map<string, string>();
	get(key: string): string | null {
		return this.data.get(key) ?? null;
	}
	set(key: string, value: string): boolean {
		this.data.set(key, value);
		return true;
	}
	remove(key: string): void {
		this.data.delete(key);
	}
}

function pages() {
	const calls: [unknown, string, string | URL | null | undefined][] = [];
	return {
		calls,
		state: { kept: true },
		replaceState: (state: unknown, unused: string, url?: string | URL | null) => {
			calls.push([state, unused, url]);
		}
	};
}

describe('the welcome link’s token', () => {
	it('comes out of the address after # or ?, which keeps the rest of its query and hash', () => {
		expect(welcomeFrom('https://g.test/#welcome=abc_-9')).toEqual({ token: 'abc_-9', href: '/' });
		expect(welcomeFrom('https://g.test/?lang=da#welcome=abc')).toEqual({
			token: 'abc',
			href: '/?lang=da'
		});
		expect(welcomeFrom('https://g.test/?welcome=abc_-9')).toEqual({ token: 'abc_-9', href: '/' });
		expect(
			welcomeFrom('https://g.test/play?lang=da&welcome=abc&party=bear:10,fox&debug#top')
		).toEqual({
			token: 'abc',
			href: '/play?lang=da&party=bear:10,fox&debug#top'
		});
		// Both forms at once: the fragment's wins, and both leave.
		expect(welcomeFrom('https://g.test/?welcome=old#welcome=new')).toEqual({
			token: 'new',
			href: '/'
		});
		expect(welcomeFrom('https://g.test/#welcome=')).toEqual({ token: null, href: '/' });
		expect(welcomeFrom('https://g.test/?welcome=%20')).toEqual({ token: null, href: '/' });
		expect(welcomeFrom('https://g.test/?lang=da#top')).toBeNull();
	});

	it('is taken once: the address is replaced, not pushed, so Back never shows it', () => {
		const history = pages();
		const session = new MemoryStore();
		expect(
			takeWelcomeToken({ where: { href: 'https://g.test/#welcome=tok' }, pages: history, session })
		).toBe('tok');
		expect(history.calls).toEqual([[{ kept: true }, '', '/']]);
	});

	it('is kept for the tab’s next starts until it is forgotten', () => {
		const session = new MemoryStore();
		takeWelcomeToken({ where: { href: 'https://g.test/#welcome=tok' }, pages: pages(), session });
		expect(session.get(WELCOME_KEY)).toBe('tok');
		// A reload: the address has no token any more, and the tab still has it.
		expect(takeWelcomeToken({ where: { href: 'https://g.test/' }, pages: pages(), session })).toBe(
			'tok'
		);
		forgetWelcome(session);
		expect(
			takeWelcomeToken({ where: { href: 'https://g.test/' }, pages: pages(), session })
		).toBeNull();
		// A new link replaces an old one the tab still held.
		session.set(WELCOME_KEY, 'old');
		expect(
			takeWelcomeToken({ where: { href: 'https://g.test/#welcome=new' }, pages: pages(), session })
		).toBe('new');
	});

	it('leaves the address of a throwaway page too, and is neither kept nor used there', () => {
		const history = pages();
		const session = new MemoryStore();
		expect(
			takeWelcomeToken({
				where: { href: 'https://g.test/?new#welcome=tok' },
				pages: history,
				session,
				throwaway: true
			})
		).toBeNull();
		expect(history.calls).toEqual([[{ kept: true }, '', '/?new']]);
		expect(session.get(WELCOME_KEY)).toBeNull();
	});

	it('still comes out when the address cannot be replaced, and without a tab’s storage', () => {
		const broken = {
			state: null,
			replaceState: () => {
				throw new Error('SecurityError');
			}
		};
		expect(
			takeWelcomeToken({
				where: { href: 'https://g.test/#welcome=tok' },
				pages: broken,
				session: null
			})
		).toBe('tok');
	});
});
