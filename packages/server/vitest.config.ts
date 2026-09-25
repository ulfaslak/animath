import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/database.js';

// Every server test runs against `mathgame_test`, never the dev database:
// `test/global-setup.ts` creates and migrates it once per run, and the URL is
// injected here so `src/env.ts` never sees the real DATABASE_URL.
export default defineConfig({
	test: {
		globalSetup: ['./test/global-setup.ts'],
		env: { DATABASE_URL: testDatabaseUrl() }
	}
});
