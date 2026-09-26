import { canReplace, readSave, replacesAnotherGame, type SaveWrite } from '@mathgame/engine';
import { eq, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { players, saveBackups, saves } from './db/schema.js';

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
