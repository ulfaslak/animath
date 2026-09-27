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
	if (peer && !isProxyAddress(peer)) return peer;
	const forwarded = c.req.header('x-forwarded-for');
	const last = forwarded?.split(',').at(-1)?.trim();
	return last || peer || 'unknown';
}

/** The host a browser addressed: the proxy's `X-Forwarded-Host` when one set it, and `Host`. */
function requestHosts(c: Context): string[] {
	const hosts = [c.req.header('host'), c.req.header('x-forwarded-host')?.split(',')[0]];
	return hosts.flatMap((h) => (h ? [h.trim().toLowerCase()] : []));
}

/**
 * Guards every request that changes state (anything but GET and HEAD):
 *
 * - **Same origin.** A browser names the page that sent a request in `Origin`;
 *   it must be this site (its host is the request's own). A request with no
 *   `Origin` at all is not from a browser's page (curl, the admin's tools),
 *   and passes.
 * - **JSON.** The body must be declared `application/json`. A form on another
 *   site cannot send that, and a script on another site cannot send it
 *   without asking first (a CORS preflight, which this server never answers).
 */
export const sameOriginJson: MiddlewareHandler = async (c, next) => {
	if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
	const origin = c.req.header('origin');
	if (origin !== undefined) {
		let host: string | null = null;
		try {
			host = new URL(origin).host.toLowerCase();
		} catch {
			host = null;
		}
		if (!host || !requestHosts(c).includes(host)) {
			return c.json({ error: 'wrong origin' }, 403);
		}
	}
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
