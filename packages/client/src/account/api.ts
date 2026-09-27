import {
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

/**
 * The account routes ([[ARCHITECTURE]] § HTTP API), reduced to what the game
 * does next. Like the backup's API (`save/api.ts`), every outcome needs the
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
	| { kind: 'too-many'; retryAfter: number }
	| { kind: 'refused' }
	| { kind: 'offline' };

/** Who the session cookie belongs to: an account's name, or `null` for nobody. */
export type WhoResult = { kind: 'user'; name: string | null } | { kind: 'offline' };

/** The server's error texts the game tells apart. */
const ERRORS = {
	badName: 'bad name',
	badPassword: 'bad password',
	taken: 'name taken',
	wrong: 'wrong name or password',
	tooMany: 'too many tries',
	notLoggedIn: 'not logged in',
	noSave: 'no save yet'
} as const;

const NAME_REJECTIONS: readonly string[] = ['empty', 'short', 'long', 'chars', 'rude'];
const PASSWORD_REFUSALS: readonly string[] = ['short', 'long'];

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
	if (
		res.status === 400 &&
		error === ERRORS.badName &&
		NAME_REJECTIONS.includes(reason as string)
	) {
		return { kind: 'bad-name', reason: reason as NameRejection };
	}
	if (
		res.status === 400 &&
		error === ERRORS.badPassword &&
		PASSWORD_REFUSALS.includes(reason as string)
	) {
		return { kind: 'bad-password', reason: reason as PasswordRefusal };
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
export async function login(name: string, password: string, base = '/api'): Promise<LoginResult> {
	const res = await post(`${base}/account/login`, { name, password });
	if (!res) return { kind: 'offline' };
	const error = errorOf(res.body);
	if (res.status === 200) {
		const kept = userName(res.body);
		return kept === null ? { kind: 'offline' } : { kind: 'logged-in', name: kept };
	}
	if (res.status === 401 && error === ERRORS.wrong) return { kind: 'wrong' };
	if (res.status === 429 && error === ERRORS.tooMany) {
		return { kind: 'too-many', retryAfter: retryAfter(res.body) };
	}
	if (res.status >= 400 && res.status < 500 && error !== undefined) return refused('a login', res);
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
 * starts, before anything else goes to the account routes: its answer may
 * send the cookie again ([[INVARIANTS]] § Server).
 */
export async function whoAmI(base = '/api', timeoutMs?: number): Promise<WhoResult> {
	const res = await send(`${base}/account/me`, {}, timeoutMs);
	if (res?.status !== 200 || typeof res.body !== 'object' || res.body === null) {
		return { kind: 'offline' };
	}
	const user = field(res.body, 'user');
	if (user === null) return { kind: 'user', name: null };
	const name = userName(res.body);
	return name === null ? { kind: 'offline' } : { kind: 'user', name };
}

/** `name`'s account's save, for `Autosave` (`session`) and for logging in. */
export async function getAccountSave(
	name: string,
	base = '/api',
	timeoutMs?: number
): Promise<ServerRead> {
	const res = await send(`${base}/account/save`, { headers: naming(name) }, timeoutMs);
	if (!res) return { kind: 'offline' };
	const error = errorOf(res.body);
	if (res.status === 200 && isStoredSave(res.body)) return { kind: 'found', doc: res.body };
	if (res.status === 404 && error === ERRORS.noSave) return { kind: 'none' };
	if (res.status === 401 && error === ERRORS.notLoggedIn) return { kind: 'unknown-player' };
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
 */
export class SessionCheck {
	private answer: Promise<SessionAnswer> | null = null;

	private readonly key: string;

	constructor(
		/** The account this page plays. */
		readonly name: string,
		/** Told each answer, `offline` included. */
		private readonly heard: (answer: SessionAnswer) => void = () => {},
		private readonly base = '/api'
	) {
		this.key = nameKey(name);
	}

	check(): Promise<SessionAnswer> {
		this.answer ??= whoAmI(this.base).then((who) => {
			const answer: SessionAnswer =
				who.kind === 'offline'
					? 'offline'
					: who.name !== null && nameKey(who.name) === this.key
						? 'live'
						: 'ended';
			// No answer is asked again next time; a real one stands for the page.
			if (answer === 'offline') this.answer = null;
			this.heard(answer);
			return answer;
		});
		return this.answer;
	}
}

/**
 * The account's save as the autosave's server: `getSave` and `putSave` ask
 * about `session`'s account (the identity they are handed is a stand-in),
 * once `session` has said the cookie is that account's, and name it in each
 * request, which the server checks against the cookie as it answers.
 * `unknown-player` is a session that has ended (or a cookie that is not this
 * account's), a `409` another device that got ahead (the autosave then asks
 * for the save and settles), and a `429` (too many saves a minute) is waited
 * out like an unreachable server.
 */
export function accountSaveServer(session: SessionCheck, base = '/api'): SaveServer {
	return {
		session: true,
		async createPlayer() {
			// Never asked: an account has no identity to make.
			return { kind: 'offline' };
		},
		async getSave(_who, timeoutMs) {
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
			if (answer === 'ended') return { kind: 'unknown-player' };
			if (answer === 'offline') return { kind: 'offline' };
			const left = deadline === undefined ? undefined : deadline - Date.now();
			if (left !== undefined && left <= 0) return { kind: 'offline' };
			return getAccountSave(session.name, base, left);
		},
		async putSave(_who, doc, keepalive = false): Promise<ServerWrite> {
			const answer = await session.check();
			if (answer === 'ended') return { kind: 'unknown-player' };
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
			if (res.status === 401 && error === ERRORS.notLoggedIn) return { kind: 'unknown-player' };
			if ((res.status === 400 || res.status === 413) && error !== undefined) {
				return { kind: 'refused', error };
			}
			return { kind: 'offline' };
		}
	};
}
