import type { SaveWrite } from '@mathgame/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	SessionCheck,
	acceptWelcome,
	accountSaveServer,
	accountsReady,
	getAccountSave,
	login,
	logout,
	lookAtWelcome,
	register,
	whoAmI,
	type SessionAnswer
} from '../src/account/api';

/**
 * The account client decides only from the API's own answers (#60): a status
 * with the API's JSON error, never a status alone. And the
 * account's save goes to the server only once the session is known to be this
 * page's account: the cookie names whichever account every save request reaches.
 */

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

type Answer = { status: number; json?: unknown; html?: string } | 'network error';
const page = '<html><body>You are about to visit…</body></html>';

function reply(a: Answer): Response {
	if (a === 'network error') throw new TypeError('Failed to fetch');
	if (a.html !== undefined) {
		return new Response(a.html, { status: a.status, headers: { 'content-type': 'text/html' } });
	}
	return new Response(JSON.stringify(a.json ?? null), {
		status: a.status,
		headers: { 'content-type': 'application/json' }
	});
}

/** Answer every request with `a`, and keep the requests. */
function answer(a: Answer): { url: string; init: RequestInit | undefined }[] {
	const seen: { url: string; init: RequestInit | undefined }[] = [];
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		seen.push({ url, init });
		return reply(a);
	});
	return seen;
}

/** Answer by path: `/api/account/me` and the rest each their own. */
function route(answers: Record<string, Answer>): string[] {
	const seen: string[] = [];
	vi.stubGlobal('fetch', async (url: string) => {
		seen.push(url);
		const a = answers[url];
		if (!a) throw new Error(`unexpected request to ${url}`);
		return reply(a);
	});
	return seen;
}

const doc = { version: 2, home: 7, world: 7, lineage: 'l', seq: 2 } as unknown as SaveWrite;

describe('register', () => {
	const cases: [string, Answer, unknown][] = [
		[
			'201 and the name',
			{ status: 201, json: { user: { name: 'Ida' } } },
			{ kind: 'registered', name: 'Ida' }
		],
		["201 and a tunnel's page", { status: 201, html: page }, { kind: 'offline' }],
		[
			'400 bad name',
			{ status: 400, json: { error: 'bad name', reason: 'rude' } },
			{ kind: 'bad-name', reason: 'rude' }
		],
		[
			'400 bad password',
			{ status: 400, json: { error: 'bad password', reason: 'short' } },
			{ kind: 'bad-password', reason: 'short' }
		],
		['409 name taken', { status: 409, json: { error: 'name taken' } }, { kind: 'taken' }],
		[
			'429 and how long',
			{ status: 429, json: { error: 'too many tries', retryAfter: 120 } },
			{ kind: 'too-many', retryAfter: 120 }
		],
		[
			'400 bad save',
			{ status: 400, json: { error: 'bad save', detail: 'x' } },
			{ kind: 'refused' }
		],
		['403 wrong origin', { status: 403, json: { error: 'wrong origin' } }, { kind: 'refused' }],
		["429 and a proxy's page", { status: 429, html: page }, { kind: 'offline' }],
		['502', { status: 502, html: page }, { kind: 'offline' }],
		['no answer', 'network error', { kind: 'offline' }]
	];
	for (const [what, a, outcome] of cases) {
		it(`${what} → ${JSON.stringify(outcome)}`, async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const seen = answer(a);
			expect(await register('Ida', 'blåbær', doc)).toEqual(outcome);
			expect(seen[0]?.url).toBe('/api/account/register');
			expect(seen[0]?.init?.method).toBe('POST');
			expect(new Headers(seen[0]?.init?.headers).get('content-type')).toBe('application/json');
			expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
				name: 'Ida',
				password: 'blåbær',
				save: doc
			});
		});
	}
});

