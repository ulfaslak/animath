-- Error reports from the game's pages (`POST /api/client-errors`,
-- `client-errors.ts`): what broke in a kid's browser, and nothing about whose
-- browser it was: no name, no account, no address, no save. The server keeps
-- 30 days of them and 5,000 at most, and only the admin reads them
-- (`admin errors`). Only a new table: nothing else changes.
CREATE TABLE IF NOT EXISTS "client_errors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message" text NOT NULL,
	"stack" text NOT NULL,
	"build" text NOT NULL,
	"mode" text NOT NULL,
	"browser" text NOT NULL,
	"screen" text NOT NULL,
	"test" boolean DEFAULT false NOT NULL
);

CREATE INDEX IF NOT EXISTS "client_errors_created_at_idx" ON "client_errors" ("created_at");
