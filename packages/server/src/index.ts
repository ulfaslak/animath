import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { env } from './env.js';

const app = createApp();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	console.log(`server listening on http://localhost:${info.port}`);
});

// `docker stop` sends SIGTERM when a deploy replaces this container: take no
// new connections, let the requests in flight finish (a script half sent, a
// save half written), then exit. Whatever still runs after 8 s is cut short,
// before Docker's kill at 10.
process.once('SIGTERM', () => {
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 8_000).unref();
});
