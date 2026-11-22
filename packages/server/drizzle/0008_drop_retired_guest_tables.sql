-- The retired anonymous backup's tables (0000 to 0002). Nothing has read or
-- written them since the backup was retired on 2026-09-27: production's are
-- empty, and the one database that held rows, the developer's own, has them
-- copied outside the repository first. The build before this one serves
-- nothing from them (only its `admin export-local-save` read them, and nobody
-- runs that on production), so it keeps working while both builds answer.
-- save_backups and saves refer to players, so they go first; their indexes
-- go with them.
DROP TABLE IF EXISTS "save_backups";
DROP TABLE IF EXISTS "saves";
DROP TABLE IF EXISTS "players";
