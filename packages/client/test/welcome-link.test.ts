import { describe, expect, it } from 'vitest';
import { takeWelcomeToken, welcomeFrom } from '../src/account/welcome';

/**
 * A welcome link's token logs in to an account once, so it leaves the page's
 * address as the page starts: the rest of the address stays as it was, and
 * neither Back nor a reload brings the token back.
 */

describe('the welcome link’s token', () => {
	it('comes out of the address, which keeps the rest of its query and its hash', () => {
		expect(welcomeFrom('https://g.test/?welcome=abc_-9')).toEqual({ token: 'abc_-9', href: '/' });
		expect(
			welcomeFrom('https://g.test/play?lang=da&welcome=abc&party=bear:10,fox&debug#top')
		).toEqual({
			token: 'abc',
			href: '/play?lang=da&party=bear:10,fox&debug#top'
		});
		expect(welcomeFrom('https://g.test/?welcome=')).toEqual({ token: null, href: '/' });
		expect(welcomeFrom('https://g.test/?welcome=%20')).toEqual({ token: null, href: '/' });
		expect(welcomeFrom('https://g.test/?lang=da')).toBeNull();
	});

	it('is taken once: the address is replaced, not pushed, so Back never shows it', () => {
		const calls: [unknown, string, string | URL | null | undefined][] = [];
		const pages = {
			state: { kept: true },
			replaceState: (state: unknown, unused: string, url?: string | URL | null) => {
				calls.push([state, unused, url]);
			}
		};
		expect(takeWelcomeToken({ href: 'https://g.test/?welcome=tok' }, pages)).toBe('tok');
		expect(calls).toEqual([[{ kept: true }, '', '/']]);
		expect(takeWelcomeToken({ href: 'https://g.test/' }, pages)).toBeNull();
		expect(calls).toHaveLength(1);
	});

	it('still comes out when the address cannot be replaced', () => {
		const pages = {
			state: null,
			replaceState: () => {
				throw new Error('SecurityError');
			}
		};
		expect(takeWelcomeToken({ href: 'https://g.test/?welcome=tok' }, pages)).toBe('tok');
	});
});
