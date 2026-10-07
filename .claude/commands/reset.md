# Reset

Recreate the local dev database from scratch.

**Only the human runs this, and only from the primary clone (`~/git/mathgame`).** `docker compose down -v` deletes everything this Mac's `mathgame` database holds: its accounts and the kids' games the retired anonymous backup kept ([[DEVELOPMENT]] § Database). An agent never runs it; an agent that needs a clean database makes one of its own ([[DEVELOPMENT]] § Running).

1. `docker compose -p mathgame down -v && docker compose -p mathgame up -d` — destroy and recreate the Postgres container with a clean volume (port 5433; the lawcel container on 5432 is untouched).
2. Wait for it: `docker compose -p mathgame exec -T postgres pg_isready -U postgres`.
3. `pnpm db:migrate` — apply all journaled migrations.
4. Confirm success: `docker compose -p mathgame exec -T postgres psql -U postgres -d mathgame -c "\dt"` — should list every table in `packages/server/src/db/schema.ts` (today `players`, `saves`, `save_backups`, `users`, `sessions`, `account_saves`, `account_save_backups`, `welcome_tokens` and `client_errors`).

Report the result briefly.
