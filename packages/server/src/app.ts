import { serveStatic, type ServeStaticOptions } from '@hono/node-server/serve-static';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { logger } from 'hono/logger';
import { AccountsReady } from './accounts.js';
import { env } from './env.js';
import { ACCOUNT_LIMITS, type AccountLimits } from './rate-limit.js';
import { accountRoute } from './routes/account.js';
import { health } from './routes/health.js';
import { playersRoute } from './routes/players.js';

export interface AppOptions {
	/**
	 * Production: session cookies are Secure, and the anonymous backup
	 * (`/api/players`) is off. Defaults to `NODE_ENV === 'production'`.
	 */
	production?: boolean;
	/** The login and register rate limits; tests pass small ones. */
	limits?: AccountLimits;
	/** Where the built client is, relative to the working directory. Tests point it at a fixture. */
	clientDist?: string;
	/** Whether accounts work now; by default the database's answer, kept 10 s (`AccountsReady`). */
	accountsReady?: () => Promise<boolean>;
}

/**
 * The anonymous backup in production: gone. Accounts keep a game on the
 * server there; the backup stays in development until the kid's game has
 * moved to production. Its tables are left as they are.
 */
const backupOff = new Hono().all('*', (c) => c.json({ error: 'the backup is off here' }, 410));

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
	if (production) app.route('/api/players', backupOff);
	else app.route('/api/players', playersRoute);
	const accounts = new AccountsReady();
	app.route(
		'/api/account',
		accountRoute({
			cookie: { secure: production },
			limits: options.limits ?? ACCOUNT_LIMITS,
			ready: options.accountsReady ?? (() => accounts.ready())
		})
	);
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
 * A request line as the log may keep it: a welcome link's token, in the
 * page's address (`?welcome=`) or the API's path (`/welcome/<token>`), is
 * `[hidden]`. The link logs a kid in to their account once, and a log is read
 * by whoever looks into a problem, into a transcript as often as not.
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
