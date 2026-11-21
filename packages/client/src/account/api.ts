import {
	isNameRejection,
	isPasswordRefusal,
	nameKey,
	type NameRejection,
	type PasswordRefusal,
	type SaveWrite
} from '@mathgame/engine';
import {
	errorOf,
	isStored,
	isStoredSave,
	send,
	type SaveServer,
	type ServerRead,
	type ServerWrite
} from '../save/api';
import type { WelcomeGone } from '../state/account.svelte';

/**
 * The account routes ([[ARCHITECTURE]] § HTTP API), reduced to what the game
 * does next. As `save/api.ts` says, every outcome needs the
 * API's own JSON answer; anything else (no answer, a proxy's page, a 5xx) is
 * `offline`, and nothing is decided from it. The session is the browser's
 * `HttpOnly` cookie: this page never sees it, and sends it with every request
 * to its own origin.
 */

export type RegisterResult =
	| { kind: 'registered'; name: string }
	| { kind: 'bad-name'; reason: NameRejection }
	| { kind: 'bad-password'; reason: PasswordRefusal }
	| { kind: 'taken' }
	| { kind: 'too-many'; retryAfter: number }
	/** The server refused what this build sent (a save it won't take): a bug, said to developers. */
	| { kind: 'refused' }
	| { kind: 'offline' };

export type LoginResult =
	| { kind: 'logged-in'; name: string }
	/** A wrong password, or a name with no account: the server does not say which. */
	| { kind: 'wrong' }
	/** A login by name alone, and this browser is not that account's own (or there is no such account). */
	| { kind: 'not-home' }
	| { kind: 'too-many'; retryAfter: number }
	| { kind: 'refused' }
	| { kind: 'offline' };

/**
 * A new password: on the account's own browser it needs nothing more, on
 * any other the password now.
 */
export type PasswordResult =
	| { kind: 'changed' }
	| { kind: 'bad-password'; reason: PasswordRefusal }
	/** This browser is not the account's own, and no password now came with it. */
	| { kind: 'not-home' }
	/** The password now was not the account's. */
	| { kind: 'wrong' }
	| { kind: 'logged-out' }
	/** The account took a new name somewhere else first: this page plays it by its old one. */
	| { kind: 'renamed'; name: string }
	| { kind: 'too-many'; retryAfter: number }
	| { kind: 'refused' }
	| { kind: 'offline' };

/** A new name, as `PasswordResult` is a new password: `name` as the server keeps it. */
export type RenameResult =
	| { kind: 'renamed'; name: string }
	| { kind: 'bad-name'; reason: NameRejection }
	| { kind: 'taken' }
	| { kind: 'not-home' }
	| { kind: 'wrong' }
	| { kind: 'logged-out' }
	| { kind: 'renamed-before'; name: string }
	| { kind: 'too-many'; retryAfter: number }
	| { kind: 'refused' }
	| { kind: 'offline' };

/**
 * Who the session cookie belongs to: an account's name, or `null` for nobody;
 * `home`: this browser is that account's own (`home.ts` on the server);
 * `renamed`: the account the page named is this one, which has a new name
 * since (`name`).
 */
export type WhoResult =
	{ kind: 'user'; name: string | null; home: boolean; renamed: boolean } | { kind: 'offline' };

/** What a welcome link is, as the server says: whose (and only that), or why it won't do. */
export type WelcomeLook =
	| { kind: 'live'; name: string }
	| { kind: 'gone'; why: WelcomeGone }
	/** Too many looks and uses from here lately: the server says how long to wait. */
	| { kind: 'too-many'; retryAfter: number }
	| { kind: 'offline' };

export type WelcomeResult =
	/** Logged in; `save` is the account's, for the browser to take (null with none). */
	| { kind: 'welcomed'; name: string; save: unknown }
	| { kind: 'gone'; why: WelcomeGone }
	| { kind: 'bad-password'; reason: PasswordRefusal }
	| { kind: 'too-many'; retryAfter: number }
	| { kind: 'refused' }
	| { kind: 'offline' };

