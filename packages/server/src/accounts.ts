import type { SaveWrite } from '@mathgame/engine';
import { and, eq, getTableColumns, getTableName, ne, sql } from 'drizzle-orm';
import type { QueryConfig } from 'pg';
import { db, pool } from './db/index.js';
import {
	accountSaveBackups,
	accountSaves,
	formerNames,
	sessions,
	users,
	welcomeTokens
} from './db/schema.js';
import { NO_PASSWORD } from './passwords.js';
import { hashSecret } from './secrets.js';
import { createSession } from './sessions.js';

/**
 * Accounts in the database: whether they work here now, finding one by name,
 * making one, a new name or a new password the kid picks, and the two things
 * only the admin does (a new password, deleting an account). What a name or a
 * password may be is the engine's rule; the routes check it before anything
 * here runs.
 */

/**
 * The tables the account routes read: `0003_accounts` makes four, `0004` the
 * welcome links', `0007` the former names.
 */
const ACCOUNT_SCHEMA = [
	users,
	sessions,
	accountSaves,
	accountSaveBackups,
	welcomeTokens,
	formerNames
];

/** The accounts' tables by name. */
export const ACCOUNT_TABLES: readonly string[] = ACCOUNT_SCHEMA.map((table) => getTableName(table));

/**
 * Every column of those tables, as `schema.ts` gives them, so a database a
 * later migration has not reached (a home's `home_hash`, `0006`) is not
 * ready either: the routes read every one.
 */
export const ACCOUNT_COLUMNS: readonly (readonly [table: string, column: string])[] =
	ACCOUNT_SCHEMA.flatMap((table) =>
		Object.values(getTableColumns(table)).map(
			(column) => [getTableName(table), column.name] as const
		)
	);

/** Runs one query, as `pg`'s pool or a client of its own does. */
export type Ask = (text: string, values: unknown[]) => Promise<{ rows: unknown[] }>;

/**
 * pg's read timeout on the question (`query_timeout`): past it the question
 * fails, and the pool drops the connection it was stuck on. A connection
 * that went quiet without a word (a database host gone from the network)
 * would otherwise hold it until the system gave the socket up, a quarter of
 * an hour, and `AccountsReady` asks no second question beside one still out.
 */
export const READY_QUERY_TIMEOUT_MS = 5_000;

/**
 * Whether accounts can work in this database now: it answers, and every
 * table they use is there with every column they read (`ACCOUNT_COLUMNS`),
 * found as the routes' queries find them (the `search_path`). A server can
 * run without them: a development database that `pnpm db:migrate` has not
 * reached, all the way or to the newest migration, or a database that is
 * down. False for either, and for any error.
 */
export async function accountTablesReady(
	ask: Ask = (text, values) => {
		// pg reads `query_timeout` from a query's own config too; its types list it for a client only.
		const query: QueryConfig & { query_timeout: number } = {
			text,
			values,
			query_timeout: READY_QUERY_TIMEOUT_MS
		};
		return pool.query(query);
	}
): Promise<boolean> {
	try {
		// A table not found has no columns, so it counts as missing too.
		const { rows } = await ask(
			'select count(*)::int as missing from unnest($1::text[], $2::text[]) as c(tbl, col) ' +
				'where not exists (select 1 from pg_attribute a where a.attrelid = to_regclass(quote_ident(c.tbl)) ' +
				'and a.attname = c.col and not a.attisdropped)',
			[ACCOUNT_COLUMNS.map(([table]) => table), ACCOUNT_COLUMNS.map(([, column]) => column)]
		);
		const [row] = rows as { missing?: unknown }[];
		return row?.missing === 0;
	} catch {
		return false;
	}
}

/** How long the server keeps its answer to whether accounts work: every page asks every half minute. */
const READY_TTL_MS = 10_000;
/** How long the question may take: a database that does not answer by then is a no. */
const READY_TIMEOUT_MS = 2_000;

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
	/** The SHA-256 of its home browser's key (`home.ts`), or null with no home yet. */
	homeHash: string | null;
}

/** The account whose name has this `nameKey`, if any. */
export async function findUser(key: string): Promise<UserRow | null> {
	return findUserIn(db, key);
}

