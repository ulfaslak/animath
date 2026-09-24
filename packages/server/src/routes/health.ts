import { Hono } from 'hono';
import { pingDb } from '../db/index.js';

export const health = new Hono().get('/', async (c) => {
	const db = await pingDb();
	return c.json({ ok: true, db }, db ? 200 : 503);
});
