import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The integration-test database URL: `TEST_DATABASE_URL` if set, otherwise
 * `DATABASE_URL` (from the environment or the repo-root .env) with its
 * database name replaced by `mathgame_test`. The name must end in `_test` —
 * the global setup truncates it on every run.
 */
export function testDatabaseUrl(): string {
	if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
	for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
		if (existsSync(candidate)) {
			process.loadEnvFile(candidate);
			break;
		}
	}
	const base = process.env.DATABASE_URL;
	if (!base) throw new Error('DATABASE_URL is not set (see .env.example)');
	const url = new URL(base);
	url.pathname = '/mathgame_test';
	return url.toString();
}
