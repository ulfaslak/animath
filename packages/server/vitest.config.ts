import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/database.js';

// Every server test runs against this checkout's own test database, never the
// dev database and never another worktree's (`test/database.ts` names it):
// `test/global-setup.ts` creates and migrates it once per run, and the URL is
// injected here so `src/env.ts` never sees the real DATABASE_URL.
// Every bound holds at a load average of 150 ([[DEVELOPMENT]] § Testing
// ideology): 30 s by default, not vitest's 5; a file that hashes passwords
// sets its own.
export default defineConfig({
	test: {
		globalSetup: ['./test/global-setup.ts'],
		env: { DATABASE_URL: testDatabaseUrl() },
		testTimeout: 30_000
	}
});
