import type { SaveWrite } from '@mathgame/engine';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { isUniqueViolation } from './accounts.js';
import { db } from './db/index.js';
import { accountSaves, users, welcomeTokens } from './db/schema.js';
import { NO_PASSWORD } from './passwords.js';
import { hashSecret, newSecret } from './secrets.js';
import { createSession } from './sessions.js';

/**
 * Welcome links: how a kid's game comes here from somewhere else (the server
 * it was played on before this one). The admin imports the save (`admin
 * import-save`), which makes an account with the save's name, the save, and
 * no password (`NO_PASSWORD`), and prints a link holding a random token. The
 * kid opens it, picks a password, and is logged in to the account, whose
 * save the page then plays.
 *
 * The token is 256 random bits, of which the database keeps only the
 * SHA-256, as it does a session's. A link works once, for `WELCOME_DAYS`, and
 * only while its account has no password: picking one uses it up, and so
 * does a password the admin sets (`reset-password`).
 */

/** How long a welcome link works. */
export const WELCOME_DAYS = 14;

/** A token as `newSecret` makes it: 32 bytes in base64url. Anything else is no link's. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** What a welcome link is now. `live` is the only one that says whose it is. */
export type WelcomeState =
	| { kind: 'live'; name: string }
	/** Used, or its account has a password by now however it got it. */
	| { kind: 'used' }
	| { kind: 'expired' }
	/** No link has this token. */
	| { kind: 'unknown' };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The link with this token as it is now. Reads only. */
export async function welcomeState(token: string, q: typeof db | Tx = db): Promise<WelcomeState> {
	if (!TOKEN.test(token)) return { kind: 'unknown' };
	const [row] = await q
		.select({
			name: users.name,
			used: sql<boolean>`${welcomeTokens.usedAt} is not null or ${users.passwordHash} <> ${NO_PASSWORD}`,
			expired: sql<boolean>`${welcomeTokens.expiresAt} <= now()`
		})
		.from(welcomeTokens)
		.innerJoin(users, eq(users.id, welcomeTokens.userId))
		.where(eq(welcomeTokens.tokenHash, hashSecret(token)));
	if (!row) return { kind: 'unknown' };
	if (row.used) return { kind: 'used' };
	if (row.expired) return { kind: 'expired' };
	return { kind: 'live', name: row.name };
}

export interface WelcomeAccount {
	/** As the engine's `checkName` gives it. */
	name: string;
	nameKey: string;
	/** Checked with `validateSaveWrite`, with the account's name on it. */
	save: SaveWrite;
}

/**
 * Makes the account `name`, with `save` and no password, and a welcome link
 * to it, all or nothing. Null when the name is taken: the unique `name_key`
 * decides, as for a registration.
 */
export async function createWelcomeAccount(
	account: WelcomeAccount
): Promise<{ token: string; expiresAt: Date } | null> {
	const token = newSecret();
	try {
		return await db.transaction(async (tx) => {
			const [user] = await tx
				.insert(users)
				.values({ name: account.name, nameKey: account.nameKey, passwordHash: NO_PASSWORD })
				.returning({ id: users.id });
			if (!user) throw new Error('insert into users returned no row');
			await tx
				.insert(accountSaves)
				.values({ userId: user.id, data: account.save, seq: account.save.seq });
			const [link] = await tx
				.insert(welcomeTokens)
				.values({
					tokenHash: hashSecret(token),
					userId: user.id,
					expiresAt: sql`now() + make_interval(days => ${WELCOME_DAYS})`
				})
				.returning({ expiresAt: welcomeTokens.expiresAt });
			if (!link) throw new Error('insert into welcome_tokens returned no row');
			return { token, expiresAt: link.expiresAt };
		});
	} catch (error) {
		if (isUniqueViolation(error)) return null;
		throw error;
	}
}

export type WelcomeResult =
	| {
			kind: 'welcomed';
			name: string;
			/** The new session's token, for the cookie. */
			sessionToken: string;
			/** The account's save as stored, or null with none. */
			save: unknown;
	  }
	| { kind: 'used' }
	| { kind: 'expired' }
	| { kind: 'unknown' };

/** Thrown inside the transaction to undo it: the account got a password meanwhile. */
class HasPasswordNow extends Error {}

/**
 * Uses the link up: its account gets `passwordHash` and a first session, all
 * or nothing, and its save comes back for the page to play. The link is
 * marked used in the same transaction, on the condition that it is not
 * already, so of uses racing each other exactly one lands and the rest find
 * it used; one that finds the account with a password (the admin set one
 * meanwhile) changes nothing, and finds it used too.
 */
export async function acceptWelcome(token: string, passwordHash: string): Promise<WelcomeResult> {
	if (!TOKEN.test(token)) return { kind: 'unknown' };
	try {
		return await db.transaction(async (tx): Promise<WelcomeResult> => {
			const [link] = await tx
				.update(welcomeTokens)
				.set({ usedAt: sql`now()` })
				.where(
					and(
						eq(welcomeTokens.tokenHash, hashSecret(token)),
						isNull(welcomeTokens.usedAt),
						sql`${welcomeTokens.expiresAt} > now()`
					)
				)
				.returning({ userId: welcomeTokens.userId });
			if (!link) {
				const state = await welcomeState(token, tx);
				return state.kind === 'live' ? { kind: 'used' } : state;
			}
			const [user] = await tx
				.update(users)
				.set({ passwordHash })
				.where(and(eq(users.id, link.userId), eq(users.passwordHash, NO_PASSWORD)))
				.returning({ name: users.name });
			if (!user) throw new HasPasswordNow();
			const sessionToken = await createSession(tx, link.userId);
			const [saved] = await tx
				.select({ data: accountSaves.data })
				.from(accountSaves)
				.where(eq(accountSaves.userId, link.userId));
			return { kind: 'welcomed', name: user.name, sessionToken, save: saved?.data ?? null };
		});
	} catch (error) {
		if (error instanceof HasPasswordNow) return { kind: 'used' };
		throw error;
	}
}