/** The server's error texts the game tells apart. */
const ERRORS = {
	badName: 'bad name',
	badPassword: 'bad password',
	taken: 'name taken',
	wrong: 'wrong name or password',
	notHome: 'not home',
	wrongPassword: 'wrong password',
	renamed: 'account renamed',
	tooMany: 'too many tries',
	notLoggedIn: 'not logged in',
	noSave: 'no save yet',
	linkUsed: 'link used',
	linkExpired: 'link expired',
	noLink: 'no such link'
} as const;

/** A spent welcome link, from the server's own answer: 410 used or expired, 404 no link. */
function welcomeGone(res: { status: number; body: unknown }): WelcomeGone | null {
	const error = errorOf(res.body);
	if (res.status === 410 && error === ERRORS.linkUsed) return 'used';
	if (res.status === 410 && error === ERRORS.linkExpired) return 'expired';
	if (res.status === 404 && error === ERRORS.noLink) return 'unknown';
	return null;
}

const JSON_TYPE = { 'content-type': 'application/json' };

function field(body: unknown, key: string): unknown {
	return typeof body === 'object' && body !== null
		? (body as Record<string, unknown>)[key]
		: undefined;
}

/** The account name in a `{ user: { name } }` answer. */
function userName(body: unknown): string | null {
	const name = field(field(body, 'user'), 'name');
	return typeof name === 'string' ? name : null;
}

/**
 * The name the account has now, from the server's `401 account renamed`: the
 * page named its account by a name it had before. Null for any other answer.
 */
export function renamedTo(res: { status: number; body: unknown }): string | null {
	if (res.status !== 401 || errorOf(res.body) !== ERRORS.renamed) return null;
	const name = field(res.body, 'name');
	return typeof name === 'string' && name !== '' ? name : null;
}

/** How long a `429` says to wait, in seconds (a minute when it does not say). */
function retryAfter(body: unknown): number {
	const seconds = field(body, 'retryAfter');
	return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
}

/** A refusal that means this build sent the server something it won't take: say it to developers. */
function refused(what: string, res: { status: number; body: unknown }): { kind: 'refused' } {
	console.error(`Animath: the server refused ${what}: ${res.status} ${errorOf(res.body) ?? ''}`);
	return { kind: 'refused' };
}

function post(
	url: string,
	body: unknown,
	headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown } | null> {
	return send(url, {
		method: 'POST',
		headers: { ...JSON_TYPE, ...headers },
		body: JSON.stringify(body)
	});
}

/**
 * The header naming the account a request is for (its name, URI-encoded;
 * the server finds its `nameKey` itself, by the same Unicode tables it made
 * the account with), on the save routes and on logout. The cookie names
 * whichever account this browser logged in to last, in any tab; the server
 * answers only for the account named, so a save sent just as another tab
 * logs in to another account never lands there, and a logout never ends
 * that one.
 */
function naming(name: string): Record<string, string> {
	return { 'x-animath-account': encodeURIComponent(name) };
}

/**
 * Make an account named `name` with `password`, bringing the guest game along
 * (`save`), and log this browser in to it. `name` comes back as the server
 * keeps it (the engine's `checkName`: trimmed, single spaces, NFC).
 */
export async function register(
	name: string,
	password: string,
	save: SaveWrite | null,
	base = '/api'
): Promise<RegisterResult> {
	const res = await post(`${base}/account/register`, { name, password, save });
	if (!res) return { kind: 'offline' };
	const error = errorOf(res.body);
	const reason = field(res.body, 'reason');
	if (res.status === 201) {
		const kept = userName(res.body);
		return kept === null ? { kind: 'offline' } : { kind: 'registered', name: kept };
	}
	if (res.status === 400 && error === ERRORS.badName && isNameRejection(reason)) {
		return { kind: 'bad-name', reason };
	}
	if (res.status === 400 && error === ERRORS.badPassword && isPasswordRefusal(reason)) {
		return { kind: 'bad-password', reason };
	}
	if (res.status === 409 && error === ERRORS.taken) return { kind: 'taken' };
	if (res.status === 429 && error === ERRORS.tooMany) {
		return { kind: 'too-many', retryAfter: retryAfter(res.body) };
	}
	if (res.status >= 400 && res.status < 500 && error !== undefined) {
		return refused('a new account', res);
	}
	return { kind: 'offline' };
}

