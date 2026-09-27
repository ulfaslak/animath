import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
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
}

/**
 * The anonymous backup in production: gone. Accounts keep a game on the
 * server there; the backup stays in development until the kid's game has
 * moved to production. Its tables are left as they are.
 */
const backupOff = new Hono().all('*', (c) => c.json({ error: 'the backup is off here' }, 410));

/**
 * The HTTP app. In production it also serves the built client from
 * `packages/client/dist`; in development Vite serves the client and proxies
 * `/api` and `/ws` here.
 */
export function createApp(options: AppOptions = {}) {
	const production = options.production ?? env.NODE_ENV === 'production';
	const app = new Hono();
	app.use(logger());
	app.route('/api/health', health);
	if (production) app.route('/api/players', backupOff);
	else app.route('/api/players', playersRoute);
	app.route(
		'/api/account',
		accountRoute({ cookie: { secure: production }, limits: options.limits ?? ACCOUNT_LIMITS })
	);
	app.use('/*', serveStatic({ root: '../client/dist' }));
	app.get('/*', serveStatic({ path: '../client/dist/index.html' }));
	return app;
}
