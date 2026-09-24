# Environment notes

Hard-won facts about the local dev environment, the shared resources agents collide on, and how to verify things. None of it is derivable from the code, and all of it has cost at least one session.

**Why this file exists.** Private agent memory is per-agent and per-machine; a second session sees none of it, so the same trap gets rediscovered at full cost. Anything true about *how this repo behaves* belongs here. Private memory is for preferences and conversational state, never for project facts.

This is **record-keeping, not DNA** — it describes what happens to be true right now, so entries change and get deleted as things get fixed. When you fix something listed here, remove the entry in the same PR.

---

## This machine is shared with the lawcel project

The same Mac runs lawcel's dev stack, often with several worktrees live at once. Two consequences:

- **Postgres.** Lawcel's container owns host port **5432**. Ours (`mathgame-postgres-1`, from the root `docker-compose.yml`) is on **5433**. `DATABASE_URL` in `.env.example` already says so; never "fix" it back to 5432.
- **Ports.** Lawcel dev servers start at Vite's default **5173** and count up. Ours: client **5180**, API **3000**. Before starting a server, `lsof -nP -iTCP:<port> -sTCP:LISTEN` — if something you didn't start is listening, pick another port and pass it explicitly; never kill a listener that isn't yours. Note that Vite binds `localhost` as IPv6 `[::1]` on this machine, so `curl 127.0.0.1:5180` fails while `curl localhost:5180` works; that's normal.

## No `psql` on the PATH

Use `pnpm db:psql -c "<sql>"` (wraps `docker compose exec postgres psql`), or `docker compose exec -T postgres psql -U postgres -d mathgame`.

## Looking at the game

The Claude-in-Chrome extension tab shows an error page for `localhost` URLs on this machine (cause not established; both `localhost` and `[::1]` fail while `curl` succeeds). Don't burn time on it: `node scripts/screenshot.mjs` drives the locally installed Google Chrome headlessly through `playwright-core` (no browser download) and renders WebGL through SwiftShader. It is slower than a GPU and logs "GPU stall" performance notes, which the script filters. Colours and layout are faithful; shadow softness and anti-aliasing are not, so judge those by eye in a real browser if they matter.

## pnpm 12 build-script approval

pnpm 12 refuses to run dependency postinstall scripts unless approved in `pnpm-workspace.yaml` under `allowBuilds` (the older `onlyBuiltDependencies` key is read but not honoured). `esbuild` is approved there. If `pnpm install` ever ends with `ERR_PNPM_IGNORED_BUILDS`, run `pnpm approve-builds <pkg> --yes` — it edits the file for you.