/** Log this browser in to the account `name`. */
export function login(name: string, password: string, base = '/api'): Promise<LoginResult> {
	return logInWith({ name, password }, base);
}

/**
 * Log this browser in to the account `name` by its name alone, which works
 * only on the account's own browser (the server knows it by a cookie this
 * page never sees).
 */
export function loginAtHome(name: string, base = '/api'): Promise<LoginResult> {
	return logInWith({ name, home: true }, base);
}

async function logInWith(body: unknown, base: string): Promise<LoginResult> {
	const res = await post(`${base}/account/login`, body);
	if (!res) return { kind: 'offline' };
	const error = errorOf(res.body);
	if (res.status === 200) {
		const kept = userName(res.body);
		return kept === null ? { kind: 'offline' } : { kind: 'logged-in', name: kept };
	}
	if (res.status === 401 && error === ERRORS.wrong) return { kind: 'wrong' };
	if (res.status === 401 && error === ERRORS.notHome) return { kind: 'not-home' };
	if (res.status === 429 && error === ERRORS.tooMany) {
		return { kind: 'too-many', retryAfter: retryAfter(res.body) };
	}
	if (res.status >= 400 && res.status < 500 && error !== undefined) return refused('a login', res);
	return { kind: 'offline' };
}

/**
 * Whose account the welcome link with `token` opens, or why it opens none
 * (the server names the account of a live link only). The token goes in a
 * header, never in the path: a request line is what nginx's logs keep, the
 * access log every one and the error log when nginx runs out of memory.
 */
export async function lookAtWelcome(token: string, base = '/api'): Promise<WelcomeLook> {
	const res = await send(`${base}/account/welcome`, {
		headers: { 'x-animath-welcome': token },
		cache: 'no-store'
	});
	if (!res) return { kind: 'offline' };
	const name = field(res.body, 'name');
	if (res.status === 200 && typeof name === 'string' && name !== '') return { kind: 'live', name };
	const gone = welcomeGone(res);
	if (gone) return { kind: 'gone', why: gone };
	if (res.status === 429 && errorOf(res.body) === ERRORS.tooMany) {
		return { kind: 'too-many', retryAfter: retryAfter(res.body) };
	}
	return { kind: 'offline' };
}

/**
 * Pick `password` for the account the welcome link with `token` opens, which
 * uses the link up and logs this browser in to it; the account's save comes
 * back for the browser to take.
 */
export async function acceptWelcome(
	token: string,
	password: string,
	base = '/api'
): Promise<WelcomeResult> {
	const res = await post(`${base}/account/welcome`, { token, password });
	if (!res) return { kind: 'offline' };
	const error = errorOf(res.body);
	const reason = field(res.body, 'reason');
	if (res.status === 200) {
		const kept = userName(res.body);
		const save = field(res.body, 'save');
		return kept === null || save === undefined
			? { kind: 'offline' }
			: { kind: 'welcomed', name: kept, save };
	}
	const gone = welcomeGone(res);
	if (gone) return { kind: 'gone', why: gone };
	if (res.status === 400 && error === ERRORS.badPassword && isPasswordRefusal(reason)) {
		return { kind: 'bad-password', reason };
	}
	if (res.status === 429 && error === ERRORS.tooMany) {
		return { kind: 'too-many', retryAfter: retryAfter(res.body) };
	}
	if (res.status >= 400 && res.status < 500 && error !== undefined) {
		return refused('a welcome link', res);
	}
	return { kind: 'offline' };
}

/**
 * End this browser's session with `name`'s account (a session that is
 * another account's is left alone). `offline` when the server did not hear it.
 */
