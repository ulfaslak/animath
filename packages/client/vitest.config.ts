import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Vitest replaces CSS with empty strings unless told otherwise; `css-vars.test.ts`
// reads `styles.css` as text, so CSS is processed in tests.
// The pattern sees the whole id, query included (`styles.css?raw`).
export default mergeConfig(viteConfig, defineConfig({ test: { css: { include: [/\.css\b/] } } }));
