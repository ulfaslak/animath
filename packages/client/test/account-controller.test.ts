import {
	newGame,
	saveDocument,
	type GameEvent,
	type SaveWrite,
	type SavedGame
} from '@mathgame/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountController } from '../src/account/controller';
import type { AccountNote } from '../src/account/restart';
import { currentAccount, gameKeys, logoutPending, rememberLogout } from '../src/account/session';
import { PICK_QUIET_SECONDS } from '../src/input/pick-guard';
import { REVEAL_KEY, rowKey } from '../src/input/press';
import { KEYS, type KeyValueStore } from '../src/save/storage';
import { account } from '../src/state/account.svelte';

/**
 * The account screens' keys and what they do ([[UI_SPEC]] § Accounts): the
 * card checks a name and a password by the engine's rules before it asks the
 * server, says kindly why not, and only a real answer moves a game; the
 * hourly card waits its quiet moment and says "not now" on Escape.
 */

type Key = KeyboardEvent & { prevented: boolean };
function key(name: string, options: { repeat?: boolean } = {}): Key {
	const event = {
		key: name,
		code: '',
		repeat: options.repeat ?? false,
		isComposing: false,
		keyCode: 0,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		prevented: false,
		preventDefault() {
			event.prevented = true;
		}
	};
	return event as unknown as Key;
}

class MemoryStore implements KeyValueStore {
	data = new Map<string, string>();
	get(key: string): string | null {
		return this.data.get(key) ?? null;
	}
	set(key: string, value: string): boolean {
		this.data.set(key, value);
		return true;
	}
	remove(key: string): void {
		this.data.delete(key);
	}
}

function saveText(seq: number, name: string | null = 'Ida', lineage = 'game-a'): string {
	const game: SavedGame = { ...newGame(1, { id: 'a', speciesId: 'rabbit', hp: 5 }), name };
	return JSON.stringify(saveDocument(game, { lineage, seq }));
}

type Answer = { status: number; json?: unknown } | 'network error';
/** Answer each path (or `METHOD path`, where one path takes two methods); keep every request made. */
function server(answers: Record<string, Answer | (() => Answer)>) {
	const requests: {
		url: string;
		method: string;
		body: unknown;
		account: string | null;
		welcome: string | null;
	}[] = [];
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		const headers = new Headers(init?.headers);
		requests.push({
			url,
			method,
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
			account: headers.get('x-animath-account'),
			welcome: headers.get('x-animath-welcome')
		});
		const a = answers[`${method} ${url}`] ?? answers[url];
		const got = typeof a === 'function' ? a() : a;
		if (!got) throw new Error(`unexpected request to ${url}`);
		if (got === 'network error') throw new TypeError('Failed to fetch');
		return new Response(JSON.stringify(got.json ?? null), {
			status: got.status,
			headers: { 'content-type': 'application/json' }
		});
	});
	return requests;
}

function setup(playerName: string | null = 'Ida', currentSave?: () => SaveWrite | null) {
	const store = new MemoryStore();
	const restarts: AccountNote[] = [];
	const events: string[] = [];
	/** The welcome link forgotten by the tab, and the restarts, in the order they came. */
	const welcomeSteps: string[] = [];
	const controller = new AccountController({
		store,
		flush: () => events.push('flush'),
		currentSave,
		pushNow: async () => {
			events.push('pushNow');
			return true;
		},
		playerName: () => playerName,
		answered: () => events.push('answered'),
		restart: (note) => {
			welcomeSteps.push(`restart:${note}`);
			restarts.push(note);
		},
		forgetWelcome: () => welcomeSteps.push('forgetWelcome')
	});
	const press = (...names: string[]) => {
		let last = key('');
		for (const n of names) controller.onKey((last = key(n)));
		return last;
	};
	/** Let the quiet moment pass, a frame at a time. */
	const quiet = () => {
		for (let t = 0; t < PICK_QUIET_SECONDS + 0.05; t += 0.1) controller.update(0.1);
	};
	return { store, controller, restarts, events, welcomeSteps, press, quiet };
}

