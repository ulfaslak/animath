import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// TUNNEL=1 lets an ngrok / cloudflared hostname reach the dev server (Vite
// blocks unknown hosts by default). Only set it while a tunnel is up.
const tunnel = process.env.TUNNEL === '1';

export default defineConfig({
	plugins: [svelte()],
	server: {
		port: 5180,
		strictPort: true,
		allowedHosts: tunnel ? true : undefined,
		proxy: {
			'/api': 'http://localhost:3000',
			'/ws': { target: 'ws://localhost:3000', ws: true }
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
