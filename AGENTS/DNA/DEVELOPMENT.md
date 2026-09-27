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
pnpm dev:client       # Vite on http://localhost:5180 (proxies /api → 3000, the /api/ws socket too)
pnpm dev:server       # Hono on http://localhost:3000 (tsx watch)
```

Health check: `curl localhost:3000/api/health` → `{"ok":true,"db":true}`.

Production shape: `pnpm build` then `pnpm -F @mathgame/server start` serves the built client from `packages/client/dist` and the API from one process, the server bundle under plain `node` as in the image (set `PORT` and `DATABASE_URL` to your own, below). The whole production stack, nginx included, runs on a Mac too (§ Deployment).

The game saves in the browser without the API; the API only holds the backup ([[ARCHITECTURE]] § Saving). From a worktree, run your own API on a free port against a database of your own on the same Postgres, never `mathgame` (the kids' games) or a database whose name ends in `_test` (the server tests empty theirs on every run, § Database), and point your Vite at it. The shell's `DATABASE_URL` and `PORT` win over `.env`'s:

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
node scripts/screenshot.mjs --touch --safe-area 0,0,20,0 --url 'http://localhost:<port>/?new' --width 1024 --height 768   # an iPad's home indicator
```

Headless Chrome via `playwright-core`. On a Mac, WebGL draws on the GPU (`--gpu metal`, ANGLE over Metal, as Chrome itself draws there) at 15–20 frames a second; `--gpu swiftshader`, the default elsewhere, draws in software at under 3 (see [[ENVIRONMENT_NOTES]] § Looking at the game). The first line printed names the renderer that drew. The script exits non-zero and prints console errors (and warnings) if the page logged any. **Read the image** — a saved file you never looked at verifies nothing. The `/play` command wraps this.

Every run is a fresh browser: a new player with no game, so the page opens on the title with no Continue. `?new` (like `?party=`, `?zoo`, `?tokens=` and `?shop`) skips the title into a throwaway game at the spawn tile with a squirrel, which touches neither storage nor the API, so walks from the start always behave the same. For a game that is saved, go through the title as a kid does: `Enter,type:Tester,wait:3000,Enter,wait:3000,Enter,wait:3000,Enter,wait:4000` is New game, the player's name, the first starter, no name for it (the name boxes and the starters take Enter only after a quiet moment of 0.8 s of game time, which a loaded machine stretches, and which every Enter starts again; see [[ENVIRONMENT_NOTES]]). `reload:` keeps the game (the save is in the page's `localStorage`) and comes back to the title, where `Enter` is Continue: that is how to check that something survives a reload. Such a game starts in a random home world, so its start differs from run to run: for the same walk every time, use `?new` (World 1) or a seeded save (§ Standing anywhere).

