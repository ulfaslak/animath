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

The game saves in the browser without the API; the API only holds the backup ([[ARCHITECTURE]] § Saving). From a worktree, run your own API on a free port against your own database and point your Vite at it:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5433/<yours> PORT=3021 pnpm dev:server
API_PORT=3021 pnpm -F @mathgame/client exec vite --port 5191 --strictPort
```

A browser's save lives under the page's address: `localhost:5180`, `localhost:5191` and the tunnel link are three separate games, each with its own `localStorage`.

## Looking at the game

```bash
node scripts/screenshot.mjs --out screenshots/what-i-changed.png
node scripts/screenshot.mjs --keys "ArrowRight*5,ArrowDown*2" --out screenshots/after-walk.png
node scripts/screenshot.mjs --width 1024 --height 768   # tablet landscape
node scripts/screenshot.mjs --url 'http://localhost:5180/?zoo' --scale 3 --clip 350,300,420,260   # every animal figure, magnified 3× (same camera)
```

Headless Chrome via `playwright-core`, WebGL through SwiftShader. The script exits non-zero and prints console errors (and warnings) if the page logged any. **Read the image** — a saved file you never looked at verifies nothing. The `/play` command wraps this.

Every run is a fresh browser: a new player and a new game, so walks from the start always behave the same. `reload:` keeps the game (the save is in the page's `localStorage`), which is how to check that something survives a reload. API calls that fail (no API server behind the proxy, a `409`) are listed at the end and do not fail the run; the game plays and saves without the API. `?new` plays a game that touches neither storage nor the API.

`--keys` is a comma-separated script run in order. A plain token is a key name, optionally `*n` to repeat it (`ArrowRight*5`, `Enter`, `3`). The rest take an argument:

| Token              | Does                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| `type:<text>`      | types each character, e.g. an answer (`type:56`, `type:-5`) or a name, emoji included (`type:Pip😀`); never a comma |
| `hold:<key>:<ms>`  | holds a key down with auto-repeat, as a real keyboard does (`hold:ArrowUp:5000`)       |
| `down:<key>`       | presses a key and keeps it down while the next tokens run; another `down:` of it is an auto-repeat |
| `up:<key>`         | lets go of a key pressed with `down:` (`down:ArrowRight,Escape,down:ArrowRight,Escape,up:ArrowRight`: a walking key held across the pause menu) |
| `wait:<ms>`        | pauses — a battle turn takes several seconds to narrate                                 |
| `shot:<name>`      | saves an extra frame to `<out>-<name>.png` there and then                               |
| `size:<w>x<h>`     | resizes the window mid-run                                                              |
| `reload:`          | reloads the page                                                                        |

After every frame the script prints what the screen says: the message line in explore (`hud:`), with `?debug` in the URL the grid position and facing (`at:`), and the party cards (`party:`, the lead in brackets); in the pause menu its rows (the lit one in brackets), the picked animal's options (greyed ones in parentheses), the name box with whether it has the focus, and the notes under it; at the doctor the doctor's line and the party (the highlighted row in brackets); in a battle the status boxes, the menu (the highlighted row in brackets; each attack with its level word, greyed rows marked) or the switch list in its place (`switch:`), the narration line, the puzzle, the typed answer, the judgement and the result card — so a run can be checked from its output as well as its images.

`?party=` starts the game with any party (`?party=squirrel:5,rabbit:0,fox`: species, then HP, full by default), for screens that need a big or hurt one; `?debug` and `?party=` combine (see [[CHEATSHEET]] § Hidden behaviour).

**Visiting the doctor.** Seven steps right from the start, all on grass, then Down bumps the tent at (5, 7); Enter opens the card, which takes no key but Escape for half a second:

```bash
node scripts/screenshot.mjs --url 'http://localhost:5180/?debug&party=squirrel:5,rabbit:0,fox' --keys "ArrowRight*7,ArrowDown,shot:prompt,Enter,wait:700,shot:card,Enter,wait:500,shot:puzzle,Escape" --out screenshots/doctor.png
```

**Playing a battle.** The 11th step of Left, Right, Left, … from the start always meets a rabbit while the starting squirrel leads (see [[CHEATSHEET]] § Finding a battle fast; the animal changes whenever the encounter tables or the lead do, and `local-authority.test.ts` pins it). Walk in, look, run away:

```bash
node scripts/screenshot.mjs --keys "ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,ArrowLeft,wait:8000,shot:menu,ArrowUp,Enter,wait:4000,shot:result,Enter" --out screenshots/ran.png
```

To attack, press the level key on the highlighted attack (`1`, or `ArrowDown,3` for the second attack at level 3), then `wait:1500,type:<answer>,Enter,wait:9000`. Answering wrong on purpose (a loss) needs no answers. Puzzles are seeded like everything else, so the same keys meet the same puzzles: to learn the right answers, replay the same walk and intents against the client's `LocalAuthority` (`packages/client/src/authority/local.ts`) in a throwaway script run with `packages/server/node_modules/.bin/tsx`, and read each `puzzle-shown` event's `puzzle.answer`. Answers change whenever the puzzle generators do, so never hard-code them in docs or tests.

## Checks and tests

```bash
pnpm check   # tsc for engine + server, svelte-check for client
pnpm test    # vitest in engine, client and server
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

