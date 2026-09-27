-- Welcome links: an account the admin makes for a kid whose game moves here
-- from somewhere else (`admin import-save`) has no password until the kid
-- picks one through a one-time link. Only the token's SHA-256 is stored.
-- Only a new table: nothing else changes.
CREATE TABLE IF NOT EXISTS "welcome_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "welcome_tokens_user_id_idx" ON "welcome_tokens" ("user_id");
