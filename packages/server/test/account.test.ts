import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db, pool } from '../src/db/index.js';
import { accountSaveBackups, accountSaves, sessions, users } from '../src/db/schema.js';
import type { AccountLimits } from '../src/rate-limit.js';
import { SAVE_MAX_BYTES } from '../src/save.js';
import {
	MAX_SESSIONS_PER_USER,
	SESSION_COOKIE,
	createSession,
	SESSION_DAYS,
	sessionUser,
	sessionUserFromCookieHeader
} from '../src/sessions.js';

// Integration tests for the account routes: the real app, the real driver,
// the test database. Each test makes its own accounts under names no other
// test (or test file) uses, so tests share no rows. The rate limits are
// tested with an app of their own; every other app here has limits too high
// to reach.

afterAll(() => pool.end());

// Every register and login hashes a password with scrypt at its real cost:
// about 150 ms a hash at a load average of 14 (2026-09-27), and 2–4 times
// that with other worktrees' browsers drawing. A test here hashes up to eight
// times (the rate limits: a wrong password is a hash too), about 1.6 s at
// that load, so the file's tests get 30 s rather than vitest's 5.
vi.setConfig({ testTimeout: 30_000 });

const ROOMY = { limit: 100_000, windowMs: 60_000, maxKeys: 100_000 };
const NO_LIMITS: AccountLimits = {
	loginPerIp: ROOMY,
	loginFailuresPerName: ROOMY,
	registerPerIp: ROOMY,
	registerPerName: ROOMY
};

const app = createApp({ limits: NO_LIMITS });

let counter = 0;
/** A name no other test uses: letters and digits, well inside 2–16 characters. */
function freshName(): string {
	counter++;
	return `Acc${process.pid % 1000}x${counter}`;
}

/** A browser: one cookie jar, which follows every Set-Cookie it is sent. */
class Browser {
	cookie: string | null = null;
	constructor(
		readonly target = app,
		readonly headers: Record<string, string> = {}
	) {}

