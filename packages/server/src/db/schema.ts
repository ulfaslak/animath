import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Players are anonymous: the client receives an id + secret on first visit and
 * presents them on every connection. No login. When accounts arrive, they
 * attach to a player row rather than replacing it.
 */
export const players = pgTable('players', {
	id: uuid('id').primaryKey().defaultRandom(),
	/**
	 * SHA-256 hex of the random secret the client holds (see `secrets.ts`).
	 * Presenting the secret proves ownership of the id; the secret itself is
	 * never stored.
	 */
	secretHash: text('secret_hash').notNull(),
	displayName: text('display_name'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * One save per player: position, party, inventory. Stored as a JSON blob while
 * the shape is still moving; promote hot fields to columns when a query needs
 * them (leaderboards, "who is near me").
 */
export const saves = pgTable('saves', {
	playerId: uuid('player_id')
		.primaryKey()
		.references(() => players.id, { onDelete: 'cascade' }),
	data: jsonb('data').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Saves the server was about to lose, kept instead: a document replaced by a
 * different game (another lineage), or one this build could not read. A
 * normal backup of the same game replaces its predecessor without a copy.
 * Nothing reads this table; it is there to recover a kid's game by hand.
 */
export const saveBackups = pgTable(
	'save_backups',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		playerId: uuid('player_id')
			.notNull()
			.references(() => players.id, { onDelete: 'cascade' }),
		data: jsonb('data').notNull(),
		/** `replaced` (another game took its place) or `unreadable` (this build could not read it). */
		reason: text('reason').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('save_backups_player_id_idx').on(t.playerId)]
);
