import { defineConfig } from 'vitest/config';

// `test/setup.ts` turns each test worker's event loop between tests (see there).
// Every bound holds at a load average of 150, where a test in the full suite
// takes up to ten times its slowest run alone ([[DEVELOPMENT]] § Testing
// ideology): 30 s by default, for a test under a second alone, not vitest's
// 5; a heavier test sets its own.
export default defineConfig({ test: { setupFiles: ['./test/setup.ts'], testTimeout: 30_000 } });
