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
		// Every table the migrations made, whatever its name: a list here would have to
		// learn each new table, and one it missed stops the truncate of any table it
		// refers to. The migrator's own bookkeeping lives in the `drizzle` schema.
		const { rows } = await pool.query<{ name: string }>(
			"select format('%I', tablename) as name from pg_tables where schemaname = 'public'"
		);
		if (rows.length > 0) {
			await pool.query(`truncate table ${rows.map((r) => r.name).join(', ')}`);
		}
	} finally {
		await pool.end();
	}
}
