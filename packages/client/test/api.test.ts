import type { SaveWrite } from '@mathgame/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionCheck, accountSaveServer } from '../src/account/api';

/**
 * The account's save, as the autosave's server, decides only from the API's
 * own answers: its JSON bodies, not a status alone. A page from something in
 * between (a tunnel's warning page, a proxy's error or login page) is
 * `offline`, whatever its status, so nothing is decided from it (#60). The
 * session check (`/api/account/me`) says the cookie is this page's account's
 * in every case here; `account-api.test.ts` has the ones where it does not.
 */

afterEach(() => vi.unstubAllGlobals());

const ME = '/api/account/me';
const doc = { version: 2, home: 7, world: 7, lineage: 'l', seq: 2 } as unknown as SaveWrite;

type Answer = { status: number; json?: unknown; html?: string } | 'network error';

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

/** The session is Ida's; the save route answers `a`. */
function answer(a: Answer): void {
	vi.stubGlobal('fetch', async (url: string) => {
		if (url === ME) return json(200, { user: { name: 'Ida' } });
		if (a === 'network error') throw new TypeError('Failed to fetch');
		if (a.html !== undefined) {
			return new Response(a.html, { status: a.status, headers: { 'content-type': 'text/html' } });
		}
		return json(a.status, a.json ?? null);
	});
}

function server() {
	return accountSaveServer(new SessionCheck('Ida'));
}

const page = '<html><body>You are about to visit…</body></html>';

describe('putSave', () => {
	const cases: [string, Answer, unknown][] = [
		['200 { ok: true }', { status: 200, json: { ok: true } }, { kind: 'saved' }],
		["200 and a tunnel's page", { status: 200, html: page }, { kind: 'offline' }],
		['200 and some other JSON', { status: 200, json: { hello: 1 } }, { kind: 'offline' }],
		['409 and its error', { status: 409, json: { error: 'higher seq' } }, { kind: 'conflict' }],
		['409 and a page', { status: 409, html: page }, { kind: 'offline' }],
		[
			'400 and its error',
			{ status: 400, json: { error: 'bad' } },
			{ kind: 'refused', error: 'bad' }
		],
		[
			'413 and its error',
			{ status: 413, json: { error: 'big' } },
			{ kind: 'refused', error: 'big' }
		],
		["413 and a proxy's page", { status: 413, html: page }, { kind: 'offline' }],
		// Too many saves a minute: waited out, like an unreachable server.
		[
			'429 and its error',
			{ status: 429, json: { error: 'too many tries', retryAfter: 30 } },
			{ kind: 'offline' }
		],
		[
			'401 and its error',
			{ status: 401, json: { error: 'not logged in' } },
			{ kind: 'logged-out' }
		],
		["401 and a proxy's login page", { status: 401, html: page }, { kind: 'offline' }],
		[
			"401 and a proxy's JSON",
			{ status: 401, json: { error: 'unauthorized' } },
			{ kind: 'offline' }
		],
		['404 and a page', { status: 404, html: page }, { kind: 'offline' }],
		['502 and a page', { status: 502, html: page }, { kind: 'offline' }],
		['a network error', 'network error', { kind: 'offline' }]
	];
	for (const [name, a, expected] of cases) {
		it(`${name} → ${(expected as { kind: string }).kind}`, async () => {
			answer(a);
			expect(await server().putSave(doc)).toEqual(expected);
		});
	}
});

describe('getSave', () => {
	const cases: [string, Answer, unknown][] = [
		[
			'200 and a save',
			{ status: 200, json: { version: 1, seq: 3 } },
			{ kind: 'found', doc: { version: 1, seq: 3 } }
		],
		[
			"200 and a newer build's save",
			{ status: 200, json: { version: 7 } },
			{ kind: 'found', doc: { version: 7 } }
		],
		["200 and a tunnel's page", { status: 200, html: page }, { kind: 'offline' }],
		['200 and JSON that is no save', { status: 200, json: { status: 'ok' } }, { kind: 'offline' }],
		['404 no save yet', { status: 404, json: { error: 'no save yet' } }, { kind: 'none' }],
		['404 and a page', { status: 404, html: page }, { kind: 'offline' }],
		[
			'401 and its error',
			{ status: 401, json: { error: 'not logged in' } },
			{ kind: 'logged-out' }
		],
		["401 and a proxy's login page", { status: 401, html: page }, { kind: 'offline' }],
		[
			"401 and a proxy's JSON",
			{ status: 401, json: { error: 'unauthorized' } },
			{ kind: 'offline' }
		],
		['a network error', 'network error', { kind: 'offline' }]
	];
	for (const [name, a, expected] of cases) {
		it(`${name} → ${(expected as { kind: string }).kind}`, async () => {
			answer(a);
			expect(await server().getSave()).toEqual(expected);
		});
	}
});
