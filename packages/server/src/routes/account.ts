import {
	checkName,
	checkPassword,
	nameKey,
	validateSaveWrite,
	type SaveWrite
} from '@mathgame/engine';
import { eq } from 'drizzle-orm';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createAccount, findUser } from '../accounts.js';
import { db } from '../db/index.js';
import { accountSaves } from '../db/schema.js';
import { hashPassword, verifyDecoy, verifyPassword } from '../passwords.js';
import { RateLimiter, type AccountLimits, type Verdict } from '../rate-limit.js';
import { clientIp, rateKey, readJson, sameOriginJson } from '../request.js';
import {
	SAVE_FROM_NEWER_BUILD,
	SAVE_MAX_BYTES,
	STORED_FROM_NEWER_BUILD,
	writeAccountSave
} from '../save.js';
import {
	clearSessionCookie,
	createSession,
	currentUser,
	deleteSession,
	sessionToken,
	sessionUser,
	setSessionCookie,
	type CookieOptions,
	type SessionUser
} from '../sessions.js';
import { acceptWelcome, welcomeState } from '../welcome.js';

/**
 * Optional accounts: a name (the character's) and a password, a session
 * cookie, and the account's save.
 *
 *   POST /api/account/register  { name, password, save? } → 201 { user: { name } } + cookie
 *   POST /api/account/login     { name, password }        → 200 { user: { name } } + cookie
 *   POST /api/account/logout                              → 200 { ok: true }: the session ended
 *   GET  /api/account/ready                               → 200 { ready: boolean }
 *   GET  /api/account/me                                  → 200 { user: { name } | null }
 *   GET  /api/account/save                                → 200 SaveV5 | 404 no save yet
 *   PUT  /api/account/save      SaveV5                    → 200 { ok: true } | 409 { error, save }
 *   GET  /api/account/welcome   (x-animath-welcome: token) → 200 { name } | 410 used or expired | 404
 *   POST /api/account/welcome   { token, password }       → 200 { user: { name }, save } + cookie
 *
 * Every POST and PUT must be JSON from a page of this site (`sameOriginJson`).
 * The save routes answer only for the account the request names
 * (`ACCOUNT_HEADER`, 400 without it): 401 without a live session, or with
 * another account's. Logout with the header ends only that account's session
 * and sends no cookie; without it, it ends whatever session there is and
 * clears the cookie. Login and register are
 * rate limited per address and per name (429 with `Retry-After`). A save a
 * newer build wrote is never replaced (409 with it, whatever the `seq`), and
 * one sent that a newer build wrote is 503: this server is the older one.
 * A welcome link (`welcome.ts`) is looked up and used under the login's
 * limit per address; its GET says only the name of a live link's account,
 * and nothing about a spent one but that it is spent. Its token travels in a
 * header or a body, never in a path: nginx's error log keeps a request's
 * line whole and cannot be cleaned (`nginx/http.conf`).
 */

/** The header a welcome link's lookup carries its token in. */
export const WELCOME_HEADER = 'x-animath-welcome';

type Env = { Variables: { user: SessionUser } };

/** Room for a name and a password beside a save of the largest size. */
const REGISTER_MAX_BYTES = SAVE_MAX_BYTES + 4096;
const LOGIN_MAX_BYTES = 4096;
/** A typed name longer than this is no account's name; it is never looked up. */
const MAX_TYPED_NAME = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tooMany(c: Context, verdict: Extract<Verdict, { ok: false }>) {
	c.header('Retry-After', String(verdict.retryAfterSeconds));
	return c.json({ error: 'too many tries', retryAfter: verdict.retryAfterSeconds }, 429);
}

/** A welcome link that does not log anyone in: used up, too old, or no link at all. */
function welcomeGone(c: Context, kind: 'used' | 'expired' | 'unknown') {
	if (kind === 'unknown') return c.json({ error: 'no such link' }, 404);
	return c.json({ error: kind === 'used' ? 'link used' : 'link expired' }, 410);
}

function tooBig(maxSize: number) {
	return bodyLimit({
		maxSize,
		onError: (c) => c.json({ error: `body is bigger than ${maxSize} bytes` }, 413)
	});
}

