import { MAX_NICKNAME_LENGTH, MAX_PARTY, normalizeNickname } from '@mathgame/engine';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { db, pool } from '../src/db/index.js';
import { players, saveBackups, saves } from '../src/db/schema.js';
import { SAVE_MAX_BYTES } from '../src/save.js';
import { hashSecret } from '../src/secrets.js';

// Integration tests: the real app against the real driver and `mathgame_test`
// (see test/global-setup.ts). Each test creates its own player, so tests are
// independent and the table is never shared state. What a save document may
// hold is the engine's rule and is tested there (`save.test.ts`); these tests
// cover the HTTP wiring, the write guard and the backups.

const app = createApp();

afterAll(() => pool.end());

interface Player {
	id: string;
	secret: string;
}

async function createPlayer(): Promise<Player> {
	const res = await app.request('/api/players', { method: 'POST' });
	expect(res.status).toBe(201);
	return (await res.json()) as Player;
}

function savePath(id: string): string {
	return `/api/players/${id}/save`;
}

function auth(secret: string): Record<string, string> {
	return { authorization: `Bearer ${secret}` };
}

function putSave(player: Player, body: unknown, extraHeaders: Record<string, string> = {}) {
	return app.request(savePath(player.id), {
		method: 'PUT',
		headers: { ...auth(player.secret), 'content-type': 'application/json', ...extraHeaders },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
}

function getSave(player: Player, secret = player.secret) {
	return app.request(savePath(player.id), { headers: auth(secret) });
}

function animal(i: number, overrides: Record<string, unknown> = {}) {
	return { id: `a${i}`, speciesId: 'squirrel', hp: 10 + i, ...overrides };
}

/** A document ready to write: save number `seq` of game `lineage`. */
function doc(seq: number, lineage = 'game-a', overrides: Record<string, unknown> = {}) {
	return {
		version: 1,
		seed: 12345,
		pos: { x: -7, y: 3 },
		facing: 'left',
		steps: 40 + seq,
		visits: 1,
		lineage,
		seq,
		party: [animal(1, { nickname: 'Nutkin' }), animal(2, { speciesId: 'fox' })],
		...overrides
	};
}

/** Sends every body at once; the statuses, in the same order. */
async function race(player: Player, bodies: unknown[]): Promise<number[]> {
	const responses = await Promise.all(bodies.map((body) => putSave(player, body)));
	return responses.map((r) => r.status);
}

async function stored(player: Player): Promise<unknown> {
	const [row] = await db.select().from(saves).where(eq(saves.playerId, player.id));
	return row?.data ?? null;
}

async function backups(player: Player) {
	return db
		.select({ data: saveBackups.data, reason: saveBackups.reason })
		.from(saveBackups)
		.where(eq(saveBackups.playerId, player.id))
		.orderBy(saveBackups.id);
}

describe('POST /api/players', () => {
	it('creates an anonymous player and returns an id plus a secret', async () => {
		const player = await createPlayer();
		expect(player.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(player.secret.length).toBeGreaterThanOrEqual(32);
	});

	it('stores only the hash of the secret', async () => {
		const player = await createPlayer();
		const [row] = await db.select().from(players).where(eq(players.id, player.id));
		expect(row?.secretHash).not.toBe(player.secret);
		expect(row?.secretHash).toBe(hashSecret(player.secret));
	});

	it('gives every player a different secret', async () => {
		const a = await createPlayer();
		const b = await createPlayer();
		expect(a.secret).not.toBe(b.secret);
	});
});

describe('save round trip', () => {
	it('answers 404 "no save yet" before anything has been saved', async () => {
		const player = await createPlayer();
		const res = await getSave(player);
		expect(res.status).toBe(404);
		// The client tells this 404 from "no such player" by its text.
		expect(await res.json()).toEqual({ error: 'no save yet' });
	});

	it('PUT then GET returns the same document, extra fields and a battle included', async () => {
		const player = await createPlayer();
		const sent = doc(1, 'game-a', {
			inventory: { leashes: 3 },
			party: [animal(1, { mood: 'happy' })],
			battle: { step: 2, phase: { kind: 'choose-action' } }
		});
		const put = await putSave(player, sent);
		expect(put.status).toBe(200);
		expect(await put.json()).toEqual({ ok: true });

		const got = await getSave(player);
		expect(got.status).toBe(200);
		expect(await got.json()).toEqual(sent);
	});

	it('stores the longest nickname the game can make, in the widest letters', async () => {
		// The engine counts a nickname in code points and the save checks UTF-16
		// units: a name of 4-byte letters is twice as long here. This fails if the
		// engine's cap ever outgrows what a save accepts.
		const nickname = normalizeNickname('\u{10400}'.repeat(MAX_NICKNAME_LENGTH + 5))!;
		expect(Array.from(nickname)).toHaveLength(MAX_NICKNAME_LENGTH);
		const player = await createPlayer();
		const sent = doc(1, 'game-a', { party: [animal(1, { nickname })] });
		expect((await putSave(player, sent)).status).toBe(200);
		expect(await (await getSave(player)).json()).toEqual(sent);
	});

	it('a later save of the same game replaces the save instead of adding a row, with no backup', async () => {
		const player = await createPlayer();
		await putSave(player, doc(1));
		const later = doc(2, 'game-a', { party: [] });
		expect((await putSave(player, later)).status).toBe(200);
		expect(await (await getSave(player)).json()).toEqual(later);
		const rows = await db.select().from(saves).where(eq(saves.playerId, player.id));
		expect(rows).toHaveLength(1);
		expect(await backups(player)).toEqual([]);
	});

	it('an authenticated request bumps last_seen_at', async () => {
		const player = await createPlayer();
		const [before] = await db.select().from(players).where(eq(players.id, player.id));
		await new Promise((r) => setTimeout(r, 5));
		await getSave(player);
		const [after] = await db.select().from(players).where(eq(players.id, player.id));
		expect(after!.lastSeenAt.getTime()).toBeGreaterThan(before!.lastSeenAt.getTime());
	});
});

describe('the stale-write guard', () => {
	it('409 for a save of the same game numbered the same or lower; the stored one stays', async () => {
		const player = await createPlayer();
		expect((await putSave(player, doc(5))).status).toBe(200);
		for (const seq of [5, 4, 1]) {
			const res = await putSave(player, doc(seq, 'game-a', { pos: { x: 99, y: 99 } }));
			expect(res.status).toBe(409);
			expect(((await res.json()) as { error: string }).error).toMatch(/seq/);
		}
		expect(await stored(player)).toEqual(doc(5));
		expect((await putSave(player, doc(6))).status).toBe(200);
	});

	it('another game replaces the save only with a higher seq, and the old game is kept', async () => {
		const player = await createPlayer();
		await putSave(player, doc(7, 'game-a'));
		expect((await putSave(player, doc(7, 'game-b'))).status).toBe(409);
		expect((await putSave(player, doc(3, 'game-b'))).status).toBe(409);
		expect(await backups(player)).toEqual([]);

		expect((await putSave(player, doc(8, 'game-b'))).status).toBe(200);
		expect(await stored(player)).toEqual(doc(8, 'game-b'));
		expect(await backups(player)).toEqual([{ data: doc(7, 'game-a'), reason: 'replaced' }]);
	});

	it('a stored save this build cannot read is kept aside when a backup replaces it', async () => {
		const player = await createPlayer();
		// As if the catalog lost a species, or a newer build wrote it.
		for (const bad of [
			doc(3, 'game-a', { party: [animal(1, { speciesId: 'dragon' })] }),
			doc(4, 'game-a', { version: 2 })
		]) {
			await db
				.insert(saves)
				.values({ playerId: player.id, data: bad })
				.onConflictDoUpdate({ target: saves.playerId, set: { data: bad } });
			expect((await putSave(player, doc(bad.seq, 'game-a'))).status).toBe(409);
			expect((await putSave(player, doc(bad.seq + 1, 'game-a'))).status).toBe(200);
			expect((await backups(player)).at(-1)).toEqual({ data: bad, reason: 'unreadable' });
		}
	});

	it('a save from before seq and lineage existed is replaced by any valid save, and kept', async () => {
		const player = await createPlayer();
		const legacy = { version: 1, seed: 3, pos: { x: 1, y: 1 }, party: [] };
		await db.insert(saves).values({ playerId: player.id, data: legacy });
		expect((await putSave(player, doc(1))).status).toBe(200);
		expect(await backups(player)).toEqual([{ data: legacy, reason: 'replaced' }]);
	});

	it('of many writes racing with the same seq, exactly one lands', async () => {
		const player = await createPlayer();
		await putSave(player, doc(1));
		const racers = Array.from({ length: 8 }, (_, i) => doc(2, 'game-a', { steps: 100 + i }));
		const statuses = await race(player, racers);
		expect(statuses.filter((s) => s === 200)).toHaveLength(1);
		expect(statuses.filter((s) => s === 409)).toHaveLength(7);
		const winner = racers[statuses.indexOf(200)];
		expect(await stored(player)).toEqual(winner);
	});

	it('of many other games racing to replace one, exactly one lands and the old one is kept once', async () => {
		const player = await createPlayer();
		await putSave(player, doc(4, 'game-a'));
		const racers = Array.from({ length: 6 }, (_, i) => doc(5, `game-${i + 10}`));
		const statuses = await race(player, racers);
		expect(statuses.filter((s) => s === 200)).toHaveLength(1);
		expect(await backups(player)).toEqual([{ data: doc(4, 'game-a'), reason: 'replaced' }]);
	});
});

describe('authentication', () => {
	it('401 without an Authorization header', async () => {
		const player = await createPlayer();
		const res = await app.request(savePath(player.id));
		expect(res.status).toBe(401);
	});

	it('401 with a non-Bearer scheme', async () => {
		const player = await createPlayer();
		const res = await app.request(savePath(player.id), {
			headers: { authorization: `Basic ${player.secret}` }
		});
		expect(res.status).toBe(401);
	});

	it('401 with a wrong secret, on GET and on PUT', async () => {
		const player = await createPlayer();
		await putSave(player, doc(1));
		expect((await getSave(player, 'not-the-secret')).status).toBe(401);
		const put = await putSave({ id: player.id, secret: 'not-the-secret' }, doc(2));
		expect(put.status).toBe(401);
		// The wrong-secret PUT did not touch the save.
		expect(await (await getSave(player)).json()).toEqual(doc(1));
	});

	it("401 with another player's secret", async () => {
		const a = await createPlayer();
		const b = await createPlayer();
		expect((await getSave(a, b.secret)).status).toBe(401);
	});

	it('404 "no such player" for an unknown player id, even with a well-formed secret', async () => {
		const player = await createPlayer();
		const res = await app.request(savePath(randomUUID()), { headers: auth(player.secret) });
		expect(res.status).toBe(404);
		// The client tells this 404 from "no save yet" by its text.
		expect(await res.json()).toEqual({ error: 'no such player' });
	});

	it('404 for an id that is not a uuid', async () => {
		const player = await createPlayer();
		const res = await app.request(savePath('not-a-uuid'), { headers: auth(player.secret) });
		expect(res.status).toBe(404);
	});
});

describe('PUT validation', () => {
	async function expectRejected(body: unknown, errorMatch: RegExp) {
		const player = await createPlayer();
		const res = await putSave(player, body);
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toMatch(errorMatch);
		expect(await stored(player)).toBeNull();
	}

	it('400 for malformed JSON', async () => {
		await expectRejected('{"version": 1,', /JSON/);
	});

	it("400 for a document the engine's validator refuses", async () => {
		await expectRejected([1, 2, 3], /object/);
		await expectRejected(doc(1, 'game-a', { version: 2 }), /version/);
		await expectRejected(
			doc(1, 'game-a', { party: [animal(1, { speciesId: 'dragon' })] }),
			/species/
		);
	});

	it(`400 for a party of ${MAX_PARTY + 1}, 200 for a party of ${MAX_PARTY}`, async () => {
		const full = Array.from({ length: MAX_PARTY }, (_, i) => animal(i));
		const player = await createPlayer();
		expect((await putSave(player, doc(1, 'game-a', { party: full }))).status).toBe(200);
		await expectRejected(doc(1, 'game-a', { party: [...full, animal(MAX_PARTY)] }), /party/);
	});

	it('400 for a write without the fields every write carries', async () => {
		for (const key of ['seq', 'lineage', 'steps', 'visits', 'facing']) {
			const partial: Record<string, unknown> = doc(1);
			delete partial[key];
			await expectRejected(partial, new RegExp(key));
		}
		await expectRejected(doc(0), /seq/);
	});

	it('400, not 500, for text jsonb cannot store, anywhere in the body', async () => {
		// Raw bodies: JSON.stringify would re-escape a lone surrogate into a pair.
		const raw = JSON.stringify(doc(1)).slice(0, -1);
		await expectRejected(`${raw},"note":"\\ud800"}`, /note/);
		await expectRejected(`${raw},"a\\u0000b":1}`, /key/);
		await expectRejected(`${raw},"big":1e400}`, /big/);
	});

	it('413 for a body over the size cap, with and without Content-Length', async () => {
		const player = await createPlayer();
		const body = JSON.stringify(doc(1, 'game-a', { notes: 'x'.repeat(SAVE_MAX_BYTES) }));
		const declared = await putSave(player, body, { 'content-length': String(body.length) });
		expect(declared.status).toBe(413);
		const streamed = await putSave(player, body);
		expect(streamed.status).toBe(413);
		expect((await getSave(player)).status).toBe(404);
	});
});
