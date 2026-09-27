import { defineConfig } from 'vitest/config';

// `test/setup.ts` turns each test worker's event loop between tests (see there).
export default defineConfig({ test: { setupFiles: ['./test/setup.ts'] } });
