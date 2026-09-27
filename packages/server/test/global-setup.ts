import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
	CHECKOUT_ROOT,
	checkoutDatabaseName,
	maintenanceUrl,
	TEST_DATABASE,
	testDatabaseUrl
} from './database.js';

/**
 * Runs once before the server test suite: makes sure this checkout's test
 * database (`test/database.ts`) exists on the same Postgres as the dev
 * database, applies every journaled migration to it, and empties it. Tests
 * then hit the real app with the real driver; nothing is mocked below the
 * HTTP layer.
 */
export default async function setup(): Promise<void> {
	const url = testDatabaseUrl();
	const dbName = new URL(url).pathname.slice(1);
	if (!TEST_DATABASE.test(dbName)) {
		throw new Error(`refusing to run tests against "${dbName}": the name must end in _test`);
	}

	const admin = new pg.Pool({ connectionString: maintenanceUrl(url) });
	try {
		const found = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
		if (found.rowCount === 0) await admin.query(`create database ${pg.escapeIdentifier(dbName)}`);
		// The checkout's folder, which `pnpm db:prune-tests` reads to drop the
		// database once that folder is gone. Set on every run, so a run that
		// died between the two statements is mended by the next.
		if (dbName === checkoutDatabaseName()) {
			await admin.query(
				`comment on database ${pg.escapeIdentifier(dbName)} is ${pg.escapeLiteral(CHECKOUT_ROOT)}`
			);
		}
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
