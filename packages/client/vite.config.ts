import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';
import { parse } from 'yaml';
import { BUILD_TARGET, colorMixFallbacks, oldBrowsers, paletteOf } from './browsers';

// TUNNEL=1 lets an ngrok / cloudflared hostname reach the dev server (Vite
// blocks unknown hosts by default). Only set it while a tunnel is up.
const tunnel = process.env.TUNNEL === '1';
// API_PORT points the proxy at another API server, e.g. a worktree's own.
const apiPort = process.env.API_PORT ?? '3000';
// The commit being built, which the image's build sets (Dockerfile) and
// index.html carries as `<meta name="animath-build">`, beside the server's
// /api/health: the two builds are one. `dev` everywhere else.
process.env.VITE_BUILD_SHA ||= 'dev';
// The game's address: `https://` and the domain the image's build is given
// (MATHGAME_DOMAIN, deploy.env's, through the Dockerfile). The link preview
// names its image by it (`%VITE_SITE_ORIGIN%` in index.html) and its page
// (`pageAddress`), as a messenger wants absolute URLs. Empty everywhere else,
// the dev server behind the tunnel included: the image's URL stays relative,
// and the page names no address that is not its own.
process.env.VITE_SITE_ORIGIN ||= process.env.MATHGAME_DOMAIN
	? `https://${process.env.MATHGAME_DOMAIN}`
	: '';
// The game's domain, for every build and the dev server alike: a page on any
// address that is neither this domain nor a machine of the developer's (the old
// tunnel's, which the dev server still serves) points the kid here first
// (`moved.ts`, `boot.ts`). It is deploy.env's `MATHGAME_DOMAIN`, the one place
// the domain is set: the image's build is given it (the build context leaves
// deploy.env out), and everywhere else it is read from the file. Empty when
// neither says one, and then no page is pointed anywhere.
process.env.VITE_GAME_DOMAIN = gameDomain();

function gameDomain(): string {
	let domain = process.env.MATHGAME_DOMAIN ?? '';
	if (domain === '') {
		try {
			const file = readFileSync(new URL('../../deploy.env', import.meta.url), 'utf8');
			domain = parseEnv(file).MATHGAME_DOMAIN ?? '';
		} catch {
			// No deploy.env here: no domain.
		}
	}
	domain = domain.trim().toLowerCase();
	return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : '';
}

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

/** The link preview's `og:url`, the game's own address, in a build that knows it (above). */
function pageAddress(): Plugin {
	return {
		name: 'animath:page-address',
		transformIndexHtml() {
			const origin = process.env.VITE_SITE_ORIGIN;
			if (!origin) return [];
			return [
				{ tag: 'meta', attrs: { property: 'og:url', content: `${origin}/` }, injectTo: 'head' }
			];
		}
	};
}

/** The error reports' module, which the build makes a chunk of its own (`errorReportsFirst`). */
const ERROR_REPORTS = 'src/error-reports.ts';
/** The syntax of the error reports' chunk: what every browser that runs a module script reads. */
const ERROR_REPORTS_TARGET = 'es2017';

/**
 * The error reports (`src/error-reports.ts`) in a script of their own, run
 * before the game's first one, so that a browser that cannot even read the
 * game's first script still runs them, and they report it. `boot.ts` imports
 * them first, so the dev server runs them first too; the build makes them an
 * entry of their own (`build.rollupOptions.input`), which `boot.ts`'s chunk
 * imports, and puts its script at the top of the page.
 *
 * The build writes every chunk for `build.target` (`BUILD_TARGET`: ES2022,
 * and Safari 15), and its minifier then uses syntax the module itself does
 * not (a `catch` with no binding, which Safari before 11.1 cannot read), so
 * the chunk is written again for `ERROR_REPORTS_TARGET`, whose syntax esbuild
 * keeps to or fails the build (and `oldBrowsers` checks).
 * Its name stays that of the chunk it was written from, one to one; its
 * source map would not match it any more, and is left out.
 */
function errorReportsFirst(): Plugin {
	return {
		name: 'animath:error-reports-first',
		apply: 'build',
		async generateBundle(_options, bundle) {
			for (const file of Object.values(bundle)) {
				if (file.type !== 'chunk' || !file.facadeModuleId?.endsWith(ERROR_REPORTS)) continue;
				const lowered = await transformWithEsbuild(file.code, file.fileName, {
					target: ERROR_REPORTS_TARGET,
					format: 'esm',
					minify: true,
					sourcemap: false
				});
				file.code = lowered.code;
				file.map = null;
				delete bundle[`${file.fileName}.map`];
			}
		},
		transformIndexHtml: {
			order: 'post',
			handler(_html, { bundle }) {
				const chunk = Object.values(bundle ?? {}).find(
					(c) => c.type === 'chunk' && c.isEntry && c.facadeModuleId?.endsWith(ERROR_REPORTS)
				);
				if (!chunk) throw new Error(`the build made no chunk of its own for ${ERROR_REPORTS}`);
				return [
					{
						tag: 'script',
						attrs: { type: 'module', crossorigin: true, src: `/${chunk.fileName}` },
						injectTo: 'head-prepend'
					}
				];
			}
		}
	};
}

/** The palette's colours, which the mixes a browser without `color-mix()` gets are worked out from. */
const palette = paletteOf(readFileSync(new URL('src/styles.css', import.meta.url), 'utf8'));

export default defineConfig({
	plugins: [
		svelte(),
		yaml(),
		robots(),
		pageAddress(),
		errorReportsFirst(),
		// Last: the build fails over anything in it Safari 15 cannot run (browsers.ts).
		oldBrowsers({ es2017: ERROR_REPORTS })
	],
	// Every stylesheet, each component's too: a colour for every `color-mix()` where there is none.
	css: { postcss: { plugins: [colorMixFallbacks(palette)] } },
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
		// Safari 15 and up, iPadOS 15 on a family's iPad (DECISIONS § The page, browsers.ts).
		target: BUILD_TARGET,
		sourcemap: true,
		// Every file Vite builds is named after its content hash; they all go in
		// one folder, which the server tells browsers to keep for good. What
		// `public/` copies over keeps its own name and folder (`assets/`), and is
		// asked for again on every visit (`cacheControl` in the server's app.ts).
		assetsDir: 'immutable',
		rollupOptions: {
			// The page, and the error reports as an entry of their own (`errorReportsFirst`).
			input: {
				index: fileURLToPath(new URL('index.html', import.meta.url)),
				'error-reports': fileURLToPath(new URL(ERROR_REPORTS, import.meta.url))
			},
			// Three.js is ~500 kB on its own; keep it in a separate, long-cached chunk.
			output: { manualChunks: { three: ['three'] } }
		}
	}
});
