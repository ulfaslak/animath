import { nameKey } from '@mathgame/engine';
import { eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { AdminError, exportLocalSave, importSave, listAll, resetPassword } from '../src/admin.js';
import { createApp, hideWelcomeTokens } from '../src/app.js';
import { db, pool } from '../src/db/index.js';
import { accountSaves, players, saves, sessions, users, welcomeTokens } from '../src/db/schema.js';
import { NO_PASSWORD } from '../src/passwords.js';
import type { AccountLimits } from '../src/rate-limit.js';
import { findSaves, openReadOnly, type Reader } from '../src/save-export.js';
import { SESSION_COOKIE } from '../src/sessions.js';
import { WELCOME_DAYS } from '../src/welcome.js';

// Welcome links, end to end against the test database: `import-save` makes
// an account with no password and a link, the link's routes pick the
// password and log in once, and `export-local-save` reads a kid's newest
// save out of a database without writing a thing.

afterAll(() => pool.end());

// A welcome and a login each hash a password with scrypt at its real cost:
// about 150 ms at a load average of 14 (2026-09-27), several times that under
// other worktrees' browsers. The race below hashes eight at once.
vi.setConfig({ testTimeout: 30_000 });

const ROOMY = { limit: 100_000, windowMs: 60_000, maxKeys: 100_000 };
const NO_LIMITS: AccountLimits = {
	loginPerIp: ROOMY,
	loginFailuresPerNameFromIp: ROOMY,
	loginFailuresPerName: ROOMY,
	registerPerIp: ROOMY,
	registerPerName: ROOMY,
	savesPerAccount: ROOMY,
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
		version: 2,
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
	constructor(readonly headers: Record<string, string> = {}) {}

	async request(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
		const headers: Record<string, string> = { ...this.headers, ...extra };
		if (body !== undefined && !('content-type' in headers)) {
			headers['content-type'] = 'application/json';
		}
		if (this.cookie) headers.cookie = `${SESSION_COOKIE}=${this.cookie}`;
		const res = await app.request(`/api/account${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const set = res.headers.get('set-cookie');
		if (set) {
			const value = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(set)?.[1] ?? '';
			this.cookie = /Max-Age=0/i.test(set) || value === '' ? null : value;
		}
		return res;
	}
	look(token: string) {
		return this.request('GET', `/welcome/${encodeURIComponent(token)}`);
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
	const link = lines.at(-1)!;
	const token = new URL(link).searchParams.get('welcome')!;
	return { name, token, lines };
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
			'4 animals (whale, frog ×2, rabbit "nini"), 6 tokens, axe, boat, pickaxe'
		);
		expect(lines.at(-1)).toBe(`http://localhost:5199/?welcome=${token}`);
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
		expect(saved?.data).toMatchObject({ version: 2, world: 1, home: 1, name });
	});

	it('links to https://<MATHGAME_DOMAIN>, and refuses before anything is made when it has no address', async () => {
		const name = freshName();
		const lines = await importSave(JSON.stringify(doc(name)), { domain: 'animath.test' });
		expect(lines.at(-1)).toMatch(/^https:\/\/animath\.test\/\?welcome=[A-Za-z0-9_-]{43}$/);
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
			JSON.stringify(doc(name, { version: 3 })),
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

	it('sets the password, logs in with the session cookie, returns the save, and works only once', async () => {
		const { name, token } = await imported();
		const kid = new Browser();
		const res = await kid.welcome(token);
		expect(res.status).toBe(200);
		expect(await res.json()).toStrictEqual({ user: { name }, save: doc(name) });
		expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
		expect(await (await kid.request('GET', '/me')).json()).toEqual({ user: { name } });
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
				method === 'GET' ? `/api/account/welcome/${token}` : '/api/account/welcome',
				method === 'GET'
					? { headers: { 'x-forwarded-for': ip } }
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

describe('export-local-save', () => {
	const folders: string[] = [];
	afterAll(() => {
		for (const folder of folders) rmSync(folder, { recursive: true, force: true });
	});
	function folder(): string {
		const made = mkdtempSync(join(tmpdir(), 'animath-export-test-'));
		folders.push(made);
		return made;
	}

	/** A player of the anonymous backup, with `save` stored at `savedAt`. */
	async function player(save: unknown, savedAt = new Date(Date.now() - 60_000)): Promise<string> {
		const [row] = await db
			.insert(players)
			.values({ secretHash: 'x' })
			.returning({ id: players.id });
		await db.insert(saves).values({ playerId: row!.id, data: save, updatedAt: savedAt });
		return row!.id;
	}

	/** An account holding `save`, saved at `savedAt`. */
	async function accountWith(name: string, save: Record<string, unknown>, savedAt: Date) {
		const [row] = await db
			.insert(users)
			.values({ name, nameKey: nameKey(name), passwordHash: NO_PASSWORD })
			.returning({ id: users.id });
		await db
			.insert(accountSaves)
			.values({ userId: row!.id, data: save, seq: save.seq as number, updatedAt: savedAt });
	}

	it('writes the anonymous backup’s save, as stored, to a file only its owner reads, and says what it holds', async () => {
		const name = freshName();
		const id = await player(doc(name));
		const into = folder();
		const lines = await exportLocalSave(id, {
			folder: into,
			now: new Date('2026-09-27T13:00:00Z')
		});
		expect(lines[0]).toMatch(/^Found the anonymous backup: seq 24614, saved \d{4}-.* UTC\.$/);
		const file = join(into, `${name}-20260927T130000Z.json`);
		const summary = lines.at(-1)!;
		expect(summary).toMatch(
			new RegExp(
				`^${name}: 4 animals \\(whale, frog ×2, rabbit "nini"\\), 6 tokens, axe, boat, pickaxe, World 1 at -40,-1000, seq 24614, saved \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d UTC → `
			)
		);
		expect(summary.endsWith(` → ${file}`)).toBe(true);
		expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(doc(name));
		expect(statSync(file).mode & 0o777).toBe(0o600);
		// Never over a file that is there.
		await expect(
			exportLocalSave(id, { folder: into, now: new Date('2026-09-27T13:00:00Z') })
		).rejects.toThrow(/is there already/);
	});

	it('lists the account that holds the game too, takes the one saved last, or the one --from names', async () => {
		const name = freshName();
		const id = await player(doc(name), new Date(Date.now() - 120_000));
		await accountWith(name, doc(name, { seq: 24700 }), new Date(Date.now() - 60_000));
		const into = folder();
		const lines = await exportLocalSave(id, { folder: into });
		expect(lines.slice(0, 2).map((l) => l.replace(/, saved .*/, ''))).toEqual([
			'Found the anonymous backup: seq 24614',
			`Found the account "${name}": seq 24700`
		]);
		expect(lines).toContain(`Taking the account "${name}", the one saved last.`);
		expect(lines.at(-1)).toContain('seq 24700');
		const older = await exportLocalSave(id, { folder: folder(), from: 'anonymous' });
		expect(older).toContain('Taking the anonymous backup, as --from says.');
		expect(older.at(-1)).toContain('seq 24614');
	});

	it('finds an account holding the same game under another name, and says when the two are different games', async () => {
		// The kid changed the name in the box as the account was made: the game is the same.
		const name = freshName();
		const id = await player(doc(name), new Date(Date.now() - 120_000));
		const renamed = freshName();
		await accountWith(
			renamed,
			doc(renamed, { lineage: `lineage-${name}`, seq: 24650 }),
			new Date()
		);
		const lines = await exportLocalSave(id, { folder: folder() });
		expect(lines).toContain(`Taking the account "${renamed}", the one saved last.`);
		expect(lines.join('\n')).not.toContain('different games');
		// The account under the kid's name holds a new game: both are listed, and the admin told.
		const other = freshName();
		const id2 = await player(doc(other), new Date(Date.now() - 120_000));
		await accountWith(other, doc(other, { lineage: 'a new game', seq: 3 }), new Date());
		const two = await exportLocalSave(id2, { folder: folder() });
		expect(two.filter((l) => l.startsWith('Found'))).toHaveLength(2);
		expect(two.join('\n')).toContain('These are different games');
		// A game of someone else's, under another name, is not this player's.
		const third = freshName();
		const id3 = await player(doc(third), new Date(Date.now() - 120_000));
		await accountWith(freshName(), doc(third, { lineage: 'someone else' }), new Date());
		const alone = await exportLocalSave(id3, { folder: folder() });
		expect(alone.filter((l) => l.startsWith('Found'))).toHaveLength(1);
	});

	it('refuses a folder inside a repository, a player it has no save for, and what is not a player id', async () => {
		const id = await player(doc(freshName()));
		const repo = fileURLToPath(new URL('../', import.meta.url));
		await expect(exportLocalSave(id, { folder: join(repo, 'exports') })).rejects.toThrow(
			/inside the repository/
		);
		await expect(
			exportLocalSave('00000000-0000-4000-8000-000000000000', { folder: folder() })
		).rejects.toThrow(/no save for the player/);
		await expect(exportLocalSave('not-a-uuid', { folder: folder() })).rejects.toThrow(
			/not a player id/
		);
		await expect(exportLocalSave(id, { folder: folder(), from: 'account' })).rejects.toThrow(
			/No account here holds this game/
		);
	});

	it('reads through a session that cannot write, and asks it nothing but reads', async () => {
		const url = process.env.DATABASE_URL!;
		const session = await openReadOnly(url);
		try {
			expect(await session.rows('show default_transaction_read_only')).toEqual([
				{ default_transaction_read_only: 'on' }
			]);
			await expect(session.rows("insert into players (secret_hash) values ('x')")).rejects.toThrow(
				/read-only transaction/
			);
			const asked: string[] = [];
			const recording: Reader = {
				rows: (text, params) => {
					asked.push(text.trim().split(/\s+/)[0]!.toLowerCase());
					return session.rows(text, params);
				}
			};
			const name = freshName();
			const id = await player(doc(name));
			await accountWith(name, doc(name, { seq: 24615 }), new Date());
			expect(await findSaves(recording, id)).toHaveLength(2);
			expect(new Set(asked)).toEqual(new Set(['select']));
		} finally {
			await session.end();
		}
	});

	it('finds only the anonymous backup in a database from before accounts', async () => {
		const name = freshName();
		const asked: string[] = [];
		const noAccounts: Reader = {
			rows: async (text) => {
				asked.push(text);
				if (text.includes('from saves')) return [{ data: doc(name), updated_at: new Date() }];
				if (text.includes('to_regclass')) return [{ accounts: false }];
				throw new Error(`unexpected: ${text}`);
			}
		};
		const found = await findSaves(noAccounts, '00000000-0000-4000-8000-000000000001');
		expect(found.map((c) => c.place)).toEqual(['anonymous']);
		expect(asked).toHaveLength(2);
	});
});
