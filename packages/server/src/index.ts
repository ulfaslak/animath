import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { env } from './env.js';
import { attachPresence } from './presence/socket.js';
import { sessionUserFromCookieHeader } from './sessions.js';

const app = createApp();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	console.log(`server listening on http://localhost:${info.port}`);
});

// Who is where, over the WebSocket at /api/ws (presence/socket.ts): an account
// holder by their session cookie, looked up once as the socket opens; anyone
// else by the guest id their hello carries.
attachPresence(server as Server, {
	accountOf: (headers) => sessionUserFromCookieHeader(headers.get('cookie') ?? undefined),
	log: (line) => console.log(line)
});

// `docker stop` sends SIGTERM when a deploy replaces this container: take no
// new connections, let the requests in flight finish (a script half sent, a
// save half written), then exit. Whatever still runs after 8 s is cut short,
// before Docker's kill at 10.
process.once('SIGTERM', () => {
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 8_000).unref();
});
