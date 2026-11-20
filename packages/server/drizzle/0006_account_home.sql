-- An account's own browser: the SHA-256 of the random key in that browser's
-- home cookie (`home.ts`). There the name alone logs in, and the password can
-- be changed. Null until the account has one. Only a nullable column and an
-- index: the build before this one never reads it.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "home_hash" text;

CREATE INDEX IF NOT EXISTS "users_home_hash_idx" ON "users" ("home_hash");
