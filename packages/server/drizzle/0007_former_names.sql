-- The names an account had before the kid picked a new one (`POST
-- /api/account/name`). A former name stays the account's: nobody else can
-- take it, and a page still playing the account by it is told the new one.
-- Only a new table: the build before this one never reads it.
CREATE TABLE IF NOT EXISTS "former_names" (
	"name_key" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "former_names_user_id_idx" ON "former_names" ("user_id");
