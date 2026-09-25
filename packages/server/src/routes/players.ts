import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { MiddlewareHandler } from 'hono';
import { db } from '../db/index.js';
import { players, saves } from '../db/schema.js';
import { SAVE_MAX_BYTES, validateSave } from '../save.js';
import { hashSecret, newSecret, secretMatches } from '../secrets.js';

/**
 * Anonymous players and their single save.
 *
 *   POST /api/players             → 201 { id, secret }
 *   GET  /api/players/:id/save    → 200 SaveV1 | 404
 *   PUT  /api/players/:id/save    → 200 { ok: true } | 400 | 413
 *
 * Every `/:id/...` request carries `Authorization: Bearer <secret>`. Missing
 * or wrong secret → 401; unknown id → 404. Only the secret's hash is stored.
 */

type Env = { Variables: { playerId: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bearerToken(header: string | undefined): string | null {
	return /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1] ?? null;
}

/** Proves the caller owns `:id`, then records that the player was seen. */
const requireOwner: MiddlewareHandler<Env> = async (c, next) => {
	const secret = bearerToken(c.req.header('authorization'));
	if (!secret) return c.json({ error: 'missing player secret' }, 401);
	const id = c.req.param('id') ?? '';
	if (!UUID.test(id)) return c.json({ error: 'no such player' }, 404);
	const [row] = await db
		.select({ secretHash: players.secretHash })
		.from(players)
		.where(eq(players.id, id));
	if (!row) return c.json({ error: 'no such player' }, 404);
	if (!secretMatches(secret, row.secretHash)) return c.json({ error: 'wrong player secret' }, 401);
	// Postgres' clock, not Node's: the row's defaults come from `now()` too, and
	// the Docker clock can run ahead of the host's.
	await db
		.update(players)
		.set({ lastSeenAt: sql`now()` })
		.where(eq(players.id, id));
	c.set('playerId', id);
	await next();
};

export const playersRoute = new Hono<Env>()
	.post('/', async (c) => {
		const secret = newSecret();
		const [row] = await db
			.insert(players)
			.values({ secretHash: hashSecret(secret) })
			.returning({ id: players.id });
		if (!row) throw new Error('insert into players returned no row');
		return c.json({ id: row.id, secret }, 201);
	})
	.use('/:id/save', requireOwner)
	.get('/:id/save', async (c) => {
		const [row] = await db
			.select({ data: saves.data })
			.from(saves)
			.where(eq(saves.playerId, c.get('playerId')));
		if (!row) return c.json({ error: 'no save yet' }, 404);
		return c.json(row.data);
	})
	.put(
		'/:id/save',
		bodyLimit({
			maxSize: SAVE_MAX_BYTES,
			onError: (c) => c.json({ error: `save is bigger than ${SAVE_MAX_BYTES} bytes` }, 413)
		}),
		async (c) => {
			let body: unknown;
			try {
				body = JSON.parse(await c.req.text());
			} catch {
				return c.json({ error: 'body is not valid JSON' }, 400);
			}
			const result = validateSave(body);
			if (!result.ok) return c.json({ error: result.error }, 400);
			await db
				.insert(saves)
				.values({ playerId: c.get('playerId'), data: result.value })
				.onConflictDoUpdate({
					target: saves.playerId,
					set: { data: result.value, updatedAt: sql`now()` }
				});
			return c.json({ ok: true });
		}
	);
