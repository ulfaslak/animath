import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('./db/index.js', () => ({ pingDb: async () => false }));

// Read by src/env.ts when it loads, so set before the app is imported.
const SHA = '0123456789abcdef0123456789abcdef01234567';
vi.stubEnv('GIT_SHA', SHA);
afterAll(() => vi.unstubAllEnvs());

const { createApp } = await import('./app.js');

/** A built client in miniature, from packages/server, where vitest runs. */
const app = createApp({ clientDist: 'test/fixtures/client-dist' });
const PAGE = "the game's page";

describe('GET /api/health', () => {
	it('reports db status and the build, and returns 503 when the db is down', async () => {
		const res = await app.request('/api/health');
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ ok: true, db: false, sha: SHA });
	});
});

describe('a path nothing answers', () => {
	it.each(['/api', '/api/', '/api/nope', '/api/players/x/y/z', '/api/ws', '/ws', '/ws/game'])(
		"%s is the API's JSON 404, never the game's page",
		async (path) => {
			for (const method of ['GET', 'POST', 'PUT']) {
				const res = await app.request(path, { method });
				expect(res.status, `${method} ${path}`).toBe(404);
				expect(await res.json(), `${method} ${path}`).toEqual({ error: 'not found' });
			}
		}
	);

	it('the retired anonymous backup is gone in development and in production alike', async () => {
		const production = createApp({ production: true, clientDist: 'test/fixtures/client-dist' });
		const id = '00000000-0000-4000-8000-000000000001';
		for (const target of [app, production]) {
			for (const [method, path] of [
				['POST', '/api/players'],
				['GET', `/api/players/${id}/save`],
				['PUT', `/api/players/${id}/save`]
			] as const) {
				const res = await target.request(path, {
					method,
					headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
					body: method === 'PUT' ? '{}' : undefined
				});
				expect(res.status, `${method} ${path}`).toBe(404);
				expect(await res.json(), `${method} ${path}`).toEqual({ error: 'not found' });
			}
		}
	});
});

describe('the built client', () => {
	it('keeps a file Vite built for good: its name changes with its content', async () => {
		const res = await app.request('/immutable/app-AbCd12_-.js');
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		expect(res.headers.get('content-type')).toMatch(/javascript/);
	});

	it.each(['/', '/index.html', '/somewhere', '/somewhere/deeper?new'])(
		'serves the page at %s, asked for again on every visit',
		async (path) => {
			const res = await app.request(path);
			expect(res.status).toBe(200);
			expect(res.headers.get('cache-control')).toBe('no-cache');
			expect(await res.text()).toContain(PAGE);
		}
	);

	it('asks for a file public/ copied over again on every visit: it keeps its name when it changes', async () => {
		const res = await app.request('/assets/CREDITS.md');
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-cache');
	});

	it.each(['/immutable/app-Missing1.js', '/immutable/', '/assets/model.glb', '/assets/'])(
		'answers %s, which is not there, with a 404 and not the page',
		async (path) => {
			const res = await app.request(path);
			expect(res.status).toBe(404);
			expect(res.headers.get('cache-control')).toBeNull();
			expect(await res.text()).not.toContain(PAGE);
		}
	);
});
