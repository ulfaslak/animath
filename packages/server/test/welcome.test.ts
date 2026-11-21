import { SAVE_VERSION, nameKey } from '@mathgame/engine';
import { eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { AdminError, importSave, listAll, resetPassword } from '../src/admin.js';
import { createApp, hideWelcomeTokens } from '../src/app.js';
import { db, pool } from '../src/db/index.js';
import { accountSaves, sessions, users, welcomeTokens } from '../src/db/schema.js';
import { NO_PASSWORD } from '../src/passwords.js';
import type { AccountLimits } from '../src/rate-limit.js';
import { HOME_COOKIE } from '../src/home.js';
import { SESSION_COOKIE } from '../src/sessions.js';
import { WELCOME_DAYS } from '../src/welcome.js';

// Welcome links, end to end against the test database: `import-save` makes
// an account with no password and a link, the link's routes pick the
// password and log in once.

afterAll(() => pool.end());

// A welcome and a login each hash a password with scrypt at its real cost:
// about 150 ms at a load average of 14 (2026-09-27), several times that under
// other worktrees' browsers. The race below hashes eight at once. Up to 1.1 s
// alone at a load average of 12 to 30 and 2.2 s in the whole suite at 28
// (2026-09-28), and up to ten times its run alone at 150.
vi.setConfig({ testTimeout: 60_000 });

const ROOMY = { limit: 100_000, windowMs: 60_000, maxKeys: 100_000 };
const NO_LIMITS: AccountLimits = {
	loginPerIp: ROOMY,
	loginFailuresPerNameFromIp: ROOMY,
	loginFailuresPerName: ROOMY,
	registerPerIp: ROOMY,
	registerPerName: ROOMY,
	savesPerAccount: ROOMY,
	renamesPerAccount: ROOMY,
	welcomePerIp: ROOMY
};
const app = createApp({ limits: NO_LIMITS });

let counter = 0;
/** A name no other test uses. */
function freshName(): string {
	counter++;
	return `Wel${process.pid % 1000}x${counter}`;
}

function doc(name: string | undefined, overrides: Record<string, unknown> = {}) {
	return {
		version: SAVE_VERSION,
		home: 1,
		world: 1,
		pos: { x: -40, y: -1000 },
		facing: 'left',
		steps: 7471,
		visits: 41,
		lineage: `lineage-${name ?? 'none'}`,
		seq: 24614,
		tokens: 6,
		items: ['axe', 'boat', 'pickaxe'],
		party: [
			{ id: 'w', speciesId: 'whale', hp: 2 },
			{ id: 'f1', speciesId: 'frog', hp: 21 },
			{ id: 'f2', speciesId: 'frog', hp: 21 },
			{ id: 'n', speciesId: 'rabbit', hp: 13, nickname: 'nini' }
		],
		...(name === undefined ? {} : { name }),
		...overrides
	};
}

/** A browser with one cookie jar, as in account.test.ts. */
class Browser {
	cookie: string | null = null;
	/** The home cookie's key (`home.ts`). */
	home: string | null = null;
	constructor(readonly headers: Record<string, string> = {}) {}

	async request(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
		const headers: Record<string, string> = { ...this.headers, ...extra };
		if (body !== undefined && !('content-type' in headers)) {
			headers['content-type'] = 'application/json';
		}
		const jar = [
			...(this.cookie ? [`${SESSION_COOKIE}=${this.cookie}`] : []),
			...(this.home ? [`${HOME_COOKIE}=${this.home}`] : [])
		];
		if (jar.length > 0) headers.cookie = jar.join('; ');
		const res = await app.request(`/api/account${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		for (const set of res.headers.getSetCookie()) {
			const value = /^[^=]*=([^;]*)/.exec(set)?.[1] ?? '';
			const kept = /Max-Age=0/i.test(set) || value === '' ? null : value;
			if (set.startsWith(`${SESSION_COOKIE}=`)) this.cookie = kept;
			else if (set.startsWith(`${HOME_COOKIE}=`)) this.home = kept;
		}
		return res;
	}
	/** The page's lookup: the token in a header, never in the path. */
	look(token: string) {
		return this.request('GET', '/welcome', undefined, { 'x-animath-welcome': token });
	}
	welcome(token: string, password = 'blåbær') {
		return this.request('POST', '/welcome', { token, password });
	}
}

/** Imports a save under a fresh name, and returns the name and the link's token. */
async function imported(
	name = freshName(),
	save: unknown = doc(name)
): Promise<{ name: string; token: string; lines: string[] }> {
	const lines = await importSave(JSON.stringify(save), { origin: 'http://localhost:5199' });
	// The token rides after `#`, which a browser never sends: no request line holds it.
	const link = new URL(lines.at(-1)!);
	expect(link.search).toBe('');
	const token = /^#welcome=([A-Za-z0-9_-]{43})$/.exec(link.hash)?.[1];
	expect(token).toBeDefined();
	return { name, token: token!, lines };
}

async function userOf(name: string) {
	const [row] = await db
		.select()
		.from(users)
		.where(eq(users.nameKey, nameKey(name)));
	return row;
}

describe('import-save', () => {
	it('makes the account with no password, the save with its name on it, and a link stored only as a hash', async () => {
		const name = freshName();
		const { token, lines } = await imported(name);
		expect(lines[0]).toContain(`Made the account ${name}, with no password yet`);
		expect(lines[0]).toContain(
			'in nordland 4 animals (whale, frog ×2, rabbit "nini"), 6 tokens, axe, boat, pickaxe'
		);
		expect(lines.at(-1)).toBe(`http://localhost:5199/#welcome=${token}`);
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const user = await userOf(name);
		expect(user?.passwordHash).toBe(NO_PASSWORD);
		const [saved] = await db.select().from(accountSaves).where(eq(accountSaves.userId, user!.id));
		expect(saved?.data).toEqual(doc(name));
		expect(saved?.seq).toBe(24614);
		const links = await db.select().from(welcomeTokens).where(eq(welcomeTokens.userId, user!.id));
		expect(links).toHaveLength(1);
		expect(links[0]!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
		expect(JSON.stringify(links)).not.toContain(token);
		const [{ days }] = (
			await db.execute(
				sql`select extract(epoch from expires_at - created_at) / 86400 as days from welcome_tokens where user_id = ${user!.id}`
			)
		).rows as [{ days: string }];
		expect(Number(days)).toBeCloseTo(WELCOME_DAYS, 3);
	});

	it('names the account and the character with --name, and upgrades a save from before numbered worlds', async () => {
		const name = freshName();
		const v1 = { ...doc('Old name'), version: 1, seed: 821322741 } as Record<string, unknown>;
		delete v1.home;
		delete v1.world;
		delete v1.name;
		await importSave(JSON.stringify(v1), { name: `  ${name} `, origin: 'https://game.test' });
		const user = await userOf(name);
		expect(user?.name).toBe(name);
		const [saved] = await db.select().from(accountSaves).where(eq(accountSaves.userId, user!.id));
		expect(saved?.data).toMatchObject({ version: SAVE_VERSION, world: 1, home: 1, name });
		// A name the rules refuse says what a name may be, from the engine's own bounds.
		await expect(
			importSave(JSON.stringify(doc(name)), { name: 'X', origin: 'https://game.test' })
		).rejects.toThrow(/\(short\): 2 to 16 letters or numbers, /);
	});

	it('links to https://<MATHGAME_DOMAIN>, and refuses before anything is made when it has no address', async () => {
		const name = freshName();
		const lines = await importSave(JSON.stringify(doc(name)), { domain: 'animath.test' });
		expect(lines.at(-1)).toMatch(/^https:\/\/animath\.test\/#welcome=[A-Za-z0-9_-]{43}$/);
		for (const options of [{}, { domain: 'animath.test/x' }, { origin: 'ftp://x.test' }]) {
			const other = freshName();
			await expect(importSave(JSON.stringify(doc(other)), options)).rejects.toThrow(AdminError);
			expect(await userOf(other)).toBeUndefined();
		}
	});

	it('refuses what is not a save it can play, and makes nothing', async () => {
		const name = freshName();
		const refused = [
			'not json',
			JSON.stringify(doc(name, { seq: undefined })),
			JSON.stringify(doc(name, { version: SAVE_VERSION + 1 })),
			JSON.stringify(doc(undefined)),
			JSON.stringify(doc('x'))
		];
		for (const text of refused) {
			await expect(importSave(text, { origin: 'https://game.test' }), text).rejects.toThrow(
				AdminError
			);
		}
		expect(await userOf(name)).toBeUndefined();
	});

	it('refuses a save nested deeper than a save can be, however deep, says why, and makes nothing', async () => {
		const name = freshName();
		const save = JSON.stringify(doc(name));
		// Lists, and objects under the key "0" (V8's `JSON.stringify` throws on those), as text.
		const levels = 100_000;
		const deeps = [
			'['.repeat(levels) + ']'.repeat(levels),
			'{"0":'.repeat(levels) + '{}' + '}'.repeat(levels)
		];
		for (const deep of deeps) {
			const text = `${save.slice(0, -1)},"deep":${deep}}`;
			const refused = await importSave(text, { origin: 'https://game.test' }).then(
				() => null,
				(error: unknown) => error
			);
			expect(refused).toBeInstanceOf(AdminError);
			expect((refused as Error).message).toMatch(
				/^This is not a save the game can play: deep\S* is nested more than 64 levels deep\.$/
			);
		}
		expect(await userOf(name)).toBeUndefined();
	});

	it('refuses a taken name, says how to pick another, and says when it is an earlier import still waiting', async () => {
		const { name } = await imported();
		const again = importSave(JSON.stringify(doc(name.toUpperCase())), { origin: 'https://g.test' });
		await expect(again).rejects.toThrow(/already called "Wel.*--name <name>.*no password yet/);
		const other = freshName();
		await importSave(JSON.stringify(doc(other)), { origin: 'https://g.test' });
		await expect(
			importSave(JSON.stringify(doc(other)), { origin: 'https://g.test' })
		).rejects.toThrow(/already called/);
	});

	it('refuses a name an account had before the kid picked a new one, and says which account keeps it', async () => {
		const name = freshName();
		const browser = new Browser();
		expect((await browser.request('POST', '/register', { name, password: 'secret' })).status).toBe(
			201
		);
		const now = freshName();
		const renamed = await browser.request(
			'POST',
			'/name',
			{ name: now },
			{ 'x-animath-account': encodeURIComponent(name) }
		);
		expect(renamed.status).toBe(200);
		await expect(
			importSave(JSON.stringify(doc(name.toLowerCase())), { origin: 'https://g.test' })
		).rejects.toThrow(`was the name of the account called "${now}" now, and stays that account's`);
		expect(await userOf(name)).toBeUndefined();
	});
});

describe('the welcome link', () => {
	it('names its account, and nothing else, and sends no cookie', async () => {
		const { name, token } = await imported();
		const res = await new Browser().look(token);
		expect(res.status).toBe(200);
		expect(await res.json()).toStrictEqual({ name });
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(res.headers.get('set-cookie')).toBeNull();
	});

	it('is asked with its token in a header, so no request line, and no log of one, holds it', async () => {
		const { token } = await imported();
		// The token in the path is no route: a request line with it would land in nginx's error log
		// whenever the app does not answer.
		const inPath = await new Browser().request('GET', `/welcome/${token}`);
		expect(inPath.status).toBe(404);
		expect(await inPath.json()).toEqual({ error: 'not found' });
		const bare = await new Browser().request('GET', '/welcome');
		expect(bare.status).toBe(400);
		expect((await new Browser().look(token)).status).toBe(200);
	});

	it('sets the password, logs in with the session cookie, returns the save, and works only once', async () => {
		const { name, token } = await imported();
		const kid = new Browser();
		const res = await kid.welcome(token);
		expect(res.status).toBe(200);
		expect(await res.json()).toStrictEqual({ user: { name }, save: doc(name) });
		expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
		// The browser the link was used in is the account's own.
		expect(await (await kid.request('GET', '/me')).json()).toEqual({ user: { name, home: true } });
		const saved = await kid.request('GET', '/save', undefined, {
			'x-animath-account': encodeURIComponent(name)
		});
		expect(await saved.json()).toEqual(doc(name));
		// The password works from anywhere.
		expect(
			(await new Browser().request('POST', '/login', { name, password: 'blåbær' })).status
		).toBe(200);
		// And the link is spent: said, and nothing more.
		const second = new Browser();
		const look = await second.look(token);
		expect(look.status).toBe(410);
		expect(await look.json()).toStrictEqual({ error: 'link used' });
		const use = await second.welcome(token, 'another');
		expect(use.status).toBe(410);
		expect(await use.json()).toStrictEqual({ error: 'link used' });
		expect(second.cookie).toBeNull();
		expect(
			(await new Browser().request('POST', '/login', { name, password: 'another' })).status
		).toBe(401);
	});

	it('a password the rules refuse leaves the link as it was', async () => {
		const { token } = await imported();
		const res = await new Browser().welcome(token, 'ab');
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'bad password', reason: 'short' });
		expect((await new Browser().look(token)).status).toBe(200);
	});

	it('an expired link says so, and logs nobody in', async () => {
		const { name, token } = await imported();
		const user = await userOf(name);
		await db
			.update(welcomeTokens)
			.set({ expiresAt: sql`now() - interval '1 second'` })
			.where(eq(welcomeTokens.userId, user!.id));
		for (const res of [await new Browser().look(token), await new Browser().welcome(token)]) {
			expect(res.status).toBe(410);
			expect(await res.json()).toStrictEqual({ error: 'link expired' });
		}
		expect((await userOf(name))?.passwordHash).toBe(NO_PASSWORD);
	});

	it('a token that is no link’s, or not a token at all, is a 404 either way', async () => {
		for (const token of ['A'.repeat(43), 'short', 'with space', '%E0%A4%A']) {
			for (const res of [await new Browser().look(token), await new Browser().welcome(token)]) {
				expect(res.status, token).toBe(404);
				expect(await res.json()).toStrictEqual({ error: 'no such link' });
			}
		}
		const malformed = await new Browser().request('POST', '/welcome', {
			token: 5,
			password: 'abcd'
		});
		expect(malformed.status).toBe(400);
	});

	it('a body nested as deep as its 4 KiB allows is a 400, or a 404 for no link, never a 500', async () => {
		// Nothing walks the body: only its token and password are read.
		const deep = '['.repeat(1900) + ']'.repeat(1900);
		const post = (body: string) =>
			app.request('/api/account/welcome', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body
			});
		for (const body of [
			`{"token":${deep},"password":"blåbær"}`,
			`{"token":"${'A'.repeat(43)}","password":${deep}}`
		]) {
			const res = await post(body);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ error: 'send the link and a password' });
		}
		const noLink = await post(`{"token":"${'A'.repeat(43)}","password":"blåbær","deep":${deep}}`);
		expect(noLink.status).toBe(404);
		expect(await noLink.json()).toEqual({ error: 'no such link' });
	});

	it('of eight uses racing each other, exactly one logs in', async () => {
		const { name, token } = await imported();
		const results = await Promise.all(
			Array.from({ length: 8 }, (_, i) => new Browser().welcome(token, `password-${i}`))
		);
		expect(results.map((r) => r.status).sort()).toEqual([200, 410, 410, 410, 410, 410, 410, 410]);
		const user = await userOf(name);
		const rows = await db.select().from(sessions).where(eq(sessions.userId, user!.id));
		expect(rows).toHaveLength(1);
	});

	it('an account waiting for its link cannot be logged in to', async () => {
		const { name } = await imported();
		const res = await new Browser().request('POST', '/login', { name, password: NO_PASSWORD });
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: 'wrong name or password' });
	});

	it('ends the session the browser had, as a login does', async () => {
		const first = await imported();
		const kid = new Browser();
		await kid.welcome(first.token);
		const old = kid.cookie;
		const second = await imported();
		await kid.welcome(second.token);
		expect(kid.cookie).not.toBe(old);
		const rows = await db
			.select()
			.from(sessions)
			.where(eq(sessions.tokenHash, createHash('sha256').update(old!).digest('hex')));
		expect(rows).toEqual([]);
	});

	it('a password the admin sets uses the link up, and deleting the account takes the link with it', async () => {
		const reset = await imported();
		const said = await resetPassword(reset.name, 'grown-up');
		expect(said).toContain('Its welcome link no longer works.');
		expect(await (await new Browser().look(reset.token)).json()).toEqual({ error: 'link used' });
		expect((await new Browser().welcome(reset.token)).status).toBe(410);
		const gone = await imported();
		await db.delete(users).where(eq(users.nameKey, nameKey(gone.name)));
		expect((await new Browser().look(gone.token)).status).toBe(404);
	});

	it('comes only from a page of this site, as JSON', async () => {
		const { token } = await imported();
		const elsewhere = await new Browser({ origin: 'https://evil.test', host: 'game.test' }).welcome(
			token
		);
		expect(elsewhere.status).toBe(403);
		const form = await new Browser().request(
			'POST',
			'/welcome',
			{ token, password: 'abcd' },
			{
				'content-type': 'text/plain'
			}
		);
		expect(form.status).toBe(415);
		expect((await new Browser().look(token)).status).toBe(200);
	});

	it('is limited per address, looks and uses together', async () => {
		const limited = createApp({
			limits: { ...NO_LIMITS, welcomePerIp: { limit: 3, windowMs: 60_000, maxKeys: 100 } }
		});
		const { token } = await imported();
		const ask = (ip: string, method: string) =>
			limited.request(
				'/api/account/welcome',
				method === 'GET'
					? { headers: { 'x-forwarded-for': ip, 'x-animath-welcome': token } }
					: {
							method: 'POST',
							headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
							body: JSON.stringify({ token, password: 'ab' })
						}
			);
		expect((await ask('10.6.0.1', 'GET')).status).toBe(200);
		expect((await ask('10.6.0.1', 'POST')).status).toBe(400);
		expect((await ask('10.6.0.1', 'GET')).status).toBe(200);
		const stopped = await ask('10.6.0.1', 'GET');
		expect(stopped.status).toBe(429);
		expect(stopped.headers.get('retry-after')).not.toBeNull();
		expect((await ask('10.6.0.2', 'GET')).status).toBe(200);
	});

	it('the admin’s list says which accounts still wait for their link', async () => {
		const waiting = await imported();
		const welcomed = await imported();
		await new Browser().welcome(welcomed.token);
		const lines = await listAll();
		expect(lines.find((l) => l.startsWith(`${waiting.name}\t`))).toContain('no password yet');
		expect(lines.find((l) => l.startsWith(`${welcomed.name}\t`))).not.toContain('no password');
	});
});

describe('the request log', () => {
	it('keeps a welcome link’s token out, in the page’s address and in the API’s path', () => {
		const token = 'Ab0_-'.repeat(8) + 'xyz';
		expect(hideWelcomeTokens(`<-- GET /?welcome=${token}`)).toBe('<-- GET /?welcome=[hidden]');
		expect(hideWelcomeTokens(`--> GET /?lang=da&welcome=${token}&x=1 200 3ms`)).toBe(
			'--> GET /?lang=da&welcome=[hidden]&x=1 200 3ms'
		);
		expect(hideWelcomeTokens(`--> GET /api/account/welcome/${token} 200 12ms`)).toBe(
			'--> GET /api/account/welcome/[hidden] 200 12ms'
		);
		for (const line of ['--> POST /api/account/welcome 200 90ms', '<-- GET /api/account/me']) {
			expect(hideWelcomeTokens(line)).toBe(line);
		}
	});
});