async function findUserIn(q: typeof db | Tx, key: string): Promise<UserRow | null> {
	const [row] = await q
		.select({
			id: users.id,
			name: users.name,
			passwordHash: users.passwordHash,
			homeHash: users.homeHash
		})
		.from(users)
		.where(eq(users.nameKey, key));
	return row ?? null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The advisory lock class a claim on a name holds (`holdNames`), apart from any other lock. */
const NAME_LOCK = 7231;

/**
 * Holds the names `keys` until the transaction ends. Making an account (a
 * registration, `admin import-save`) and a new name claim a name, and a new
 * name keeps the old one as a former name, each while holding the name, so
 * of two claims on one name the second looks only once the first has landed:
 * the unique `name_key` alone cannot see a former name. Taken in order, so two
 * transactions holding the same two names never wait for each other.
 */
export async function holdNames(tx: Tx, keys: readonly string[]): Promise<void> {
	for (const key of [...new Set(keys)].sort()) {
		await tx.execute(sql`select pg_advisory_xact_lock(${NAME_LOCK}, hashtext(${key}))`);
	}
}

/** The account whose former name has this `nameKey`, if any (`former_names`). */
export async function formerOwner(q: typeof db | Tx, key: string): Promise<string | null> {
	const [row] = await q
		.select({ userId: formerNames.userId })
		.from(formerNames)
		.where(eq(formerNames.nameKey, key));
	return row?.userId ?? null;
}

/** The name with this `nameKey` is an account's, or was one's: nobody else can take it. */
export async function nameTaken(key: string): Promise<boolean> {
	return (await findUser(key)) !== null || (await formerOwner(db, key)) !== null;
}

/** Postgres' unique-violation code, however the driver wraps the error. */
export function isUniqueViolation(error: unknown): boolean {
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
	/** The SHA-256 of the home key of the browser it is made in (`home.ts`): its home. None: no home yet. */
	homeHash?: string;
}

/**
 * Makes the account, its save (when one came along) and a first session, all
 * or nothing, with the browser it is made in as its home. Null when the name
 * was taken, even by a registration that landed a moment earlier (the unique
 * `name_key` decides), or is another account's former name.
 */
export async function createAccount(input: NewAccount): Promise<{ token: string } | null> {
	try {
		return await db.transaction(async (tx) => {
			await holdNames(tx, [input.nameKey]);
			if ((await formerOwner(tx, input.nameKey)) !== null) return null;
			const [user] = await tx
				.insert(users)
				.values({
					name: input.name,
					nameKey: input.nameKey,
					passwordHash: input.passwordHash,
					homeHash: input.homeHash ?? null
				})
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

export type RenameResult =
	| { kind: 'renamed' }
	/** Another account has the name, or had it. */
	| { kind: 'taken' }
	/** The account is gone (deleted while the request was on its way). */
	| { kind: 'gone' };

/**
 * The kid picked a new name (`POST /name`), `name` as `checkName` keeps it and
 * `key` its `nameKey`. The account's old name becomes a former name of its own
 * (none when only its case or its spacing changed: the key stays), a former
 * name of its own it takes back, and its save, where it holds a name, takes the
 * new one, so a login on another device finds the kid's name in it. Every
 * browser logged in stays logged in. `taken` when another account has the
 * name or had it.
 */
export async function renameAccount(
	userId: string,
	name: string,
	key: string
): Promise<RenameResult> {
	try {
		return await db.transaction(async (tx): Promise<RenameResult> => {
			// The account's row first: two renames of one account, and its save writes, wait in turn.
			const [user] = await tx
				.select({ name: users.name, nameKey: users.nameKey })
				.from(users)
				.where(eq(users.id, userId))
				.for('update');
			if (!user) return { kind: 'gone' };
			await holdNames(tx, [user.nameKey, key]);
			if (key !== user.nameKey) {
				const holder = await findUserIn(tx, key);
				if (holder !== null) return { kind: 'taken' };
				const formerly = await formerOwner(tx, key);
				if (formerly !== null && formerly !== userId) return { kind: 'taken' };
				if (formerly !== null) await tx.delete(formerNames).where(eq(formerNames.nameKey, key));
				await tx
					.insert(formerNames)
					.values({ nameKey: user.nameKey, userId, name: user.name })
					.onConflictDoNothing();
			}
			await tx.update(users).set({ name, nameKey: key }).where(eq(users.id, userId));
			await tx.execute(sql`
				update account_saves set data = jsonb_set(data, '{name}', to_jsonb(${name}::text))
				where user_id = ${userId} and jsonb_typeof(data -> 'name') = 'string'`);
			return { kind: 'renamed' };
		});
	} catch (error) {
		if (isUniqueViolation(error)) return { kind: 'taken' };
		throw error;
	}
}

/**
 * The kid picked a new password (`POST /password`): every other browser
 * logged in to the account is logged out, and this one, whose session token
 * is `keep`, stays in. False when there is no such account.
 */
export async function changePasswordHash(
	userId: string,
	passwordHash: string,
	keep: string
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const updated = await tx
			.update(users)
			.set({ passwordHash })
			.where(eq(users.id, userId))
			.returning({ id: users.id });
		await tx
			.delete(sessions)
			.where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashSecret(keep))));
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
	/** False for an account waiting for its welcome link (`welcome.ts`). */
	hasPassword: boolean;
	sessions: number;
	/** It has its own browser (`home.ts`). */
	hasHome: boolean;
	/** The names it had before, oldest first, or null with none (`former_names`). */
	formerly: string | null;
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
			hasPassword: sql<boolean>`${users.passwordHash} <> ${NO_PASSWORD}`,
			sessions: sql<number>`(select count(*)::int from ${sessions} where ${sessions.userId} = ${users.id} and ${sessions.expiresAt} > now())`,
			hasHome: sql<boolean>`${users.homeHash} is not null`,
			formerly: sql<
				string | null
			>`(select string_agg(${formerNames.name}, ', ' order by ${formerNames.createdAt}) from ${formerNames} where ${formerNames.userId} = ${users.id})`,
			seq: accountSaves.seq,
			savedAt: accountSaves.updatedAt
		})
		.from(users)
		.leftJoin(accountSaves, eq(accountSaves.userId, users.id))
		.orderBy(users.createdAt);
	return rows;
}
