import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../src/db/index.js';
import {
	CHECKOUT_DATABASE,
	CHECKOUT_ROOT,
	checkoutDatabaseName,
	TEST_DATABASE,
	testDatabaseUrl
} from './database.js';

// Every checkout's server tests have a database of their own. When all
// worktrees shared one, a run starting in one emptied the tables under a run
// in progress in another, and a test saw two accounts made for one name (#100).

afterAll(() => pool.end());
afterEach(() => vi.unstubAllEnvs());

const CHECKOUTS = [
	'/Users/cookie/git/mathgame',
	'/Users/cookie/git/mathgame-worktrees/feat-glider',
	'/Users/cookie/git/mathgame-worktrees/feat-species-wave-1',
	'/home/runner/work/mathgame/mathgame',
	// The same folder name as the first, somewhere else.
	'/Users/someone/elsewhere/mathgame',
	`/Users/cookie/git/mathgame-worktrees/${'a-branch-name-that-goes-on-'.repeat(4)}`,
	'/Users/cookie/Ää ø/日本語',
	'/Users/cookie/git/Fix.Per Worktree--DB'
];

describe("a checkout's test database", () => {
	it('is its own: no two checkouts share one, folders of one name included', () => {
		const names = CHECKOUTS.map((root) => checkoutDatabaseName(root));
		expect(new Set(names).size).toBe(CHECKOUTS.length);
	});

	it('has a name Postgres keeps whole, the setup accepts and the prune knows', () => {
		const bad = CHECKOUTS.map((root) => checkoutDatabaseName(root)).filter(
			// Postgres cuts a longer name to 63 bytes, which could cut two apart names to one.
			(name) =>
				Buffer.byteLength(name) > 63 || !TEST_DATABASE.test(name) || !CHECKOUT_DATABASE.test(name)
		);
		expect(bad).toEqual([]);
	});

	it('is the only kind of database the prune may drop', () => {
		const others = [
			'mathgame',
			'mathgame_test',
			'mathgame_feat_matches_test',
			'postgres',
			'template1'
		];
		expect(others.filter((name) => CHECKOUT_DATABASE.test(name))).toEqual([]);
	});

	it("is DATABASE_URL's server with only the database changed, unless TEST_DATABASE_URL says", () => {
		vi.stubEnv('TEST_DATABASE_URL', '');
		vi.stubEnv(
			'DATABASE_URL',
			'postgres://someone:secret@db.example:5433/mathgame?sslmode=disable'
		);
		expect(testDatabaseUrl()).toBe(
			`postgres://someone:secret@db.example:5433/${checkoutDatabaseName()}?sslmode=disable`
		);
		vi.stubEnv('TEST_DATABASE_URL', 'postgres://ci:ci@localhost:5432/ci_test');
		expect(testDatabaseUrl()).toBe('postgres://ci:ci@localhost:5432/ci_test');
	});

	it('is the one this run uses, with its checkout written on it for the prune', async () => {
		const { rows } = await pool.query<{ name: string; checkout: string | null }>(
			`select datname as name, shobj_description(oid, 'pg_database') as checkout
			   from pg_database where datname = current_database()`
		);
		const override = process.env.TEST_DATABASE_URL;
		if (override) expect(rows[0]?.name).toBe(new URL(override).pathname.slice(1));
		else expect(rows[0]).toEqual({ name: checkoutDatabaseName(), checkout: CHECKOUT_ROOT });
	});
});
