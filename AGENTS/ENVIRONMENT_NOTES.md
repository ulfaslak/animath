# Environment notes

Hard-won facts about the local dev environment, the shared resources agents collide on, and how to verify things. None of it is derivable from the code, and all of it has cost at least one session.

**Why this file exists.** Private agent memory is per-agent and per-machine; a second session sees none of it, so the same trap gets rediscovered at full cost. Anything true about *how this repo behaves* belongs here. Private memory is for preferences and conversational state, never for project facts.

This is **record-keeping, not DNA** — it describes what happens to be true right now, so entries change and get deleted as things get fixed. When you fix something listed here, remove the entry in the same PR.

---

## This machine is shared with the lawcel project

The same Mac runs lawcel's dev stack, often with several worktrees live at once. Two consequences:

- **Postgres.** Lawcel's container owns host port **5432**. Ours (`mathgame-postgres-1`, from the root `docker-compose.yml`) is on **5433**. `DATABASE_URL` in `.env.example` already says so; never "fix" it back to 5432.
- **Ports.** Lawcel dev servers start at Vite's default **5173** and count up. Ours: client **5180**, API **3000**. Before starting a server, `lsof -nP -iTCP:<port> -sTCP:LISTEN` — if something you didn't start is listening, pick another port and pass it explicitly; never kill a listener that isn't yours. Note that Vite binds `localhost` as IPv6 `[::1]` on this machine, so `curl 127.0.0.1:5180` fails while `curl localhost:5180` works; that's normal.
- **The primary clone's dev servers are often already up.** The human (or another session) runs `pnpm dev` from `~/git/mathgame` on 5180 and 3000; `lsof -a -p <pid> -d cwd` shows whose it is. From a worktree, start your own client beside it with `pnpm -F @mathgame/client exec vite --port 5181 --strictPort` (the config pins 5180) and point the screenshot script at it with `--url http://localhost:5181/`. The client does not call the API yet, so no second API server is needed for anything on screen.

## No `psql` on the PATH

Use `pnpm db:psql -c "<sql>"` (wraps `docker compose exec postgres psql`), or `docker compose exec -T postgres psql -U postgres -d mathgame`.

**From a worktree, pass `-p mathgame`.** Compose names its project after the directory, so inside `../mathgame-worktrees/<branch>/` both `pnpm db:psql` and `pnpm db:up` look for a `<branch>-postgres-1` container and report `service "postgres" is not running` (or, for `db:up`, start a second Postgres that fights for port 5433). The dev database is the container `mathgame-postgres-1`: `docker compose -p mathgame exec -T postgres psql -U postgres -d mathgame -c "<sql>"`. `pnpm db:migrate` is unaffected — it connects through `DATABASE_URL`.

## `git gtr new` may skip the `.env` copy and the `pnpm install` hook

`.gtrconfig` asks gtr to copy `.env` and run `pnpm install` into every new worktree, and at least once (2026-09-25) it did neither: the fresh worktree had no `.env` and no `node_modules`. Without `.env` the server tests fail at startup with `DATABASE_URL is not set` (their vitest config derives the test database URL from it), which looks like a broken merge and isn't. After `git gtr new`, check `ls .env node_modules` in the worktree; if either is missing, `cp ../../mathgame/.env .` and `pnpm install` by hand.

## The Postgres container's clock runs ~120 ms ahead of the host

Measured with `clock_timestamp()` against `Date.now()`: 116–134 ms, stable across calls. A row whose default is `now()` therefore carries a later timestamp than a `new Date()` computed in Node afterwards, and a test asserting "updated after created" fails. Write timestamps with one clock — the server uses `sql\`now()\`` for `last_seen_at` and `updated_at` — and never compare a Postgres timestamp to a Node one across a gap under a second.

## Looking at the game

The Claude-in-Chrome extension tab shows an error page for `localhost` URLs on this machine (cause not established; both `localhost` and `[::1]` fail while `curl` succeeds). Don't burn time on it: `node scripts/screenshot.mjs` drives the locally installed Google Chrome headlessly through `playwright-core` (no browser download) and renders WebGL through SwiftShader. It is slower than a GPU and logs "GPU stall" performance notes, which the script filters. Colours and layout are faithful; shadow softness and anti-aliasing are not, so judge those by eye in a real browser if they matter.

Long walks lose taps. SwiftShader can freeze for over a second while new chunks render. Taps pressed during a freeze pile up, and the client keeps only two of them by design, so a 70-key route ends a few tiles short, and short by a different amount each run. For a walk longer than about 20 keys, pass `--key-interval 1300` and check the coordinates in the `hud:` line the script prints. To plan a route around water and trees, run a breadth-first search over `tileAtWorld` + `isWalkable` from `spawnPoint` in a throwaway vitest file.

## pnpm 12 build-script approval

pnpm 12 refuses to run dependency postinstall scripts unless approved in `pnpm-workspace.yaml` under `allowBuilds` (the older `onlyBuiltDependencies` key is read but not honoured). `esbuild` is approved there. If `pnpm install` ever ends with `ERR_PNPM_IGNORED_BUILDS`, run `pnpm approve-builds <pkg> --yes` — it edits the file for you.
