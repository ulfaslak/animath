import { canReplace, readSave, replacesAnotherGame, type SaveWrite } from '@mathgame/engine';
import { eq, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { players, saveBackups, saves } from './db/schema.js';

/**
 * Storing a player's save backup. The document's shape is the engine's
 * (`SaveV1`, `validateSaveWrite`); this module decides whether a write lands.
 */

/** Hard cap on a PUT body. A full party mid-battle, with nicknames, is a few KB. */
export const SAVE_MAX_BYTES = 64 * 1024;

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
