import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';

/**
 * What the account routes need to know about a request before they trust it:
 * where it came from (for rate limits) and that a page of this site sent it
 * (for anything that changes state).
 */

/** Loopback and private addresses: a proxy of ours (Vite, nginx on the compose network), not a client. */
function isProxyAddress(address: string): boolean {
	const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
	if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
		const [a, b] = v4.split('.').map(Number) as [number, number];
		return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
	}
	const v6 = address.toLowerCase();
	return v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

/**
 * The address a request came from. A request that reached us through a proxy
 * of ours (its peer is a loopback or private address: Vite in development,
 * nginx in production) is from the last address in `X-Forwarded-For`, the one
 * that proxy saw; any earlier entries are whatever the client claimed. With
 * no socket at all (`app.request` in tests) the peer counts as a proxy.
 */
export function clientIp(c: Context): string {
	let peer: string | undefined;
	try {
		peer = getConnInfo(c).remote.address;
	} catch {
		peer = undefined;
	}
	return clientAddress(peer, c.req.header('x-forwarded-for'));
}

/**
 * `clientIp`'s rule, from the socket's peer address and the request's
 * `X-Forwarded-For`: for a request that has no Hono context, such as a
 * WebSocket upgrade.
 */
export function clientAddress(peer: string | undefined, forwardedFor: string | undefined): string {
	if (peer && !isProxyAddress(peer)) return peer;
	const last = forwardedFor?.split(',').at(-1)?.trim();
	return last || peer || 'unknown';
}

/** The eight groups of an IPv6 address, in lower-case hex without leading zeros; null when it is not one. */
function ipv6Groups(ip: string): string[] | null {
	const address = ip.split('%')[0]!.toLowerCase();
	if (!address.includes(':') || !/^[0-9a-f:.]+$/.test(address)) return null;
	const halves = address.split('::');
	if (halves.length > 2) return null;
	const groupsOf = (part: string) => (part === '' ? [] : part.split(':'));
	const head = groupsOf(halves[0]!);
	const tail = halves.length === 2 ? groupsOf(halves[1]!) : [];
	// An IPv4 address written at the end fills the last two groups.
	const width = (groups: string[]) => groups.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0);
	const missing = 8 - width(head) - width(tail);
	if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
	const groups = [...head, ...Array<string>(Math.max(0, missing)).fill('0'), ...tail];
	if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g) || /^\d{1,3}(\.\d{1,3}){3}$/.test(g)))
		return null;
	return groups.map((g) => (g.includes('.') ? g : parseInt(g, 16).toString(16)));
}

/**
 * The key a client's rate limits count under: an IPv4 address itself, and an
 * IPv6 address's /64, the block one household or one server is given, since
 * picking another address inside it costs nothing.
 */
export function rateKey(ip: string): string {
	const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return v4;
	const groups = ipv6Groups(ip);
	return groups ? `${groups.slice(0, 4).join(':')}::/64` : ip;
}

/** The hosts a browser may have addressed: `Host`, and a proxy's `X-Forwarded-Host` when one set it. */
function requestHosts(c: Context): string[] {
	const hosts = [c.req.header('host'), c.req.header('x-forwarded-host')?.split(',')[0]];
	return hosts.flatMap((h) => (h ? [h.trim().toLowerCase()] : []));
}

/**
 * Whether `origin` names `host`. A host with a port must match the origin's
 * host and port; one without a port is compared by name alone, because a
 * proxy may pass the name the browser used without its port (nginx's `$host`
 * does), and a page on this name at another port is still a page of ours.
 */
function names(origin: URL, host: string): boolean {
	return /:\d+$/.test(host)
		? host === origin.host.toLowerCase()
		: host === origin.hostname.toLowerCase();
}

/**
 * Whether a request's `Origin` is this site: its host is the one the browser
 * addressed. A browser names the page behind every POST, PUT and WebSocket
 * upgrade in `Origin`; a request with none is not from a browser's page (curl,
 * the admin's tools) and counts as this site. The WebSocket upgrade, a GET
 * that `sameOriginJson` lets through, must ask this itself: a page on another
 * site can open a socket here, and on a same-site subdomain the session
 * cookie goes along.
 */
export function fromThisSite(c: Context): boolean {
	const origin = c.req.header('origin');
	if (origin === undefined) return true;
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	return url.host !== '' && requestHosts(c).some((host) => names(url, host));
}

/**
 * Guards every request that changes state (anything but GET and HEAD):
 *
 * - **Same origin** (`fromThisSite`).
 * - **JSON.** The body must be declared `application/json`. A form on another
 *   site cannot send that, and a script on another site cannot send it
 *   without asking first (a CORS preflight, which this server never answers).
 */
export const sameOriginJson: MiddlewareHandler = async (c, next) => {
	if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
	if (!fromThisSite(c)) return c.json({ error: 'wrong origin' }, 403);
	const type = c.req.header('content-type') ?? '';
	if (!/^application\/json\s*(;|$)/i.test(type)) {
		return c.json({ error: 'send JSON' }, 415);
	}
	return next();
};

/** The body as JSON, or `undefined` when it is not JSON at all. */
export async function readJson(c: Context): Promise<unknown> {
	try {
		return JSON.parse(await c.req.text());
	} catch {
		return undefined;
	}
}
