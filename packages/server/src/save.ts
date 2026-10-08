import {
	canReplace,
	isNewerSave,
	readSave,
	replacesAnotherGame,
	type SaveWrite
} from '@mathgame/engine';
import { eq, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { accountSaveBackups, accountSaves, users } from './db/schema.js';

/**
 * Storing an account's save. The document's shape is the engine's
 * (`SaveV3`, `validateSaveWrite`); this module decides whether a write lands.
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

export type AccountWriteResult =
	| { kind: 'saved' }
	/** The stored save has the same or a higher `seq`; it comes back so the client can load it. */
	| { kind: 'stale'; stored: unknown }
	/** A newer build wrote the stored save, which this build never replaces; it comes back too. */
	| { kind: 'newer'; stored: unknown }
	/** The account is gone (deleted while this request was on its way). */
	| { kind: 'gone' };

/**
 * Stores `doc` as the account's save unless the stored one has the same or a
 * higher `seq`, or was written by a newer build (`canReplace`). Before
 * replacing a document from a different game, or one this build cannot read,
 * copies it to `account_save_backups`, within `ACCOUNT_BACKUP_BYTES`. The
 * account's row is locked for the read-decide-write, so two concurrent writes
 * are decided one after the other, never both against the same old document.
 * A write that does not land returns the stored save.
 */
export async function writeAccountSave(
	userId: string,
	doc: SaveWrite
): Promise<AccountWriteResult> {
	return db.transaction(async (tx) => {
		const [user] = await tx
			.select({ id: users.id })
			.from(users)
			.where(eq(users.id, userId))
			// Serializes this account's save writes without holding up a login,
			// whose new session only needs the row to stay (a key-share lock).
			.for('no key update');
		if (!user) return { kind: 'gone' };
		const [row] = await tx
			.select({ data: accountSaves.data })
			.from(accountSaves)
			.where(eq(accountSaves.userId, userId));
		const stored: unknown = row ? row.data : null;
		if (!canReplace(stored, doc)) {
			return { kind: isNewerSave(stored) ? 'newer' : 'stale', stored };
		}
		if (replacesAnotherGame(stored, doc)) {
			await tx.insert(accountSaveBackups).values({
				userId,
				data: stored,
				reason: readSave(stored).ok ? 'replaced' : 'unreadable'
			});
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