describe('login and logout', () => {
	const cases: [string, Answer, unknown][] = [
		[
			'200 and the name',
			{ status: 200, json: { user: { name: 'Ida' } } },
			{ kind: 'logged-in', name: 'Ida' }
		],
		[
			'401 wrong name or password',
			{ status: 401, json: { error: 'wrong name or password' } },
			{ kind: 'wrong' }
		],
		["401 and a proxy's page", { status: 401, html: page }, { kind: 'offline' }],
		[
			'429 without a wait',
			{ status: 429, json: { error: 'too many tries' } },
			{ kind: 'too-many', retryAfter: 60 }
		],
		['no answer', 'network error', { kind: 'offline' }]
	];
	for (const [what, a, outcome] of cases) {
		it(`login: ${what} → ${JSON.stringify(outcome)}`, async () => {
			answer(a);
			expect(await login('ida', 'blåbær')).toEqual(outcome);
		});
	}

	it('logout is done only on the API’s own { ok: true }', async () => {
		answer({ status: 200, json: { ok: true } });
		expect(await logout('Ida')).toBe('done');
		answer({ status: 200, html: page });
		expect(await logout('Ida')).toBe('offline');
		answer('network error');
		expect(await logout('Ida')).toBe('offline');
	});
});

describe('a welcome link', () => {
	it('is looked at with its token in a header, never in the path, and names its account only on the API’s own answer', async () => {
		const seen = answer({ status: 200, json: { name: 'Aslak' } });
		expect(await lookAtWelcome('ab_c-d')).toEqual({ kind: 'live', name: 'Aslak' });
		expect(seen[0]?.url).toBe('/api/account/welcome');
		expect(new Headers(seen[0]?.init?.headers).get('x-animath-welcome')).toBe('ab_c-d');
		// Too many looks from here: said so, with the wait, never as a server out of reach.
		answer({ status: 429, json: { error: 'too many tries', retryAfter: 300 } });
		expect(await lookAtWelcome('token')).toEqual({ kind: 'too-many', retryAfter: 300 });
		const cases: [Answer, unknown][] = [
			[
				{ status: 410, json: { error: 'link used' } },
				{ kind: 'gone', why: 'used' }
			],
			[
				{ status: 410, json: { error: 'link expired' } },
				{ kind: 'gone', why: 'expired' }
			],
			[
				{ status: 404, json: { error: 'no such link' } },
				{ kind: 'gone', why: 'unknown' }
			],
			// The API's own 404 for a path it has not got (an older server) is no answer.
			[{ status: 404, json: { error: 'not found' } }, { kind: 'offline' }],
			[{ status: 410, html: page }, { kind: 'offline' }],
			[{ status: 200, json: { name: '' } }, { kind: 'offline' }],
			[{ status: 429, html: page }, { kind: 'offline' }],
			['network error', { kind: 'offline' }]
		];
		for (const [a, outcome] of cases) {
			answer(a);
			expect(await lookAtWelcome('token'), JSON.stringify(a)).toEqual(outcome);
		}
	});

	it('is used with the password picked, and brings the account’s save back', async () => {
		const save = { version: 2, seq: 24614 };
		const seen = answer({ status: 200, json: { user: { name: 'Aslak' }, save } });
		expect(await acceptWelcome('token', 'blåbær')).toEqual({
			kind: 'welcomed',
			name: 'Aslak',
			save
		});
		expect(seen[0]?.url).toBe('/api/account/welcome');
		expect(seen[0]?.init?.method).toBe('POST');
		expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
			token: 'token',
			password: 'blåbær'
		});
		const cases: [Answer, unknown][] = [
			[
				{ status: 200, json: { user: { name: 'Aslak' }, save: null } },
				{ kind: 'welcomed', name: 'Aslak', save: null }
			],
			[{ status: 200, json: { user: { name: 'Aslak' } } }, { kind: 'offline' }],
			[
				{ status: 410, json: { error: 'link used' } },
				{ kind: 'gone', why: 'used' }
			],
			[
				{ status: 410, json: { error: 'link expired' } },
				{ kind: 'gone', why: 'expired' }
			],
			[
				{ status: 404, json: { error: 'no such link' } },
				{ kind: 'gone', why: 'unknown' }
			],
			[
				{ status: 400, json: { error: 'bad password', reason: 'short' } },
				{ kind: 'bad-password', reason: 'short' }
			],
			[
				{ status: 429, json: { error: 'too many tries', retryAfter: 90 } },
				{ kind: 'too-many', retryAfter: 90 }
			],
			[{ status: 200, html: page }, { kind: 'offline' }],
			['network error', { kind: 'offline' }]
		];
		for (const [a, outcome] of cases) {
			answer(a);
			expect(await acceptWelcome('token', 'blåbær'), JSON.stringify(a)).toEqual(outcome);
		}
		vi.spyOn(console, 'error').mockImplementation(() => {});
		answer({ status: 403, json: { error: 'wrong origin' } });
		expect(await acceptWelcome('token', 'blåbær')).toEqual({ kind: 'refused' });
	});
});

