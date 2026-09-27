import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
	ACCOUNT_TABLES,
	AccountsReady,
	READY_QUERY_TIMEOUT_MS,
	accountTablesReady
} from '../src/accounts.js';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/index.js';

/**
 * Whether accounts work on this server now: the game offers an account only
 * on a yes, so a server whose database lacks the accounts' tables (a
 * development database `pnpm db:migrate` has not reached) or does not answer
 * must say no, and one with them must say yes. Against the real test
 * database, which the global setup migrated.
 */

afterAll(() => pool.end());

describe('accountTablesReady', () => {
	it("is yes on a database with every account table: the routes' own users, sessions and saves", async () => {
		expect([...ACCOUNT_TABLES].sort()).toEqual([
			'account_save_backups',
			'account_saves',
			'sessions',
			'users'
		]);
		expect(await accountTablesReady()).toBe(true);
	});

	it('is no where the tables are not found as the routes find them, as before the migration', async () => {
		const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await client.connect();
		try {
			// No such schema: the queries' unqualified names find no table, as in a database
			// the accounts' migration has not reached.
			await client.query('set search_path to no_accounts_here');
			expect(await accountTablesReady((text, values) => client.query(text, values))).toBe(false);
			await client.query('reset search_path');
			expect(await accountTablesReady((text, values) => client.query(text, values))).toBe(true);
		} finally {
			await client.end();
		}
	});

	it('is no when the database does not answer', async () => {
		const nowhere = new pg.Pool({
			connectionString: 'postgres://postgres:postgres@127.0.0.1:9/nothing',
			connectionTimeoutMillis: 1000
		});
		nowhere.on('error', () => {});
		try {
			expect(await accountTablesReady((text, values) => nowhere.query(text, values))).toBe(false);
		} finally {
			await nowhere.end();
		}
	});

	// A question stuck on a connection that went quiet (a database gone without a word) would
	// keep `AccountsReady` from ever asking again, and every page told no, until the system
	// gave the socket up: a quarter of an hour. pg's own read timeout ends it, and the pool
	// drops the connection it timed out on.
	it("asks the pool with pg's read timeout, which gives a stuck question up", async () => {
		const asked: unknown[] = [];
		const spy = vi.spyOn(pool, 'query').mockImplementation(((config: unknown) => {
			asked.push(config);
			return Promise.resolve({ rows: [{ missing: 0 }] });
		}) as never);
		try {
			expect(await accountTablesReady()).toBe(true);
		} finally {
			spy.mockRestore();
		}
		expect(asked).toEqual([expect.objectContaining({ query_timeout: READY_QUERY_TIMEOUT_MS })]);
		// The timeout holds through the pool with this pg: a question that outlasts it fails when
		// its 200 ms are up, with pg's own error. The question waits on a lock the test holds, so
		// it outlasts any wait, and pg's timer runs on the fake clock, stepped to either side of
		// the 200 ms (a bound on the real clock measured the machine too, #108).
		const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await holder.connect();
		const key = Math.floor(Math.random() * 2 ** 31);
		await holder.query('select pg_advisory_lock($1)', [key]);
		// A connection the pool already holds: the question goes out before the clock moves.
		await pool.query('select 1');
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let failed: unknown;
		try {
			void pool
				.query({ text: 'select pg_advisory_lock($1)', values: [key], query_timeout: 200 })
				.catch((e: unknown) => (failed = e));
			await vi.advanceTimersByTimeAsync(199);
			expect(failed).toBeUndefined();
			await vi.advanceTimersByTimeAsync(1);
			expect((failed as Error | undefined)?.message).toBe('Query read timeout');
		} finally {
			vi.useRealTimers();
			await holder.end();
		}
	});
});

describe('AccountsReady', () => {
	/** A probe the test answers by hand, and a clock it moves. */
	function rig(ttlMs = 10_000, timeoutMs = 2_000) {
		const clock = { t: 0 };
		const asked: ((ready: boolean) => void)[] = [];
		const ready = new AccountsReady(
			() => new Promise<boolean>((resolve) => asked.push(resolve)),
			ttlMs,
			timeoutMs,
			() => clock.t
		);
		return { ready, asked, clock };
	}

	it('asks the database once for everyone within its time to live, then again', async () => {
		const { ready, asked, clock } = rig();
		const racing = [ready.ready(), ready.ready(), ready.ready()];
		expect(asked).toHaveLength(1);
		asked[0]!(true);
		expect(await Promise.all(racing)).toEqual([true, true, true]);
		clock.t = 9_999;
		expect(await ready.ready()).toBe(true);
		expect(asked).toHaveLength(1);
		clock.t = 10_000;
		const next = ready.ready();
		expect(asked).toHaveLength(2);
		asked[1]!(false);
		expect(await next).toBe(false);
	});

	it('takes a database that does not answer in time as a no, and never asks again beside the question still out', async () => {
		const { ready, asked, clock } = rig(10_000, 20);
		expect(await ready.ready()).toBe(false);
		expect(asked).toHaveLength(1);
		clock.t = 10_000;
		expect(await ready.ready()).toBe(false);
		expect(asked).toHaveLength(1);
		// The question comes back at last: the next one after the time to live is asked.
		asked[0]!(true);
		await Promise.resolve();
		clock.t = 20_000;
		const next = ready.ready();
		expect(asked).toHaveLength(2);
		asked[1]!(true);
		expect(await next).toBe(true);
	});

	it('takes a probe that throws or rejects as a no', async () => {
		const throwing = new AccountsReady(() => {
			throw new Error('boom');
		});
		expect(await throwing.ready()).toBe(false);
		const rejecting = new AccountsReady(() => Promise.reject(new Error('boom')));
		expect(await rejecting.ready()).toBe(false);
	});
});

describe('GET /api/account/ready', () => {
	it('says yes on a database with the tables, fresh on every ask (no-store), and sends no cookie', async () => {
		// A page asks this before `/me`, with whatever cookie it has: only login, register,
		// `/me` and a logout that names no account ever send one (INVARIANTS § Server).
		const res = await createApp().request('/api/account/ready', {
			headers: { cookie: 'animath_session=whatever' }
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(res.headers.get('set-cookie')).toBeNull();
		expect(await res.json()).toEqual({ ready: true });
	});

	it('says no, with a 200, when accounts do not work: the game then offers none', async () => {
		const res = await createApp({ accountsReady: async () => false }).request('/api/account/ready');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ready: false });
	});
});
