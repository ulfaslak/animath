import { serveStatic, type ServeStaticOptions } from '@hono/node-server/serve-static';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { logger } from 'hono/logger';
import { AccountsReady } from './accounts.js';
import { env } from './env.js';
import { ACCOUNT_LIMITS, type AccountLimits } from './rate-limit.js';
import { accountRoute } from './routes/account.js';
import { clientErrorsRoute, REPORT_LIMITS, type ReportLimits } from './routes/client-errors.js';
import { health } from './routes/health.js';

export interface AppOptions {
	/** Production: session cookies are Secure. Defaults to `NODE_ENV === 'production'`. */
	production?: boolean;
	/** The login and register rate limits; tests pass small ones. */
	limits?: AccountLimits;
	/** The error reports' rate limits (`REPORT_LIMITS`); tests pass their own. */
	reportLimits?: ReportLimits;
	/** Where the built client is, relative to the working directory. Tests point it at a fixture. */
	clientDist?: string;
	/** Whether accounts work now; by default the database's answer, kept 10 s (`AccountsReady`). */
	accountsReady?: () => Promise<boolean>;
}

/**
 * The built client, `packages/client/dist`, from the server package's own
 * directory: the working directory in development and in the image alike.
 */
export const CLIENT_DIST = '../client/dist';

/**
 * Cache-Control for a file of the built client, by the path it was asked for.
 * Vite writes every file it builds into `immutable/`, under a name that carries
 * its content hash (`build.assetsDir` in the client's vite.config.ts), so a
 * browser keeps those for good: the next build has new names. Everything else
 * is asked for again on every visit: `index.html` names the build's files, so a
 * deploy reaches every kid at their next load, and a file `public/` copies over
 * keeps its name when it changes.
 */
export function cacheControl(requestPath: string): string {
	return requestPath.startsWith('/immutable/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

/**
 * The HTTP app: the API under `/api`, and the built client (in development Vite
 * serves the client and proxies `/api` here). A path that is not a
 * file of the client gets `index.html`, except the API's and the sockets'
 * paths and the client's file folders, where nothing found is a 404.
 */
export function createApp(options: AppOptions = {}) {
	const production = options.production ?? env.NODE_ENV === 'production';
	const clientDist = options.clientDist ?? CLIENT_DIST;
	const app = new Hono();
	app.use(logger((line) => console.log(hideWelcomeTokens(line))));
	app.route('/api/health', health);
	const accounts = new AccountsReady();
	app.route(
		'/api/account',
		accountRoute({
			cookie: { secure: production },
			limits: options.limits ?? ACCOUNT_LIMITS,
			ready: options.accountsReady ?? (() => accounts.ready())
		})
	);
	app.route('/api/client-errors', clientErrorsRoute(options.reportLimits ?? REPORT_LIMITS));
	// No route answered. The API's own 404, never the game's page with a 200:
	// a caller reading the status or the JSON must not be told an unknown path
	// (or the WebSocket path asked without an upgrade) worked.
	app.all('/api/*', notFound);
	app.all('/ws', notFound);
	app.all('/ws/*', notFound);
	app.use('/*', serveClient({ root: clientDist }));
	// A file of the client that is not there is a 404, never the page. During a
	// deploy the old server and the new one answer side by side for a few
	// seconds, and a page from one asks for its scripts by names only it has:
	// the other's 404 is what sends nginx to the one that has them.
	app.all('/immutable/*', (c) => c.notFound());
	app.all('/assets/*', (c) => c.notFound());
	app.get('/*', serveClient({ path: `${clientDist}/index.html` }));
	return app;
}

/**
 * A request line as the log may keep it: a welcome link's token is
 * `[hidden]`. The printed link carries it after `#`, which no request does,
 * and the page sends it in a header or a body; only a link typed with
 * `?welcome=` (or a path someone made up) brings one here. The link logs a
 * kid in to their account once, and a log is read by whoever looks into a
 * problem, into a transcript as often as not.
 */
export function hideWelcomeTokens(line: string): string {
	return line.replace(/(welcome[=/])[^\s&#/?]+/gi, '$1[hidden]');
}

function notFound(c: Context) {
	return c.json({ error: 'not found' }, 404);
}

/**
 * `serveStatic`, with each file it finds given its Cache-Control, and nothing
 * it does not find: a 404 marked `immutable` would be kept for a year. The
 * header goes on the response `serveStatic` returns, because its own `onFound`
 * runs after that response is built, too late to add one.
 */
function serveClient(options: ServeStaticOptions): MiddlewareHandler {
	const serve = serveStatic(options);
	return async (c, next) => {
		const found = await serve(c, next);
		if (found instanceof Response) found.headers.set('Cache-Control', cacheControl(c.req.path));
		return found;
	};
}
