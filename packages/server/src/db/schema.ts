import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Players are anonymous: the client receives an id + secret on first visit and
 * presents them on every connection. No login. When accounts arrive, they
 * attach to a player row rather than replacing it.
 */
export const players = pgTable('players', {
	id: uuid('id').primaryKey().defaultRandom(),
	/** Random secret the client holds; proves ownership of the id. */
	secret: text('secret').notNull(),
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