export async function logout(name: string, base = '/api'): Promise<'done' | 'offline'> {
	const res = await post(`${base}/account/logout`, {}, naming(name));
	return res?.status === 200 && isStored(res.body) ? 'done' : 'offline';
}

/**
 * Whether the server can make and keep an account now: its database answers
 * and has the accounts' tables. Only the API's own `{ ready: true }` is a
 * yes; no answer, a proxy's page or a 5xx is a no, since an offer the server
 * cannot keep is a promise broken to a kid.
 */
export async function accountsReady(base = '/api', timeoutMs?: number): Promise<boolean> {
	const res = await send(`${base}/account/ready`, { cache: 'no-store' }, timeoutMs);
	return res?.status === 200 && field(res.body, 'ready') === true;
}

/**
 * Who this browser's session cookie belongs to. Asked once as the page
 * starts, before anything else that reads the session goes to the account
 * routes (`accountsReady` reads no cookie and sends none): its answer may
 * send the cookie again ([[INVARIANTS]] § Server). `playing`: the account
 * this page plays, named so the server can say it has a new name since.
 */
export async function whoAmI(
	base = '/api',
	timeoutMs?: number,
	playing?: string
): Promise<WhoResult> {
	const res = await send(
		`${base}/account/me`,
		playing === undefined ? {} : { headers: naming(playing) },
		timeoutMs
	);
	if (res?.status !== 200 || typeof res.body !== 'object' || res.body === null) {
		return { kind: 'offline' };
	}
	const user = field(res.body, 'user');
	if (user === null) return { kind: 'user', name: null, home: false, renamed: false };
	const name = userName(res.body);
	return name === null
		? { kind: 'offline' }
		: {
				kind: 'user',
				name,
				home: field(user, 'home') === true,
				renamed: field(user, 'renamed') === true
			};
}

/**
 * The accounts whose own browser this is, by name (none for most browsers);
 * null with no answer. Reads only: its answer sends no cookie.
 */
export async function homeAccounts(base = '/api', timeoutMs?: number): Promise<string[] | null> {
	const res = await send(`${base}/account/home`, { cache: 'no-store' }, timeoutMs);
	const names = res?.status === 200 ? field(res.body, 'names') : undefined;
	return Array.isArray(names) && names.every((n) => typeof n === 'string') ? names : null;
}

/**
 * A new password for `name`'s account, where the page is logged in to it:
 * on its own browser with nothing more, on any other with the password now
 * (`current`). Every other browser logged in to it is logged out.
 */
export async function changePassword(
	name: string,
	password: string,
	current?: string,
	base = '/api'
): Promise<PasswordResult> {
	const res = await post(
		`${base}/account/password`,
		current === undefined ? { password } : { password, current },
		naming(name)
	);
	if (!res) return { kind: 'offline' };
	const error = errorOf(res.body);
	const reason = field(res.body, 'reason');
	if (res.status === 200 && isStored(res.body)) return { kind: 'changed' };
	if (res.status === 400 && error === ERRORS.badPassword && isPasswordRefusal(reason)) {
		return { kind: 'bad-password', reason };
	}
	if (res.status === 403 && error === ERRORS.notHome) return { kind: 'not-home' };
	if (res.status === 403 && error === ERRORS.wrongPassword) return { kind: 'wrong' };
	if (res.status === 401 && error === ERRORS.notLoggedIn) return { kind: 'logged-out' };
	const now = renamedTo(res);
	if (now !== null) return { kind: 'renamed', name: now };
	if (res.status === 429 && error === ERRORS.tooMany) {
		return { kind: 'too-many', retryAfter: retryAfter(res.body) };
	}
	if (res.status >= 400 && res.status < 500 && error !== undefined) {
		return refused('a new password', res);
	}
	return { kind: 'offline' };
}

/**
 * A new name for `name`'s account, where the page is logged in to it: on its
 * own browser with nothing more, on any other with the password (`password`).
 * Every browser logged in to it stays logged in; the server keeps the old
 * name for the account, and tells a page still playing by it the new one.
 */
