-- Store only the SHA-256 hash of a player's secret. Nothing had written a
-- player row before this migration, so a rename is enough: no backfill.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'players' AND column_name = 'secret'
	) THEN
		ALTER TABLE "players" RENAME COLUMN "secret" TO "secret_hash";
	END IF;
END $$;