**Keep every test well under vitest's 5 s default timeout**, including when other worktrees load the machine. A sweep costs the product of its dimensions, so when a new dimension joins an existing one (every lead, every species), time the file again. In a hot loop, collect failures into an array and assert once (`expect(bad).toEqual([])`): an `expect` per item costs more than the rule it checks. A sampling test can skip the draws it does not measure; `encounters.test.ts` samples species picks with an `Rng` whose every chance comes up.

**Simulate balance, don't guess it.** When a change touches damage, HP, catch rates or difficulty, write (or run) a small simulation in `packages/engine/test/` or a scratch script: N battles between species pairs, win rates, average turns, catch attempts to success. Paste the table in the PR. A number in [[PRODUCT]] §4 that was never simulated is a guess.

**Client**: no unit tests for rendering. Verification is a screenshot you read (see above), at the default viewport and at 1024×768. Pure client helpers (input mapping, tweens) may get vitest tests if they grow logic; Svelte components don't. `test/animals.test.ts` pins the figure contract (every catalog species builds, feet on `y = 0`, flat-shaded) because a species added to the engine without a figure would otherwise only fail at run time. `test/local-authority.test.ts` drives the real `LocalAuthority` over the real engine (the authority's rules around the engine: encounters, outcomes, the party cap, facing, the doctor visit, the trip to the tent, games restored from a save), `test/autosave.test.ts` drives the autosave against a `localStorage` stand-in shared by several tabs and a server stand-in running the engine's real write guard, with fake timers, and `test/battle-controller.test.ts` and `test/doctor-controller.test.ts` press keys at the battle screen and the doctor's card against it — the input and pacing rules a screenshot can't pin (held keys, empty answers, mashing, stale events, keys during a beat). All read puzzle answers from the events, never from a hard-coded list. `test/hud.test.ts` pins the message line's timing and hints. `test/css-vars.test.ts` fails when a component reads a CSS custom property that `styles.css` never defines — the browser, `svelte-check` and the build all accept that silently. `test/copy-files.test.ts` and `test/hardcoded-text.test.ts` hold the copy rules in § Copy and languages; they parse the source (Svelte's and TypeScript's parsers, `test/source.ts`) rather than grep it, so a comment that mentions a key or a word never counts.

**Server**: integration tests in `packages/server/test/*.test.ts` drive the real app through `app.request()` against a real `mathgame_test` database — no mocks below the HTTP layer. `test/global-setup.ts` creates the database on the same Postgres if missing, applies the journaled migrations and truncates it, and `vitest.config.ts` injects its URL as `DATABASE_URL`, so a test can never touch `mathgame`. Each test creates its own player, so tests share no rows. Mock the DB only for what cannot be exercised for real (`src/app.test.ts` mocks `pingDb` to see the 503).

