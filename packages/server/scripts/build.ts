import { build } from 'esbuild';

/**
 * Bundles the server for production: `dist/index.mjs` (the server),
 * `dist/migrate.mjs` (the migrations) and `dist/admin.mjs` (the accounts'
 * admin command, `/redeploy` § Logs), each one file with every dependency
 * inside, the engine's TypeScript included. The image runs them with plain
 * `node`: no `tsx`, and no `node_modules`.
 */
await build({
	entryPoints: { index: 'src/index.ts', migrate: 'scripts/migrate.ts', admin: 'scripts/admin.ts' },
	outdir: 'dist',
	outExtension: { '.js': '.mjs' },
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node26',
	sourcemap: true,
	// Optional native helpers that `pg` and `ws` load when they are installed,
	// inside a `try`. Left out of the bundle, they are simply not there.
	external: ['pg-native', 'bufferutil', 'utf-8-validate'],
	// Bundled CommonJS (`pg`) calls `require` for Node's own modules, and an ES
	// module has no `require` of its own.
	banner: {
		js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
	},
	logLevel: 'info'
});
