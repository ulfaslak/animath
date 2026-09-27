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
import { SAVE_MAX_BYTES, writeAccountSave } from '../save.js';
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

/**
 * Optional accounts: a name (the character's) and a password, a session
 * cookie, and the account's save.
 *
 *   POST /api/account/register  { name, password, save? } → 201 { user: { name } } + cookie
 *   POST /api/account/login     { name, password }        → 200 { user: { name } } + cookie
 *   POST /api/account/logout                              → 200 { ok: true }, cookie cleared
 *   GET  /api/account/me                                  → 200 { user: { name } | null }
 *   GET  /api/account/save                                → 200 SaveV2 | 404 no save yet
 *   PUT  /api/account/save      SaveV2                    → 200 { ok: true } | 409 { error, save }
 *
 * Every POST and PUT must be JSON from a page of this site (`sameOriginJson`).
 * The save routes answer 401 without a live session. Login and register are
 * rate limited per address and per name (429 with `Retry-After`).
 */

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
 * The `nameKey` a typed login name looks up. `nameKey` tidies the text itself
 * (spaces, NFC, case), and the name rules are not asked, so an account whose
 * name a later rule refuses can still log in. Null for a name too long to be
 * anyone's.
 */
/**
 * The header a page names its account in, on the save routes and on logout:
 * the engine's `nameKey`, URI-encoded. The cookie names whichever account
 * the browser logged in to last, in any tab; the header names the account
 * the page plays, so a save sent as another tab logs in to another account
 * never lands in that account, and a logout never ends its session.
 */
export const ACCOUNT_HEADER = 'x-animath-account';

/** The account a request names: undefined when it names none, null when the header is not a name key. */
function claimedAccount(c: Context): string | null | undefined {
	const raw = c.req.header(ACCOUNT_HEADER);
	if (raw === undefined) return undefined;
	try {
		const key = decodeURIComponent(raw);
		return key.length > 0 && key.length <= MAX_TYPED_NAME ? key : null;
	} catch {
		return null;
	}
}

function loginKey(typed: string): string | null {
	return typed.length > MAX_TYPED_NAME ? null : nameKey(typed);
}

export interface AccountRouteOptions {
	cookie: CookieOptions;
	limits: AccountLimits;
}

export function accountRoute({ cookie, limits }: AccountRouteOptions) {
	const limit = {
		loginPerIp: new RateLimiter(limits.loginPerIp),
		loginFailuresPerNameFromIp: new RateLimiter(limits.loginFailuresPerNameFromIp),
		loginFailuresPerName: new RateLimiter(limits.loginFailuresPerName),
		registerPerIp: new RateLimiter(limits.registerPerIp),
		registerPerName: new RateLimiter(limits.registerPerName),
		savesPerAccount: new RateLimiter(limits.savesPerAccount)
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
				// The body limit leaves room for the name and password; the save
				// itself gets the same cap as a PUT.
				if (Buffer.byteLength(JSON.stringify(guestSave), 'utf8') > SAVE_MAX_BYTES) {
					return c.json({ error: `save is bigger than ${SAVE_MAX_BYTES} bytes` }, 413);
				}
				const checked = validateSaveWrite(guestSave);
				if (!checked.ok) return c.json({ error: 'bad save', detail: checked.error }, 400);
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
			if (claimed !== undefined) {
				// A page logging its own account out. A cookie that is not that account's (another
				// tab logged in to another one) is left as it is, session and all: no cookie is
				// sent, so this answer cannot undo a login that lands before it.
				const user = await sessionUser(c);
				if (!user || user.nameKey !== claimed) return c.json({ ok: true });
			}
			const token = sessionToken(c);
			if (token !== undefined) await deleteSession(token);
			clearSessionCookie(c, cookie);
			return c.json({ ok: true });
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
			if (!checked.ok) return c.json({ error: 'bad save', detail: checked.error }, 400);
			const written = await writeAccountSave(c.get('user').id, checked.value);
			if (written.kind === 'gone') return c.json({ error: 'not logged in' }, 401);
			if (written.kind === 'stale') {
				return c.json(
					{ error: 'a save with the same or a higher seq is already stored', save: written.stored },
					409
				);
			}
			return c.json({ ok: true });
		});
}
