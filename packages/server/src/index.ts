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
