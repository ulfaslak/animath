import {
	bigint,
	bigserial,
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core';

/**
 * The retired anonymous backup: `players`, `saves` and `save_backups`. Until
 * the human's kid's game moved to production, a guest's browser got an id and
 * a secret here and backed its save up under them (development only). Nothing
 * in the game reads or writes these tables any more; they stay, rows and all,
 * because the human's local database holds the kids' old games in them, which
 * `admin export-local-save` reads (`save-export.ts`), and no migration may drop
 * or alter them ([[INVARIANTS]] § Server; dropping them is a [[DEFERRED]] item).
 * Accounts (`users`, below) never refer to them.
 */
export const players = pgTable('players', {
	id: uuid('id').primaryKey().defaultRandom(),
	/** SHA-256 hex of the random secret the browser held; the secret itself was never stored. */
	secretHash: text('secret_hash').notNull(),
	displayName: text('display_name'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow()
});

/** The retired anonymous backup (above): one save per player, the save document (version 1 or 2) its browser last sent. */
export const saves = pgTable('saves', {
	playerId: uuid('player_id')
		.primaryKey()
		.references(() => players.id, { onDelete: 'cascade' }),
	data: jsonb('data').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * The retired anonymous backup (above): the saves it was about to lose, kept
 * instead, a document replaced by a different game (another lineage) or one
 * that build could not read. Nothing reads this table; a game in it comes
 * back only by hand.
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
 * is stored, so a database dump logs nobody in. `expires_at` is a year out,
 * and moves a year out again when `/me` sees it more than `SLIDE_AFTER_DAYS`
 * into its year (`sessions.ts`).
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
 * The one save an account keeps: the same document as the browser's (`SaveV5`,
 * the engine's), written only with a higher `seq` (`writeAccountSave`). `seq`
 * is the document's own `seq`, kept beside it.
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
 * An account's saves the server was about to lose, kept instead: one replaced
 * by a different game (a New game on the title), one this build could not
 * read, or one an older build wrote. Nothing reads it; it is there to recover a kid's game by hand.
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

/**
 * Error reports from the game's pages (`client-errors.ts`): an error nothing
 * on a page caught, what the page showed, the build, the browser and the
 * window's size, and nothing about whose browser it was. `test` marks one sent
 * by hand to check the route. Kept `KEEP_DAYS`, `KEEP_ROWS` at most; only the
 * admin reads them (`admin errors`). Nothing refers to another table.
 */
export const clientErrors = pgTable(
	'client_errors',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		message: text('message').notNull(),
		stack: text('stack').notNull(),
		build: text('build').notNull(),
		mode: text('mode').notNull(),
		browser: text('browser').notNull(),
		screen: text('screen').notNull(),
		test: boolean('test').notNull().default(false)
	},
	(t) => [index('client_errors_created_at_idx').on(t.createdAt)]
);
