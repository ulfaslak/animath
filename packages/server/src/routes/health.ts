import { Hono } from 'hono';
import { pingDb } from '../db/index.js';
import { env } from '../env.js';

/**
 * Whether the server and its database answer, and which build is running: `sha`
 * is the commit the image was built from, which the deploy checks after every
 * deploy and the client carries in its `index.html` too.
 */
export const health = new Hono().get('/', async (c) => {
	const db = await pingDb();
	return c.json({ ok: true, db, sha: env.GIT_SHA }, db ? 200 : 503);
});
