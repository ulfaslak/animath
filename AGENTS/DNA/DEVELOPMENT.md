# Development

How to work on the game: setup, running, testing, migrations, sharing. Environment traps that are true today but not by design live in [[ENVIRONMENT_NOTES]].

## Prerequisites

- Node ≥ 26 and pnpm 12 (`corepack` or Homebrew). `package.json` pins `packageManager`.
- Docker (for local Postgres).
- Google Chrome installed (the screenshot script drives it; nothing is downloaded).
- `gh` authenticated, `git gtr` installed (worktrees).

## Setup

```bash
pnpm install          # installs all three packages
cp .env.example .env  # if missing; gtr copies it into worktrees
pnpm db:up            # Postgres on localhost:5433
pnpm db:migrate       # applies packages/server/drizzle/*.sql
```

## Running

```bash
pnpm dev              # both dev servers, interleaved output
pnpm dev:client       # Vite on http://localhost:5180 (proxies /api, /ws → 3000)
pnpm dev:server       # Hono on http://localhost:3000 (tsx watch)
```

Health check: `curl localhost:3000/api/health` → `{"ok":true,"db":true}`.

Production shape: `pnpm build` then `pnpm -F @mathgame/server start` serves the built client from `packages/client/dist` and the API from one process.

## Looking at the game

```bash
node scripts/screenshot.mjs --out screenshots/what-i-changed.png
node scripts/screenshot.mjs --keys "ArrowRight*5,ArrowDown*2" --out screenshots/after-walk.png
node scripts/screenshot.mjs --width 1024 --height 768   # tablet landscape
node scripts/screenshot.mjs --url 'http://localhost:5180/?zoo' --scale 3 --clip 400,320,360,230   # every animal figure, magnified 3× (same camera)
```

Headless Chrome via `playwright-core`, WebGL through SwiftShader. The script exits non-zero and prints console errors (and warnings) if the page logged any. **Read the image** — a saved file you never looked at verifies nothing. The `/play` command wraps this.

`--keys` is a comma-separated script run in order. A plain token is a key name, optionally `*n` to repeat it (`ArrowRight*5`, `Enter`, `3`). The rest take an argument:

| Token              | Does                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| `type:<text>`      | types each character, e.g. an answer: `type:56`, `type:-5`                              |
| `hold:<key>:<ms>`  | holds a key down with auto-repeat, as a real keyboard does (`hold:ArrowUp:5000`)       |
| `wait:<ms>`        | pauses — a battle turn takes several seconds to narrate                                 |
| `shot:<name>`      | saves an extra frame to `<out>-<name>.png` there and then                               |
| `size:<w>x<h>`     | resizes the window mid-run                                                              |
| `reload:`          | reloads the page                                                                        |

After every frame the script prints what the screen says — the HUD line with the grid position in explore; in a battle the status boxes, the menu (the highlighted row in brackets, with its level), the narration line, the puzzle, the typed answer, the judgement and the result card — so a run can be checked from its output as well as its images.

**Playing a battle.** The 11th step of Left, Right, Left, … from the start always meets a rabbit (see [[CHEATSHEET]] § Finding a battle fast; the animal changes whenever the encounter tables do). Walk in, look, run away:

```bash
node scripts/screenshot.mjs --keys "ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,ArrowLeft,wait:8000,shot:menu,ArrowUp,Enter,wait:4000,shot:result,Enter" --out screenshots/ran.png
```

To attack, press the level key on the highlighted attack (`1`, or `ArrowDown,3` for the second attack at level 3), then `wait:1500,type:<answer>,Enter,wait:9000`. Answering wrong on purpose (a loss) needs no answers. Puzzles are seeded like everything else, so the same keys meet the same puzzles: to learn the right answers, replay the same walk and intents against the client's `LocalAuthority` (`packages/client/src/authority/local.ts`) in a throwaway script run with `packages/server/node_modules/.bin/tsx`, and read each `puzzle-shown` event's `puzzle.answer`. Answers change whenever the puzzle generators do, so never hard-code them in docs or tests.

## Checks and tests

```bash
pnpm check   # tsc for engine + server, svelte-check for client
pnpm test    # vitest in engine and server
pnpm lint    # prettier --check
pnpm format  # prettier --write
```

Per package: `pnpm -F @mathgame/engine test`, `pnpm -F @mathgame/engine test:watch`.

### Testing ideology

All code is written by agents; the human reviews PRs and plays the game but doesn't run test suites by hand. Tests are the primary regression net and must be high-signal and low-maintenance.

**The engine is the backbone.** It is pure and seeded, so every rule can be tested exhaustively and deterministically. Prefer:

