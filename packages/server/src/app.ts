import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { health } from './routes/health.js';

/**
 * The HTTP app. In production it also serves the built client from
 * `packages/client/dist`; in development Vite serves the client and proxies
 * `/api` and `/ws` here.
 */
export function createApp() {
	const app = new Hono();
	app.use(logger());
	app.route('/api/health', health);
	app.use('/*', serveStatic({ root: '../client/dist' }));
	app.get('/*', serveStatic({ path: '../client/dist/index.html' }));
	return app;
}