export async function renameAccount(
	name: string,
	to: string,
	password?: string,
	base = '/api'
): Promise<RenameResult> {
	const res = await post(
		`${base}/account/name`,
		password === undefined ? { name: to } : { name: to, password },
		naming(name)
	);
	if (!res) return { kind: 'offline' };
	const error = errorOf(res.body);
	const reason = field(res.body, 'reason');
	if (res.status === 200) {
		const kept = userName(res.body);
		return kept === null ? { kind: 'offline' } : { kind: 'renamed', name: kept };
	}
	if (res.status === 400 && error === ERRORS.badName && isNameRejection(reason)) {
		return { kind: 'bad-name', reason };
	}
	if (res.status === 409 && error === ERRORS.taken) return { kind: 'taken' };
	if (res.status === 403 && error === ERRORS.notHome) return { kind: 'not-home' };
	if (res.status === 403 && error === ERRORS.wrongPassword) return { kind: 'wrong' };
	if (res.status === 401 && error === ERRORS.notLoggedIn) return { kind: 'logged-out' };
	const now = renamedTo(res);
	if (now !== null) return { kind: 'renamed-before', name: now };
	if (res.status === 429 && error === ERRORS.tooMany) {
		return { kind: 'too-many', retryAfter: retryAfter(res.body) };
	}
	if (res.status >= 400 && res.status < 500 && error !== undefined) {
		return refused('a new name', res);
	}
	return { kind: 'offline' };
}

/**
 * Hand `doc`, the guest game the password gate passes over, to `name`'s
 * account on the server, to keep among its set-aside games (never as its
 * save). True only on the server's own yes: it holds the game now (kept just
 * now, or held already). Anything else, a refusal included, is no: the guest
 * game stays where it is.
 */
export async function keepGame(
	name: string,
	doc: unknown,
	base = '/api',
	timeoutMs?: number
): Promise<boolean> {
	const res = await send(
		`${base}/account/keep`,
		{
			method: 'POST',
			headers: { ...JSON_TYPE, ...naming(name) },
			body: JSON.stringify(doc)
		},
		timeoutMs
	);
	if (!res) return false;
	if (res.status === 200 && isStored(res.body)) return true;
	const error = errorOf(res.body);
	if ((res.status === 400 || res.status === 413) && error !== undefined) {
		refused('a guest game to keep', res);
	}
	return false;
}

/** `name`'s account's save, for `Autosave` (`accountSaveServer`) and for logging in. */
export async function getAccountSave(
	name: string,
	base = '/api',
	timeoutMs?: number
): Promise<ServerRead | { kind: 'renamed'; name: string }> {
	const res = await send(`${base}/account/save`, { headers: naming(name) }, timeoutMs);
	if (!res) return { kind: 'offline' };
	const error = errorOf(res.body);
	if (res.status === 200 && isStoredSave(res.body)) return { kind: 'found', doc: res.body };
	if (res.status === 404 && error === ERRORS.noSave) return { kind: 'none' };
	if (res.status === 401 && error === ERRORS.notLoggedIn) return { kind: 'logged-out' };
	const now = renamedTo(res);
	if (now !== null) return { kind: 'renamed', name: now };
	return { kind: 'offline' };
}

/** What the server says about this page's account: the session is its, is over, or no answer. */
export type SessionAnswer = 'live' | 'ended' | 'offline';

/**
 * The server's word on whether the session cookie is this page's account's,
 * asked once, as the page starts, and asked again only after no answer. The
 * account's save goes to the server only on a `live` answer, so a page whose
 * cookie is not its account's (a logout the server never heard, a login in
 * another tab) says so and saves in the browser; each save request also
 * names its account, which the server checks as it answers, since the cookie
 * can change hands after the check.
 *
 * An account that took a new name on another page since this one started is
 * told to `onRenamed`, once, with the name, by this check or by any save
 * request: the page plays it by the old name, which the server answers for no
 * more, so nothing more is sent, and the page moves its game to the new one.
 */
