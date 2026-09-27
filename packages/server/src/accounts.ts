import type { SaveWrite } from '@mathgame/engine';
import { eq, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { accountSaves, sessions, users } from './db/schema.js';
import { createSession } from './sessions.js';

/**
 * Accounts in the database: finding one by name, making one, and the two
 * things only the admin does (a new password, deleting an account). What a
 * name or a password may be is the engine's rule; the routes check it before
 * anything here runs.
 */

export interface UserRow {
	id: string;
	name: string;
	passwordHash: string;
}

/** The account whose name has this `nameKey`, if any. */
export async function findUser(key: string): Promise<UserRow | null> {
	const [row] = await db
		.select({ id: users.id, name: users.name, passwordHash: users.passwordHash })
		.from(users)
		.where(eq(users.nameKey, key));
	return row ?? null;
}

/** Postgres' unique-violation code, however the driver wraps the error. */
function isUniqueViolation(error: unknown): boolean {
	for (let e: unknown = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
		if ((e as { code?: unknown }).code === '23505') return true;
	}
	return false;
}

export interface NewAccount {
	name: string;
	nameKey: string;
	passwordHash: string;
	/** The guest game the player brings along, already checked with `validateSaveWrite`. */
	save: SaveWrite | null;
}

/**
 * Makes the account, its save (when one came along) and a first session, all
 * or nothing. Null when the name was taken, even by a registration that
 * landed a moment earlier: the unique `name_key` decides.
 */
export async function createAccount(input: NewAccount): Promise<{ token: string } | null> {
	try {
		return await db.transaction(async (tx) => {
			const [user] = await tx
				.insert(users)
				.values({ name: input.name, nameKey: input.nameKey, passwordHash: input.passwordHash })
				.returning({ id: users.id });
			if (!user) throw new Error('insert into users returned no row');
			if (input.save) {
				await tx
					.insert(accountSaves)
					.values({ userId: user.id, data: input.save, seq: input.save.seq });
			}
			return { token: await createSession(tx, user.id) };
		});
	} catch (error) {
		if (isUniqueViolation(error)) return null;
		throw error;
	}
}

/** Sets a new password hash and logs the account out everywhere. False when there is no such account. */
export async function setPasswordHash(userId: string, passwordHash: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		const updated = await tx
			.update(users)
			.set({ passwordHash })
			.where(eq(users.id, userId))
			.returning({ id: users.id });
		await tx.delete(sessions).where(eq(sessions.userId, userId));
		return updated.length > 0;
	});
}

/** Deletes the account with its sessions, save and set-aside saves. False when there is no such account. */
export async function deleteUser(userId: string): Promise<boolean> {
	const deleted = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
	return deleted.length > 0;
}

export interface AccountSummary {
	name: string;
	createdAt: Date;
	sessions: number;
	/** The save's `seq`, or null with no save. */
	seq: number | null;
	savedAt: Date | null;
}

/** Every account, oldest first, for the admin. */
export async function listAccounts(): Promise<AccountSummary[]> {
	const rows = await db
		.select({
			name: users.name,
			createdAt: users.createdAt,
			sessions: sql<number>`(select count(*)::int from ${sessions} where ${sessions.userId} = ${users.id} and ${sessions.expiresAt} > now())`,
			seq: accountSaves.seq,
			savedAt: accountSaves.updatedAt
		})
		.from(users)
		.leftJoin(accountSaves, eq(accountSaves.userId, users.id))
		.orderBy(users.createdAt);
	return rows;
}