describe('whoAmI', () => {
	it('names the account, or nobody, and anything else is no answer', async () => {
		answer({ status: 200, json: { user: { name: 'Ida' } } });
		expect(await whoAmI()).toEqual({ kind: 'user', name: 'Ida' });
		answer({ status: 200, json: { user: null } });
		expect(await whoAmI()).toEqual({ kind: 'user', name: null });
		answer({ status: 200, html: page });
		expect(await whoAmI()).toEqual({ kind: 'offline' });
		answer({ status: 500, json: { error: 'x' } });
		expect(await whoAmI()).toEqual({ kind: 'offline' });
	});
});

describe('accountsReady', () => {
	it("is yes only on the API's own { ready: true }: no answer is a no", async () => {
		const seen = answer({ status: 200, json: { ready: true } });
		expect(await accountsReady()).toBe(true);
		expect(seen.map((r) => r.url)).toEqual(['/api/account/ready']);
		for (const a of [
			{ status: 200, json: { ready: false } },
			{ status: 200, json: { ready: 'true' } },
			{ status: 200, json: null },
			{ status: 200, html: page },
			{ status: 502, html: page },
			{ status: 503, json: { ready: true } },
			'network error'
		] as const) {
			answer(a);
			expect(await accountsReady(), JSON.stringify(a)).toBe(false);
		}
	});
});

describe('SessionCheck', () => {
	it("is live only when the cookie names this page's account, however its name is typed", async () => {
		for (const [said, expected] of [
			[{ user: { name: 'IDA' } }, 'live'],
			[{ user: { name: 'Bo' } }, 'ended'],
			[{ user: null }, 'ended']
		] as const) {
			answer({ status: 200, json: said });
			expect(await new SessionCheck('Ida').check()).toBe(expected);
		}
	});

	it('asks once, and again only after no answer', async () => {
		const heard: SessionAnswer[] = [];
		const check = new SessionCheck('Ida', (a) => heard.push(a));
		const seen = answer('network error');
		expect(await check.check()).toBe('offline');
		answer({ status: 200, json: { user: { name: 'Ida' } } });
		expect(await check.check()).toBe('live');
		const later = answer({ status: 200, json: { user: null } });
		expect(await check.check()).toBe('live');
		expect(later).toHaveLength(0);
		expect(seen).toHaveLength(1);
		expect(heard).toEqual(['offline', 'live']);
	});
});

