import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';
import { parse } from 'yaml';

// TUNNEL=1 lets an ngrok / cloudflared hostname reach the dev server (Vite
// blocks unknown hosts by default). Only set it while a tunnel is up.
const tunnel = process.env.TUNNEL === '1';
// API_PORT points the proxy at another API server, e.g. a worktree's own.
const apiPort = process.env.API_PORT ?? '3000';

/**
 * `import en from './en.yaml'` gives the file's data. The YAML is parsed here,
 * at build time, so the browser gets plain objects and ships no YAML parser.
 * Vitest extends this config, so tests load YAML the same way. A syntax error
 * or a repeated key fails the build (and shows in the dev overlay). Imports
 * with a query (`?raw`, `?url`) are left to Vite.
 */
function yaml(): Plugin {
	return {
		name: 'animath:yaml',
		transform(source, id) {
			if (!id.endsWith('.yaml') && !id.endsWith('.yml')) return null;
			const data: unknown = parse(source);
			return { code: `export default ${JSON.stringify(data)};`, map: { mappings: '' } };
		}
	};
}

export default defineConfig({
	plugins: [svelte(), yaml()],
	server: {
		port: 5180,
		strictPort: true,
		allowedHosts: tunnel ? true : undefined,
		proxy: {
			'/api': `http://localhost:${apiPort}`,
			'/ws': { target: `ws://localhost:${apiPort}`, ws: true }
		}
	},
	build: {
		target: 'es2022',
		sourcemap: true,
		rollupOptions: {
			// Three.js is ~500 kB on its own; keep it in a separate, long-cached chunk.
			output: { manualChunks: { three: ['three'] } }
		}
	}
});