**The API is blocked.** The script aborts every request to `/api/` in the browser, as if the server were down (and the presence socket at `/api/ws` opens onto nothing, so a run sees nobody and is seen by nobody), and counts the blocked calls in one line at the end; an API response that arrives anyway fails the run. A game started in a fresh browser makes a player on the server, and every Vite proxies `/api` to the primary clone's API, with the kids' games in its database, unless `API_PORT` says otherwise ([[ENVIRONMENT_NOTES]] § This machine is shared). The game plays and saves in the page all the same. `--api` lets the calls through, for a run that tests the backup, against your own API and database (§ Running); there, calls that fail (no API server behind the proxy, a `409`) are listed at the end and do not fail the run. A throwaway Playwright script (the recipes below) is a fresh browser too: block the API the same way before its first `goto`, with `await context.route((u) => /^\/api(\/|$)/.test(u.pathname), (r) => r.abort())`.

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
| `tap:<css>`        | taps the first element a CSS selector finds with a finger (`--touch` only): `tap:.pad .ok`, `tap:[data-press="row:1"]` (the battle menu's second attack) |
| `touch:<css>:<ms>` | keeps a finger on that element for `<ms>`, then lifts it: `touch:.dpad .left:2000` walks left for two seconds |
| `click:<css>`      | clicks it with the mouse: `click:.pill-button.go`                                        |

Three flags pace a run: `--key-interval <ms>` between key tokens (700), `--tap-ms <ms>` for how long a key token holds its key (100), and `--settle <ms>` before the last frame (1500).

**Touch.** `--touch` opens the page as a touch tablet does (Playwright's `hasTouch` and `isMobile`): the page matches `pointer: coarse` and shows its touch controls from the start, and `tap:` and `touch:` send real touch events (Chrome turns them into `pointerType: 'touch'` pointer events and clicks; the game presses on the pointer events, never the click). A key token in the same run is a real keyboard's key, which puts the touch controls away until the next tap, as it would on a tablet with a keyboard. A selector never holds a comma, the script's separator. Taps wait like keys, for the quiet moment before a new choice takes a pick, and a tap too soon starts the moment again: under load, `wait:` until Go! is lit before tapping it, never tap it again and again. The phone's soft keyboard does not exist here: a name is typed with `type:`, and `size:` to a shorter height stands in for a keyboard that shrinks the window.

**Two fingers at once** need a throwaway Playwright script (`hasTouch`, `isMobile`) that sends CDP's `Input.dispatchTouchEvent` itself, each finger with its own `id`: `touchStart` with every finger that is down (the one landing added to those still down), and `touchEnd` listing the fingers that lift. Not the ones that stay, whatever the protocol's description says: in Chrome 153, `touchEnd` with finger 1 listed lifts finger 1, and a `touchMove` that leaves a finger out lifts nothing. `touchEnd` with no fingers lifts them all.

**The safe area.** `--safe-area top,right,bottom,left` gives the page the insets a notch, rounded corners or a home indicator take, in CSS pixels, through Chrome's `Emulation.setSafeAreaInsetsOverride`, and tints the strips outside the safe area red in every frame, so anything under them shows. An iPad in Safari is `0,0,20,0`; an iPhone held sideways about `0,59,21,59` (`--width 844 --height 390`). Chrome reports them whether or not the page asks for `viewport-fit=cover`, which Safari needs before a page reaches under a notch at all ([[ENVIRONMENT_NOTES]] § Looking at the game).

**Without WebGL or JavaScript.** A throwaway Playwright script shows the two cards the game gives instead of itself: Chrome launched with `args: ['--disable-3d-apis']` has no WebGL (the `NoWebGL` card, in the language `?lang=` asks for), and a context with `javaScriptEnabled: false` runs no script (the `<noscript>` card).

After every frame the script prints what the screen says: on the title its menu (`title:`, the lit row in brackets), the confirm (`confirm:`), the player's name box (`player:`, what is typed in brackets, then the rule or why a name did not go), the starters' name tags (`starters:`, the lit one in brackets), the card under them (`starter:`) and its notes; the message line in explore (`hud:`), the coordinates in its corner as a kid reads them (`coords:`, `x 7 · y 0` beside World 1's tent: from the world's spawn, `y` up the screen), with `?debug` in the URL the engine's grid position and facing (`at:`, `5, 6 · down` on the same tile: `y` down the screen) and the last four sound cues the game asked for (`cue:`), and the party cards (`party:`, the lead's in brackets, an open one in braces) with an open card's animals (`open card (n):`, the first eight); the touch controls on screen (`touch:` — the D-pad and the arrow held, Talk and whether it is lit, Menu, the number pad and whether it is dimmed, the turn-sideways screen); in the pause menu its rows (the lit one in brackets), an open card's animals (`card (n):`, the first eight), the picked animal's or card's options (greyed ones in parentheses), the name box with whether it has the focus, and the notes under it; at the doctor the doctor's line and the party (the highlighted row in brackets); in a battle the status boxes, the menu (the highlighted row in brackets; each attack with its level word, greyed rows marked) or the switch list in its place (`switch:`), the narration line, the puzzle, the typed answer, the judgement and the result card — so a run can be checked from its output as well as its images.

`?party=` starts the game with any party (`?party=squirrel:5,rabbit:0,fox`: species, then HP, full by default; `*` and a count for many of a kind, `rabbit*30`, `rabbit:0*5`, up to 1,000 animals in all), for screens that need a big or hurt one. A team of 120 across the eight land kinds: `?party=squirrel*15,rabbit*15,frog*15,fox*15,otter*15,deer*15,wolf*15,bear*15` (the sea animals are `crab`, `starfish`, `turtle`, `dolphin`, `octopus` and `whale`). The party column's hover, clicks and drags need a throwaway Playwright script (`page.mouse`), and a finger's hold-and-drag CDP's `Input.dispatchTouchEvent` (§ Two fingers at once) with a pause of 0.7 s after `touchStart` (the card lifts after 0.5 s held still) and then moves of more than 20 px (a lifted card let go closer to where it was is a tap); to see the column keep scrolling under a card held at its edge, move the finger there and wait before `touchEnd`; `?debug` and `?party=` combine (see [[CHEATSHEET]] § Hidden behaviour).

**Visiting the doctor.** Seven steps right from the start, all on grass, then Down bumps the tent at (5, 7); Enter opens the card, whose list takes a pick only after a quiet moment of 0.8 s (and Talk too waits 0.8 s after the game starts):

```bash
node scripts/screenshot.mjs --url 'http://localhost:<port>/?debug&party=squirrel:5,rabbit:0,fox' --keys "ArrowRight*7,ArrowDown,shot:prompt,Enter,wait:700,shot:card,Enter,wait:500,shot:puzzle,Escape" --out screenshots/doctor.png
```

**The doctor's tabs and the shop.** Left and Right go through Heal, Help home and Shop. A tool goes on sale only once its effect lands (the axe, the pickaxe and the boat all have), so to look at buying, start with tokens (`?tokens=`, a throwaway game), and add `?shop` for a tool not on sale yet ([[CHEATSHEET]] § Hidden behaviour). The script prints the tabs and the tokens (`tabs:`), the tab's list (`patients:`: picks ticked, a kind picked in part with "–", the one who has to stay marked "(stays)"), what the right-hand side says (`side:`, a hand-over's running total among it), the confirm (`confirm:`), a token sum's story (`story:`), and in explore the tokens, the puzzles solved, the tools and the world in the corner (`belongings:`):

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
- **CSS animations and transitions** — the heal's sparkles and "+N", a hit's burst ("−N"), a shake, the sound chip — run on the document's own timeline, which the fake clock does not touch: under load they are over before the screenshot. Slow them down over CDP instead: `const cdp = await page.context().newCDPSession(page); await cdp.send('Animation.enable'); await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.05 })` makes a 0.9 s sparkle last 18 s.

The running page's modules can be read from the script (`await page.evaluate(() => import('/src/state/battle.svelte.ts'))`), which gives the puzzle on screen and its answer without a mirror authority. Only on a dev server that has not hot-updated that module since it started: after an edit or a merge, Vite serves it to the page as `…?t=<time>`, the plain path is a second copy with nothing in it, and the script types `undefined` as the answer. Restart the dev server first.

**Standing anywhere.** To look at a place far from the spawn (a biome, a mountain's peaks), put a save there before the page loads, in a throwaway Playwright script with the API blocked: `context.addInitScript` writes `localStorage['animath.save']` (once, behind a `sessionStorage` flag, so a reload keeps the game's own saves) with `{ version: 2, home: 1, world: 1, name: 'Tester', pos, facing, steps, visits: 0, lineage, seq: 1, party }`, and Enter on the title is Continue (without a `name`, Continue asks for one first; a v1 document, `{ version: 1, seed: <WORLD_SEED>, … }`, still loads, into World 1, and asks too). In World 1: meadow (49, 37), forest (-20, 52), a river bank of reed beds (-6, -10), the mountains (48, -18), their peaks (-101, -119). A save on a tile the player can't stand on (a rock, a tree or a tent, or water without the boat) puts the player on the spawn tile instead.

**Chopping and breaking.** The same save with `items: ['axe', 'pickaxe']` and the player beside a tree or a rock, facing it: (-16, 9) facing `right` has the tree at (-15, 9); (-2, 19) facing `right` a rock; (-29, -24) facing `right` a snow-capped peak. Continue, wait out Talk's quiet moment (the bottom line says "Press Enter to chop the tree"), and Enter. A save that already cleared tiles carries `edits` (`["-1,0:91"]` is that tree). The swing, the fall and the chips take under a second: freeze the clock for frames inside them (below). To buy the tools as a kid does, `?tokens=40&shop`: seven steps right, Down, Enter, Right twice to the shop, Enter on the axe, type 32, Enter; Down to the pickaxe, Enter, type 19, Enter. The screenshot script prints the touch button's label (`talk "Chop" (lit)`).

**Out on the water.** A save with `items: ['boat']` can stand on water: straight up from the spawn tile, (-2, 5) to (-2, 3) are the shallows and (-2, 2) is deep water. A sea battle comes out the way a kid meets one: that save at (-2, 2), `steps: 0`, the party `[otter, …]`, then Left, Right, Left… (a quiet 350 ms between presses) meets a Turtle on the 11th step (the sixth Left), every time (the authority's rolls are keyed by the world seed and the step count). A same-sized sea animal needs weakening before a leash catches it: answering Splash on easy right until the Turtle is under a fifth of its HP, then throwing, caught it on the first or second throw here. Driving a touch screen, tap only: one key press turns the touch controls off (`page.tap('[data-press="row:0"]')` for Continue, `.dpad .arrow.left` to sail). `localStorage['animath.language']` holds the bare code (`da`), not JSON. To buy the boat as a kid does, `?tokens=40` is enough: seven steps right, Down, Enter, then right twice to the Shop, Down twice to the boat (the list starts on the axe) and Enter, and the sum is `40 − 21`. The boat's swing onto the water lasts `BOAT_SWING_SECONDS` of frame time: freeze the page's clock (above) after the trainer stands facing the water, press the arrow, and step 16 ms frames (about 34 of them) to film it.

**Long names.** `?party=` takes no nicknames; a seeded save does. Its `party` holds `{ id, speciesId, hp, nickname }`, so the recipe above with six animals named "WWWWWWWWWWWW" (the widest twelve letters at 242 px), "ÆØÅÆØÅÆØÅÆØÅ" and "MMMMMMMMMMMM", some at 0 HP and one a bear (three-digit HP), puts the widest rows on every screen at once: the title's Continue, the party cards, the pause menu and, from `pos: { x: 5, y: 6 }` facing `down`, the doctor one Enter away. Check each screen at 1024×768 and 1280×720, in both languages, and with `hasTouch`. A name cut short is `scrollWidth > clientWidth` on its element, and a card that scrolls sideways (the pause menu once did while naming) has a `scrollLeft`.

### Several players at once

`pnpm players` (`scripts/players.mts`, run by the server package's `tsx`) drives several players against one running game and its server: one headless Chrome, a browser context per player (its own storage, so its own guest and its own game), all driven by one script and screenshotted player by player. It is how to look at anything players share: seeing each other, Who's here and Go to, friendly matches. The presence socket goes through to the server; the HTTP API is blocked unless `--api`. Point `--url` at your own Vite, whose `API_PORT` is your own server (§ Running): the socket reaches whatever `/api` is proxied to, and the script refuses 5180. The production shape works too: `pnpm build`, then your server on a free port serves the built client and the socket, and `--url` is that port.

```bash
pnpm players --url http://localhost:<port>/ \
  --player "ada:name=Ada" --player "bo:name=Bo,at=150:-40" \
  --steps "all:wait:3500,ada:shot:arrow,bo:Escape,bo:ArrowDown*2,bo:Enter,bo:shot:list,bo:Enter,all:wait:1500,all:shot:together" \
  --out screenshots/two/goto.png     # Bo, far away, goes to Ada from Who's here
```

Each player's game is a save put in their browser before the page opens (kept after a `reload:`), then Continue is pressed (tapped, for a touch player). `--player label:options`, options comma-separated: `name=` (a game without a name is seen by nobody), `world=` (1 by default), `at=x:y` (the world's spawn by default; a tile nobody could stand on starts at the spawn, as a loaded save does), `facing=`, `party=` (as `?party=` writes it, joined with `+`: `party=otter+rabbit:5*2`), `steps=` (steps walked so far: from the start tile, `steps=10` and one step Left meets a wild animal on the reed), `boat`, `touch`, `calm` (reduced motion), `lang=`, `size=1024x768`, `title` (stay on the title).

`--steps` is a comma-separated script of `who:token`, `who` a player's label or `all`. The tokens are the screenshot script's keys (`ArrowRight*3`, `Enter`) and `wait:`, `shot:`, `type:`, `hold:`, `click:`, `tap:`, `reload:`, `size:`, plus: `burst:<name>:<n>` (n frames as fast as they come, for a poof), `press:<key>` (no pause after it), `close:` and `open:` (the player leaves, or comes back), `twin:<label>` (a second window of this player, same browser, which later steps call by its label: one player, two windows), `hide:` and `show:` (the tab hidden and shown, as the page sees it), `until:<css>` (wait for an element), `run:<command>` (a shell command: `all:run:touch packages/server/src/index.ts` restarts a `tsx watch` server mid-play), `solve:right` or `solve:wrong` (answer the puzzle on that player's screen, its prompt read off the page and worked out by the script's own solver, since the server never sends an answer) and `turn:<level>` (whatever that player's friendly match asks of them now: on the menu, attack at that level once Go! is lit; on the puzzle, solve it, `turn:1w` wrongly; on the list after a knock-out, send in the highlighted one; on the other's turn, nothing). After every shot it prints what that player's screen says: `at:` (with `?debug`, which it adds), `others:` (the names over the players on screen and what they are busy with), `thoughts:` (the thought bubbles over players in a battle, their sum or `…`, with ✓ or ✗ while an answer's pop or wobble plays), `bars:` (the animals in the battles on screen, and how full their HP bars are), `pops:` (the damage floating up), `arrows:`, `note:`, `message:`, `pause:` and `side:` (the pause menu and its list), `battle:`, and a friendly match's `challenge:`, `invite:`, `notes:`, `puzzle:` and `result:`.

A friendly match played to its end, Ada asking Bo beside her:

```bash
STEPS="all:wait:4000,ada:c,all:wait:1500,bo:wait:1200,bo:Enter,all:wait:4000"
for i in $(seq 30); do STEPS="$STEPS,all:turn:3,all:wait:2000"; done
pnpm players --url http://localhost:<port>/ --player "ada:name=Ada,at=-2:6" \
  --player "bo:name=Bo,at=-1:6,facing=left,party=frog" --steps "$STEPS,all:shot:end" --out screenshots/m/end
``` Each player's console errors fail the run; a socket the server did not take (it was restarting) is counted, not failed.

**A deploy's hop, without Docker.** Production swaps the app behind nginx: the new copy takes new connections, then the old gets SIGTERM and sends its presence sockets on ([[ARCHITECTURE]] § Presence › Deploys). To watch it, stand a TCP switch in for nginx on your `API_PORT`, sending each new connection to the port a file names, and run the API twice behind it (`PORT=<a>` and `PORT=<b>`, `tsx src/index.ts` without `watch`, your own `DATABASE_URL`):

```js
// switch.mjs: node switch.mjs; `target` holds the port new connections go to
import net from 'node:net';
import { readFileSync } from 'node:fs';
net.createServer((c) => {
	const up = net.connect(Number(readFileSync(new URL('./target', import.meta.url), 'utf8')), '127.0.0.1');
	c.pipe(up).pipe(c);
	for (const s of [c, up]) s.on('error', () => (c.destroy(), up.destroy()));
}).listen(Number(process.env.API_PORT));
```

A `run:` step does the swap: start the new copy and wait for its `/api/health`, write its port to `target`, `kill -TERM` the old one's listening process. The old copy logs `presence: stopping, N sockets told to come back`; the players' `others:` and `note:` lines should not change.

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

- **Property tests over the whole space** rather than examples: every species in the catalog, every kind at every difficulty, 25 seeds. `battle.test.ts` and `puzzles.test.ts` are the pattern. A balance change that breaks monotonicity anywhere in the catalog must fail a test. A sweep over pairs or trios of species grows with the square or the cube of the catalog (32 species since #89, 49 to come), so it says how many it takes and why, and a cut never drops what a rule depends on; a check that a cut kept its coverage counts that (each species against others), never what every sample holds anyway (a species against itself). The catalog sweep in `battle-reducer.test.ts` plays every pair that can meet, with fewer seeds a pair as the catalog grows (about 60 battles per species, at least 3 a pair) and its own player's draws for each pair; § switching there switches every newcomer in against every wild animal it can meet, since who leaves never changes the reply; the leash's reduced-motion throws in the client's `battle-scene.test.ts` take a third of the species at each screen size, in turn, so that each is thrown at two or three sizes. The balance bands and the two "never hurts" checks keep every pair and the seeds they were set on.
- **Independent re-derivation** for generators: the puzzle test re-solves each prompt with its own tiny solver instead of trusting `answer`. When you add a puzzle kind, extend the solver.
- **Replay tests** for state machines: apply a fixed intent log to a fixed seed and assert the final state, as § replay does in `battle-reducer.test.ts` and `doctor.test.ts`.
- **Boundary tests** that pin the architecture: `purity.test.ts` fails if the engine grows an import. Keep it.

**Keep every test well under vitest's 5 s default timeout**, including when other worktrees load the machine. A sweep costs the product of its dimensions, so when a new dimension joins an existing one (every lead, every species), time the file again. In a hot loop, collect failures into an array and assert once (`expect(bad).toEqual([])`): an `expect` per item costs more than the rule it checks (seven tenths of a save sweep's time, #86). Cap that array in a sweep of thousands of cells (the first 20 and a count of the rest, `findings()` in `encounters.test.ts`): a broken rule fails every cell, and printing all of them can outlast the timeout, so the run reports a timeout instead of the rule. A sampling test can skip the draws it does not measure; `encounters.test.ts` samples species picks with an `Rng` whose every chance comes up. Build what a test only stands on the cheap way when it gives the same thing: an overlay of thousands of chunks read from its text, not grown one `with` at a time (each copies the overlay), and a search helper's answer kept, not worked out again for every question (`tilesOfKind` in `edits.test.ts`). Other agents' builds and browsers beside a run (load averages of 40 to 65 on this Mac's 12 threads) made tests 6 to 13 times slower than alone (#86). So a test that still takes a quarter of a second or more alone, after those savings, gets an explicit timeout of at least twice its slowest run under load: 30 s for most, 60 s for sweeps of one to two seconds alone, 120 s for the catalog's battle sweep (the frog's took 40 s at a load of 54). A comment above the timeout gives the reason: its measured cost alone and under load, and what it does that many times. Measure alone with `pnpm -F @mathgame/engine exec vitest run --no-file-parallelism --reporter=json --outputFile=<file>` (the client likewise), which runs one file at a time, and read each test's `duration`; `uptime` says how loaded the machine was. Never cut a sweep's count to fit the default without saying so. A test that bounds a duration (`match.test.ts`, `edits.test.ts`) keeps the fastest of up to three tries: at a load of 40 one try in a few lost a few hundred milliseconds to the machine.

**The code's own waits run on the fake clock.** The fastest of three tries is for work the CPU does. A rule about how long the code waits (a timeout, a deadline, a heartbeat) is tested on vitest's fake timers, stepped to either side of the edge: still waiting at 119 ms, given up at 120 (`account-api.test.ts`). Against a real server or database, fake only the timers the rule is about (`toFake: ['setInterval', 'clearInterval']` for the presence heartbeat, `['setTimeout', 'clearTimeout']` for the hello's wait and pg's read timeout) and let the sockets run. A bound on the real clock measures the machine as well: at a load of 60 a 120 ms wait took 197 ms, and the run failed with no bug behind it (#108). In the same way, a test that waits for a message, or for proof that none is coming, waits on a barrier and never on a stretch of the real clock: a ping of its own answered on the same socket, whose frames keep their order both ways (`roundTrip` in `presence-socket.test.ts`), or the end of a closing handshake.

**A test worker reads vitest's replies between tests.** vitest runs a file's synchronous tests back to back in one turn of its worker's event loop. The worker gives the reply to each progress report it sends 60 s, counted from the send, and reads a reply only when its loop turns. So a file of sweeps adding up to a minute (`battle-reducer.test.ts` held its worker for 59.6 s at a load of 28) failed the run with `Timeout calling "onTaskUpdate"`, every test passed (#86). No vitest option sets that limit, and the `forks` pool, vitest's default, has it as threads do. `test/setup.ts` in the engine and the client turns the loop twice before each test, so no file holds its worker longer than its slowest test; `setup.test.ts` pins it. The server's tests wait on the database, so its workers turn anyway.

**Simulate balance, don't guess it.** When a change touches damage, HP, catch rates or difficulty, write (or run) a small simulation in `packages/engine/test/` or a scratch script: N battles between species pairs, win rates, average turns, catch attempts to success. Paste the table in the PR. A number in [[PRODUCT]] §4 that was never simulated is a guess.

**Client**: no unit tests for rendering. Verification is a screenshot you read (see above), at the default viewport and at 1024×768. Pure client helpers (input mapping, tweens) may get vitest tests if they grow logic; Svelte components don't. What a screenshot can't show gets a test instead, and [[ARCHITECTURE]] § `packages/client` lists each test file with what it pins: the figure contract (a species added to the engine without a figure would otherwise only fail at run time), what the renderer keeps on the GPU (a leak no screenshot shows), the authority's rules around the engine, the autosave against a shared `localStorage` stand-in and a server stand-in running the engine's real write guard, and every screen's input and pacing rules (held keys, empty answers, mashing, stale events, keys during a beat), pressed as keys against the real authority. All read puzzle answers from the events, never from a hard-coded list. A mash is never pressed like a metronome: `test/mash.ts` gives every mash test the same kid's mashes, at 2, 4 and 8 presses a second, each gap uneven by up to 30% (from a fixed seed) or every fourth press a little late, because an even mash is what a wrong guard passes (#37). Some rules only a test can see, because the browser, `svelte-check` and the build all accept breaking them silently: a CSS custom property nothing defines (`css-vars.test.ts`), and the copy rules of § Copy and languages (`copy-files.test.ts`, `hardcoded-text.test.ts`). Tests that read the source parse it (Svelte's and TypeScript's parsers, `test/source.ts`) rather than grep it, so a comment that mentions a key or a word never counts.

**Server**: integration tests in `packages/server/test/*.test.ts` drive the real app through `app.request()` against a real database, the checkout's own test database (§ Database) — no mocks below the HTTP layer. `test/global-setup.ts` creates it on the same Postgres if missing, applies the journaled migrations with the real migrator and truncates it, and `vitest.config.ts` injects its URL as `DATABASE_URL`, so a test can never touch `mathgame`, or a run in another worktree. Each test creates its own player, so tests share no rows. Mock the DB only for what cannot be exercised for real (`src/app.test.ts` mocks `pingDb` to see the 503).

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

Each checkout's server tests use a database of their own on the same instance, created and migrated by the tests themselves (see § Testing ideology): `mathgame_<folder>_<hash>_test`, from the checkout's folder name and 8 hex digits of the SHA-256 of its full path (`test/database.ts`). When every worktree shared one, a run starting in one emptied the tables under a run in another, and two runs at once registered the same account names, so one of them got a `409` (#100); now no two checkouts share one. Two runs in one checkout at the same moment still do ([[DEFERRED]]), so run one at a time there. `TEST_DATABASE_URL` overrides the URL, for CI or a database named by hand; the name must end in `_test`. The deploy workflow's `test` job sets it to `mathgame_ci_test` on the Postgres beside the job.

Nothing drops a checkout's test database when the worktree goes. The setup writes the checkout's folder into the database's comment, and `pnpm db:prune-tests` reads it: it lists every checkout's test database with its folder and drops each one whose folder no longer exists, printing it first; `--dry-run` only lists. It works through the server's `postgres` database and matches only the names `test/database.ts` makes: never `mathgame`, and never a test database named by hand, which it lists as left alone. Run it from any checkout after removing worktrees (`git gtr rm`, `git gtr clean --merged`).

**Getting a kid's game back.** Every save the server was about to lose is in `save_backups`: one a different game replaced (`reason = 'replaced'`) or one the server could not read (`'unreadable'`). Find the player (the kid's browser holds the id in `localStorage['animath.player']`), look at their rows, and put one back with a `seq` far above the current save's. The browser's own save can be ahead of the server's copy, and at its next start the browser takes the server's game only when its `seq` is higher:

```sql
select id, reason, created_at, data->>'seq' as seq, data->'party' as party
  from save_backups where player_id = '<id>' order by id;
update saves set data = jsonb_set(b.data, '{seq}', to_jsonb((saves.data->>'seq')::int + 1000000)), updated_at = now()
  from save_backups b where b.id = <backup id> and saves.player_id = b.player_id;
```

The browser keeps its own set-aside copies too: `animath.save.unreadable` (a save it could not read), `animath.save.replaced` (its game, when a bigger one came from the server or another tab wrote over it in the same instant), `animath.save.previous` (a game the kid left for New game on the title) and `animath.save.upgraded` (an older version's save, as it was before this version first saved over it; the server keeps its copy in `save_backups`), each followed by `.2`, `.3`, … when the key was taken, oldest first. To give a kid back a game they left, in their browser's developer tools copy that text into `animath.save` with its `seq` raised above the current save's (and above the server's, or the server's newer game wins at the next start), then reload: the title offers it as Continue.
### Migrations

Hand-written SQL, applied by `pnpm db:migrate` (`drizzle-orm`'s migrator, journal-driven).

1. Edit `packages/server/src/db/schema.ts`.
2. Add `packages/server/drizzle/NNNN_<name>.sql` with the next number. Use `IF NOT EXISTS` / `IF EXISTS` so it is idempotent.
3. Append an entry to `packages/server/drizzle/meta/_journal.json`: `idx` +1, `tag` = filename without `.sql`, `version: "7"`, a larger `when`, `breakpoints: true`. **A `.sql` without a journal entry is never applied.**
4. Run `pnpm db:migrate` against a database of your own, never `mathgame` (§ Running: `DATABASE_URL=postgres://postgres:postgres@localhost:5433/mathgame_<yours> pnpm db:migrate`), then confirm there with `\d <table>` (the `-p mathgame` form in § Database, with `-d mathgame_<yours>`). Production runs it at the deploy (§ How a merge reaches prod).

Never run `drizzle-kit generate` in a worktree (it emits a full `0000` dump that collides with the real one).

**A migration keeps the build before it working.** A deploy runs the new migrations while the old build still serves, the two builds then answer side by side for a few seconds, and a rollback runs an older build on the newer schema: migrations never go back. So add (a table, a nullable column, a column with a default); rename or drop only in a later PR, once no deployed build reads the old name.

`migrations.test.ts` fails when a `.sql` file has no journal entry or is out of order, and when a migration after `0002` changes the anonymous backup's tables ([[INVARIANTS]] § Server).

## Accounts

An account is a row in `users` with its `sessions`, its `account_saves` row and its `account_save_backups` ([[ARCHITECTURE]] § Data model). There is no email, so a forgotten password is reset, and an account deleted, by the human with the admin CLI:

```bash
pnpm admin list                                    # every account: its save's seq and when, how many browsers are logged in, and "no password yet" while its welcome link waits
pnpm admin reset-password <name> [<new password>]  # a made-up six-character password when none is given; logs every browser out (and uses a waiting welcome link up)
printf '%s' "$PW" | pnpm admin reset-password <name> --stdin  # the password from stdin, never in a command line (the process list, `docker events`) nor said back
pnpm admin delete-account <name>                   # only says what it would delete
pnpm admin delete-account <name> --yes             # deletes the account, its sessions, its save, its set-aside saves and its welcome link
pnpm admin export-local-save <player id> [--from anonymous|account|account:<name>] [--out <folder>]  # a kid's newest save, read-only, into ~/animath-exports/
pnpm admin import-save [--name <name>] [--origin <address>] < save.json             # an account for it, with no password, and a welcome link
```

The last two move a kid's game from one server to another (below).

A name is matched the way the game matches it, whatever its case or however its letters were typed; quote one with a space (`"Anna Sofie"`). Locally the CLI uses `.env`'s `DATABASE_URL`, the `mathgame` database; from a worktree, give it your own database's. In production it runs in the app container, against production's database, from the directory that holds `docker-compose.prod.yml`:

```bash
docker compose -f docker-compose.prod.yml exec app node dist/admin.mjs reset-password <name>
```

**Trying the routes.** A POST or PUT under `/api/account` must declare JSON, and when it carries an `Origin` (a browser's always does) its host must be the request's `Host`; curl sends none. The session is the `animath_session` cookie, which a cookie jar keeps; the save routes also need the account named in `x-animath-account` (its name, URI-encoded), as the game names it:

```bash
API=http://localhost:3021   # your own API
curl -s -c jar -b jar -H 'content-type: application/json' -d '{"name":"Pip","password":"1234"}' $API/api/account/register
curl -s -c jar -b jar $API/api/account/me
curl -s -c jar -b jar -X PUT -H 'content-type: application/json' -H 'x-animath-account: Pip' --data @save.json $API/api/account/save
```

The login and register limits are counted in the API process's memory, so restarting your API clears them. The admin CLI is another process and cannot: a kid who guessed wrong ten times before the reset waits out the rest of that quarter-hour with the new password too.

**Accounts only where they work.** `curl $API/api/account/ready` answers `{"ready":true}` only when the API's database answers and has the accounts' tables; the game offers no account on a `false` or on no answer (the hourly card, the menu's and the title's rows). A worktree's API on a database of its own that only `0000`–`0002` reached (feed those files to `psql`) shows the game as the primary clone's does before `pnpm db:migrate`; migrate it and the offers appear within about 40 s (the API keeps its answer 10 s, a page asks every 30 s). To take a database away from your own API without touching the shared Postgres, `alter database <yours> allow_connections false` and `select pg_terminate_backend(pid) from pg_stat_activity where datname = '<yours>'`; `allow_connections true` brings it back.

**Accounts in the browser.** A guest's game is under `animath.save` as always. The account a browser is logged in to is `animath.account` (`{ name }`), and its game lives under `animath.account.<nameKey, URI-encoded>.save`, with its own set-aside keys (`.replaced`, `.unreadable`, `.previous`, `.upgraded`); logging out removes only the pointer, so the account's copy waits for the next login. `animath.playtime` counts a guest game's play for the hourly card: open a saved game with `?hour=10` and an hour is ten seconds (a throwaway game, `?new`, has no card and no account rows). To try two devices, drive two browser contexts against your own API: the screenshot script is one context, so a throwaway Playwright script opens both (each with its own storage and cookie), and `docker compose -p mathgame exec -T postgres psql …` on your own database shows what the server holds. A page whose account's save on the server a newer build wrote is behind it: it reloads up to 3 times a minute, then shows the behind card ("A new version of the game is ready."). Try it by setting that save's `version` to 99 in your own database.

**Getting a kid's account game back.** As with the anonymous backup (§ Database), what an account's save replaced (another game, from New game on the title, or one the server could not read) is in `account_save_backups`. Put one back with a `seq` far above the current save's, in the document and in its column:

```sql
select b.id, b.reason, b.created_at, b.data->>'seq' as seq, b.data->'party' as party
  from account_save_backups b join users u on u.id = b.user_id where u.name = '<name>' order by b.id;
update account_saves
   set data = jsonb_set(b.data, '{seq}', to_jsonb(account_saves.seq + 1000000)),
       seq = account_saves.seq + 1000000, updated_at = now()
  from account_save_backups b where b.id = <backup id> and account_saves.user_id = b.user_id;
```

### Moving a kid's game to production

A game played through the tunnel lives in this Mac's `mathgame` database and in the kid's browser under the tunnel's address, which the public site cannot read. It moves as an account ([[DECISIONS]] § Accounts): export the save here, import it on production, and give the kid the welcome link the import prints. Only the admin does this, and the kid's local game is never written to.

1. **Export**, on this Mac, from the primary clone, whose `.env` is the local `mathgame` database. The player id is the kid's (`localStorage['animath.player']` in his browser; the human's kid is `5c6f3bd4-fd8d-415a-8c88-65b087943c4b`):

   ```bash
   cd ~/git/mathgame
   pnpm admin export-local-save 5c6f3bd4-fd8d-415a-8c88-65b087943c4b
   ```

   It reads in a read-only session and writes nothing to the database ([[INVARIANTS]] § Server), so it is safe while he plays. It lists every copy of the game it finds with its `seq` and when it was saved: the anonymous backup, and the account he made locally, if he did (found by his name or by the game's lineage). When they are copies of one game it takes the one saved last. When they are different games (a new game he started in the account, or another kid's account that took the name he had as a guest) it writes nothing and says so: look at the list, and run it again with `--from anonymous`, `--from account` or `--from "account:<name>"`. It writes `~/animath-exports/<name>-<time>.json` (0600; a folder inside a repository is refused) and prints one line: his name, how many animals and which, tokens, tools, world and place, `seq`, when saved. Check that it is his game.

2. **Import**, into production over SSH, the file on stdin. The link's address is `deploy.env`'s domain, handed to the container (`-T`: no terminal, so the file pipes through):

   ```bash
   . ./deploy.env
   ssh -i ~/.ssh/mathgame_deploy deploy@$MATHGAME_DOMAIN \
     "cd ~/mathgame && docker compose -f docker-compose.prod.yml exec -T -e MATHGAME_DOMAIN=$MATHGAME_DOMAIN app node dist/admin.mjs import-save" \
     < ~/animath-exports/<name>-<time>.json
   ```

   It checks and upgrades the save with the engine, makes the account under the save's name (or `--name <name>`, inside the quotes; the character takes it too) with the save and no password, and prints `https://<domain>/#welcome=<token>`, which works once, for 14 days. The token is after `#`, which a browser never sends, so it lands in no server's log; the page looks it up with a header. A taken name is refused, and nothing is made. The link logs in to his account until he uses it: it goes to the human, never into a PR, an issue or a note.

3. **The kid opens the link** on his tablet, picks a password, and plays on where he was ([[UI_SPEC]] § Accounts). `node dist/admin.mjs list` in the container shows "no password yet" until he has. From then on it is an ordinary account: a forgotten password is `reset-password`.

4. **Afterwards.** Delete the export once he has played on production (`rm ~/animath-exports/<file>`). A link lost or too old before he used it: `delete-account <name> --yes` (the account holds only the import), then import again. `reset-password` on an account whose link waits uses the link up.

To try it without production, import into your own database with your own client's address, then open the link printed there:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5433/mathgame_<yours> pnpm admin import-save --origin http://localhost:5191 < save.json
```

## Sharing the game through a tunnel

Before the prod server was up (§ Deployment), the game was shared from this machine, and the kids who played it then still play here until their games move over:

```bash
TUNNEL=1 pnpm dev              # both dev servers; TUNNEL lets Vite accept the tunnel hostname
ngrok http 5180                # or: cloudflared tunnel --url http://localhost:5180
```

Send the printed URL. The API is reached through Vite's proxy, so one tunnel is enough. ngrok is installed and signed in on this machine.

Each kid's game is saved in their own browser, under the link they opened, and backed up to this machine's database when the API is running (`pnpm dev` starts both; with only `pnpm dev:client` the games are still saved, just not backed up). So keep sending the same link. ngrok's free plan gives the account one fixed `….ngrok-free.dev` address, reused on every `ngrok http 5180`; a new address, `localhost`, or another tunnel is a different place, where the kid starts a new game and their old one waits under the old address.

## Deployment

Production is **https://animath.xyz**: the game's own Hetzner VPS, `mathgame-prod` at **91.98.203.234**, runs the production stack ([[ARCHITECTURE]] § Production), live since 2026-09-27. The runbook for everything done by hand on it (provisioning, DNS, the secrets, a restore, a rollback without GitHub Actions, the logs) is `/redeploy` (`.claude/commands/redeploy.md`). The deploy secrets (`VPS_HOST`, the IP; `VPS_USER`; `VPS_SSH_KEY`) are set; without them every push to main would end green at the workflow's first job, with a notice saying so, and nothing would deploy.

### How a merge reaches prod

Every push to main that touches what is deployed (`packages/`, the manifests, `Dockerfile`, `docker-compose.prod.yml`, `deploy.env`, `nginx/`, `scripts/`, the workflow) runs `.github/workflows/deploy.yml`:

1. `check` stops the run, green with a notice, when the deploy secrets are missing or the head commit says `[skip deploy]`.
2. `test` is the gate: `pnpm check`, `pnpm lint`, `pnpm test` (with Postgres beside it) and `nginx -t` on the server's config. A red check stops the deploy, and prod keeps the build it has.
3. `build` pushes the image to GHCR as `:<sha>` and `:prod`.
4. `deploy` runs, over SSH, `git reset --hard <sha>` in `~/mathgame` and `scripts/deploy.sh`. The script takes a lock (one deploy at a time), and stops before it touches a container when a canary of an earlier deploy is still there; the checkout has moved to the new commit by then. It warns when the checkout names another Postgres image than the one running, which a deploy never changes (`/redeploy` § Changing Postgres). Otherwise it migrates the database from the new image and checks that image where nothing can reach it (healthy, and serving the game's page). Only then does a canary of it take requests beside the old app, while compose recreates the app. After that it restarts the backup service if its definition or `scripts/backup.sh` changed, and applies nginx's definition and config. Then, from GitHub, `https://<domain>/api/health` must report `<sha>` within 2 minutes.

A push during a run waits for it. GitHub keeps one run waiting and cancels an older one, so of several pushes during a deploy only the newest runs; its build holds the others' code. If that newest says `[skip deploy]`, what it skipped stays off prod until the next deploy. `gh workflow run deploy.yml` builds and deploys main's tip whatever its commit says: the way to catch prod up after a `[skip deploy]`, a cancelled run or a failed one. A merge that touches nothing deployed (docs, `AGENTS/`) starts no run, and prod keeps its build.

### Skipping a deploy

`[skip deploy]` anywhere in the head commit's message, in any case. For a PR, that is the merge commit's subject:

```bash
gh pr merge <N> --merge --subject "Merge pull request #<N> from ulfaslak/<branch> [skip deploy]"
```

Main then runs ahead of prod until the next deploy. Never `[skip ci]` or its kin: GitHub's own markers skip every workflow.

A deploy costs GitHub Actions minutes: about 5 for the checks and 2 to 4 for the image, out of the 2,000 a month the free plan gives private repos, shared with lawcel. A skipped run costs a few seconds, and a merge touching nothing deployed costs nothing.

### Rolling back

```bash
pnpm rollback          # the recent deploys, newest first: the commit each one put on prod
pnpm rollback <sha>    # the image built from <sha> back on prod
```

It dispatches the deploy workflow with that SHA: no build and no tests; `:prod` points at that commit's image, the server checks out that commit, and the same swap and health check run. It holds until the next push to main; to stay back, merge a revert. The database stays as it is, so the older build runs on the newer schema (§ Migrations). Without GitHub Actions: `/redeploy` § Roll back.

### Backups

Three layers ([[ARCHITECTURE]] § Production): the `backup` service's dumps in `~/mathgame/backups/` on the server, every 6 hours, 30 days kept; their copy in `~/mathgame-backups/` on this Mac, pulled every 6 hours by the launchd agent `com.mathgame.backup-sync` (installed by `./scripts/install-backup-sync.sh`; its log is `~/Library/Logs/mathgame-backup-sync.log`); and Hetzner's nightly image of the machine, taken between 06:00 and 10:00 UTC. Restoring one: `/redeploy` § Restore from a backup. Alerts go to Slack when `MONITORING_SLACK_WEBHOOK_URL` is set, in `~/mathgame/.env.monitoring` on the server and `~/.config/mathgame/monitoring.env` here; without it an alert is a log line.

### Prod access

An agent on this Mac reaches every part of prod by itself; none of it needs the human.

```bash
curl -fsS https://animath.xyz/api/health     # {"ok":true,"db":true,"sha":"<the build>"}
ssh -i ~/.ssh/mathgame_deploy deploy@animath.xyz
cd ~/mathgame && docker compose -f docker-compose.prod.yml logs --tail 200 -f app
```

- **The server.** `deploy` on `animath.xyz` (or `91.98.203.234`), with `~/.ssh/mathgame_deploy`, a key only this Mac holds; Terraform put its public half on the server. `deploy` runs Docker, and `sudo` without a password. Everything is under `~/mathgame` (`/redeploy` § Logs and a look inside), and the admin CLI runs there in the app container (§ Accounts).
- **The Hetzner project.** Terraform, from the primary clone's `terraform/`, where its state is, with the API token in `terraform.tfvars` beside it (gitignored, mode 600, never printed). `terraform output` gives the addresses. The Cloud Console, the human's login, shows the server's nightly images.
- **The keys the deploy uses.** The workflow logs in with a key of its own, whose private half is only in the `VPS_SSH_KEY` secret. The server fetches the repo with a read-only deploy key, `mathgame-prod` in the repo's settings, whose copy is in `~/mathgame-backups/.ssh/`.
- **The domain.** At Porkbun, the human's account: an A record for `animath.xyz` to the IP and a CNAME `www` to `animath.xyz`, no AAAA (`/redeploy` § DNS). A new IP means changing that A record, and `VPS_HOST`.

Never change a file on the server: the next deploy resets the checkout, and a change that belongs there belongs in a PR.

### Trying it on a Mac

The production stack runs locally with `docker-compose.local.yml` (Docker is colima here: [[ENVIRONMENT_NOTES]]), as the project `mathgame-local` on `localhost:8480`, with plain HTTP and nothing of the dev database's:

```bash
docker build --build-arg GIT_SHA=$(git rev-parse HEAD) -t mathgame:local .
MATHGAME_DIR=$PWD MATHGAME_COMPOSE_OVERRIDE=docker-compose.local.yml bash scripts/deploy.sh
curl -s localhost:8480/api/health
node scripts/screenshot.mjs --url http://localhost:8480/ --api --out screenshots/prod-local.png
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml down -v
```

The deploy script's first run starts the stack; run again after tagging a new build `mathgame:local`, it does the canary swap. `--api` lets the page back up to the stack's own database. To see the page shown while the game does not answer, stop the app (`… stop app`) and load `localhost:8480` (with `?lang=da` for Danish). The last line removes the stack's containers, network and volumes.