/** The name and password of a register or login body, or null when the body has no such fields. */
function credentials(body: unknown): { name: string; password: string } | null {
	if (!isRecord(body) || typeof body.name !== 'string' || typeof body.password !== 'string') {
		return null;
	}
	return { name: body.name, password: body.password };
}

/**
 * The header a page names its account in, on the save routes and on logout:
 * the account's name, URI-encoded, whose `nameKey` the server finds itself
 * (a browser's Unicode tables may not be the server's). The cookie names
 * whichever account the browser logged in to last, in any tab; the header
 * names the account the page plays, so a save sent as another tab logs in to
 * another account never lands in that account, and a logout never ends its
 * session.
 */
export const ACCOUNT_HEADER = 'x-animath-account';

/**
 * The `nameKey` of the account a request names: undefined when it names
 * none, null when the header is not a name.
 */
function claimedAccount(c: Context): string | null | undefined {
	const raw = c.req.header(ACCOUNT_HEADER);
	if (raw === undefined) return undefined;
	let name: string;
	try {
		name = decodeURIComponent(raw);
	} catch {
		return null;
	}
	const key = loginKey(name);
	return key === null || key === '' ? null : key;
}

/**
 * The `nameKey` a typed login name looks up. `nameKey` tidies the text itself
 * (spaces, NFC, case), and the name rules are not asked, so an account whose
 * name a later rule refuses can still log in. Null for a name too long to be
 * anyone's.
 */
function loginKey(typed: string): string | null {
	return typed.length > MAX_TYPED_NAME ? null : nameKey(typed);
}

export interface AccountRouteOptions {
	cookie: CookieOptions;
	limits: AccountLimits;
	/** Whether accounts work now (`AccountsReady`): the game offers them only then. */
	ready: () => Promise<boolean>;
}

