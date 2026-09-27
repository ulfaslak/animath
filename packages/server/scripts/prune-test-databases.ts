import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import pg from 'pg';
import { CHECKOUT_DATABASE, databaseUrl, maintenanceUrl } from '../test/database.js';

// Drops the server tests' databases whose checkout is gone
// (see AGENTS/DNA/DEVELOPMENT.md § Database):
//
//   prune-test-databases             lists them, and drops each one whose checkout folder is gone
//   prune-test-databases --dry-run   only lists them
//
// Every checkout's server tests make a database of their own (test/database.ts)
// and write the checkout's folder into its comment; nothing drops it when the
// worktree goes. Only a database of that name whose comment names a folder that
// no longer exists is dropped, and it is printed first. Everything goes through
// the `postgres` database on DATABASE_URL's server, never the database
// DATABASE_URL names.

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--dry-run')) {
	console.error('usage: prune-test-databases [--dry-run]');
	process.exit(1);
}
const dryRun = args.includes('--dry-run');

/** Whether `path` is certainly gone: missing, not merely unreadable. */
function gone(path: string): boolean {
	try {
		return statSync(path, { throwIfNoEntry: false }) === undefined;
	} catch {
		return false;
	}
}

const client = new pg.Client({ connectionString: maintenanceUrl(databaseUrl()) });
await client.connect();
try {
	const { rows } = await client.query<{ name: string; checkout: string | null }>(
		`select datname as name, shobj_description(oid, 'pg_database') as checkout
		   from pg_database order by datname`
	);
	const ours = rows.filter((row) => CHECKOUT_DATABASE.test(row.name));
	if (ours.length === 0) console.log('No checkout has a test database.');
	for (const { name, checkout } of ours) {
		if (!checkout || !isAbsolute(checkout)) {
			console.log(`kept      ${name}  (no checkout recorded)`);
		} else if (!gone(checkout)) {
			console.log(`kept      ${name}  ${checkout}`);
		} else if (dryRun) {
			console.log(`stale     ${name}  ${checkout} is gone`);
		} else {
			console.log(`dropping  ${name}  ${checkout} is gone`);
			try {
				await client.query(`drop database if exists ${pg.escapeIdentifier(name)}`);
				console.log(`dropped   ${name}`);
			} catch (error) {
				console.log(`kept      ${name}  (${(error as Error).message})`);
				process.exitCode = 1;
			}
		}
	}
	const others = rows.filter(
		(row) => row.name.endsWith('_test') && !CHECKOUT_DATABASE.test(row.name)
	);
	if (others.length > 0) {
		console.log(`Not a checkout's, left alone: ${others.map((row) => row.name).join(', ')}`);
	}
} finally {
	await client.end();
}
