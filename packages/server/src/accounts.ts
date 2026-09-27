import type { SaveWrite } from '@mathgame/engine';
import { eq, getTableName, sql } from 'drizzle-orm';
import { db, pool } from './db/index.js';
import { accountSaveBackups, accountSaves, sessions, users } from './db/schema.js';
import { createSession } from './sessions.js';

/**
 * Accounts in the database: whether they work here now, finding one by name,
 * making one, and the two things only the admin does (a new password,
 * deleting an account). What a name or a password may be is the engine's
 * rule; the routes check it before anything here runs.
 */

/** The tables accounts keep everything in: migration `0003_accounts` makes them. */
export const ACCOUNT_TABLES: readonly string[] = [
	users,
	sessions,
	accountSaves,
	accountSaveBackups
].map((table) => getTableName(table));

/** Runs one query, as `pg`'s pool or a client of its own does. */
export type Ask = (text: string, values: unknown[]) => Promise<{ rows: unknown[] }>;

/**
 * Whether accounts can work in this database now: it answers, and every
 * table they use is there, found as the routes' queries find them (the
 * `search_path`). A server can run without them: a development database
 * that `pnpm db:migrate` has not reached, or a database that is down. False
 * for either, and for any error.
 */
export async function accountTablesReady(
	ask: Ask = (text, values) => pool.query(text, values)
): Promise<boolean> {
	try {
		const { rows } = await ask(
			'select count(*)::int as missing from unnest($1::text[]) as t(name) where to_regclass(quote_ident(t.name)) is null',
			[ACCOUNT_TABLES]
		);
		const [row] = rows as { missing?: unknown }[];
		return row?.missing === 0;
	} catch {
		return false;
	}
}

/** How long the server keeps its answer to whether accounts work: every page asks every half minute. */
export const READY_TTL_MS = 10_000;
/** How long the question may take: a database that does not answer by then is a no. */
export const READY_TIMEOUT_MS = 2_000;

/**
 * `accountTablesReady`, asked at most once every `ttlMs` however many pages
 * ask: askers racing each other share one question, and a question the
 * database leaves unanswered for `timeoutMs` is a no. A question still
 * unanswered is never asked again beside it, so a database that hangs holds
 * one connection of the pool here, not one more every `ttlMs`.
 */
export class AccountsReady {
	private known: { ready: boolean; at: number } | null = null;
	private asking: Promise<boolean> | null = null;
	/** A probe has not settled yet, even if its answer was given up on. */
	private probing = false;

	constructor(
		private readonly probe: () => Promise<boolean> = () => accountTablesReady(),
		private readonly ttlMs = READY_TTL_MS,
		private readonly timeoutMs = READY_TIMEOUT_MS,
		private readonly now: () => number = () => Date.now()
	) {}

	ready(): Promise<boolean> {
		const known = this.known;
		if (known !== null && this.now() - known.at < this.ttlMs) return Promise.resolve(known.ready);
		if (this.asking) return this.asking;
		if (this.probing) {
			// The last question never came back: still a no.
			this.known = { ready: false, at: this.now() };
			return Promise.resolve(false);
		}
		this.probing = true;
		let answer: Promise<boolean>;
		try {
			answer = this.probe();
		} catch {
			answer = Promise.resolve(false);
		}
		void answer.then(
			() => (this.probing = false),
			() => (this.probing = false)
		);
		const asking = noLater(answer, this.timeoutMs).then((ready) => {
			this.known = { ready, at: this.now() };
			this.asking = null;
			return ready;
		});
		this.asking = asking;
		return asking;
	}
}

/** `answer`, or false when it fails or has not come within `ms`. */
function noLater(answer: Promise<boolean>, ms: number): Promise<boolean> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), ms);
		timer.unref();
		answer.then(
			(ready) => {
				clearTimeout(timer);
				resolve(ready === true);
			},
			() => {
				clearTimeout(timer);
				resolve(false);
			}
		);
	});
}

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
