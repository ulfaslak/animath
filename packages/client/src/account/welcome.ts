/**
 * A welcome link (`/?welcome=<token>`, [[UI_SPEC]] § Accounts): the admin
 * made an account for a kid whose game came here from another server, and
 * the link lets the kid pick its password. The token logs in to that
 * account once, so it leaves the address as the page starts, before anything
 * else runs: it is kept in memory only, and never lands in the history, a
 * bookmark, a shared screenshot or a reload.
 */

/** The address's switch that carries a welcome link's token. */
export const WELCOME_PARAM = 'welcome';

/** Whether one `name=value` part of a query is the welcome switch. */
function isWelcomePart(part: string): boolean {
	const name = part.split('=')[0]!.replace(/\+/g, ' ');
	try {
		return decodeURIComponent(name) === WELCOME_PARAM;
	} catch {
		return false;
	}
}

/**
 * The welcome link's token in `href`, and the address without it (the rest
 * of the query, as it was written, and the hash), or null when there is no
 * switch. An empty token is no token, and still leaves the address.
 */
export function welcomeFrom(href: string): { token: string | null; href: string } | null {
	const url = new URL(href);
	if (!url.searchParams.has(WELCOME_PARAM)) return null;
	const token = (url.searchParams.get(WELCOME_PARAM) ?? '').trim();
	const kept = url.search
		.slice(1)
		.split('&')
		.filter((part) => part !== '' && !isWelcomePart(part));
	const search = kept.length > 0 ? `?${kept.join('&')}` : '';
	return { token: token === '' ? null : token, href: `${url.pathname}${search}${url.hash}` };
}

/**
 * Takes the welcome link's token out of the page's address (`replaceState`,
 * so neither Back nor a reload brings it back) and returns it, or null.
 */
export function takeWelcomeToken(
	where: Pick<Location, 'href'> = location,
	pages: Pick<History, 'replaceState' | 'state'> = history
): string | null {
	const found = welcomeFrom(where.href);
	if (!found) return null;
	try {
		pages.replaceState(pages.state, '', found.href);
	} catch {
		// An address that cannot be replaced keeps the token; the link works all the same.
	}
	return found.token;
}
