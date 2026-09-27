import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load the repo-root .env (Node ≥ 21.7 has this built in; no dotenv needed).
// Worktrees get their own copy via .gtrconfig.
for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
	if (existsSync(candidate)) {
		process.loadEnvFile(candidate);
		break;
	}
}

function required(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`Missing env var ${name} (see .env.example)`);
	return v;
}

export const env = {
	DATABASE_URL: required('DATABASE_URL'),
	PORT: Number(process.env.PORT ?? 3000),
	NODE_ENV: process.env.NODE_ENV ?? 'development',
	/** The commit this server was built from: the image's `GIT_SHA` build argument, `dev` outside an image. */
	GIT_SHA: process.env.GIT_SHA || 'dev'
};
