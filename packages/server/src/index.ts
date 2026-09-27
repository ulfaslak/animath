import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { env } from './env.js';
import { attachPresence, noAccounts } from './presence/socket.js';

const app = createApp();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	console.log(`server listening on http://localhost:${info.port}`);
});

// Who is where, over the WebSocket at /api/ws (presence/socket.ts). Accounts
// (a session cookie) join the guests once they land.
attachPresence(server as Server, {
	accountOf: noAccounts,
	log: (line) => console.log(line)
});