export class SessionCheck {
	private answer: Promise<SessionAnswer> | null = null;

	private readonly key: string;

	private renamedTo: string | null = null;

	constructor(
		/** The account this page plays. */
		readonly name: string,
		/**
		 * Told each answer, `offline` included; `home`: on `live`, this browser
		 * is the account's own.
		 */
		private readonly heard: (answer: SessionAnswer, home: boolean) => void = () => {},
		private readonly base = '/api',
		private readonly onRenamed: (name: string) => void = () => {}
	) {
		this.key = nameKey(name);
	}

	check(): Promise<SessionAnswer> {
		this.answer ??= whoAmI(this.base, undefined, this.name).then((who) => {
			if (who.kind === 'user' && who.renamed && who.name !== null) {
				this.renamed(who.name);
				return 'ended';
			}
			const answer: SessionAnswer =
				who.kind === 'offline'
					? 'offline'
					: who.name !== null && nameKey(who.name) === this.key
						? 'live'
						: 'ended';
			// No answer is asked again next time; a real one stands for the page.
			if (answer === 'offline') this.answer = null;
			this.heard(answer, answer === 'live' && who.kind === 'user' && who.home);
			return answer;
		});
		return this.answer;
	}

	/**
	 * The server said the account is called `name` now: nothing more goes as
	 * the old name, and the page hears it once.
	 */
	renamed(name: string): void {
		this.answer = Promise.resolve('ended');
		if (this.renamedTo !== null) return;
		this.renamedTo = name;
		this.onRenamed(name);
	}
}

/**
 * The account's save as the autosave's server: `getSave` and `putSave` ask
 * about `session`'s account, once `session` has said the cookie is that
 * account's, and name it in each request, which the server checks against
 * the cookie as it answers. `logged-out` is a session that has ended (or a
 * cookie that is not this account's), a `409` another device that got ahead
 * (the autosave then asks for the save and settles), and a `429` (too many
 * saves a minute) is waited out like an unreachable server.
 */
export function accountSaveServer(session: SessionCheck, base = '/api'): SaveServer {
	return {
		async getSave(timeoutMs) {
			// Start-up waits for the account's save only so long, the session check included.
			const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
			const answer =
				timeoutMs === undefined
					? await session.check()
					: await Promise.race([
							session.check(),
							new Promise<SessionAnswer>((resolve) =>
								setTimeout(() => resolve('offline'), timeoutMs)
							)
						]);
			if (answer === 'ended') return { kind: 'logged-out' };
			if (answer === 'offline') return { kind: 'offline' };
			const left = deadline === undefined ? undefined : deadline - Date.now();
			if (left !== undefined && left <= 0) return { kind: 'offline' };
			const read = await getAccountSave(session.name, base, left);
			if (read.kind !== 'renamed') return read;
			session.renamed(read.name);
			return { kind: 'logged-out' };
		},
		async putSave(doc, keepalive = false): Promise<ServerWrite> {
			const answer = await session.check();
			if (answer === 'ended') return { kind: 'logged-out' };
			if (answer === 'offline') return { kind: 'offline' };
			const res = await send(`${base}/account/save`, {
				method: 'PUT',
				keepalive,
				headers: { ...JSON_TYPE, ...naming(session.name) },
				body: JSON.stringify(doc)
			});
			if (!res) return { kind: 'offline' };
			const error = errorOf(res.body);
			if (res.status === 200 && isStored(res.body)) return { kind: 'saved' };
			if (res.status === 409 && error !== undefined) return { kind: 'conflict' };
			if (res.status === 401 && error === ERRORS.notLoggedIn) return { kind: 'logged-out' };
			const now = renamedTo(res);
			if (now !== null) {
				session.renamed(now);
				return { kind: 'logged-out' };
			}
			if ((res.status === 400 || res.status === 413) && error !== undefined) {
				return { kind: 'refused', error };
			}
			return { kind: 'offline' };
		}
	};
}
