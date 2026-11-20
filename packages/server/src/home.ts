import { timingSafeEqual } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { db } from './db/index.js';
import { users } from './db/schema.js';
import { hashSecret, newSecret } from './secrets.js';
import type { CookieOptions } from './sessions.js';

/**
 * An account's own browser, its home ([[DECISIONS]] § Accounts): the browser
 * it was made in (or, for an account made before homes, the first one it is
 * logged in on). There the account's name alone logs in, and only there can
 * the kid pick a new password. Logging in anywhere else never moves it; only
 * the admin can (`admin clear-home`).
 *
 * The browser holds a random key (256 bits) in an HttpOnly cookie of its own,
 * sent only to the account routes; the account keeps its SHA-256
 * (`users.home_hash`), as a session's token is kept. One key per browser, so
 * a tablet two kids share is home to both their accounts. The key never
 * changes once it is set, so an answer that sends it again can never undo
 * another tab's: unlike the session's cookie, it is sent again freely, to
 * keep it alive.
 */

export const HOME_COOKIE = 'animath_home';
/** The longest a browser keeps a cookie (Chrome caps it at 400 days); sent again at every start. */
const HOME_DAYS = 400;
/** Only the account routes read it. */
const HOME_PATH = '/api/account';
/** A key as `newSecret` makes it: 32 bytes in base64url. Anything else is not looked up. */
const KEY = /^[A-Za-z0-9_-]{43}$/;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The home key this browser holds, or undefined with none (or not one of ours). */
export function homeKey(c: Context): string | undefined {
	const key = getCookie(c, HOME_COOKIE);
	return key !== undefined && KEY.test(key) ? key : undefined;
}

function setHomeCookie(c: Context, key: string, options: CookieOptions): void {
	setCookie(c, HOME_COOKIE, key, {
		httpOnly: true,
		sameSite: 'Lax',
		secure: options.secure,
		path: HOME_PATH,
		maxAge: HOME_DAYS * 24 * 60 * 60
	});
}

/**
 * The browser's home key, or a new one when it has none, for an account to
 * take this browser as its home. A new key reaches the browser only with
 * `sendHomeKey`, once an account has taken it.
 */
export function homeKeyOrNew(c: Context): string {
	return homeKey(c) ?? newSecret();
}

/** The home cookie goes with the answer. */
export function sendHomeKey(c: Context, key: string, options: CookieOptions): void {
	setHomeCookie(c, key, options);
}

/** Sends the browser's home key again, when it has one, so the cookie outlives a year of play. */
export function keepHomeKey(c: Context, options: CookieOptions): void {
	const key = homeKey(c);
	if (key !== undefined) setHomeCookie(c, key, options);
}

export function homeHashOf(key: string): string {
	return hashSecret(key);
}

/** Whether `key` is the home key of an account whose `home_hash` is `stored`. */
export function isHome(stored: string | null, key: string | undefined): boolean {
	if (stored === null || key === undefined) return false;
	const given = Buffer.from(hashSecret(key), 'utf8');
	const kept = Buffer.from(stored, 'utf8');
	return given.length === kept.length && timingSafeEqual(given, kept);
}

/**
 * Makes this browser the home of `userId`, only if the account has none yet:
 * of two browsers racing for it, one wins and the other changes nothing.
 * True when this browser is its home now.
 */
export async function claimHome(q: typeof db | Tx, userId: string, key: string): Promise<boolean> {
	const hash = hashSecret(key);
	const claimed = await q
		.update(users)
		.set({ homeHash: hash })
		.where(and(eq(users.id, userId), isNull(users.homeHash)))
		.returning({ id: users.id });
	if (claimed.length > 0) return true;
	const [row] = await q
		.select({ homeHash: users.homeHash })
		.from(users)
		.where(eq(users.id, userId));
	return isHome(row?.homeHash ?? null, key);
}

/** The names of the accounts whose home this browser is, by name. */
export async function homeNames(key: string | undefined): Promise<string[]> {
	if (key === undefined) return [];
	const rows = await db
		.select({ name: users.name })
		.from(users)
		.where(eq(users.homeHash, hashSecret(key)))
		.orderBy(asc(users.createdAt));
	return rows.map((row) => row.name);
}

/** The account's `home_hash`, or null (no home yet, or no such account). */
export async function homeHashFor(userId: string): Promise<string | null> {
	const [row] = await db
		.select({ homeHash: users.homeHash })
		.from(users)
		.where(eq(users.id, userId));
	return row?.homeHash ?? null;
}

/** The admin moves a home: the account has none, and the next browser it is logged in on takes it. */
export async function clearHome(userId: string): Promise<boolean> {
	const cleared = await db
		.update(users)
		.set({ homeHash: null })
		.where(eq(users.id, userId))
		.returning({ id: users.id });
	return cleared.length > 0;
}