export function accountRoute({ cookie, limits, ready }: AccountRouteOptions) {
	const limit = {
		loginPerIp: new RateLimiter(limits.loginPerIp),
		loginFailuresPerNameFromIp: new RateLimiter(limits.loginFailuresPerNameFromIp),
		loginFailuresPerName: new RateLimiter(limits.loginFailuresPerName),
		registerPerIp: new RateLimiter(limits.registerPerIp),
		registerPerName: new RateLimiter(limits.registerPerName),
		savesPerAccount: new RateLimiter(limits.savesPerAccount),
		welcomePerIp: new RateLimiter(limits.welcomePerIp)
	};

	/** Starts a session for this browser, ending the one it had (whoever's it was). */
	async function logIn(c: Context, token: string): Promise<void> {
		const previous = sessionToken(c);
		if (previous !== undefined) await deleteSession(previous);
		setSessionCookie(c, token, cookie);
	}

	/**
	 * The save routes only read the session: they never send the cookie,
	 * neither to slide it nor to clear it. An autosave still on its way with
	 * the old cookie when the browser logs in to another account would
	 * otherwise answer after the login, and its cookie would replace the new
	 * one. Only `/me` slides a session, and only once a month (`currentUser`).
	 * The session must be the account the request names (`ACCOUNT_HEADER`):
	 * a cookie that is another account's now is, for this one, not logged in.
	 */
	const requireSession: MiddlewareHandler<Env> = async (c, next) => {
		const user = await sessionUser(c);
		if (!user) return c.json({ error: 'not logged in' }, 401);
		const claimed = claimedAccount(c);
		if (!claimed) return c.json({ error: `name the account in ${ACCOUNT_HEADER}` }, 400);
		if (claimed !== user.nameKey) return c.json({ error: 'not logged in' }, 401);
		c.set('user', user);
		await next();
	};

	/** At most `savesPerAccount` save PUTs an account, before any body is read. */
	const savesLimited: MiddlewareHandler<Env> = async (c, next) => {
		const verdict = limit.savesPerAccount.hit(c.get('user').id);
		if (!verdict.ok) return tooMany(c, verdict);
		await next();
	};

	return new Hono<Env>()
		.use('*', sameOriginJson)
		.post('/register', tooBig(REGISTER_MAX_BYTES), async (c) => {
			const byIp = limit.registerPerIp.hit(rateKey(clientIp(c)));
			if (!byIp.ok) return tooMany(c, byIp);
			const body = await readJson(c);
			if (body === undefined) return c.json({ error: 'body is not valid JSON' }, 400);
			const given = credentials(body);
			if (!given) return c.json({ error: 'send a name and a password' }, 400);
			// The body may be a megabyte; a name that long is never worked through.
			const named =
				given.name.length > MAX_TYPED_NAME
					? ({ ok: false, reason: 'long' } as const)
					: checkName(given.name);
			if (!named.ok) return c.json({ error: 'bad name', reason: named.reason }, 400);
			const key = nameKey(named.name);
			const byName = limit.registerPerName.hit(key);
			if (!byName.ok) return tooMany(c, byName);
			const password = checkPassword(given.password);
			if (!password.ok) return c.json({ error: 'bad password', reason: password.reason }, 400);
			let save: SaveWrite | null = null;
			const guestSave = (body as Record<string, unknown>).save;
			if (guestSave !== undefined && guestSave !== null) {
				// Checked before anything else walks it: the check refuses a document nested
				// past `MAX_SAVE_DEPTH`, which `JSON.stringify` can throw on.
				const checked = validateSaveWrite(guestSave);
				if (!checked.ok) {
					if (checked.reason === 'newer') return c.json({ error: SAVE_FROM_NEWER_BUILD }, 503);
					return c.json({ error: 'bad save', detail: checked.error }, 400);
				}
				// The body limit leaves room for the name and password; the save
				// itself gets the same cap as a PUT.
				if (Buffer.byteLength(JSON.stringify(guestSave), 'utf8') > SAVE_MAX_BYTES) {
					return c.json({ error: `save is bigger than ${SAVE_MAX_BYTES} bytes` }, 413);
				}
				save = checked.value;
			}
			// Spare the slow hash for a name that is plainly taken; the unique
			// key still decides a race between two registrations.
			if (await findUser(key)) return c.json({ error: 'name taken' }, 409);
			const created = await createAccount({
				name: named.name,
				nameKey: key,
				passwordHash: await hashPassword(password.password),
				save
			});
			if (!created) return c.json({ error: 'name taken' }, 409);
			await logIn(c, created.token);
			return c.json({ user: { name: named.name } }, 201);
		})
		.post('/login', tooBig(LOGIN_MAX_BYTES), async (c) => {
			const address = rateKey(clientIp(c));
			const byIp = limit.loginPerIp.hit(address);
			if (!byIp.ok) return tooMany(c, byIp);
			const body = await readJson(c);
			if (body === undefined) return c.json({ error: 'body is not valid JSON' }, 400);
			const given = credentials(body);
			if (!given) return c.json({ error: 'send a name and a password' }, 400);
			const key = loginKey(given.name);
			if (key === null) return c.json({ error: 'wrong name or password' }, 401);
			// Counted as a failure until the password proves right, so tries
			// racing each other cannot all slip under the limits.
			const pair = `${key}\u0000${address}`;
			const fromHere = limit.loginFailuresPerNameFromIp.hit(pair);
			if (!fromHere.ok) return tooMany(c, fromHere);
			const fromAnywhere = limit.loginFailuresPerName.hit(key);
			if (!fromAnywhere.ok) {
				limit.loginFailuresPerNameFromIp.refund(pair);
				return tooMany(c, fromAnywhere);
			}
			const password = checkPassword(given.password);
			const user = await findUser(key);
			const right =
				user && password.ok
					? await verifyPassword(password.password, user.passwordHash)
					: await verifyDecoy(password.ok ? password.password : 'wrong length');
			if (!user || !right) return c.json({ error: 'wrong name or password' }, 401);
			limit.loginFailuresPerNameFromIp.refund(pair);
			limit.loginFailuresPerName.refund(key);
			await logIn(c, await createSession(db, user.id));
			return c.json({ user: { name: user.name } });
		})
		.post('/logout', tooBig(LOGIN_MAX_BYTES), async (c) => {
			const claimed = claimedAccount(c);
			if (claimed === null) return c.json({ error: `name the account in ${ACCOUNT_HEADER}` }, 400);
			const token = sessionToken(c);
			if (claimed !== undefined) {
				// A page logging its own account out: that account's session ends, and no cookie
				// is sent, so this answer can never undo a login another tab makes at the same
				// moment (a cookie whose session is gone opens nothing). A session that is another
				// account's now is left as it is.
				const user = await sessionUser(c);
				if (token !== undefined && user?.nameKey === claimed) await deleteSession(token);
				return c.json({ ok: true });
			}
			if (token !== undefined) await deleteSession(token);
			clearSessionCookie(c, cookie);
			return c.json({ ok: true });
		})
		.get('/ready', async (c) => {
			// Every page asks this every half minute, and offers accounts only on a yes: a
			// server whose database is down, or lacks the accounts' tables, would break the promise.
			c.header('Cache-Control', 'no-store');
			return c.json({ ready: await ready() });
		})
		.get('/me', async (c) => {
			const user = await currentUser(c, cookie);
			return c.json({ user: user ? { name: user.name } : null });
		})
		.get('/save', requireSession, async (c) => {
			const [row] = await db
				.select({ data: accountSaves.data })
				.from(accountSaves)
				.where(eq(accountSaves.userId, c.get('user').id));
			if (!row) return c.json({ error: 'no save yet' }, 404);
			return c.json(row.data);
		})
		.put('/save', requireSession, savesLimited, tooBig(SAVE_MAX_BYTES), async (c) => {
			const body = await readJson(c);
			if (body === undefined) return c.json({ error: 'body is not valid JSON' }, 400);
			const checked = validateSaveWrite(body);
			if (!checked.ok) {
				if (checked.reason === 'newer') return c.json({ error: SAVE_FROM_NEWER_BUILD }, 503);
				return c.json({ error: 'bad save', detail: checked.error }, 400);
			}
			const written = await writeAccountSave(c.get('user').id, checked.value);
			if (written.kind === 'gone') return c.json({ error: 'not logged in' }, 401);
			if (written.kind === 'stale') {
				return c.json(
					{ error: 'a save with the same or a higher seq is already stored', save: written.stored },
					409
				);
			}
			if (written.kind === 'newer') {
				return c.json({ error: STORED_FROM_NEWER_BUILD, save: written.stored }, 409);
			}
			return c.json({ ok: true });
		})
		.get('/welcome', async (c) => {
			// The answer names an account for a secret: no cache keeps it.
			c.header('Cache-Control', 'no-store');
			const byIp = limit.welcomePerIp.hit(rateKey(clientIp(c)));
			if (!byIp.ok) return tooMany(c, byIp);
			const token = c.req.header(WELCOME_HEADER);
			if (token === undefined) return c.json({ error: `send the link in ${WELCOME_HEADER}` }, 400);
			const state = await welcomeState(token);
			if (state.kind !== 'live') return welcomeGone(c, state.kind);
			return c.json({ name: state.name });
		})
		.post('/welcome', tooBig(LOGIN_MAX_BYTES), async (c) => {
			c.header('Cache-Control', 'no-store');
			const byIp = limit.welcomePerIp.hit(rateKey(clientIp(c)));
			if (!byIp.ok) return tooMany(c, byIp);
			const body = await readJson(c);
			if (body === undefined) return c.json({ error: 'body is not valid JSON' }, 400);
			if (!isRecord(body) || typeof body.token !== 'string' || typeof body.password !== 'string') {
				return c.json({ error: 'send the link and a password' }, 400);
			}
			// A password the rules refuse leaves the link as it was.
			const password = checkPassword(body.password);
			if (!password.ok) return c.json({ error: 'bad password', reason: password.reason }, 400);
			// Only a live link costs a slow hash.
			const state = await welcomeState(body.token);
			if (state.kind !== 'live') return welcomeGone(c, state.kind);
			const result = await acceptWelcome(body.token, await hashPassword(password.password));
			if (result.kind !== 'welcomed') return welcomeGone(c, result.kind);
			await logIn(c, result.sessionToken);
			return c.json({ user: { name: result.name }, save: result.save });
		});
}
