import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Vitest replaces CSS with empty strings unless told otherwise; `css-vars.test.ts`
// reads `styles.css` as text, so CSS is processed in tests.
// The pattern sees the whole id, query included (`styles.css?raw`).
// `test/setup.ts` turns each test worker's event loop between tests (see there).
// Every bound holds at a load average of 150, where a test in the full suite
// takes up to ten times its slowest run alone ([[DEVELOPMENT]] § Testing
// ideology): 30 s by default, for a test under a second alone, not vitest's
// 5; a heavier test sets its own.
export default mergeConfig(
	viteConfig,
	defineConfig({
		test: { css: { include: [/\.css\b/] }, setupFiles: ['./test/setup.ts'], testTimeout: 30_000 }
	})
);