**Don't test**: framework glue, things the type system guarantees, a wrapper that only forwards to the engine.

**Redundancy rule**: a test that mocks a dependency and asserts what another test already proves with the real thing is dead weight. Remove it. `/cleanse` prunes these.

**`toEqual` cannot see a key set to `undefined`**: `{ nickname: undefined }` equals `{}` to it. When a missing key is the point — no nickname is no key, as in a save — assert with `toStrictEqual`.

**Pragmatic coverage.** No coverage number. The question is: "if an agent breaks this rule in a future PR, does a test fail before merge?"

## Copy and languages

Every word a player reads comes from `packages/client/src/copy/<code>.yaml` ([[DECISIONS]] § Copy and languages; the moving parts are in [[ARCHITECTURE]] § Copy).

### Adding a line

1. Pick a key: the screen's group, then a camelCase name for what the line is *for*, not what it says (`puzzle.keys`, `battle.wildTired`). Engine ids are used as they are, so code can build the key: `species.fox.name`, `species.fox.attacks.nip`.
2. Add it to `en.yaml` **and** `da.yaml`, in the same place in both. The Danish follows [[DESIGN]] § Voice and copy, Danish, and its glossary.
3. Show it. In markup: `{t('puzzle.keys')}`, with `import { t } from '../copy'`. For something said later — narration, the message line — keep a line, not a string: `battle.line = line('battle.go', { animal })` (`lines.ts`), and draw it with `{words(battle.line)}`, so it re-words when the language changes. Write the key out (`cond ? t('a') : t('b')`, not a variable) so the tests can check it; a key built at run time, like the species ones, needs a test of its own over every id.
4. An animal goes in as `{ animal: animalWords(a) }` to `t()` (or as itself to `line()`), and the message picks its form: `{animal.name}`, `{animal.the}`, `{animal.aWild}`… (`names.ts`, `ANIMAL_FORMS`). An attack goes to `line()` as `{ speciesId, attackIndex }`.
5. `pnpm -F @mathgame/client test`.

A line an authority sends (`message`) is declared in the engine's `LINES` (`packages/engine/src/lines.ts`) with the params it fills and what each holds — numbers and species by id, never text — and needs its key in the copy files too; `copy-files.test.ts` checks both sides.

The rules, all enforced by `copy-files.test.ts`:

- **Placeholders.** `{name}` prints a string or number param as it is. `{animal.a}` picks the `a` form of an object param (`{ name: 'Ræv', a: 'en ræv' }`); a plain string param, such as a nickname, stands for every form. A key reads the same params in every language, and a `t()` or `line()` call passes exactly those.
- **Species.** Every catalog species has all six forms (`name`, `a`, `the`, `wild`, `aWild`, `theWild`) and a name for each attack, in every language. A new species or attack in the engine fails the tests until its words are written.
- **Plurals.** A group of CLDR forms, chosen by the `count` param: `one: '{count} point'` and `other: '{count} points'`. English and Danish use exactly `one` and `other`; each language's forms are checked against `Intl.PluralRules`.
- **Capitals.** A species form that starts a sentence (the start of the line, or after `.`, `!` or `?`) gets a capital first letter, so forms are written the way they read mid-sentence: `et vildt egern`. A plain string — a nickname — is never changed.
- **YAML.** Quote a line that starts with `{` (`'{animal.aWild} dukker op!'`), or YAML reads a map. Every value is text: quote one that is only a number or `true`. A repeated key fails the build. `yes` and `no` are plain words (YAML 1.2).
- **No words in code.** `hardcoded-text.test.ts` fails on words written into a `.svelte` template (text between tags, `title`, `aria-label`, `placeholder`-style attributes, string literals a `{…}` prints) and on a TypeScript literal that reads as a sentence, in a module or a `<script>` block (a letter, a space and a letter, or a word and a closing `.!?…`; `new Error` and `console` messages are for developers and allowed). The engine has the same scan (`no-words.test.ts`), and its catalog sweeps check that no state or event carries words.

