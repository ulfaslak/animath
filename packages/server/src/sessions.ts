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
 * logs nobody in. A session lasts a year from when it was last used: each use
 * that finds it more than a day into its year moves its end a year out again,
 * in the database and in the cookie. Logging out deletes it.
 */

export const SESSION_COOKIE = 'animath_session';
/** How long a session lasts after its last use. */
export const SESSION_DAYS = 365;
/** A browser logged in to one account on more devices than this loses the least used session. */
export const MAX_SESSIONS_PER_USER = 20;

/** A token as `newSecret` makes it: 32 bytes in base64url. Anything else is not looked up. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Who a session belongs to. The id never leaves the server. */
export interface SessionUser {
	id: string;
	name: string;
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
	/** More than a day into its year: time to move its end out again. */
	stale: boolean;
}

async function findSession(token: string | undefined): Promise<Found | null> {
	if (!token || !TOKEN.test(token)) return null;
	const [row] = await db
		.select({
			id: users.id,
			name: users.name,
			stale: sql<boolean>`${sessions.expiresAt} < now() + make_interval(days => ${SESSION_DAYS - 1})`
		})
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(and(eq(sessions.tokenHash, hashSecret(token)), sql`${sessions.expiresAt} > now()`));
	return row ? { user: { id: row.id, name: row.name }, stale: row.stale } : null;
}

/**
 * The account a request is logged in to, or null: no cookie, a token that
 * matches no session, or a session that has expired. Reads only; the account
 * routes extend the session (`currentUser`). The presence server calls this
 * on the WebSocket upgrade.
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
 * The account a request to the account routes is logged in to, sliding the
 * session's end a year out when it is more than a day into its year, and
 * sending the cookie again with it. A cookie that names no live session is
 * cleared, so the browser stops sending it.
 */
export async function currentUser(c: Context, options: CookieOptions): Promise<SessionUser | null> {
	const token = getCookie(c, SESSION_COOKIE);
	const found = await findSession(token);
	if (!found) {
		if (token !== undefined) clearSessionCookie(c, options);
		return null;
	}
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