	async request(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
		const headers: Record<string, string> = { ...this.headers, ...extra };
		if (body !== undefined && !('content-type' in headers)) {
			headers['content-type'] = 'application/json';
		}
		if (this.cookie) headers.cookie = `${SESSION_COOKIE}=${this.cookie}`;
		const res = await this.target.request(`/api/account${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
		});
		const set = res.headers.get('set-cookie');
		if (set) {
			const value = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(set)?.[1] ?? '';
			this.cookie = /Max-Age=0/i.test(set) || value === '' ? null : value;
		}
		return res;
	}

	register(name: string, password = 'secret', save?: unknown) {
		return this.request(
			'POST',
			'/register',
			save === undefined ? { name, password } : { name, password, save }
		);
	}
	login(name: string, password = 'secret') {
		return this.request('POST', '/login', { name, password });
	}
	logout() {
		return this.request('POST', '/logout', {});
	}
	async me(): Promise<unknown> {
		return (await this.request('GET', '/me')).json();
	}
	getSave() {
		return this.request('GET', '/save');
	}
	putSave(doc: unknown, extra: Record<string, string> = {}) {
		return this.request('PUT', '/save', doc, extra);
	}
}

/** A browser logged in to a new account. */
async function account(save?: unknown): Promise<{ browser: Browser; name: string }> {
	const browser = new Browser();
	const name = freshName();
	const res = await browser.register(name, 'secret', save);
	expect(res.status).toBe(201);
	return { browser, name };
}

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
		party: [{ id: 'a1', speciesId: 'squirrel', hp: 11, nickname: 'Nutkin' }],
		...overrides
	};
}

async function userRow(name: string) {
	const [row] = await db.select().from(users).where(eq(users.name, name));
	return row;
}

async function sessionRows(name: string) {
	const user = await userRow(name);
	return db.select().from(sessions).where(eq(sessions.userId, user!.id));
}

function sha256(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('register', () => {
	it('makes the account, logs the browser in and answers with the name', async () => {
		const browser = new Browser();
		const name = freshName();
		const res = await browser.register(name);
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ user: { name } });
		expect(browser.cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(await browser.me()).toEqual({ user: { name } });
	});

	it('sets an HttpOnly, SameSite=Lax cookie for a year, not Secure in development', async () => {
		const res = await new Browser().register(freshName());
		const cookie = res.headers.get('set-cookie')!;
		expect(cookie).toMatch(/HttpOnly/);
		expect(cookie).toMatch(/SameSite=Lax/);
		expect(cookie).toMatch(/Path=\//);
		expect(cookie).toMatch(new RegExp(`Max-Age=${SESSION_DAYS * 86400}`));
		expect(cookie).not.toMatch(/Secure/);
	});

	it('stores a salted scrypt hash, never the password, and only a hash of the session token', async () => {
		const a = new Browser();
		const b = new Browser();
		const nameA = freshName();
		const nameB = freshName();
		await a.register(nameA, 'same password');
		await b.register(nameB, 'same password');
		const rowA = await userRow(nameA);
		const rowB = await userRow(nameB);
		expect(rowA!.passwordHash).toMatch(
			/^\$scrypt\$ln=\d+,r=\d+,p=\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/
		);
		expect(rowA!.passwordHash).not.toContain('same password');
		expect(rowA!.passwordHash).not.toBe(rowB!.passwordHash);
		const [session] = await sessionRows(nameA);
		expect(session!.tokenHash).toBe(sha256(a.cookie!));
		const stored = JSON.stringify(await db.select().from(sessions));
		expect(stored).not.toContain(a.cookie!);
	});

	it('keeps the guest game it carries as the account save, verbatim', async () => {
		const guest = doc(17, 'guest-game', { tokens: 3, items: ['axe'], extra: { kept: true } });
		const { browser, name } = await account(guest);
		const res = await browser.getSave();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(guest);
		const user = await userRow(name);
		const [row] = await db.select().from(accountSaves).where(eq(accountSaves.userId, user!.id));
		expect(row!.seq).toBe(17);
	});

	it('makes no account at all when the guest game it carries is not a valid save', async () => {
		const browser = new Browser();
		const name = freshName();
		const res = await browser.register(name, 'secret', { ...doc(1), seq: 0 });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'bad save', detail: 'seq must be 1 or more' });
		expect(browser.cookie).toBeNull();
		expect(await userRow(name)).toBeUndefined();
		expect((await browser.register(name)).status).toBe(201);
	});

	it('refuses a name that is taken, whatever its case, spacing or way of writing a letter', async () => {
		const owner = new Browser();
		expect((await owner.register('Åse Marie')).status).toBe(201);
		for (const taken of ['Åse Marie', 'åse marie', 'ÅSE MARIE', '  Åse Marie ', 'Åse Marie']) {
			const res = await new Browser().register(taken);
			expect(res.status, taken).toBe(409);
			expect(await res.json()).toEqual({ error: 'name taken' });
		}
		// The name is kept as the rules give it: trimmed, and NFC.
		const other = new Browser();
		expect((await other.register('  Bjørn Ole  ')).status).toBe(201);
		expect(await other.me()).toEqual({ user: { name: 'Bjørn Ole' } });
	});

	it('of registrations racing for one name, exactly one gets it', async () => {
		const name = freshName();
		const results = await Promise.all(
			Array.from({ length: 6 }, (_, i) => new Browser().register(i % 2 ? name.toLowerCase() : name))
		);
		expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409]);
		expect(
			await db
				.select()
				.from(users)
				.where(sql`lower(${users.name}) = lower(${name})`)
		).toHaveLength(1);
	});

	it('says why a name is refused, with the rule the name broke', async () => {
		const cases: [string, string][] = [
			['', 'empty'],
			['   ', 'empty'],
			['A', 'short'],
			['Abcdefghijklmnopq', 'long'],
			['Pip!', 'chars'],
			// A name as long as a register body allows: refused without being read.
			['Ab'.repeat(400_000), 'long']
		];
		for (const [name, reason] of cases) {
			const res = await new Browser().register(name);
			expect(res.status, name).toBe(400);
			expect(await res.json(), name).toEqual({ error: 'bad name', reason });
		}
	});

	it('says why a password is refused', async () => {
		const short = await new Browser().register(freshName(), 'abc');
		expect(short.status).toBe(400);
		expect(await short.json()).toEqual({ error: 'bad password', reason: 'short' });
		const long = await new Browser().register(freshName(), 'x'.repeat(129));
		expect(long.status).toBe(400);
		expect(await long.json()).toEqual({ error: 'bad password', reason: 'long' });
		expect((await new Browser().register(freshName(), 'x'.repeat(128))).status).toBe(201);
	});

	it('ends the session the browser had before, whoever it belonged to', async () => {
		const { browser, name } = await account();
		const before = browser.cookie!;
		expect((await browser.register(freshName())).status).toBe(201);
		expect(browser.cookie).not.toBe(before);
		expect(await sessionRows(name)).toHaveLength(0);
	});
});

describe('login and logout', () => {
	it('logs a second browser in with the right password, and both stay logged in', async () => {
		const { browser: first, name } = await account();
		const second = new Browser();
		const res = await second.login(name);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ user: { name } });
		expect(second.cookie).not.toBe(first.cookie);
		expect(await first.me()).toEqual({ user: { name } });
		expect(await second.me()).toEqual({ user: { name } });
	});

	it('finds the account whatever the case or way of writing the name, and the password typed on a tablet', async () => {
		const owner = new Browser();
		expect((await owner.register('Søren Å', 'blåbær')).status).toBe(201);
		for (const typed of ['søren å', ' SØREN Å ', 'Søren Å']) {
			const res = await new Browser().login(typed, 'blåbær');
			expect(res.status, typed).toBe(200);
			expect(await res.json()).toEqual({ user: { name: 'Søren Å' } });
		}
	});

	it('answers a wrong password and an unknown name the same way', async () => {
		const { name } = await account();
		const wrong = await new Browser().login(name, 'not it');
		const unknown = await new Browser().login(freshName(), 'secret');
		const tooShort = await new Browser().login(name, 'no');
		const tooLong = await new Browser().login('x'.repeat(150), 'secret');
		for (const res of [wrong, unknown, tooShort, tooLong]) {
			expect(res.status).toBe(401);
			expect(await res.json()).toEqual({ error: 'wrong name or password' });
			expect(res.headers.get('set-cookie')).toBeNull();
		}
		// A body no login needs is refused before anything reads it.
		const huge = await new Browser().login(name, 'x'.repeat(5000));
		expect(huge.status).toBe(413);
	});

	it('logout deletes the session: the old cookie opens nothing any more', async () => {
		const { browser, name } = await account(doc(1));
		const token = browser.cookie!;
		const res = await browser.logout();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(browser.cookie).toBeNull();
		expect(await sessionRows(name)).toHaveLength(0);
		const replay = new Browser();
		replay.cookie = token;
		expect(await replay.me()).toEqual({ user: null });
		expect((await replay.getSave()).status).toBe(401);
	});

	it('logout without a session is fine', async () => {
		const res = await new Browser().logout();
		expect(res.status).toBe(200);
	});

	it('keeps an account to its most recently used sessions, however often it logs in', async () => {
		const { browser, name } = await account();
		const first = browser.cookie!;
		const user = await userRow(name);
		// What a login does after the password check, without a slow hash each time.
		for (let i = 0; i < MAX_SESSIONS_PER_USER - 1; i++) await createSession(db, user!.id);
		expect(await sessionRows(name)).toHaveLength(MAX_SESSIONS_PER_USER);
		expect(await browser.me()).toEqual({ user: { name } });
		const latest = new Browser();
		expect((await latest.login(name)).status).toBe(200);
		expect(await sessionRows(name)).toHaveLength(MAX_SESSIONS_PER_USER);
		const oldest = new Browser();
		oldest.cookie = first;
		expect(await oldest.me()).toEqual({ user: null });
		expect(await latest.me()).toEqual({ user: { name } });
	});
});

describe('sessions', () => {
	it('me says nobody without a cookie, and clears a cookie that names no session', async () => {
		expect(await new Browser().me()).toEqual({ user: null });
		const forged = new Browser();
		forged.cookie = 'A'.repeat(43);
		const res = await forged.request('GET', '/me');
		expect(await res.json()).toEqual({ user: null });
		expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
		expect(forged.cookie).toBeNull();
	});

	it('an expired session logs nobody in, and its cookie is cleared', async () => {
		const { browser, name } = await account(doc(1));
		const user = await userRow(name);
		await db
			.update(sessions)
			.set({ expiresAt: sql`now() - interval '1 second'` })
			.where(eq(sessions.userId, user!.id));
		const token = browser.cookie!;
		expect((await browser.getSave()).status).toBe(401);
		expect(browser.cookie).toBeNull();
		const again = new Browser();
		again.cookie = token;
		expect(await again.me()).toEqual({ user: null });
		expect((await again.putSave(doc(2))).status).toBe(401);
	});

	it('a session in use slides a year out, in the database and in the cookie', async () => {
		const { browser, name } = await account();
		const user = await userRow(name);
		// Fresh: nothing to move, no cookie sent again.
		const fresh = await browser.request('GET', '/me');
		expect(fresh.headers.get('set-cookie')).toBeNull();
		await db
			.update(sessions)
			.set({ expiresAt: sql`now() + interval '300 days'` })
			.where(eq(sessions.userId, user!.id));
		const res = await browser.request('GET', '/me');
		expect(res.headers.get('set-cookie')).toMatch(new RegExp(`Max-Age=${SESSION_DAYS * 86400}`));
		const [row] = await db
			.select({ days: sql<number>`extract(epoch from (${sessions.expiresAt} - now())) / 86400` })
			.from(sessions)
			.where(eq(sessions.userId, user!.id));
		expect(Number(row!.days)).toBeGreaterThan(SESSION_DAYS - 0.01);
	});
});

describe('the account save', () => {
	it('404 "no save yet" for an account that has none; 401 without a session', async () => {
		const { browser } = await account();
		const res = await browser.getSave();
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'no save yet' });
		expect((await new Browser().getSave()).status).toBe(401);
		expect(await (await new Browser().getSave()).json()).toEqual({ error: 'not logged in' });
		expect((await new Browser().putSave(doc(1))).status).toBe(401);
	});

	it('PUT then GET gives the document back; a higher seq replaces it with no backup', async () => {
		const { browser, name } = await account();
		expect((await browser.putSave(doc(1))).status).toBe(200);
		const next = doc(2, 'game-a', { tokens: 9 });
		const res = await browser.putSave(next);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(await (await browser.getSave()).json()).toEqual(next);
		const user = await userRow(name);
		expect(
			await db.select().from(accountSaveBackups).where(eq(accountSaveBackups.userId, user!.id))
		).toEqual([]);
	});

	it('409 with the stored save for the same or a lower seq: another device moved ahead', async () => {
		const { browser, name } = await account(doc(5, 'game-a', { tokens: 50 }));
		const other = new Browser();
		await other.login(name);
		for (const seq of [5, 4]) {
			const res = await other.putSave(doc(seq, 'game-a', { tokens: 1 }));
			expect(res.status).toBe(409);
			expect(await res.json()).toEqual({
				error: 'a save with the same or a higher seq is already stored',
				save: doc(5, 'game-a', { tokens: 50 })
			});
		}
		expect(await (await browser.getSave()).json()).toEqual(doc(5, 'game-a', { tokens: 50 }));
	});

	it('another game replaces the save only with a higher seq, and the old game is kept aside', async () => {
		const { browser, name } = await account(doc(8, 'old-game'));
		expect((await browser.putSave(doc(3, 'new-game'))).status).toBe(409);
		expect((await browser.putSave(doc(9, 'new-game'))).status).toBe(200);
		const user = await userRow(name);
		const kept = await db
			.select({ data: accountSaveBackups.data, reason: accountSaveBackups.reason })
			.from(accountSaveBackups)
			.where(eq(accountSaveBackups.userId, user!.id));
		expect(kept).toEqual([{ data: doc(8, 'old-game'), reason: 'replaced' }]);
	});

	it('a stored save this build cannot read is kept aside when a save replaces it', async () => {
		const { browser, name } = await account(doc(1));
		const user = await userRow(name);
		const unreadable = { version: 99, whatever: true, seq: 4 };
		await db
			.update(accountSaves)
			.set({ data: unreadable })
			.where(eq(accountSaves.userId, user!.id));
		// Its seq still counts: the next save must be numbered past it.
		expect((await browser.putSave(doc(4))).status).toBe(409);
		expect((await browser.putSave(doc(5))).status).toBe(200);
		const kept = await db
			.select({ data: accountSaveBackups.data, reason: accountSaveBackups.reason })
			.from(accountSaveBackups)
			.where(eq(accountSaveBackups.userId, user!.id));
		expect(kept).toEqual([{ data: unreadable, reason: 'unreadable' }]);
	});

	it('of many writes racing with the same seq, exactly one lands', async () => {
		const { browser } = await account();
		const results = await Promise.all(
			Array.from({ length: 8 }, (_, i) => browser.putSave(doc(3, 'game-a', { tokens: i })))
		);
		const statuses = results.map((r) => r.status).sort();
		expect(statuses).toEqual([200, 409, 409, 409, 409, 409, 409, 409]);
	});

	it('400 for a body that is not JSON, or a document the engine refuses', async () => {
		const { browser } = await account();
		const notJson = await browser.putSave('{"version":1,');
		expect(notJson.status).toBe(400);
		expect(await notJson.json()).toEqual({ error: 'body is not valid JSON' });
		const refused = await browser.putSave({ ...doc(1), party: 'none' });
		expect(refused.status).toBe(400);
		expect(await refused.json()).toEqual({ error: 'bad save', detail: 'party must be a list' });
		const noSeq = await browser.putSave({ ...doc(1), seq: undefined });
		expect(noSeq.status).toBe(400);
		expect((await browser.getSave()).status).toBe(404);
	});

	it('413 for a save over the size cap, with and without Content-Length, and at register', async () => {
		const { browser } = await account();
		const body = JSON.stringify(doc(1, 'game-a', { notes: 'x'.repeat(SAVE_MAX_BYTES) }));
		const declared = await browser.putSave(body, { 'content-length': String(body.length) });
		expect(declared.status).toBe(413);
		expect((await browser.putSave(body)).status).toBe(413);
		expect((await browser.getSave()).status).toBe(404);
		const name = freshName();
		const huge = new Browser();
		const res = await huge.register(name, 'secret', JSON.parse(body));
		expect(res.status).toBe(413);
		expect(await userRow(name)).toBeUndefined();
	});
});

describe('what a request must be', () => {
	it('415 for a POST or PUT that is not declared JSON', async () => {
		const { browser } = await account();
		for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
			const res = await new Browser().request(
				'POST',
				'/register',
				JSON.stringify({ name: freshName(), password: 'secret' }),
				{ 'content-type': type }
			);
			expect(res.status, type).toBe(415);
			expect(await res.json()).toEqual({ error: 'send JSON' });
		}
		const put = await browser.putSave(JSON.stringify(doc(1)), { 'content-type': 'text/plain' });
		expect(put.status).toBe(415);
		expect((await browser.getSave()).status).toBe(404);
		const charset = await new Browser().request(
			'POST',
			'/register',
			JSON.stringify({ name: freshName(), password: 'secret' }),
			{ 'content-type': 'application/json; charset=utf-8' }
		);
		expect(charset.status).toBe(201);
	});

	it('403 for a POST or PUT from a page of another site; same-site and origin-less requests pass', async () => {
		const site = { host: 'animath.example' };
		const foreign = new Browser(app, { ...site, origin: 'https://evil.example' });
		expect((await foreign.register(freshName())).status).toBe(403);
		const nullOrigin = new Browser(app, { ...site, origin: 'null' });
		expect((await nullOrigin.register(freshName())).status).toBe(403);
		const lookalike = new Browser(app, { ...site, origin: 'https://animath.example.evil.example' });
		expect((await lookalike.register(freshName())).status).toBe(403);
		const same = new Browser(app, { ...site, origin: 'https://animath.example' });
		expect((await same.register(freshName())).status).toBe(201);
		// Behind a proxy that rewrote Host but said where the browser went.
		const proxied = new Browser(app, {
			host: 'localhost:3000',
			'x-forwarded-host': 'localhost:5180',
			origin: 'http://localhost:5180'
		});
		expect((await proxied.register(freshName())).status).toBe(201);
		expect((await new Browser(app, site).register(freshName())).status).toBe(201);
		// A logged-in browser's PUT from another site's page changes nothing.
		const { browser } = await account();
		const attack = await browser.putSave(doc(1), { ...site, origin: 'https://evil.example' });
		expect(attack.status).toBe(403);
		expect((await browser.getSave()).status).toBe(404);
	});

	it('400 for a body that is not a name and a password', async () => {
		const bodies: unknown[] = [
			'not json',
			'[]',
			'{}',
			{ name: 'Pip' },
			{ name: 5, password: 'secret' },
			{ name: 'Pip', password: null }
		];
		for (const body of bodies) {
			for (const path of ['/register', '/login']) {
				const res = await new Browser().request(
					'POST',
					path,
					typeof body === 'string' ? body : JSON.stringify(body)
				);
				expect(res.status, `${path} ${JSON.stringify(body)}`).toBe(400);
			}
		}
	});
});

describe('the anonymous backup', () => {
	it('works in development', async () => {
		const res = await createApp({ production: false, limits: NO_LIMITS }).request('/api/players', {
			method: 'POST'
		});
		expect(res.status).toBe(201);
	});

	it('is off in production, where session cookies are Secure', async () => {
		const prod = createApp({ production: true, limits: NO_LIMITS });
		for (const [method, path] of [
			['POST', '/api/players'],
			['GET', '/api/players/00000000-0000-0000-0000-000000000000/save'],
			['PUT', '/api/players/00000000-0000-0000-0000-000000000000/save']
		] as const) {
			const res = await prod.request(path, { method });
			expect(res.status, `${method} ${path}`).toBe(410);
			expect(await res.json()).toEqual({ error: 'the backup is off here' });
		}
		const res = await new Browser(prod).register(freshName());
		expect(res.status).toBe(201);
		expect(res.headers.get('set-cookie')).toMatch(/; Secure/);
	});
});

describe('sessionUser, for code outside these routes (the WebSocket upgrade)', () => {
	it('names the account of the session cookie, and nobody otherwise', async () => {
		const { browser, name } = await account();
		const token = browser.cookie!;
		const id = (await userRow(name))!.id;
		const probe = new Hono().get('/who', async (c) => c.json(await sessionUser(c)));
		const who = async (cookie?: string) =>
			(await probe.request('/who', { headers: cookie ? { cookie } : {} })).json();
		expect(await who(`other=1; ${SESSION_COOKIE}=${token}`)).toEqual({ id, name });
		expect(await who()).toBeNull();
		expect(await who(`${SESSION_COOKIE}=nope`)).toBeNull();
		expect(await sessionUserFromCookieHeader(`a=b; ${SESSION_COOKIE}=${token}`)).toEqual({
			id,
			name
		});
		expect(await sessionUserFromCookieHeader(undefined)).toBeNull();
		await browser.logout();
		expect(await who(`${SESSION_COOKIE}=${token}`)).toBeNull();
		expect(await sessionUserFromCookieHeader(`${SESSION_COOKIE}=${token}`)).toBeNull();
	});
});

describe('rate limits', () => {
	const TIGHT: AccountLimits = {
		loginPerIp: { limit: 6, windowMs: 60_000, maxKeys: 100 },
		loginFailuresPerName: { limit: 3, windowMs: 60_000, maxKeys: 100 },
		registerPerIp: { limit: 4, windowMs: 60_000, maxKeys: 100 },
		registerPerName: { limit: 2, windowMs: 60_000, maxKeys: 100 }
	};
	let address = 0;
	/** A browser at an address no other browser in these tests has. */
	function from(
		target: ReturnType<typeof createApp>,
		ip = `10.9.${address >> 8}.${address++ & 255}`
	) {
		return new Browser(target, { 'x-forwarded-for': ip });
	}

	it('blocks a name after three wrong passwords, from any address, even with the right one', async () => {
		const limited = createApp({ limits: TIGHT });
		const { name } = await account();
		for (let i = 0; i < 3; i++) expect((await from(limited).login(name, 'wrong')).status).toBe(401);
		for (const typed of [name, name.toUpperCase()]) {
			const blocked = await from(limited).login(typed, 'secret');
			expect(blocked.status).toBe(429);
			const retryAfter = Number(blocked.headers.get('retry-after'));
			expect(retryAfter).toBeGreaterThanOrEqual(1);
			expect(retryAfter).toBeLessThanOrEqual(60);
			expect(await blocked.json()).toEqual({ error: 'too many tries', retryAfter });
		}
		const other = await account();
		expect((await from(limited).login(other.name)).status).toBe(200);
	});

	it('counts no right password against its name', async () => {
		const limited = createApp({ limits: TIGHT });
		const { name } = await account();
		for (let i = 0; i < 5; i++) expect((await from(limited).login(name)).status).toBe(200);
		expect((await from(limited).login(name, 'wrong')).status).toBe(401);
	});

	it('of wrong passwords racing each other, no more than the limit are tried', async () => {
		const limited = createApp({ limits: TIGHT });
		const { name } = await account();
		const results = await Promise.all(
			Array.from({ length: 8 }, () => from(limited).login(name, 'wrong'))
		);
		const statuses = results.map((r) => r.status).sort();
		expect(statuses).toEqual([401, 401, 401, 429, 429, 429, 429, 429]);
	});

	it('blocks an address after six login tries, whatever the names; other addresses go on', async () => {
		const limited = createApp({ limits: TIGHT });
		const { name } = await account();
		const ip = '10.8.0.1';
		for (let i = 0; i < 6; i++) {
			expect((await from(limited, ip).login(freshName(), 'wrong')).status).toBe(401);
		}
		expect((await from(limited, ip).login(name)).status).toBe(429);
		expect((await from(limited).login(name)).status).toBe(200);
	});

	it('reads the address a proxy of ours saw: the last X-Forwarded-For entry', async () => {
		const limited = createApp({ limits: TIGHT });
		for (let i = 0; i < 6; i++) {
			const res = await from(limited, `spoof-${i}, 10.8.0.2`).login(freshName(), 'wrong');
			expect(res.status).toBe(401);
		}
		expect((await from(limited, 'another-spoof, 10.8.0.2').login(freshName())).status).toBe(429);
	});

	it('blocks an address after four registrations, and a name after two tries', async () => {
		const limited = createApp({ limits: TIGHT });
		const ip = '10.8.0.3';
		for (let i = 0; i < 4; i++)
			expect((await from(limited, ip).register(freshName())).status).toBe(201);
		expect((await from(limited, ip).register(freshName())).status).toBe(429);
		const name = freshName();
		expect((await from(limited).register(name)).status).toBe(201);
		expect((await from(limited).register(name.toLowerCase())).status).toBe(409);
		expect((await from(limited).register(name)).status).toBe(429);
	});
});
