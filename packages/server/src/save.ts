import {
	canReplace,
	isNewerSave,
	readSave,
	replacesAnotherGame,
	type SaveWrite
} from '@mathgame/engine';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { accountSaveBackups, accountSaves, users } from './db/schema.js';

/**
 * Storing an account's save. The document's shape is the engine's
 * (`SaveV7`, `validateSaveWrite`); this module decides whether a write lands.
 */

/**
 * Hard cap on a PUT body, and so on a save. A party has no cap, so this is
 * what bounds a save. An animal takes about 80 bytes of one (a uuid, a
 * species, its HP), up to 140 with a twelve-letter name of 4-byte letters,
 * and twice that mid-battle, when the battle holds a second copy of the
 * party: 1 MiB holds over 3,500 such animals, and 6,000 without names. At
 * one catch every two minutes that is over a hundred hours of catching. The
 * 64 KB before it held about 230 in the worst case, which a keen kid could
 * reach.
 */
export const SAVE_MAX_BYTES = 1024 * 1024;

/**
 * The 503 for a save this server cannot read because a newer build wrote it:
 * the server is the older one (a deploy half done, or a rollback). The client
 * keeps its save and tries again later, as when the server is out of reach.
 */
export const SAVE_FROM_NEWER_BUILD =
	'this save is from a newer version of the game than this server';

/** The 409 for a write over a save a newer build wrote: never replaced, whatever the `seq`. */
export const STORED_FROM_NEWER_BUILD = 'the stored save is from a newer version of the game';

/**
 * How much of an account's set-aside saves the server keeps, as Postgres
 * stores them: the newest first, as many as fit, and always the newest one.
 * A kid's save is a few kilobytes, so this keeps hundreds of New games; a
 * client that sends a megabyte of another game with every write keeps two,
 * and cannot fill the disk.
 */
export const ACCOUNT_BACKUP_BYTES = 2 * 1024 * 1024;

/**
 * Why a game is among an account's set-aside saves (`account_save_backups`):
 * `replaced`, another game, or an older build's save of this one, took its
 * place; `unreadable`, this build could not read it; `guest`, the guest game
 * the password gate passed over when it logged this browser in to the
 * account (`keepAccountGame`).
 */
export type KeptReason = 'replaced' | 'unreadable' | 'guest';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Copies `data` to the account's set-aside saves, then drops the oldest ones
 * past `ACCOUNT_BACKUP_BYTES`, always keeping the newest. Runs inside the
 * caller's transaction, with the account's row locked.
 */
async function keepAside(tx: Tx, userId: string, data: unknown, reason: KeptReason): Promise<void> {
	await tx.insert(accountSaveBackups).values({ userId, data, reason });
	await tx.execute(sql`
		delete from account_save_backups
		where user_id = ${userId}
		  and id in (
			select id from (
				select id, sum(pg_column_size(data)) over (order by id desc) as kept
				from account_save_backups where user_id = ${userId}
			) newest_first
			where kept > ${ACCOUNT_BACKUP_BYTES}
			  and id <> (select max(id) from account_save_backups where user_id = ${userId})
		  )`);
}

export type KeepResult =
	/** Kept among the account's set-aside saves. */
	| { kind: 'kept' }
	/**
	 * The account holds this very document already: it is the account's save,
	 * or the newest of its set-aside saves. Nothing is written.
	 */
	| { kind: 'held' }
	/** The account is gone (deleted while this request was on its way). */
	| { kind: 'gone' };

/**
 * Keeps `doc`, a guest game the password gate passed over, among the
 * account's set-aside saves (`guest`), within `ACCOUNT_BACKUP_BYTES`, so the
 * grown-up can bring it back by hand. The account's own save is never
 * touched. Only the very same document is `held`, never kept twice: the
 * account's save, or the newest set-aside save, which is where a page that
 * did not hear the answer finds it when it sends it again at the next gate.
 * A copy of the account's own game (the same lineage) that differs in any
 * way is kept, whatever its `seq`: it may hold play the account's save does
 * not. Two documents are compared at most, each up to a save's size, so the
 * cost does not grow with the set-aside saves an account has. The account's
 * row is locked, as for a write, so racing sends are decided one after the
 * other, each seeing what the one before kept.
 */
