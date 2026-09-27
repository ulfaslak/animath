import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { AdminError, deleteAccount, easyPassword, listAll, resetPassword } from '../src/admin.js';
import { createApp } from '../src/app.js';
import { db, pool } from '../src/db/index.js';
import { accountSaveBackups, accountSaves, sessions, users } from '../src/db/schema.js';
import { SESSION_COOKIE } from '../src/sessions.js';

// The admin's commands against the test database. Accounts are made through
// the real routes, as a kid would make them.

afterAll(() => pool.end());

// Each register, login and reset hashes a password with scrypt at its real
// cost, about 150 ms at a load average of 14 (2026-09-27); a test here hashes
// up to five times.
vi.setConfig({ testTimeout: 30_000 });

const app = createApp();
let counter = 0;
function freshName(): string {
	counter++;
	return `Adm${process.pid % 1000}x${counter}`;
}

async function post(path: string, body: unknown): Promise<Response> {
	return app.request(`/api/account${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.7.0.${counter & 255}` },
		body: JSON.stringify(body)
	});
}

/** Registers `name`, with a save, and returns its session cookie. */
async function register(name: string, password = 'secret'): Promise<string> {
	const save = {
		version: 1,
		seed: 1,
		pos: { x: 0, y: 0 },
		facing: 'down',
		steps: 3,
		visits: 0,
		lineage: 'g',
		seq: 7,
		party: [{ id: 'a', speciesId: 'rabbit', hp: 5 }]
	};
	const res = await post('/register', { name, password, save });
	expect(res.status).toBe(201);
	return /animath_session=([^;]+)/.exec(res.headers.get('set-cookie')!)![1]!;
}

async function me(token: string): Promise<unknown> {
	const res = await app.request('/api/account/me', {
		headers: { cookie: `${SESSION_COOKIE}=${token}` }
	});
	return res.json();
}

describe('reset-password', () => {
	it('sets the password it is given, and logs every browser out', async () => {
		const name = freshName();
		const token = await register(name, 'forgotten');
		const lines = await resetPassword(name.toUpperCase(), 'new one');
		expect(lines[0]).toBe(`New password for ${name}: new one`);
		expect(await me(token)).toEqual({ user: null });
		expect((await post('/login', { name, password: 'forgotten' })).status).toBe(401);
		expect((await post('/login', { name, password: 'new one' })).status).toBe(200);
	});

	it('makes up an easy password when none is given', async () => {
		const name = freshName();
		await register(name);
		const [line] = await resetPassword(name);
		const password = /: (\S+)$/.exec(line!)![1]!;
		expect(password).toMatch(/^[a-hjkmnp-z2-9]{6}$/);
		expect((await post('/login', { name, password })).status).toBe(200);
	});

	it('refuses a name with no account, and a password the rules refuse, changing nothing', async () => {
		await expect(resetPassword(freshName(), 'whatever')).rejects.toBeInstanceOf(AdminError);
		const name = freshName();
		await register(name);
		await expect(resetPassword(name, 'abc')).rejects.toThrow(/too short/);
		expect((await post('/login', { name, password: 'secret' })).status).toBe(200);
	});

	it('an easy password is six characters from the easy alphabet', () => {
		for (let i = 0; i < 200; i++) expect(easyPassword()).toMatch(/^[a-hjkmnp-z2-9]{6}$/);
	});
});

describe('delete-account', () => {
	it('only says what it would delete without --yes', async () => {
		const name = freshName();
		const token = await register(name);
		const lines = await deleteAccount(name, false);
		expect(lines[0]).toMatch(
			new RegExp(
				`^Would delete ${name}: made .*, save seq 7 from .*, 1 browser\\(s\\) logged in\\.$`
			)
		);
		expect(await me(token)).toEqual({ user: { name } });
	});

	it('with --yes deletes the account, its sessions, its save and its set-aside saves', async () => {
		const name = freshName();
		const token = await register(name);
		const [user] = await db.select().from(users).where(eq(users.name, name));
		await db
			.insert(accountSaveBackups)
			.values({ userId: user!.id, data: { old: true }, reason: 'replaced' });
		expect((await deleteAccount(name, true))[0]).toMatch(/^Deleted /);
		expect(await me(token)).toEqual({ user: null });
		for (const [table, column] of [
			[sessions, sessions.userId],
			[accountSaves, accountSaves.userId],
			[accountSaveBackups, accountSaveBackups.userId]
		] as const) {
			expect(await db.select().from(table).where(eq(column, user!.id))).toEqual([]);
		}
		await expect(deleteAccount(name, true)).rejects.toBeInstanceOf(AdminError);
		// The name is free again.
		await register(name);
	});
});

describe('list', () => {
	it('lists every account with its save and how many browsers are logged in', async () => {
		const name = freshName();
		await register(name);
		const line = (await listAll()).find((l) => l.startsWith(`${name}\t`));
		expect(line).toMatch(/\tseq 7 at .*\t1 logged in$/);
	});
});