A key missing from Danish shows in English and logs one warning in the console, which makes the screenshot script exit non-zero. A key missing from English shows the key itself and fails the tests.

### Adding a language

1. Copy `en.yaml` to `<code>.yaml` beside it (ISO 639-1: `sv`, `de`) and write every value in the new language, keeping every key and `{param}`.
2. Add `'<code>'` to `LANGUAGES` in `packages/client/src/copy/languages.ts`. The order there is the order of the Language setting.
3. `pnpm -F @mathgame/client test` fails until every key and param is there and every plural message has the language's forms (Polish needs `one`, `few`, `many` and `other`).
4. Add the language's voice notes and glossary to [[DESIGN]] § Voice and copy, and look at every screen in it at 1024×768 (`?lang=<code>`, below): longer words overflow first.

### Looking at the game in another language

`?lang=da` (or `?lang=en`) picks the language for that visit without remembering it: `node scripts/screenshot.mjs --url 'http://localhost:5180/?lang=da'`. Without it, the game starts in the language chosen before on this device, else the browser's. With the dev server running, an edited copy file changes the words on screen in place, without a reload.

## Database

Local Postgres runs in Docker (`docker-compose.yml`, host port 5433, database `mathgame`, user/password `postgres`). `pnpm db:psql -c "<sql>"` runs a query; `/reset` recreates it from scratch.

The server test suite uses a second database on the same instance, `mathgame_test`, created and migrated by the tests themselves (see § Testing ideology). `TEST_DATABASE_URL` overrides its URL; the name must end in `_test`.

**Getting a kid's game back.** Every save the server was about to lose is in `save_backups`: one a different game replaced (`reason = 'replaced'`) or one the server could not read (`'unreadable'`). Find the player (the kid's browser holds the id in `localStorage['animath.player']`), look at their rows, and put one back with a `seq` far above the current save's. The browser's own save can be ahead of the server's copy, and at its next start the browser takes the server's game only when its `seq` is higher:

```sql
select id, reason, created_at, data->>'seq' as seq, data->'party' as party
  from save_backups where player_id = '<id>' order by id;
update saves set data = jsonb_set(b.data, '{seq}', to_jsonb((saves.data->>'seq')::int + 1000000)), updated_at = now()
  from save_backups b where b.id = <backup id> and saves.player_id = b.player_id;
```

The browser keeps its own set-aside copies too: `animath.save.unreadable` (a save it could not read) and `animath.save.replaced` (its game, when a bigger one came from the server), each followed by `.2`, `.3`, … when the key was taken, oldest first.
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
TUNNEL=1 pnpm dev              # both dev servers; TUNNEL lets Vite accept the tunnel hostname
ngrok http 5180                # or: cloudflared tunnel --url http://localhost:5180
```

Send the printed URL. The API is reached through Vite's proxy, so one tunnel is enough. Installing and authenticating the tunnel client is a human task ([[HUMAN_TODO]]).

Each kid's game is saved in their own browser, under the link they opened, and backed up to this machine's database when the API is running (`pnpm dev` starts both; with only `pnpm dev:client` the games are still saved, just not backed up). So keep sending the same link. ngrok's free plan gives the account one fixed `….ngrok-free.dev` address, reused on every `ngrok http 5180`; a new address, `localhost`, or another tunnel is a different place, where the kid starts a new game and their old one waits under the old address.

## Deployment

None yet. The plan ([[DECISIONS]] § Deployment): Docker image with the built client + server, Docker Compose with Postgres behind nginx on the existing Hetzner VPS, GitHub Actions build on merge. When that lands, this section grows the operational recipes and CLAUDE.md gains a Phase 5 (post-deploy verification).
