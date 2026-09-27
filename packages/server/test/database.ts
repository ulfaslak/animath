import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * This checkout's folder: the primary clone or a worktree, found from this
 * file's own place, so the working directory a run starts from never matters.
 */
export const CHECKOUT_ROOT = realpathSync(fileURLToPath(new URL('../../..', import.meta.url)));

/**
 * The server tests' database for the checkout at `root`:
 * `mathgame_<folder>_<hash>_test`. The hash (8 hex digits of the SHA-256 of the
 * full path) keeps every checkout's apart, two folders of one name included;
 * the folder name, cut to 24 characters, only tells a person reading `\l`
 * whose it is. At most 47 characters, well inside Postgres's 63.
 */
export function checkoutDatabaseName(root: string = CHECKOUT_ROOT): string {
	const folder = basename(root)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.slice(0, 24)
		.replace(/^_+|_+$/g, '');
	const hash = createHash('sha256').update(root).digest('hex').slice(0, 8);
	return `mathgame_${folder ? `${folder}_` : ''}${hash}_test`;
}

/** A database the server tests may empty: the global setup refuses any other name. */
export const TEST_DATABASE = /^[a-z_][a-z0-9_]*_test$/;

/**
 * A name `checkoutDatabaseName` makes, and nothing else on the server:
 * `mathgame`, `mathgame_test` and a test database named by hand do not match.
 * `scripts/prune-test-databases.ts` drops only databases of this shape.
 */
export const CHECKOUT_DATABASE = /^mathgame_(?:[a-z0-9_]+_)?[0-9a-f]{8}_test$/;

/** `DATABASE_URL`, from the environment or else the repo-root .env. */
export function databaseUrl(): string {
	for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
		if (existsSync(candidate)) {
			process.loadEnvFile(candidate);
			break;
		}
	}
	const base = process.env.DATABASE_URL;
	if (!base) throw new Error('DATABASE_URL is not set (see .env.example)');
	return base;
}

/**
 * The integration-test database URL: `TEST_DATABASE_URL` if set, otherwise
 * `DATABASE_URL` with its database replaced by this checkout's own
 * (`checkoutDatabaseName`), so two checkouts' runs never share one. The name
 * must end in `_test`: the global setup empties it on every run.
 */
export function testDatabaseUrl(): string {
	if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
	const url = new URL(databaseUrl());
	url.pathname = `/${checkoutDatabaseName()}`;
	return url.toString();
}

/** The `postgres` database on the same server as `url`: where databases are made and dropped. */
export function maintenanceUrl(url: string): string {
	const admin = new URL(url);
	admin.pathname = '/postgres';
	return admin.toString();
}
