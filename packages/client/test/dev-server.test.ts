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
});