/** Let the requests a submit started run to their end. */
async function answered(): Promise<void> {
	for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
	Object.assign(account, {
		name: null,
		session: 'unknown',
		// A server that can keep an account, unless a test says otherwise.
		ready: true,
		card: null,
		prompt: false,
		busy: false,
		leaving: false,
		problem: null
	});
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('the account card', () => {
	it('opens with the player’s name in its box and the password to type; Escape closes it', () => {
		const { controller, press } = setup('Ida');
		controller.openRegister('pause');
		expect(account.card).toBe('register');
		expect(account.from).toBe('pause');
		expect(account.nameDraft).toBe('Ida');
		expect(account.field).toBe('password');
		press('Escape');
		expect(account.card).toBeNull();
	});

	it('Tab moves between the boxes, the show button shows the password, and typing again clears a problem', () => {
		const { controller, press } = setup(null);
		controller.openLogin('title');
		expect(account.field).toBe('name');
		expect(press('Tab').prevented).toBe(true);
		expect(account.field).toBe('password');
		press(REVEAL_KEY);
		expect(account.reveal).toBe(true);
		press(REVEAL_KEY);
		expect(account.reveal).toBe(false);
		account.problem = { kind: 'wrong' };
		press('Shift');
		expect(account.problem).not.toBeNull();
		press('x');
		expect(account.problem).toBeNull();
	});

	it('Enter waits its quiet moment, and from the name box goes on to the password first', () => {
		const requests = server({});
		const { controller, press, quiet } = setup(null);
		controller.openLogin('title');
		account.nameDraft = 'Ida';
		press('Enter');
		expect(account.field).toBe('name');
		quiet();
		press('Enter');
		expect(account.field).toBe('password');
		expect(requests).toEqual([]);
	});
});

describe('making an account', () => {
	it('says kindly why a name or a password will not do, before asking the server', () => {
		const requests = server({});
		const { controller, press, quiet } = setup('Ida');
		controller.openRegister('prompt');
		account.nameDraft = 'X';
		account.passwordDraft = 'secret';
		quiet();
		press('Enter');
		expect(account.problem).toEqual({ kind: 'name', reason: 'short' });
		expect(account.field).toBe('name');
		account.nameDraft = 'Ida';
		account.passwordDraft = 'abc';
		quiet();
		press('Enter');
		expect(account.problem).toEqual({ kind: 'password', reason: 'short' });
		expect(requests).toEqual([]);
	});

	it('takes the guest game along, named, moves it in and starts again, saying so', async () => {
		const requests = server({
			'/api/account/register': { status: 201, json: { user: { name: 'Ida B' } } }
		});
		const { store, controller, restarts, events, press, quiet } = setup('Ida');
		store.set(KEYS.save, saveText(12));
		controller.openRegister('prompt');
		account.nameDraft = '  Ida   B ';
		account.passwordDraft = 'blåbær';
		quiet();
		press('Enter');
		expect(account.busy).toBe(true);
		// Busy: nothing changes the card, and no second request goes.
		quiet();
		expect(press('Enter').prevented).toBe(true);
		await answered();
		expect(requests).toHaveLength(1);
		expect(requests[0]?.body).toMatchObject({ name: 'Ida B', password: 'blåbær' });
		expect((requests[0]?.body as { save: { name: string; seq: number } }).save).toMatchObject({
			name: 'Ida B',
			seq: 12
		});
		expect(events).toContain('flush');
		expect(currentAccount(store)).toEqual({ name: 'Ida B' });
		expect(store.get(KEYS.save)).toBeNull();
		expect(JSON.parse(store.get(gameKeys({ name: 'Ida B' }).save)!).name).toBe('Ida B');
		expect(restarts).toEqual(['saved']);
	});

	it('takes the game on screen along, not an older copy the browser kept (its storage full)', async () => {
		const requests = server({
			'/api/account/register': { status: 201, json: { user: { name: 'Ida' } } }
		});
		const onScreen = JSON.parse(saveText(15, 'Guest')) as SaveWrite;
		const { store, controller, press, quiet } = setup('Ida', () => onScreen);
		store.set(KEYS.save, saveText(12, 'Guest'));
		controller.openRegister('pause');
		account.passwordDraft = 'secret';
		quiet();
		press('Enter');
		await answered();
		expect((requests[0]?.body as { save: SaveWrite }).save).toMatchObject({ name: 'Ida', seq: 15 });
	});

	it('made, but in a browser that keeps nothing: said kindly, and no start as a guest again', async () => {
		server({ '/api/account/register': { status: 201, json: { user: { name: 'Ida' } } } });
		const { store, controller, restarts, press, quiet } = setup('Ida');
		const guest = saveText(5);
		store.set(KEYS.save, guest);
		// The browser's storage refuses every write from here on.
		store.set = () => false;
		controller.openRegister('pause');
		account.passwordDraft = 'secret';
		quiet();
		press('Enter');
		await answered();
		expect(account.problem).toEqual({ kind: 'storage' });
		expect(account.busy).toBe(false);
		expect(restarts).toEqual([]);
		expect(store.get(KEYS.save)).toBe(guest);
	});

	it('a taken name, too many tries or no server: said kindly, and nothing moved', async () => {
		for (const [a, problem] of [
			[{ status: 409, json: { error: 'name taken' } }, { kind: 'taken' }],
			[
				{ status: 429, json: { error: 'too many tries', retryAfter: 125 } },
				{ kind: 'too-many', minutes: 3 }
			],
			['network error', { kind: 'offline' }]
		] as const) {
			server({ '/api/account/register': a });
			const { store, controller, restarts, press, quiet } = setup('Ida');
			const guest = saveText(5);
			store.set(KEYS.save, guest);
			controller.openRegister('pause');
			account.passwordDraft = 'secret';
			quiet();
			press('Enter');
			await answered();
			expect(account.problem, JSON.stringify(a)).toEqual(problem);
			expect(account.busy).toBe(false);
			expect(account.card).toBe('register');
			expect(store.get(KEYS.save)).toBe(guest);
			expect(currentAccount(store)).toBeNull();
			expect(restarts).toEqual([]);
		}
	});
});

describe('logging in', () => {
	it('an empty name or a password too short to be anyone’s is said at once, with no request', () => {
		const requests = server({});
		const { controller, press, quiet } = setup(null);
		controller.openLogin('title');
		account.passwordDraft = 'secret';
		quiet();
		press('Enter');
		expect(account.problem).toEqual({ kind: 'name', reason: 'empty' });
		account.nameDraft = 'Ida';
		account.passwordDraft = 'no';
		quiet();
		press('Enter');
		expect(account.problem).toEqual({ kind: 'wrong' });
		expect(requests).toEqual([]);
	});

	it('a logout the server never heard waits aside while this browser logs in or registers, and is moot once it has', async () => {
		let store = new MemoryStore();
		const waitingWhileAsked: (string | null)[] = [];
		const asked = (a: Answer) => () => {
			waitingWhileAsked.push(logoutPending(store));
			return a;
		};
		const requests = server({
			'/api/account/login': asked({ status: 200, json: { user: { name: 'Ida' } } }),
			'/api/account/save': { status: 404, json: { error: 'no save yet' } },
			'/api/account/register': asked({ status: 201, json: { user: { name: 'Bo' } } })
		});
		for (const card of ['login', 'register'] as const) {
			const page = setup(card === 'login' ? null : 'Bo');
			store = page.store;
			rememberLogout(store, 'Old');
			if (card === 'login') page.controller.openLogin('title');
			else page.controller.openRegister('pause');
			account.nameDraft = card === 'login' ? 'Ida' : 'Bo';
			account.passwordDraft = 'secret';
			page.quiet();
			page.press('Enter');
			await answered();
			// Nothing waited while the server was asked: a page starting then sends no logout.
			expect(waitingWhileAsked, card).toEqual([null]);
			waitingWhileAsked.length = 0;
			expect(logoutPending(store), card).toBeNull();
		}
		// The login's own save request names the account it logged in to.
		expect(requests.find((r) => r.url === '/api/account/save')?.account).toBe('Ida');
	});

	it('a login or a registration that fails leaves the waiting logout to be sent', async () => {
		server({
			'/api/account/login': { status: 401, json: { error: 'wrong name or password' } },
			'/api/account/register': 'network error'
		});
		for (const card of ['login', 'register'] as const) {
			const { store, controller, press, quiet } = setup(card === 'login' ? null : 'Bo');
			rememberLogout(store, 'Old');
			if (card === 'login') controller.openLogin('title');
			else controller.openRegister('pause');
			account.nameDraft = card === 'login' ? 'Ida' : 'Bo';
			account.passwordDraft = 'secret';
			quiet();
			press('Enter');
			await answered();
			expect(logoutPending(store), card).toBe('Old');
		}
	});

	it("takes the account's save when it is further along, leaves the guest game alone, and starts again in the account", async () => {
		server({
			'/api/account/login': { status: 200, json: { user: { name: 'Ida' } } },
			'/api/account/save': { status: 200, json: JSON.parse(saveText(30, 'Ida', 'theirs')) }
		});
		const { store, controller, restarts, press, quiet } = setup(null);
		const guest = saveText(4, 'Guest', 'guest');
		store.set(KEYS.save, guest);
		controller.openLogin('title');
		account.nameDraft = 'ida';
		account.passwordDraft = 'blåbær';
		quiet();
		press('Enter');
		await answered();
		expect(JSON.parse(store.get(gameKeys({ name: 'Ida' }).save)!).seq).toBe(30);
		expect(store.get(KEYS.save)).toBe(guest);
		expect(currentAccount(store)).toEqual({ name: 'Ida' });
		expect(restarts).toEqual(['welcome']);
	});

	it('a wrong password is said kindly, and the password box has the typing again', async () => {
		server({ '/api/account/login': { status: 401, json: { error: 'wrong name or password' } } });
		const { store, controller, restarts, press, quiet } = setup(null);
		controller.openLogin('title');
		account.nameDraft = 'Ida';
		account.passwordDraft = 'guess';
		account.field = 'name';
		quiet();
		press('Enter');
		await answered();
		expect(account.problem).toEqual({ kind: 'wrong' });
		expect(account.field).toBe('password');
		expect(currentAccount(store)).toBeNull();
		expect(restarts).toEqual([]);
	});
});

describe('the welcome link', () => {
	const TOKEN = 'T0k3n_for-the-kid';
	const look = 'GET /api/account/welcome';
	const use = 'POST /api/account/welcome';
	const live: Answer = { status: 200, json: { name: 'Aslak' } };
	/** The requests made, as `METHOD path`. */
	const said = (requests: { method: string; url: string }[]) =>
		requests.map((r) => `${r.method} ${r.url}`);

	/** Open the card, and let the server say whose account the link opens. */
	async function opened(controller: AccountController): Promise<void> {
		controller.openWelcome(TOKEN);
		expect(account.card).toBe('welcome');
		expect(account.welcome).toEqual({ phase: 'checking' });
		await answered();
	}

	it('asks whose account the link opens, then takes the password for it; the view never holds the token', async () => {
		server({ [look]: live });
		const { controller, press } = setup(null);
		await opened(controller);
		expect(account.welcome).toEqual({ phase: 'ready', name: 'Aslak' });
		expect(account.field).toBe('password');
		// The name is the account's: Tab leaves the typing in the password.
		press('Tab');
		expect(account.field).toBe('password');
		const view = [account.welcome, account.nameDraft, account.passwordDraft, account.problem];
		expect(JSON.stringify(view)).not.toContain(TOKEN);
	});

	it('logs in with the password picked: the account’s save in its own keys, the guest game untouched, the page started again', async () => {
		const theirs = JSON.parse(saveText(24614, 'Aslak', 'kid'));
		const requests = server({
			[look]: live,
			[use]: { status: 200, json: { user: { name: 'Aslak' }, save: theirs } }
		});
		const { store, controller, restarts, events, welcomeSteps, press, quiet } = setup(null);
		const guest = saveText(4, 'Guest', 'guest');
		store.set(KEYS.save, guest);
		rememberLogout(store, 'Old');
		await opened(controller);
		account.passwordDraft = 'blåbær';
		quiet();
		press('Enter');
		await answered();
		// The token in a header, then in the body: never in a path.
		expect(requests).toEqual([
			{
				url: '/api/account/welcome',
				method: 'GET',
				body: undefined,
				account: null,
				welcome: TOKEN
			},
			{
				url: '/api/account/welcome',
				method: 'POST',
				body: { token: TOKEN, password: 'blåbær' },
				account: null,
				welcome: null
			}
		]);
		// The tab forgets the link before the page starts again, or the next start would reopen it.
		expect(welcomeSteps).toEqual(['forgetWelcome', 'restart:welcome']);
		expect(JSON.parse(store.get(gameKeys({ name: 'Aslak' }).save)!)).toEqual(theirs);
		expect(store.get(KEYS.save)).toBe(guest);
		expect(currentAccount(store)).toEqual({ name: 'Aslak' });
		// The new session ended the old one: the logout waiting is moot.
		expect(logoutPending(store)).toBeNull();
		expect(events).toContain('flush');
		expect(restarts).toEqual(['welcome']);
	});

	it('a password the rules refuse is said at once, with nothing sent, and the link waits', async () => {
		const requests = server({ [look]: live });
		const { controller, press, quiet, restarts } = setup(null);
		await opened(controller);
		account.passwordDraft = 'ab';
		quiet();
		press('Enter');
		await answered();
		expect(account.problem).toEqual({ kind: 'password', reason: 'short' });
		expect(said(requests)).toEqual([look]);
		expect(restarts).toEqual([]);
	});

	it('a spent link says so kindly: Enter opens the login card, Escape leaves the card for the title', async () => {
		const spent: [Answer, string][] = [
			[{ status: 410, json: { error: 'link used' } }, 'used'],
			[{ status: 410, json: { error: 'link expired' } }, 'expired'],
			[{ status: 404, json: { error: 'no such link' } }, 'unknown']
		];
		for (const [answer, why] of spent) {
			server({ [look]: answer });
			const { controller, welcomeSteps, press, quiet } = setup(null);
			await opened(controller);
			expect(account.welcome, why).toEqual({ phase: 'gone', why });
			// A spent link is no use to the tab's next start.
			expect(welcomeSteps).toEqual(['forgetWelcome']);
			// Enter mashed as the card turned picks nothing.
			press('Enter');
			expect(account.card).toBe('welcome');
			quiet();
			press('Enter');
			expect(account.card).toBe('login');
			expect(account.from).toBe('title');
			await opened(controller);
			press('Escape');
			expect(account.card).toBeNull();
		}
	});

	it('a spent link offers no login while the server cannot keep an account, and offers it once it can', async () => {
		server({ [look]: { status: 410, json: { error: 'link used' } } });
		const { controller, press, quiet } = setup(null);
		account.ready = false;
		await opened(controller);
		expect(account.welcome).toEqual({ phase: 'gone', why: 'used' });
		quiet();
		press('Enter');
		expect(account.card).toBe('welcome');
		controller.heardReady(true);
		quiet();
		press('Enter');
		expect(account.card).toBe('login');
	});

	it('a link used meanwhile, between the look and the password, turns the card to the spent one', async () => {
		const requests = server({
			[look]: live,
			[use]: { status: 410, json: { error: 'link used' } }
		});
		const { store, controller, restarts, press, quiet } = setup(null);
		rememberLogout(store, 'Old');
		await opened(controller);
		account.passwordDraft = 'blåbær';
		quiet();
		press('Enter');
		await answered();
		expect(account.welcome).toEqual({ phase: 'gone', why: 'used' });
		expect(account.busy).toBe(false);
		expect(currentAccount(store)).toBeNull();
		expect(logoutPending(store)).toBe('Old');
		expect(restarts).toEqual([]);
		expect(said(requests).filter((r) => r === use)).toHaveLength(1);
	});

	it('with no answer, the password is kept to try again, and the look asks again on Enter', async () => {
		let up = false;
		const requests = server({
			[look]: () => (up ? live : 'network error'),
			[use]: () =>
				up ? { status: 200, json: { user: { name: 'Aslak' }, save: null } } : 'network error'
		});
		const { controller, welcomeSteps, press, quiet, restarts } = setup(null);
		await opened(controller);
		expect(account.welcome).toEqual({ phase: 'unreachable' });
		// No answer is no reason to drop the link: the tab keeps it for a reload.
		expect(welcomeSteps).toEqual([]);
		up = true;
		quiet();
		press('Enter');
		expect(account.welcome).toEqual({ phase: 'checking' });
		await answered();
		expect(account.welcome).toEqual({ phase: 'ready', name: 'Aslak' });
		up = false;
		account.passwordDraft = 'blåbær';
		quiet();
		press('Enter');
		await answered();
		expect(account.problem).toEqual({ kind: 'offline' });
		expect(account.passwordDraft).toBe('blåbær');
		up = true;
		quiet();
		press('Enter');
		await answered();
		expect(restarts).toEqual(['welcome']);
		expect(said(requests).filter((r) => r === look)).toHaveLength(2);
		expect(said(requests).filter((r) => r === use)).toHaveLength(2);
	});

	it('too many looks from here says so, with the wait, and Try again stays', async () => {
		let limited = true;
		server({
			[look]: () =>
				limited ? { status: 429, json: { error: 'too many tries', retryAfter: 290 } } : live
		});
		const { controller, welcomeSteps, press, quiet } = setup(null);
		await opened(controller);
		expect(account.welcome).toEqual({ phase: 'unreachable', minutes: 5 });
		expect(welcomeSteps).toEqual([]);
		limited = false;
		quiet();
		press('Enter');
		await answered();
		expect(account.welcome).toEqual({ phase: 'ready', name: 'Aslak' });
	});

	it('Escape puts the card away and the link with it; an answer that comes after changes nothing', async () => {
		const requests = server({ [look]: live });
		const { controller, welcomeSteps, press, quiet } = setup(null);
		controller.openWelcome(TOKEN);
		press('Escape');
		expect(welcomeSteps).toEqual(['forgetWelcome']);
		await answered();
		expect(account.card).toBeNull();
		account.passwordDraft = 'blåbær';
		quiet();
		press('Enter');
		await answered();
		expect(said(requests)).toEqual([look]);
		// A card that took its place while the server was asked is left as it is.
		controller.openWelcome(TOKEN);
		controller.openLogin('title');
		await answered();
		expect(account.card).toBe('login');
	});

	it('a browser that keeps nothing sends nothing: the link waits for one that can', async () => {
		const requests = server({ [look]: live });
		const controller = new AccountController({
			store: null,
			flush: () => {},
			pushNow: async () => true,
			playerName: () => null,
			answered: () => {},
			restart: () => {
				throw new Error('no restart expected');
			}
		});
		controller.openWelcome(TOKEN);
		await answered();
		account.passwordDraft = 'blåbær';
		for (let t = 0; t < PICK_QUIET_SECONDS + 0.05; t += 0.1) controller.update(0.1);
		controller.onKey(key('Enter'));
		await answered();
		expect(account.problem).toEqual({ kind: 'storage' });
		expect(said(requests)).toEqual([look]);
	});
});

describe('logging out', () => {
	it('saves, sends the newest save, ends the session, and starts again as a guest', async () => {
		const requests = server({ '/api/account/logout': { status: 200, json: { ok: true } } });
		const { store, controller, restarts, events } = setup();
		store.set('animath.account', JSON.stringify({ name: 'Søren' }));
		account.name = 'Søren';
		await controller.logOut();
		expect(events).toEqual(['flush', 'pushNow']);
		// The logout names its account: a session another tab made for another one stays.
		expect(requests.map((r) => [r.url, r.account])).toEqual([
			['/api/account/logout', 'S%C3%B8ren']
		]);
		expect(currentAccount(store)).toBeNull();
		expect(logoutPending(store)).toBeNull();
		expect(restarts).toEqual(['loggedOut']);
	});

	it('with the server out of reach, logs out here and sends the logout at the next start', async () => {
		server({ '/api/account/logout': 'network error' });
		const { store, controller, restarts } = setup();
		store.set('animath.account', JSON.stringify({ name: 'Ida' }));
		account.name = 'Ida';
		await controller.logOut();
		expect(currentAccount(store)).toBeNull();
		expect(logoutPending(store)).toBe('Ida');
		expect(restarts).toEqual(['loggedOut']);
	});
});

describe('the hourly card', () => {
	it('waits its quiet moment; "Save my game" opens the card to make an account', () => {
		const { controller, events, press, quiet } = setup('Ida');
		controller.openPrompt();
		expect(account.prompt).toBe(true);
		press('Enter');
		expect(account.prompt).toBe(true);
		quiet();
		press('Enter');
		expect(account.prompt).toBe(false);
		expect(events).toEqual(['answered']);
		expect(account.card).toBe('register');
		expect(account.from).toBe('prompt');
	});

	it('"Not now", or Escape, goes back to the game until another hour has passed', () => {
		const { controller, events, press, quiet } = setup();
		controller.openPrompt();
		quiet();
		press('ArrowRight', 'ArrowRight');
		expect(account.promptChoice).toBe(1);
		press('Enter');
		expect(account.prompt).toBe(false);
		expect(account.card).toBeNull();
		controller.openPrompt();
		press('Escape');
		expect(account.prompt).toBe(false);
		expect(account.card).toBeNull();
		expect(events).toEqual(['answered', 'answered']);
	});

	it('goes away unanswered when a battle, the doctor or the title takes the screen, and comes back later', () => {
		const { controller, events } = setup();
		for (const type of ['battle-started', 'doctor-visit-started', 'game-left'] as const) {
			controller.openPrompt();
			controller.handle({ type } as GameEvent);
			expect(account.prompt, type).toBe(false);
		}
		controller.handle({ type: 'player-moved' } as GameEvent);
		expect(events).toEqual([]);
	});

	it('a tap on a choice picks it, after the quiet moment too', () => {
		const { controller, press, quiet } = setup();
		controller.openPrompt();
		press(rowKey(1));
		expect(account.prompt).toBe(true);
		quiet();
		press(rowKey(1));
		expect(account.prompt).toBe(false);
		expect(account.card).toBeNull();
	});

	it('never comes while the server cannot keep an account: "Save my game" would be a broken promise', () => {
		const { controller, events } = setup();
		controller.heardReady(false);
		controller.openPrompt();
		expect(account.prompt).toBe(false);
		// Once the server can, the hour that was due brings it.
		controller.heardReady(true);
		controller.openPrompt();
		expect(account.prompt).toBe(true);
		expect(events).toEqual([]);
	});

	it('goes, unanswered, when the server stops keeping accounts; an account card up stays, with its typing', () => {
		const { controller, events, press, quiet } = setup('Ida');
		controller.openPrompt();
		controller.heardReady(false);
		expect(account.prompt).toBe(false);
		expect(events).toEqual([]);
		controller.heardReady(true);
		controller.openPrompt();
		quiet();
		press('Enter');
		expect(account.card).toBe('register');
		account.passwordDraft = 'pip';
		controller.heardReady(false);
		expect([account.card, account.passwordDraft]).toEqual(['register', 'pip']);
	});
});
