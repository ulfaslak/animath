import {
	bigint,
	bigserial,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core';

/**
 * The anonymous backup's players: the client receives an id + secret on first
 * visit and presents them on every backup. No login. Accounts (`users`, below)
 * are separate and never touch these tables; the backup runs only in
 * development (see `app.ts`).
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

/**
 * Accounts. `name` is the account's name as the player chose it (the engine's
 * `checkName`: trimmed, NFC), which is also their character's name; `name_key`
 * is the engine's `nameKey(name)`, unique, so two names that differ only in
 * case or in how a letter is written cannot both exist. `password_hash` is a
 * salted scrypt hash with its parameters (`passwords.ts`).
 */
export const users = pgTable('users', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	nameKey: text('name_key').notNull().unique('users_name_key_unique'),
	passwordHash: text('password_hash').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * A logged-in browser. The cookie holds a random token; only its SHA-256 hash
 * is stored, so a database dump logs nobody in. `expires_at` slides forward a
 * year as the session is used (`sessions.ts`).
 */
export const sessions = pgTable(
	'sessions',
	{
		tokenHash: text('token_hash').primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
	},
	(t) => [index('sessions_user_id_idx').on(t.userId)]
);

/**
 * The one save an account keeps: the same document as the browser's (`SaveV2`,
 * the engine's), written with the same guard as the anonymous backup. `seq` is
 * the document's own `seq`, kept beside it.
 */
export const accountSaves = pgTable('account_saves', {
	userId: uuid('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	data: jsonb('data').notNull(),
	seq: bigint('seq', { mode: 'number' }).notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * One-time welcome links (`welcome.ts`): an account the admin made for a kid
 * whose game moved here (`admin import-save`) has no password until the kid
 * picks one through its link. The link's token is random; only its SHA-256
 * hash is stored, as a session's is. A link works once (`used_at`), until
 * `expires_at`, and only while its account has no password.
 */
export const welcomeTokens = pgTable(
	'welcome_tokens',
	{
		tokenHash: text('token_hash').primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		usedAt: timestamp('used_at', { withTimezone: true })
	},
	(t) => [index('welcome_tokens_user_id_idx').on(t.userId)]
);

/**
 * An account's saves the server was about to lose, as `save_backups` keeps the
 * anonymous backup's: one replaced by a different game (a New game on the
 * title), or one this build could not read. Nothing reads it; it is there to
 * recover a kid's game by hand.
 */
export const accountSaveBackups = pgTable(
	'account_save_backups',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		data: jsonb('data').notNull(),
		/** `replaced` (another game took its place) or `unreadable` (this build could not read it). */
		reason: text('reason').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('account_save_backups_user_id_idx').on(t.userId)]
);