export async function keepAccountGame(userId: string, doc: SaveWrite): Promise<KeepResult> {
	const text = JSON.stringify(doc);
	return db.transaction(async (tx) => {
		const [user] = await tx
			.select({ id: users.id })
			.from(users)
			.where(eq(users.id, userId))
			.for('no key update');
		if (!user) return { kind: 'gone' };
		const [save] = await tx
			.select({ same: sql<boolean>`${accountSaves.data} = ${text}::jsonb` })
			.from(accountSaves)
			.where(eq(accountSaves.userId, userId));
		if (save?.same) return { kind: 'held' };
		const [newest] = await tx
			.select({ same: sql<boolean>`${accountSaveBackups.data} = ${text}::jsonb` })
			.from(accountSaveBackups)
			.where(eq(accountSaveBackups.userId, userId))
			.orderBy(desc(accountSaveBackups.id))
			.limit(1);
		if (newest?.same) return { kind: 'held' };
		await keepAside(tx, userId, doc, 'guest');
		return { kind: 'kept' };
	});
}

export type AccountWriteResult =
	| { kind: 'saved' }
	/** The stored save has the same or a higher `seq`; it comes back so the client can load it. */
	| { kind: 'stale'; stored: unknown }
	/** A newer build wrote the stored save, which this build never replaces; it comes back too. */
	| { kind: 'newer'; stored: unknown }
	/** The account is gone (deleted while this request was on its way). */
	| { kind: 'gone' }
	/** The account took a new name, `name`, while this request was on its way: nothing written. */
	| { kind: 'renamed'; name: string };

/**
 * Stores `doc` as the account's save unless the stored one has the same or a
 * higher `seq`, or was written by a newer build (`canReplace`). Before
 * replacing a document from a different game, one this build cannot read, or
 * one an older build wrote (`replacesAnotherGame`), copies it to
 * `account_save_backups`, within `ACCOUNT_BACKUP_BYTES`. The account's row
 * is locked for the read-decide-write, so two concurrent writes are decided
 * one after the other, never both against the same old document.
 * A write that does not land returns the stored save. `name` is the
 * account's name as the request named it, spelled as it is: a new name that
 * landed since then (`renameAccount`, which locks the row too), even one in
 * another case only, refuses the write, so a page still playing the account
 * by its old name puts no old name back in its save.
 */
export async function writeAccountSave(
	userId: string,
	doc: SaveWrite,
	name: string
): Promise<AccountWriteResult> {
	return db.transaction(async (tx) => {
		const [user] = await tx
			.select({ id: users.id, name: users.name })
			.from(users)
			.where(eq(users.id, userId))
			// Serializes this account's save writes without holding up a login,
			// whose new session only needs the row to stay (a key-share lock).
			.for('no key update');
		if (!user) return { kind: 'gone' };
		if (user.name !== name) return { kind: 'renamed', name: user.name };
		const [row] = await tx
			.select({ data: accountSaves.data })
			.from(accountSaves)
			.where(eq(accountSaves.userId, userId));
		const stored: unknown = row ? row.data : null;
		if (!canReplace(stored, doc)) {
			return { kind: isNewerSave(stored) ? 'newer' : 'stale', stored };
		}
		if (replacesAnotherGame(stored, doc)) {
			await keepAside(tx, userId, stored, readSave(stored).ok ? 'replaced' : 'unreadable');
		}
		await tx
			.insert(accountSaves)
			.values({ userId, data: doc, seq: doc.seq })
			.onConflictDoUpdate({
				target: accountSaves.userId,
				set: { data: doc, seq: doc.seq, updatedAt: sql`now()` }
			});
		return { kind: 'saved' };
	});
}