describe("the account's save, as the autosave's server", () => {
	const me = '/api/account/me';
	const save = '/api/account/save';

	it('sends nothing to the save routes while the session is not this account’s', async () => {
		const seen = route({ [me]: { status: 200, json: { user: { name: 'Bo' } } } });
		const server = accountSaveServer(new SessionCheck('Ida'));
		expect(await server.getSave()).toEqual({ kind: 'logged-out' });
		expect(await server.putSave(doc)).toEqual({ kind: 'logged-out' });
		expect(seen).toEqual([me]);
	});

	it('waits out a server it cannot reach, and asks who it is again next time', async () => {
		const seen = route({ [me]: 'network error' });
		const server = accountSaveServer(new SessionCheck('Ida'));
		expect(await server.putSave(doc)).toEqual({ kind: 'offline' });
		expect(await server.getSave()).toEqual({ kind: 'offline' });
		expect(seen).toEqual([me, me]);
	});

	it('maps each answer of the save routes, once the session is this account’s', async () => {
		const cases: [Answer, unknown][] = [
			[{ status: 200, json: { ok: true } }, { kind: 'saved' }],
			[{ status: 409, json: { error: 'higher', save: doc } }, { kind: 'conflict' }],
			[{ status: 401, json: { error: 'not logged in' } }, { kind: 'logged-out' }],
			[
				{ status: 400, json: { error: 'bad save' } },
				{ kind: 'refused', error: 'bad save' }
			],
			[
				{ status: 413, json: { error: 'big' } },
				{ kind: 'refused', error: 'big' }
			],
			// Too many saves a minute: waited out, like an unreachable server.
			[{ status: 429, json: { error: 'too many tries', retryAfter: 30 } }, { kind: 'offline' }],
			[{ status: 401, html: page }, { kind: 'offline' }],
			['network error', { kind: 'offline' }]
		];
		for (const [a, outcome] of cases) {
			route({ [me]: { status: 200, json: { user: { name: 'Ida' } } }, [save]: a });
			const server = accountSaveServer(new SessionCheck('Ida'));
			expect(await server.putSave(doc), JSON.stringify(a)).toEqual(outcome);
		}
		route({
			[me]: { status: 200, json: { user: { name: 'Ida' } } },
			[save]: { status: 200, json: doc }
		});
		expect(await accountSaveServer(new SessionCheck('Ida')).getSave()).toEqual({
			kind: 'found',
			doc
		});
		route({
			[me]: { status: 200, json: { user: { name: 'Ida' } } },
			[save]: { status: 404, json: { error: 'no save yet' } }
		});
		expect(await accountSaveServer(new SessionCheck('Ida')).getSave()).toEqual({ kind: 'none' });
	});

	it('names its account in each request to the save routes and in the logout', async () => {
		const heard: [string, string | null][] = [];
		vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
			heard.push([url, new Headers(init?.headers).get('x-animath-account')]);
			if (url === me) return reply({ status: 200, json: { user: { name: 'Søren' } } });
			return reply({ status: 200, json: init?.method === undefined ? doc : { ok: true } });
		});
		const server = accountSaveServer(new SessionCheck('SØREN'));
		expect(await server.getSave()).toEqual({ kind: 'found', doc });
		expect(await server.putSave(doc)).toEqual({ kind: 'saved' });
		expect(await getAccountSave('søren ')).toEqual({ kind: 'found', doc });
		expect(await logout('Søren')).toBe('done');
		// The name as the page has it: the server keys it by its own Unicode tables.
		expect(heard).toEqual([
			[me, null],
			[save, 'S%C3%98REN'],
			[save, 'S%C3%98REN'],
			[save, 's%C3%B8ren%20'],
			['/api/account/logout', 'S%C3%B8ren']
		]);
	});

	it('start-up waits no longer than it asked, for the check and the save together', async () => {
		vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
			if (url === me) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				return reply({ status: 200, json: { user: { name: 'Ida' } } });
			}
			// The save never answers: only the abort ends the wait, as with a real fetch.
			return new Promise<Response>((_, reject) =>
				init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')))
			);
		});
		const server = accountSaveServer(new SessionCheck('Ida'));
		const started = Date.now();
		// 120 ms in all: not 100 for the check and then 120 more for the save.
		expect(await server.getSave(120)).toEqual({ kind: 'offline' });
		expect(Date.now() - started).toBeLessThan(180);
	});

	it('start-up waits no longer than it asked, the session check included', async () => {
		vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
		const server = accountSaveServer(new SessionCheck('Ida'));
		const started = Date.now();
		expect(await server.getSave(50)).toEqual({ kind: 'offline' });
		expect(Date.now() - started).toBeLessThan(2000);
	});
});
