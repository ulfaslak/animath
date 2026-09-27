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

The game saves in the browser without the API; the API only holds the backup ([[ARCHITECTURE]] § Saving). From a worktree, run your own API on a free port against a database of your own on the same Postgres, never `mathgame` (the kids' games) or `mathgame_test` (the server tests empty it), and point your Vite at it. The shell's `DATABASE_URL` and `PORT` win over `.env`'s:

```bash
docker compose -p mathgame exec -T postgres createdb -U postgres mathgame_<yours>
DATABASE_URL=postgres://postgres:postgres@localhost:5433/mathgame_<yours> pnpm db:migrate
DATABASE_URL=postgres://postgres:postgres@localhost:5433/mathgame_<yours> PORT=3021 pnpm dev:server
API_PORT=3021 pnpm -F @mathgame/client exec vite --port 5191 --strictPort
# done: stop both, then
docker compose -p mathgame exec -T postgres dropdb -U postgres mathgame_<yours>
```

A browser's save lives under the page's address: `localhost:5180`, `localhost:5191` and the tunnel link are three separate games, each with its own `localStorage`.

## Looking at the game

`<port>` below is your own client's (§ Running, and `/play`). 5180 is the primary clone's Vite, which serves the kids' tunnel, and the script's default `--url` points at it: from a worktree, always pass `--url`.

```bash
node scripts/screenshot.mjs --url 'http://localhost:<port>/' --out screenshots/title.png   # a fresh browser: the title, no Continue
node scripts/screenshot.mjs --url 'http://localhost:<port>/?new' --keys "ArrowRight*5,ArrowDown*2" --out screenshots/after-walk.png
node scripts/screenshot.mjs --url 'http://localhost:<port>/?new' --width 1024 --height 768   # tablet landscape, keyboard
node scripts/screenshot.mjs --touch --url 'http://localhost:<port>/?new&debug' --width 1024 --height 768 --keys "tap:.dpad .right,touch:.dpad .down:1500,tap:.talk-button"   # a touch tablet: the D-pad, Talk
node scripts/screenshot.mjs --url 'http://localhost:<port>/?zoo' --scale 3 --clip 350,300,420,260   # every animal figure, magnified 3× (same camera)
node scripts/screenshot.mjs --url 'http://localhost:<port>/?zoo=tired' --wait 4000 --scale 3 --clip 350,300,420,260   # every animal lying down to rest
node scripts/screenshot.mjs --url 'http://localhost:<port>/' --reduced-motion   # as a system that asks for less motion
```

Headless Chrome via `playwright-core`. On a Mac, WebGL draws on the GPU (`--gpu metal`, ANGLE over Metal, as Chrome itself draws there) at 15–20 frames a second; `--gpu swiftshader`, the default elsewhere, draws in software at under 3 (see [[ENVIRONMENT_NOTES]] § Looking at the game). The first line printed names the renderer that drew. The script exits non-zero and prints console errors (and warnings) if the page logged any. **Read the image** — a saved file you never looked at verifies nothing. The `/play` command wraps this.

Every run is a fresh browser: a new player with no game, so the page opens on the title with no Continue. `?new` (like `?party=`, `?zoo`, `?tokens=` and `?shop`) skips the title into a throwaway game at the spawn tile with a squirrel, which touches neither storage nor the API, so walks from the start always behave the same. For a game that is saved, go through the title as a kid does: `Enter,wait:3000,Enter,wait:3000,Enter,wait:4000` is New game, the first starter, no name (the starters and the name box take Enter only after a quiet moment of 0.8 s of game time, which a loaded machine stretches, and which every Enter starts again; see [[ENVIRONMENT_NOTES]]). `reload:` keeps the game (the save is in the page's `localStorage`) and comes back to the title, where `Enter` is Continue: that is how to check that something survives a reload.

**The API is blocked.** The script aborts every request to `/api/` in the browser, as if the server were down, and counts the blocked calls in one line at the end; an API response that arrives anyway fails the run. A game started in a fresh browser makes a player on the server, and every Vite proxies `/api` to the primary clone's API, with the kids' games in its database, unless `API_PORT` says otherwise ([[ENVIRONMENT_NOTES]] § This machine is shared). The game plays and saves in the page all the same. `--api` lets the calls through, for a run that tests the backup, against your own API and database (§ Running); there, calls that fail (no API server behind the proxy, a `409`) are listed at the end and do not fail the run. A throwaway Playwright script (the recipes below) is a fresh browser too: block the API the same way before its first `goto`, with `await context.route((u) => /^\/api(\/|$)/.test(u.pathname), (r) => r.abort())`.

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
| `tap:<css>`        | taps the first element a CSS selector finds with a finger (`--touch` only): `tap:.pad .ok`, `tap:.actions .row:nth-child(2)` |
| `touch:<css>:<ms>` | keeps a finger on that element for `<ms>`, then lifts it: `touch:.dpad .left:2000` walks left for two seconds |
| `click:<css>`      | clicks it with the mouse: `click:.pill-button.go`                                        |

Three flags pace a run: `--key-interval <ms>` between key tokens (700), `--tap-ms <ms>` for how long a key token holds its key (100), and `--settle <ms>` before the last frame (1500).

**Touch.** `--touch` opens the page as a touch tablet does (Playwright's `hasTouch` and `isMobile`): the page matches `pointer: coarse` and shows its touch controls from the start, and `tap:` and `touch:` send real touch events (Chrome turns them into `pointerType: 'touch'` pointer events and clicks; the game presses on the pointer events, never the click). A key token in the same run is a real keyboard's key, which puts the touch controls away until the next tap, as it would on a tablet with a keyboard. A selector never holds a comma, the script's separator. Taps wait like keys, for the quiet moment before a new choice takes a pick, and a tap too soon starts the moment again: under load, `wait:` until Go! is lit before tapping it, never tap it again and again. The phone's soft keyboard does not exist here: a name is typed with `type:`, and `size:` to a shorter height stands in for a keyboard that shrinks the window.

**Two fingers at once** need a throwaway Playwright script (`hasTouch`, `isMobile`) that sends CDP's `Input.dispatchTouchEvent` itself, each finger with its own `id`: `touchStart` with every finger that is down (the one landing added to those still down), and `touchEnd` listing the fingers that lift. Not the ones that stay, whatever the protocol's description says: in Chrome 153, `touchEnd` with finger 1 listed lifts finger 1, and a `touchMove` that leaves a finger out lifts nothing. `touchEnd` with no fingers lifts them all.

After every frame the script prints what the screen says: on the title its menu (`title:`, the lit row in brackets), the confirm (`confirm:`), the starters' name tags (`starters:`, the lit one in brackets), the card under them (`starter:`) and its notes; the message line in explore (`hud:`), with `?debug` in the URL the grid position and facing (`at:`) and the last four sound cues the game asked for (`cue:`), and the party cards (`party:`, the lead's in brackets, an open one in braces) with an open card's animals (`open card (n):`, the first eight); the touch controls on screen (`touch:` — the D-pad and the arrow held, Talk and whether it is lit, Menu, the number pad and whether it is dimmed, the turn-sideways screen); in the pause menu its rows (the lit one in brackets), an open card's animals (`card (n):`, the first eight), the picked animal's or card's options (greyed ones in parentheses), the name box with whether it has the focus, and the notes under it; at the doctor the doctor's line and the party (the highlighted row in brackets); in a battle the status boxes, the menu (the highlighted row in brackets; each attack with its level word, greyed rows marked) or the switch list in its place (`switch:`), the narration line, the puzzle, the typed answer, the judgement and the result card — so a run can be checked from its output as well as its images.

`?party=` starts the game with any party (`?party=squirrel:5,rabbit:0,fox`: species, then HP, full by default; `*` and a count for many of a kind, `rabbit*30`, `rabbit:0*5`, up to 1,000 animals in all), for screens that need a big or hurt one. A team of 120 across the eight land kinds: `?party=squirrel*15,rabbit*15,frog*15,fox*15,otter*15,deer*15,wolf*15,bear*15` (the sea animals are `crab`, `starfish`, `turtle`, `dolphin`, `octopus` and `whale`). The party column's hover, clicks and drags need a throwaway Playwright script (`page.mouse`), and a finger's hold-and-drag CDP's `Input.dispatchTouchEvent` (§ Two fingers at once) with a pause of 0.7 s after `touchStart` (the card lifts after 0.5 s held still) and then moves of more than 20 px (a lifted card let go closer to where it was is a tap); to see the column keep scrolling under a card held at its edge, move the finger there and wait before `touchEnd`; `?debug` and `?party=` combine (see [[CHEATSHEET]] § Hidden behaviour).

**Visiting the doctor.** Seven steps right from the start, all on grass, then Down bumps the tent at (5, 7); Enter opens the card, whose list takes a pick only after a quiet moment of 0.8 s (and Talk too waits 0.8 s after the game starts):

```bash
node scripts/screenshot.mjs --url 'http://localhost:<port>/?debug&party=squirrel:5,rabbit:0,fox' --keys "ArrowRight*7,ArrowDown,shot:prompt,Enter,wait:700,shot:card,Enter,wait:500,shot:puzzle,Escape" --out screenshots/doctor.png
```

**The doctor's tabs and the shop.** Left and Right go through Heal, Help home and Shop. A tool goes on sale only once its effect lands (the axe, the pickaxe and the boat all have), so to look at buying, start with tokens (`?tokens=`, a throwaway game), and add `?shop` for a tool not on sale yet ([[CHEATSHEET]] § Hidden behaviour). The script prints the tabs and the tokens (`tabs:`), the tab's list (`patients:`: picks ticked, a kind picked in part with "–", the one who has to stay marked "(stays)"), what the right-hand side says (`side:`, a hand-over's running total among it), the confirm (`confirm:`), a token sum's story (`story:`), and in explore the tokens and tools in the corner (`belongings:`):

```bash
node scripts/screenshot.mjs --url 'http://localhost:<port>/?debug&party=squirrel:5,rabbit:0,fox&tokens=23&shop' --keys "ArrowRight*7,ArrowDown,wait:1200,Enter,wait:1500,ArrowRight,wait:600,shot:home,ArrowRight,wait:600,shot:shop,Enter,wait:600,shot:sum" --out screenshots/shop.png
```

Help home's row for a whole kind is the first row of the tab when the team starts with a kind of several (`?party=fox*40,squirrel`: Right to the tab, then Enter picks all forty); with `?party=fox*40` alone it picks all but the first fox, who stays.

In a throwaway Playwright script, the number pad's keys have no `data-press` (they press as the finger lands): tap them by their text, `page.locator('.pad .key').getByText('7', { exact: true }).tap()`, and OK as `.pad .ok`. The open puzzle's answer, a token sum's too, is `doctor.puzzle.answer` in `/src/state/doctor.svelte.ts`.

**Playing a battle.** The 11th step of Left, Right, Left, … from the start always meets a frog while a starter leads (see [[CHEATSHEET]] § Finding a battle fast; the animal changes whenever the encounter tables or the lead do, and `local-authority.test.ts` pins it). Walk in, look, run away:

```bash
node scripts/screenshot.mjs --url 'http://localhost:<port>/?new' --keys "ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,ArrowLeft,wait:8000,shot:menu,ArrowUp,Enter,wait:4000,shot:result,Enter" --out screenshots/ran.png
```

To attack, press the level key on the highlighted attack (`1`, or `ArrowDown,3` for the second attack at level 3), then `wait:1500,type:<answer>,Enter,wait:9000`. Answering wrong on purpose (a loss) needs no answers. Puzzles are seeded like everything else, so the same keys meet the same puzzles: to learn the right answers, replay the same walk and intents against the client's `LocalAuthority` (`packages/client/src/authority/local.ts`) in a throwaway script run with `packages/server/node_modules/.bin/tsx`, and read each `puzzle-shown` event's `puzzle.answer`. Answers change whenever the puzzle generators do, so never hard-code them in docs or tests.

**A frame in the middle of an animation** (the iris, a lunge, the dust, the confetti, the heal's sparkles) is luck with fixed waits: a screenshot under load takes longer than the whole effect. Two kinds of animation need two tools, in a throwaway Playwright script:

- **What the game animates itself** — the iris, everything in the Three.js scenes, the beats — runs on frame time. Freeze the page's clock: `page.clock.install()` before `goto`, play normally up to the key that starts it, then `page.clock.pauseAt(<the page's Date.now()> + 30)` (retry with a larger margin on "Cannot fast-forward to the past") and step with `page.clock.runFor(16)` — every `requestAnimationFrame` runs, one 16 ms frame at a time — taking a screenshot after the steps you want. A frozen page shows exactly the moment asked for, however slow the machine.
- **CSS animations and transitions** — the heal's sparkles and "+N", the damage "−N", a shake, the sound chip — run on the document's own timeline, which the fake clock does not touch: under load they are over before the screenshot. Slow them down over CDP instead: `const cdp = await page.context().newCDPSession(page); await cdp.send('Animation.enable'); await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.05 })` makes a 0.9 s sparkle last 18 s.

The running page's modules can be read from the script (`await page.evaluate(() => import('/src/state/battle.svelte.ts'))`), which gives the puzzle on screen and its answer without a mirror authority. Only on a dev server that has not hot-updated that module since it started: after an edit or a merge, Vite serves it to the page as `…?t=<time>`, the plain path is a second copy with nothing in it, and the script types `undefined` as the answer. Restart the dev server first.

**Standing anywhere.** To look at a place far from the spawn (a biome, a mountain's peaks), put a save there before the page loads, in a throwaway Playwright script with the API blocked: `context.addInitScript` writes `localStorage['animath.save']` (once, behind a `sessionStorage` flag, so a reload keeps the game's own saves) with `{ version: 1, seed: <WORLD_SEED>, pos, facing, steps, visits: 0, lineage, seq: 1, party }`, and Enter on the title is Continue. In the prototype world: meadow (49, 37), forest (-20, 52), a river bank of reed beds (-6, -10), the mountains (48, -18), their peaks (-101, -119). A save on a tile the player can't stand on (a rock, a tree or a tent, or water without the boat) puts the player on the spawn tile instead.

**Chopping and breaking.** The same save with `items: ['axe', 'pickaxe']` and the player beside a tree or a rock, facing it: (-16, 9) facing `right` has the tree at (-15, 9); (-2, 19) facing `right` a rock; (-29, -24) facing `right` a snow-capped peak. Continue, wait out Talk's quiet moment (the bottom line says "Press Enter to chop the tree"), and Enter. A save that already cleared tiles carries `edits` (`["-1,0:91"]` is that tree). The swing, the fall and the chips take under a second: freeze the clock for frames inside them (below). To buy the tools as a kid does, `?tokens=40&shop`: seven steps right, Down, Enter, Right twice to the shop, Enter on the axe, type 32, Enter; Down to the pickaxe, Enter, type 19, Enter. The screenshot script prints the touch button's label (`talk "Chop" (lit)`).

**Out on the water.** A save with `items: ['boat']` can stand on water: straight up from the spawn tile, (-2, 5) to (-2, 3) are the shallows and (-2, 2) is deep water. A sea battle comes out the way a kid meets one: that save at (-2, 2), `steps: 0`, the party `[otter, …]`, then Left, Right, Left… (a quiet 350 ms between presses) meets a Turtle on the 11th step (the sixth Left), every time (the authority's rolls are keyed by the world seed and the step count). A same-sized sea animal needs weakening before a leash catches it: answering Splash on easy right until the Turtle is under a fifth of its HP, then throwing, caught it on the first or second throw here. Driving a touch screen, tap only: one key press turns the touch controls off (`page.tap('[data-press="row:0"]')` for Continue, `.dpad .arrow.left` to sail). `localStorage['animath.language']` holds the bare code (`da`), not JSON. To buy the boat as a kid does, `?tokens=40` is enough: seven steps right, Down, Enter, then right twice to the Shop, Down twice to the boat (the list starts on the axe) and Enter, and the sum is `40 − 21`. The boat's swing onto the water lasts `BOAT_SWING_SECONDS` of frame time: freeze the page's clock (above) after the trainer stands facing the water, press the arrow, and step 16 ms frames (about 34 of them) to film it.

**Long names.** `?party=` takes no nicknames; a seeded save does. Its `party` holds `{ id, speciesId, hp, nickname }`, so the recipe above with six animals named "WWWWWWWWWWWW" (the widest twelve letters at 242 px), "ÆØÅÆØÅÆØÅÆØÅ" and "MMMMMMMMMMMM", some at 0 HP and one a bear (three-digit HP), puts the widest rows on every screen at once: the title's Continue, the party cards, the pause menu and, from `pos: { x: 5, y: 6 }` facing `down`, the doctor one Enter away. Check each screen at 1024×768 and 1280×720, in both languages, and with `hasTouch`. A name cut short is `scrollWidth > clientWidth` on its element, and a card that scrolls sideways (the pause menu once did while naming) has a `scrollLeft`.

### Hearing the game

Headless Chrome plays sound to no one, and an agent can't listen. Three checks instead:

- **Which cue played, and when.** `?debug` shows the last four cues under the position, and the screenshot script prints them (`cue:`). The controller tests pin the important ones (`sfx.onCue`).
- **What a cue is made of.** `test/sfx.test.ts` checks every cue's data and the nodes `scheduleCue` builds.
- **That it makes a sound.** Render the cues offline in the real browser: with the dev server up, a Playwright page runs `const { CUES, CUE_NAMES } = await import('/src/audio/cues.ts'); const { scheduleCue } = await import('/src/audio/synth.ts')`, renders each into an `OfflineAudioContext` (`scheduleCue(ctx, ctx.destination, CUES[name], 0)`, then `ctx.startRendering()`), and measures the samples: peak, RMS, and where the sound starts and stops. Every cue should be well above silence, under 1.2 s, and below clipping. To hear them, play the same in a normal browser tab's console on the dev server.

## Checks and tests

```bash
pnpm check   # tsc for engine + server, svelte-check for client
pnpm test    # vitest in engine, client and server
pnpm lint    # prettier --check
pnpm format  # prettier --write
```

Per package: `pnpm -F @mathgame/engine test`, `pnpm -F @mathgame/engine test:watch`.

`pnpm build` prints the size of each chunk of the client. When a change reaches for a three.js class the game didn't use before, compare the `three` chunk with main's: a `Shape`, say, brings its triangulator along (about 24 kB for one star).

### Testing ideology

All code is written by agents; the human reviews PRs and plays the game but doesn't run test suites by hand. Tests are the primary regression net and must be high-signal and low-maintenance.

**The engine is the backbone.** It is pure and seeded, so every rule can be tested exhaustively and deterministically. Prefer:

- **Property tests over the whole space** rather than examples: every species in the catalog, every kind at every difficulty, 25 seeds. `battle.test.ts` and `puzzles.test.ts` are the pattern. A balance change that breaks monotonicity anywhere in the catalog must fail a test.
- **Independent re-derivation** for generators: the puzzle test re-solves each prompt with its own tiny solver instead of trusting `answer`. When you add a puzzle kind, extend the solver.
- **Replay tests** for state machines: apply a fixed intent log to a fixed seed and assert the final state, as § replay does in `battle-reducer.test.ts` and `doctor.test.ts`.
- **Boundary tests** that pin the architecture: `purity.test.ts` fails if the engine grows an import. Keep it.

**Keep every test well under vitest's 5 s default timeout**, including when other worktrees load the machine. A sweep costs the product of its dimensions, so when a new dimension joins an existing one (every lead, every species), time the file again. In a hot loop, collect failures into an array and assert once (`expect(bad).toEqual([])`): an `expect` per item costs more than the rule it checks. Cap that array in a sweep of thousands of cells (the first 20 and a count of the rest, `findings()` in `encounters.test.ts`): a broken rule fails every cell, and printing all of them can outlast the timeout, so the run reports a timeout instead of the rule. A sampling test can skip the draws it does not measure; `encounters.test.ts` samples species picks with an `Rng` whose every chance comes up. Two browsers drawing beside a run (load average around 30) make a test 2–4 times slower. So a test that still takes about a second alone, after those savings, gets an explicit timeout of 30 s (60 s for the catalog's battle sweep). A comment above the timeout gives the reason: its measured cost alone and under load, and what it does that many times. Measure with `pnpm -F @mathgame/engine exec vitest run --reporter=json --outputFile=<file>` and read each test's `duration`. Never cut a sweep's count to fit the default without saying so.

**Simulate balance, don't guess it.** When a change touches damage, HP, catch rates or difficulty, write (or run) a small simulation in `packages/engine/test/` or a scratch script: N battles between species pairs, win rates, average turns, catch attempts to success. Paste the table in the PR. A number in [[PRODUCT]] §4 that was never simulated is a guess.

**Client**: no unit tests for rendering. Verification is a screenshot you read (see above), at the default viewport and at 1024×768. Pure client helpers (input mapping, tweens) may get vitest tests if they grow logic; Svelte components don't. What a screenshot can't show gets a test instead, and [[ARCHITECTURE]] § `packages/client` lists each test file with what it pins: the figure contract (a species added to the engine without a figure would otherwise only fail at run time), what the renderer keeps on the GPU (a leak no screenshot shows), the authority's rules around the engine, the autosave against a shared `localStorage` stand-in and a server stand-in running the engine's real write guard, and every screen's input and pacing rules (held keys, empty answers, mashing, stale events, keys during a beat), pressed as keys against the real authority. All read puzzle answers from the events, never from a hard-coded list. A mash is never pressed like a metronome: `test/mash.ts` gives every mash test the same kid's mashes, at 2, 4 and 8 presses a second, each gap uneven by up to 30% (from a fixed seed) or every fourth press a little late, because an even mash is what a wrong guard passes (#37). Some rules only a test can see, because the browser, `svelte-check` and the build all accept breaking them silently: a CSS custom property nothing defines (`css-vars.test.ts`), and the copy rules of § Copy and languages (`copy-files.test.ts`, `hardcoded-text.test.ts`). Tests that read the source parse it (Svelte's and TypeScript's parsers, `test/source.ts`) rather than grep it, so a comment that mentions a key or a word never counts.

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
- **Danish commas.** No comma before "og" or "eller" unless a sentence with its own subject follows ([[DESIGN]] § Voice and copy, Danish): "Hold på et kort og træk det", but "Jeg gør dem helt raske, og du får mønter som tak!". The test knows a subject by its pronoun (`du`, `den`, `der`…) or by a placeholder (`{animal.the}`); a sentence whose subject is a plain noun ("…, og ræven hopper") needs its word added to the test's list.
- **No words in code.** `hardcoded-text.test.ts` fails on words written into a `.svelte` template (text between tags, `title`, `aria-label`, `placeholder`-style attributes, string literals a `{…}` prints) and on a TypeScript literal that reads as a sentence, in a module or a `<script>` block (a letter, a space and a letter, or a word and a closing `.!?…`; `new Error` and `console` messages are for developers and allowed). The engine has the same scan (`no-words.test.ts`), and its catalog sweeps check that no state or event carries words.

A key missing from any file fails `copy-files.test.ts`; what a gap does on screen is in [[ARCHITECTURE]] § Copy.

### Adding a language

1. Copy `en.yaml` to `<code>.yaml` beside it (ISO 639-1: `sv`, `de`) and write every value in the new language, keeping every key and `{param}`.
2. Add `'<code>'` to `LANGUAGES` in `packages/client/src/copy/languages.ts`. The order there is the order of the Language setting.
3. `pnpm -F @mathgame/client test` fails until every key and param is there and every plural message has the language's forms (Polish needs `one`, `few`, `many` and `other`).
4. Add the language's voice notes and glossary to [[DESIGN]] § Voice and copy, and look at every screen in it at 1024×768 (`?lang=<code>`, below): longer words overflow first.

### Looking at the game in another language

`?lang=da` (or `?lang=en`) picks the language for that visit without remembering it: `node scripts/screenshot.mjs --url 'http://localhost:<port>/?lang=da'`. Without it, the game starts in the language chosen before on this device (the title's Language row), else the browser's. With the dev server running, an edited copy file changes the words on screen in place, without a reload.

## Database

Local Postgres runs in Docker (`docker-compose.yml`, host port 5433, database `mathgame`, user/password `postgres`). `pnpm db:psql -c "<sql>"` runs a query from the primary clone; from a worktree it looks for the wrong container, so use `docker compose -p mathgame exec -T postgres psql -U postgres -d mathgame -c "<sql>"` ([[ENVIRONMENT_NOTES]] § No `psql` on the PATH). `/reset` recreates the database from scratch with `docker compose down -v`, which deletes every save the server holds, the kids' backups included: only the human runs it.

The server test suite uses a second database on the same instance, `mathgame_test`, created and migrated by the tests themselves (see § Testing ideology). `TEST_DATABASE_URL` overrides its URL; the name must end in `_test`.

**Getting a kid's game back.** Every save the server was about to lose is in `save_backups`: one a different game replaced (`reason = 'replaced'`) or one the server could not read (`'unreadable'`). Find the player (the kid's browser holds the id in `localStorage['animath.player']`), look at their rows, and put one back with a `seq` far above the current save's. The browser's own save can be ahead of the server's copy, and at its next start the browser takes the server's game only when its `seq` is higher:

```sql
select id, reason, created_at, data->>'seq' as seq, data->'party' as party
  from save_backups where player_id = '<id>' order by id;
update saves set data = jsonb_set(b.data, '{seq}', to_jsonb((saves.data->>'seq')::int + 1000000)), updated_at = now()
  from save_backups b where b.id = <backup id> and saves.player_id = b.player_id;
```

The browser keeps its own set-aside copies too: `animath.save.unreadable` (a save it could not read), `animath.save.replaced` (its game, when a bigger one came from the server or another tab wrote over it in the same instant) and `animath.save.previous` (a game the kid left for New game on the title), each followed by `.2`, `.3`, … when the key was taken, oldest first. To give a kid back a game they left, in their browser's developer tools copy that text into `animath.save` with its `seq` raised above the current save's (and above the server's, or the server's newer game wins at the next start), then reload: the title offers it as Continue.
### Migrations

Hand-written SQL, applied by `pnpm db:migrate` (`drizzle-orm`'s migrator, journal-driven).

1. Edit `packages/server/src/db/schema.ts`.
2. Add `packages/server/drizzle/NNNN_<name>.sql` with the next number. Use `IF NOT EXISTS` / `IF EXISTS` so it is idempotent.
3. Append an entry to `packages/server/drizzle/meta/_journal.json`: `idx` +1, `tag` = filename without `.sql`, `version: "7"`, a larger `when`, `breakpoints: true`. **A `.sql` without a journal entry is never applied.**
4. Run `pnpm db:migrate`, then confirm with `pnpm db:psql -c "\d <table>"` (from a worktree, the `-p mathgame` form in § Database).

Never run `drizzle-kit generate` in a worktree (it emits a full `0000` dump that collides with the real one).

## Sharing the game through a tunnel

Until there is a deploy, the game is shared from this machine:

```bash
TUNNEL=1 pnpm dev              # both dev servers; TUNNEL lets Vite accept the tunnel hostname
ngrok http 5180                # or: cloudflared tunnel --url http://localhost:5180
```

Send the printed URL. The API is reached through Vite's proxy, so one tunnel is enough. ngrok is installed and signed in on this machine.

Each kid's game is saved in their own browser, under the link they opened, and backed up to this machine's database when the API is running (`pnpm dev` starts both; with only `pnpm dev:client` the games are still saved, just not backed up). So keep sending the same link. ngrok's free plan gives the account one fixed `….ngrok-free.dev` address, reused on every `ngrok http 5180`; a new address, `localhost`, or another tunnel is a different place, where the kid starts a new game and their old one waits under the old address.

## Deployment

None yet. The plan ([[DECISIONS]] § Deployment): Docker image with the built client + server, Docker Compose with Postgres behind nginx on a dedicated Hetzner VPS, GitHub Actions build on merge. When that lands, this section grows the operational recipes and CLAUDE.md's Phase 5 gains its post-deploy checks.
