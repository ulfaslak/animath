-- Saves the server would otherwise lose: a backup from a different game (another
-- lineage) or one this build cannot read replaces them, so they are copied here
-- first. See packages/server/src/save.ts.
CREATE TABLE IF NOT EXISTS "save_backups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
	"data" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "save_backups_player_id_idx" ON "save_backups" ("player_id");
