import { serveStatic, type ServeStaticOptions } from '@hono/node-server/serve-static';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { logger } from 'hono/logger';
import { health } from './routes/health.js';
import { playersRoute } from './routes/players.js';

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

export interface AppOptions {
	/** Where the built client is, relative to the working directory. Tests point it at a fixture. */
	clientDist?: string;
}

/**
 * The HTTP app: the API under `/api`, and the built client (in development Vite
 * serves the client and proxies `/api` and `/ws` here). A path that is not a
 * file of the client gets `index.html`, except the API's and the sockets'
 * paths and the client's file folders, where nothing found is a 404.
 */
export function createApp({ clientDist = CLIENT_DIST }: AppOptions = {}) {
	const app = new Hono();
	app.use(logger());
	app.route('/api/health', health);
	app.route('/api/players', playersRoute);
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
