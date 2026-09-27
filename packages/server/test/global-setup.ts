import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { testDatabaseUrl } from './database.js';

/**
 * Runs once before the server test suite: makes sure `mathgame_test` exists
 * on the same Postgres as the dev database, applies every journaled
 * migration to it, and empties it. Tests then hit the real app with the real
 * driver; nothing is mocked below the HTTP layer.
 */
export default async function setup(): Promise<void> {
	const url = testDatabaseUrl();
	const dbName = new URL(url).pathname.slice(1);
	if (!/^[a-z_][a-z0-9_]*_test$/.test(dbName)) {
		throw new Error(`refusing to run tests against "${dbName}": the name must end in _test`);
	}

	const adminUrl = new URL(url);
	adminUrl.pathname = '/postgres';
	const admin = new pg.Pool({ connectionString: adminUrl.toString() });
	try {
		const found = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
		if (found.rowCount === 0) await admin.query(`create database "${dbName}"`);
	} finally {
		await admin.end();
	}

	const pool = new pg.Pool({ connectionString: url });
	try {
		await migrate(drizzle(pool), {
			migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url))
		});
		await pool.query(
			'truncate table save_backups, saves, players, account_save_backups, account_saves, sessions, users'
		);
	} finally {
		await pool.end();
	}
}