- **Property tests over the whole space** rather than examples: every species in the catalog, every kind at every difficulty, 25 seeds. `battle.test.ts` and `puzzles.test.ts` are the pattern. A balance change that breaks monotonicity anywhere in the catalog must fail a test.
- **Independent re-derivation** for generators: the puzzle test re-solves each prompt with its own tiny solver instead of trusting `answer`. When you add a puzzle kind, extend the solver.
- **Replay tests** for state machines: apply a fixed intent log to a fixed seed and assert the final state. When the battle reducer lands, this is how it is tested.
- **Boundary tests** that pin the architecture: `purity.test.ts` fails if the engine grows an import. Keep it.

**Simulate balance, don't guess it.** When a change touches damage, HP, catch rates or difficulty, write (or run) a small simulation in `packages/engine/test/` or a scratch script: N battles between species pairs, win rates, average turns, catch attempts to success. Paste the table in the PR. A number in [[PRODUCT]] §4 that was never simulated is a guess.

**Client**: no unit tests for rendering. Verification is a screenshot you read (see above), at the default viewport and at 1024×768. Pure client helpers (input mapping, tweens) may get vitest tests if they grow logic; Svelte components don't. `test/animals.test.ts` pins the figure contract (every catalog species builds, feet on `y = 0`, flat-shaded) because a species added to the engine without a figure would otherwise only fail at run time. `test/local-authority.test.ts` drives the real `LocalAuthority` over the real engine (the authority's rules around the engine: encounters, outcomes, the party cap), and `test/battle-controller.test.ts` presses keys at the battle screen against it — the input and pacing rules a screenshot can't pin (held keys, empty answers, mashing, stale events). Both read puzzle answers from the events, never from a hard-coded list.

**Server**: integration tests in `packages/server/test/*.test.ts` drive the real app through `app.request()` against a real `mathgame_test` database — no mocks below the HTTP layer. `test/global-setup.ts` creates the database on the same Postgres if missing, applies the journaled migrations and truncates it, and `vitest.config.ts` injects its URL as `DATABASE_URL`, so a test can never touch `mathgame`. Each test creates its own player, so tests share no rows. Mock the DB only for what cannot be exercised for real (`src/app.test.ts` mocks `pingDb` to see the 503).

**Don't test**: framework glue, things the type system guarantees, a wrapper that only forwards to the engine.

**Redundancy rule**: a test that mocks a dependency and asserts what another test already proves with the real thing is dead weight. Remove it. `/cleanse` prunes these.

**Pragmatic coverage.** No coverage number. The question is: "if an agent breaks this rule in a future PR, does a test fail before merge?"

## Database

Local Postgres runs in Docker (`docker-compose.yml`, host port 5433, database `mathgame`, user/password `postgres`). `pnpm db:psql -c "<sql>"` runs a query; `/reset` recreates it from scratch.

The server test suite uses a second database on the same instance, `mathgame_test`, created and migrated by the tests themselves (see § Testing ideology). `TEST_DATABASE_URL` overrides its URL; the name must end in `_test`.

### Migrations

Hand-written SQL, applied by `pnpm db:migrate` (`drizzle-orm`'s migrator, journal-driven).

1. Edit `packages/server/src/db/schema.ts`.
2. Add `packages/server/drizzle/NNNN_<name>.sql` with the next number. Use `IF NOT EXISTS` / `IF EXISTS` so it is idempotent.
3. Append an entry to `packages/server/drizzle/meta/_journal.json`: `idx` +1, `tag` = filename without `.sql`, `version: "7"`, a larger `when`, `breakpoints: true`. **A `.sql` without a journal entry is never applied.**
4. Run `pnpm db:migrate`, then confirm with `pnpm db:psql -c "\d <table>"`.

Never run `drizzle-kit generate` in a worktree (it emits a full `0000` dump that collides with the real one).

## Sharing the game through a tunnel

Until there is a deploy, the game is shared from this machine:

```bash
TUNNEL=1 pnpm dev:client       # lets Vite accept the tunnel hostname
ngrok http 5180                # or: cloudflared tunnel --url http://localhost:5180
```

Send the printed URL. The API is reached through Vite's proxy, so one tunnel is enough. Installing and authenticating the tunnel client is a human task ([[HUMAN_TODO]]).

## Deployment

None yet. The plan ([[DECISIONS]] § Deployment): Docker image with the built client + server, Docker Compose with Postgres behind nginx on the existing Hetzner VPS, GitHub Actions build on merge. When that lands, this section grows the operational recipes and CLAUDE.md gains a Phase 5 (post-deploy verification).
