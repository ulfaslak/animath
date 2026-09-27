import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';
import { parse } from 'yaml';

// TUNNEL=1 lets an ngrok / cloudflared hostname reach the dev server (Vite
// blocks unknown hosts by default). Only set it while a tunnel is up.
const tunnel = process.env.TUNNEL === '1';
// API_PORT points the proxy at another API server, e.g. a worktree's own.
const apiPort = process.env.API_PORT ?? '3000';
// The commit being built, which the image's build sets (Dockerfile) and
// index.html carries as `<meta name="animath-build">`, beside the server's
// /api/health: the two builds are one. `dev` everywhere else.
process.env.VITE_BUILD_SHA ||= 'dev';

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

/**
 * Whether search engines may list the game. They may not (DECISIONS § The
 * page): it is a kids' game that shows players' names, with no moderation,
 * shared by link. This is the one switch: `robots()` below follows it.
 */
const SEARCH_ENGINES_WELCOME = false;

/**
 * `robots.txt` (served by the dev server, written into the build) and the
 * page's robots meta, from `SEARCH_ENGINES_WELCOME`. Kept out, every crawler
 * is turned away except the ones messengers send to draw a shared link's
 * preview card, and the page says `noindex` to any that come anyway.
 */
function robots(): Plugin {
	const text = SEARCH_ENGINES_WELCOME
		? 'User-agent: *\nAllow: /\n'
		: [
				'# Animath is shared by link, not found by search (DECISIONS § The page).',
				'User-agent: *',
				'Disallow: /',
				'',
				'# Messengers may still fetch a shared link to show its preview.',
				'User-agent: facebookexternalhit',
				'User-agent: Facebot',
				'User-agent: Twitterbot',
				'User-agent: Slackbot-LinkExpanding',
				'User-agent: Discordbot',
				'User-agent: TelegramBot',
				'User-agent: LinkedInBot',
				'User-agent: WhatsApp',
				'Allow: /',
				''
			].join('\n');
	return {
		name: 'animath:robots',
		configureServer(server) {
			server.middlewares.use('/robots.txt', (_req, res) => {
				res.setHeader('Content-Type', 'text/plain; charset=utf-8');
				res.end(text);
			});
		},
		generateBundle() {
			this.emitFile({ type: 'asset', fileName: 'robots.txt', source: text });
		},
		transformIndexHtml() {
			if (SEARCH_ENGINES_WELCOME) return [];
			return [
				{ tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' }, injectTo: 'head' }
			];
		}
	};
}

export default defineConfig({
	plugins: [svelte(), yaml(), robots()],
	server: {
		port: 5180,
		strictPort: true,
		allowedHosts: tunnel ? true : undefined,
		proxy: {
			// The API, WebSocket upgrades included (the presence socket at `/api/ws`),
			// as nginx passes them on in production. It sees the Host the browser
			// used (the string shorthand would rewrite it to localhost:<apiPort>): the
			// account routes check that a POST's Origin is this site, and the presence
			// socket that its Origin is.
			'/api': { target: `http://localhost:${apiPort}`, changeOrigin: false, ws: true }
		}
	},
	build: {
		target: 'es2022',
		sourcemap: true,
		// Every file Vite builds is named after its content hash; they all go in
		// one folder, which the server tells browsers to keep for good. What
		// `public/` copies over keeps its own name and folder (`assets/`), and is
		// asked for again on every visit (`cacheControl` in the server's app.ts).
		assetsDir: 'immutable',
		rollupOptions: {
			// Three.js is ~500 kB on its own; keep it in a separate, long-cached chunk.
			output: { manualChunks: { three: ['three'] } }
		}
	}
});
