import { canReplace, readSave, replacesAnotherGame, type SaveWrite } from '@mathgame/engine';
import { eq, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import {
	accountSaveBackups,
	accountSaves,
	players,
	saveBackups,
	saves,
	users
} from './db/schema.js';

/**
 * Storing a player's save backup. The document's shape is the engine's
 * (`SaveV1`, `validateSaveWrite`); this module decides whether a write lands.
 */

/**
 * Hard cap on a PUT body, and so on a backup. A party has no cap, so this is
 * what bounds a save. An animal takes about 80 bytes of one (a uuid, a
 * species, its HP), up to 140 with a twelve-letter name of 4-byte letters,
 * and twice that mid-battle, when the battle holds a second copy of the
 * party: 1 MiB holds over 3,500 such animals, and 6,000 without names. At
 * one catch every two minutes that is over a hundred hours of catching. The
 * 64 KB before it held about 230 in the worst case, which a keen kid could
 * reach.
 */
export const SAVE_MAX_BYTES = 1024 * 1024;

export type WriteResult = 'saved' | 'stale';

/**
 * Stores `doc` as the player's save unless the stored one has the same or a
 * higher `seq` (`canReplace`), which is `stale` (409). Before replacing a
 * document from a different game, or one this build cannot read, copies it to
 * `save_backups`. The player's row is locked for the read-decide-write, so
 * two concurrent writes are decided one after the other, never both against
 * the same old document.
 */
export async function writeSave(playerId: string, doc: SaveWrite): Promise<WriteResult> {
	return db.transaction(async (tx) => {
		await tx.select({ id: players.id }).from(players).where(eq(players.id, playerId)).for('update');
		const [row] = await tx
			.select({ data: saves.data })
			.from(saves)
			.where(eq(saves.playerId, playerId));
		const stored: unknown = row ? row.data : null;
		if (!canReplace(stored, doc)) return 'stale';
		if (replacesAnotherGame(stored, doc)) {
			await tx.insert(saveBackups).values({
				playerId,
				data: stored,
				reason: readSave(stored).ok ? 'replaced' : 'unreadable'
			});
		}
		await tx
			.insert(saves)
			.values({ playerId, data: doc })
			.onConflictDoUpdate({ target: saves.playerId, set: { data: doc, updatedAt: sql`now()` } });
		return 'saved';
	});
}

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
	/** The account is gone (deleted while this request was on its way). */
	| { kind: 'gone' };

/**
 * `writeSave` for an account's save: the same guard (`canReplace`), the same
 * copy aside before another game or an unreadable document is replaced (to
 * `account_save_backups`, within `ACCOUNT_BACKUP_BYTES`), with the account's
 * row locked for the read-decide-write. A stale write returns the stored save.
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
		if (!canReplace(stored, doc)) return { kind: 'stale', stored };
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
