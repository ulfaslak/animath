import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The dev server answers the old tunnel link from the internet ([[DEVELOPMENT]]
 * § The old tunnel), so what it hands out from outside the client is the
 * engine and the installed libraries, never the rest of the clone: terraform's
 * state and API token, the server's code, the agents' notes.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
let server: ViteDevServer;
let base: string;

beforeAll(async () => {
	server = await createServer({
		configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
		server: { port: 0, strictPort: false, hmr: false, watch: null },
		logLevel: 'silent'
	});
	await server.listen();
	const address = server.httpServer?.address();
	if (!address || typeof address === 'string') throw new Error('the dev server has no port');
	base = `http://localhost:${address.port}`;
}, 60_000);

afterAll(async () => {
	await server?.close();
});

async function status(fromRoot: string): Promise<number> {
	const response = await fetch(`${base}/@fs${ROOT}${fromRoot}`);
	await response.arrayBuffer();
	return response.status;
}

describe('the dev server', () => {
	it('serves the engine the client imports', async () => {
		expect(await status('packages/engine/src/index.ts')).toBe(200);
	});

	it('refuses every other file of the clone', async () => {
		const refused = [
			'terraform/main.tf',
			'terraform/cloud-init.yml',
			'package.json',
			'deploy.env',
			'packages/server/src/env.ts',
			'AGENTS/DNA/DECISIONS.md'
		];
		const answers = await Promise.all(refused.map(async (path) => [path, await status(path)]));
		expect(answers.filter(([, code]) => code !== 403)).toEqual([]);
	});

	it('refuses every file reached through a link that leaves what it serves', async () => {
		// Vite checks the path a request names, not where a link in it leads.
		const leaving = linksLeaving();
		expect(leaving.map((l) => l.link)).toContain('node_modules/.pnpm/node_modules/@mathgame/server');
		const answers = await Promise.all(
			leaving.map(async ({ link, file }) => [`${link}/${file}`, await status(`${link}/${file}`)])
		);
		expect(answers.filter(([, code]) => code !== 403)).toEqual([]);
	});
});

const SERVED = ['packages/client', 'packages/engine', 'node_modules'].map((p) =>
	realpathSync(join(ROOT, p))
);

/**
 * Every link where pnpm puts them (a package's `node_modules`, and the store's
 * own) whose target is outside the folders the dev server serves, with a file
 * in it to ask for.
 */
function linksLeaving(): { link: string; file: string }[] {
	const folders = [
		'node_modules',
		'node_modules/.pnpm/node_modules',
		'packages/client/node_modules',
		'packages/engine/node_modules',
		...readdirSync(join(ROOT, 'node_modules/.pnpm')).map((d) => `node_modules/.pnpm/${d}/node_modules`)
	];
	const found: { link: string; file: string }[] = [];
	const look = (folder: string) => {
		let names: string[];
		try {
			names = readdirSync(join(ROOT, folder));
		} catch {
			return;
		}
		for (const name of names) {
			const path = `${folder}/${name}`;
			const stat = lstatSync(join(ROOT, path));
			if (name.startsWith('@') && stat.isDirectory()) look(path);
			if (!stat.isSymbolicLink()) continue;
			let target: string;
			try {
				target = realpathSync(join(ROOT, path));
			} catch {
				continue;
			}
			if (SERVED.some((s) => target === s || target.startsWith(`${s}/`))) continue;
			const file = statSync(target).isDirectory()
				? readdirSync(target).find((f) => statSync(join(target, f)).isFile())
				: undefined;
			if (file) found.push({ link: path, file });
		}
	};
	for (const folder of folders) look(folder);
	return found;
}
