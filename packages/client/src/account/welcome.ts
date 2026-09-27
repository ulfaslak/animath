import type { KeyValueStore } from '../save/storage';

/**
 * A welcome link (`/#welcome=<token>`, [[UI_SPEC]] § Accounts): the admin
 * made an account for a kid whose game came here from another server, and
 * the link lets the kid pick its password. The token logs in to that
 * account once.
 *
 * It rides after `#`, which a browser never sends: no request line holds it,
 * so no server's log does, nginx's error log included. The page sends it in
 * a header to look the link up and in a body to use it. As the page starts
 * it leaves the address (`replaceState`), so this tab's Back and a
 * bookmark made now never show it. The browser's own history may still hold
 * the address as it was opened: what keeps a link safe there is that it
 * works once and for 14 days, and a password picked uses it up.
 *
 * The tab keeps the token (`sessionStorage`) for its own next starts until
 * the link is settled: used, spent, or put away (Not now). A reload, or a
 * tablet bringing back a tab it had discarded, opens the card again. `?welcome=`
 * works too, for a link written by hand; the query reaches the servers, whose
 * access logs hide it.
 */

/** The switch that carries a welcome link's token, after `#` (or `?`). */
export const WELCOME_PARAM = 'welcome';

/** The key a tab keeps a welcome link's token under between its own starts (`sessionStorage`). */
export const WELCOME_KEY = 'animath.welcome';

/** Whether one `name=value` part of a query or a fragment is the welcome switch. */
function isWelcomePart(part: string): boolean {
	const name = part.split('=')[0]!.replace(/\+/g, ' ');
	try {
		return decodeURIComponent(name) === WELCOME_PARAM;
	} catch {
		return false;
	}
}

/** The welcome switch's value in a query or a fragment (without `?` or `#`), or null for none. */
function welcomeIn(parts: string): string | null {
	const params = new URLSearchParams(parts);
	return params.has(WELCOME_PARAM) ? (params.get(WELCOME_PARAM) ?? '') : null;
}

/** `parts` without the welcome switch, each other part as it was written. */
function without(parts: string): string {
	return parts
		.split('&')
		.filter((part) => part !== '' && !isWelcomePart(part))
		.join('&');
}

/**
 * The welcome link's token in `href` (the fragment's, else the query's),
 * and the address without either (the rest of the query and of the fragment
 * as they were written), or null when there is no switch. An empty token is
 * no token, and still leaves the address.
 */
export function welcomeFrom(href: string): { token: string | null; href: string } | null {
	const url = new URL(href);
	const query = url.search.slice(1);
	const fragment = url.hash.slice(1);
	const inFragment = welcomeIn(fragment);
	const inQuery = welcomeIn(query);
	if (inFragment === null && inQuery === null) return null;
	const token = (inFragment ?? inQuery ?? '').trim();
	const search = without(query);
	const hash = inFragment === null ? fragment : without(fragment);
	return {
		token: token === '' ? null : token,
		href: `${url.pathname}${search ? `?${search}` : ''}${hash ? `#${hash}` : ''}`
	};
}

export interface WelcomeStart {
	where?: Pick<Location, 'href'>;
	pages?: Pick<History, 'replaceState' | 'state'>;
	/** The tab's own storage (`sessionStorage`), which keeps the token for the tab's next starts. */
	session?: KeyValueStore | null;
	/** A throwaway page: the token leaves the address and is neither kept nor used there. */
	throwaway?: boolean;
}

/**
 * The welcome link's token this start is for: taken out of the page's
 * address (`replaceState`, so neither Back nor a reload brings the address
 * back), else the one this tab kept from an earlier start; null for none.
 */
export function takeWelcomeToken({
	where = location,
	pages = history,
	session = null,
	throwaway = false
}: WelcomeStart = {}): string | null {
	const found = welcomeFrom(where.href);
	if (found) {
		try {
			pages.replaceState(pages.state, '', found.href);
		} catch {
			// An address that cannot be replaced keeps the token; the link works all the same.
		}
	}
	if (throwaway) return null;
	if (found?.token) {
		session?.set(WELCOME_KEY, found.token);
		return found.token;
	}
	return session?.get(WELCOME_KEY) ?? null;
}

/** The link is settled (used, spent, or put away): the tab's next start opens no card for it. */
export function forgetWelcome(session: KeyValueStore | null): void {
	session?.remove(WELCOME_KEY);
}
