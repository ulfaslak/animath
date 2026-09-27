import { and, eq, lte, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { parse as parseCookies } from 'hono/utils/cookie';
import { db } from './db/index.js';
import { sessions, users } from './db/schema.js';
import { hashSecret, newSecret } from './secrets.js';

/**
 * Sessions: what keeps a browser logged in to an account.
 *
 * The browser holds a random token (256 bits) in an HttpOnly, SameSite=Lax
 * cookie, Secure in production. The server stores only the token's SHA-256
 * hash: the token is random, so there is nothing to salt, and a database dump
 * logs nobody in. A session lasts about a year from when it was last used:
 * `/me` (which a page asks as it starts) moves its end a year out again, in
 * the database and in the cookie, once it is `SLIDE_AFTER_DAYS` into its
 * year. Logging out deletes it.
 */

export const SESSION_COOKIE = 'animath_session';
/** How long a session lasts after its last use. */
export const SESSION_DAYS = 365;
/**
 * How far into its year a session is before `/me` moves its end out again.
 * Each move sends the cookie, and an answer that sends it can land after a
 * login in another tab and put the old cookie back (§ `currentUser`), so it
 * happens once a month, not at every start.
 */
export const SLIDE_AFTER_DAYS = 30;
/** A browser logged in to one account on more devices than this loses the least used session. */
export const MAX_SESSIONS_PER_USER = 20;

/** A token as `newSecret` makes it: 32 bytes in base64url. Anything else is not looked up. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Who a session belongs to. The id never leaves the server. */
export interface SessionUser {
	id: string;
	name: string;
	/** The engine's `nameKey(name)`, as stored: what a request names its account by. */
	nameKey: string;
}

/** Cookie attributes that depend on where the server runs. */
export interface CookieOptions {
	secure: boolean;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Starts a session for `userId` and returns its token, for the cookie. Also
 * clears that user's expired sessions and keeps only their
 * `MAX_SESSIONS_PER_USER` most recently used, so the table cannot grow
 * without bound however often someone logs in.
 */
export async function createSession(q: typeof db | Tx, userId: string): Promise<string> {
	const token = newSecret();
	await q
		.delete(sessions)
		.where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, sql`now()`)));
	await q.insert(sessions).values({
		tokenHash: hashSecret(token),
		userId,
		expiresAt: sql`now() + make_interval(days => ${SESSION_DAYS})`
	});
	await q.execute(sql`
		delete from sessions
		where user_id = ${userId}
		  and token_hash not in (
			select token_hash from sessions where user_id = ${userId}
			order by expires_at desc, created_at desc
			limit ${MAX_SESSIONS_PER_USER}
		  )`);
	return token;
}

/** Ends the session with this token, if there is one. */
export async function deleteSession(token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.tokenHash, hashSecret(token)));
}

interface Found {
	user: SessionUser;
	/** More than `SLIDE_AFTER_DAYS` into its year: time to move its end out again. */
	stale: boolean;
}

async function findSession(token: string | undefined): Promise<Found | null> {
	if (!token || !TOKEN.test(token)) return null;
	const [row] = await db
		.select({
			id: users.id,
			name: users.name,
			nameKey: users.nameKey,
			stale: sql<boolean>`${sessions.expiresAt} < now() + make_interval(days => ${SESSION_DAYS - SLIDE_AFTER_DAYS})`
		})
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(and(eq(sessions.tokenHash, hashSecret(token)), sql`${sessions.expiresAt} > now()`));
	return row
		? { user: { id: row.id, name: row.name, nameKey: row.nameKey }, stale: row.stale }
		: null;
}

/**
 * The account a request is logged in to, or null: no cookie, a token that
 * matches no session, or a session that has expired. Reads only, and sends
 * no cookie: the save routes and the WebSocket upgrade use it, and only
 * `/me` extends a session (`currentUser`).
 */
export async function sessionUser(c: Context): Promise<SessionUser | null> {
	return (await findSession(getCookie(c, SESSION_COOKIE)))?.user ?? null;
}

/** `sessionUser` for a raw `Cookie` header, for code that has no Hono context. */
export async function sessionUserFromCookieHeader(
	header: string | undefined
): Promise<SessionUser | null> {
	if (!header) return null;
	return (await findSession(parseCookies(header, SESSION_COOKIE)[SESSION_COOKIE]))?.user ?? null;
}

export function setSessionCookie(c: Context, token: string, options: CookieOptions): void {
	setCookie(c, SESSION_COOKIE, token, {
		httpOnly: true,
		sameSite: 'Lax',
		secure: options.secure,
		path: '/',
		maxAge: SESSION_DAYS * 24 * 60 * 60
	});
}

export function clearSessionCookie(c: Context, options: CookieOptions): void {
	deleteCookie(c, SESSION_COOKIE, {
		httpOnly: true,
		sameSite: 'Lax',
		secure: options.secure,
		path: '/'
	});
}

/**
 * `/me`'s lookup: the account a request is logged in to, moving the
 * session's end a year out once it is `SLIDE_AFTER_DAYS` into its year, and
 * sending the cookie again with it. Only login, register, a welcome link's
 * POST, logout and this send the cookie, and this as rarely as it can: an
 * answer that sends it
 * may land after a login in another tab of the same browser (whose
 * `Set-Cookie` then loses to the old token), so a cookie that names no live
 * session is left alone rather than cleared, and a live one is sent again
 * only once a month.
 */
export async function currentUser(c: Context, options: CookieOptions): Promise<SessionUser | null> {
	const token = getCookie(c, SESSION_COOKIE);
	const found = await findSession(token);
	if (!found) return null;
	if (found.stale && token) {
		await db
			.update(sessions)
			.set({ expiresAt: sql`now() + make_interval(days => ${SESSION_DAYS})` })
			.where(eq(sessions.tokenHash, hashSecret(token)));
		setSessionCookie(c, token, options);
	}
	return found.user;
}

/** The session token a request carries, whatever it is. */
export function sessionToken(c: Context): string | undefined {
	return getCookie(c, SESSION_COOKIE);
}
