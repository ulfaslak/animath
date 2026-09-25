import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { db, pool } from '../src/db/index.js';
import { players, saves } from '../src/db/schema.js';
import { MAX_PARTY, SAVE_MAX_BYTES } from '../src/save.js';
import { hashSecret } from '../src/secrets.js';

// Integration tests: the real app against the real driver and `mathgame_test`
// (see test/global-setup.ts). Each test creates its own player, so tests are
// independent and the table is never shared state.

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

const validSave = {
	version: 1,
	seed: 12345,
	pos: { x: -7, y: 3 },
	party: [animal(1, { nickname: 'Nutkin' }), animal(2, { speciesId: 'fox' })]
};

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
	it('answers 404 before anything has been saved', async () => {
		const player = await createPlayer();
		const res = await getSave(player);
		expect(res.status).toBe(404);
	});

	it('PUT then GET returns the same document, extra fields included', async () => {
		const player = await createPlayer();
		const doc = { ...validSave, inventory: { leashes: 3 }, party: [animal(1, { mood: 'happy' })] };
		const put = await putSave(player, doc);
		expect(put.status).toBe(200);
		expect(await put.json()).toEqual({ ok: true });

		const got = await getSave(player);
		expect(got.status).toBe(200);
		expect(await got.json()).toEqual(doc);
	});

	it('a second PUT replaces the save instead of adding a row', async () => {
		const player = await createPlayer();
		await putSave(player, validSave);
		const later = { ...validSave, seed: 99, party: [] };
		expect((await putSave(player, later)).status).toBe(200);
		expect(await (await getSave(player)).json()).toEqual(later);
		const rows = await db.select().from(saves).where(eq(saves.playerId, player.id));
		expect(rows).toHaveLength(1);
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
		await putSave(player, validSave);
		expect((await getSave(player, 'not-the-secret')).status).toBe(401);
		const put = await putSave({ id: player.id, secret: 'not-the-secret' }, validSave);
		expect(put.status).toBe(401);
		// The wrong-secret PUT did not touch the save.
		expect(await (await getSave(player)).json()).toEqual(validSave);
	});

	it("401 with another player's secret", async () => {
		const a = await createPlayer();
		const b = await createPlayer();
		expect((await getSave(a, b.secret)).status).toBe(401);
	});

	it('404 for an unknown player id, even with a well-formed secret', async () => {
		const player = await createPlayer();
		const res = await app.request(savePath(randomUUID()), { headers: auth(player.secret) });
		expect(res.status).toBe(404);
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
	}

	it('400 for malformed JSON', async () => {
		await expectRejected('{"version": 1,', /JSON/);
	});

	it('400 for a non-object document', async () => {
		await expectRejected([1, 2, 3], /object/);
		await expectRejected('"just a string"', /object/);
	});

	it('400 for the wrong version', async () => {
		await expectRejected({ ...validSave, version: 2 }, /version/);
		await expectRejected({ ...validSave, version: '1' }, /version/);
	});

	it('400 for a missing or fractional seed', async () => {
		const { seed: _seed, ...noSeed } = validSave;
		await expectRejected(noSeed, /seed/);
		await expectRejected({ ...validSave, seed: 1.5 }, /seed/);
	});

	it('400 for a bad position', async () => {
		await expectRejected({ ...validSave, pos: { x: '1', y: 2 } }, /pos/);
		await expectRejected({ ...validSave, pos: [1, 2] }, /pos/);
		await expectRejected({ ...validSave, pos: { x: 1 } }, /pos/);
	});

	it(`400 for a party of ${MAX_PARTY + 1}, 200 for a party of ${MAX_PARTY}`, async () => {
		const full = Array.from({ length: MAX_PARTY }, (_, i) => animal(i));
		const player = await createPlayer();
		expect((await putSave(player, { ...validSave, party: full })).status).toBe(200);
		await expectRejected({ ...validSave, party: [...full, animal(MAX_PARTY)] }, /party/);
	});

	it('400 for a party that is not a list', async () => {
		await expectRejected({ ...validSave, party: { a: 1 } }, /party/);
	});

	it('400 for an animal with an unknown species, bad hp, or missing id', async () => {
		await expectRejected({ ...validSave, party: [animal(1, { speciesId: 'dragon' })] }, /species/);
		await expectRejected({ ...validSave, party: [animal(1, { hp: -1 })] }, /hp/);
		await expectRejected({ ...validSave, party: [animal(1, { hp: 2.5 })] }, /hp/);
		await expectRejected({ ...validSave, party: [animal(1, { hp: '10' })] }, /hp/);
		await expectRejected({ ...validSave, party: [animal(1, { id: '' })] }, /id/);
		await expectRejected({ ...validSave, party: [animal(1, { nickname: 7 })] }, /nickname/);
		await expectRejected({ ...validSave, party: [animal(1, { nickname: null })] }, /nickname/);
	});

	it('400 when two animals share an id', async () => {
		await expectRejected({ ...validSave, party: [animal(1), animal(1)] }, /id/);
	});

	it('400, not 500, for text jsonb cannot store: NUL and lone surrogates, anywhere', async () => {
		await expectRejected(
			{ ...validSave, party: [animal(1, { nickname: 'a\u0000b' })] },
			/nickname/
		);
		await expectRejected({ ...validSave, party: [animal(1, { id: 'a\u0000' })] }, /id/);
		// Raw bodies: JSON.stringify would re-escape a lone surrogate into a pair.
		const raw = JSON.stringify(validSave).slice(0, -1);
		await expectRejected(`${raw},"note":"\\ud800"}`, /note/);
		await expectRejected(`${raw},"a\\u0000b":1}`, /key/);
	});

	it('400 for a number that overflows to Infinity, which would come back as null', async () => {
		const raw = JSON.stringify(validSave).slice(0, -1);
		await expectRejected(`${raw},"big":1e400}`, /big/);
		await expectRejected(`${raw},"party":[{"id":"a","speciesId":"fox","hp":1,"x":-1e999}]}`, /x/);
	});

	it('413 for a body over the size cap, with and without Content-Length', async () => {
		const player = await createPlayer();
		const body = JSON.stringify({ ...validSave, notes: 'x'.repeat(SAVE_MAX_BYTES) });
		const declared = await putSave(player, body, { 'content-length': String(body.length) });
		expect(declared.status).toBe(413);
		const streamed = await putSave(player, body);
		expect(streamed.status).toBe(413);
		expect((await getSave(player)).status).toBe(404);
	});
});
