# Reset

Recreate the local dev database from scratch.

1. `pnpm db:down && docker compose down -v && pnpm db:up` — destroy and recreate the Postgres container with a clean volume (port 5433; the lawcel container on 5432 is untouched).
2. Wait for it: `docker compose exec -T postgres pg_isready -U postgres`.
3. `pnpm db:migrate` — apply all journaled migrations.
4. Confirm success: `pnpm db:psql -c "\dt"` — should list `players` and `saves` (plus whatever has been added since).

Report the result briefly.
