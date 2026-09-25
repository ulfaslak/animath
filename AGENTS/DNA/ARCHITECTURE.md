# Architecture

## Shape

A pnpm workspace with three packages and one rule about the arrows between them:

```
packages/engine   ← pure game rules. Imports nothing.
      ▲      ▲
      │      │
packages/client   packages/server
(Vite, Three.js,  (Hono, ws, Drizzle,
 Svelte overlay)   Postgres)
```

The engine knows the rules of the game and nothing about screens, sockets or databases. The client renders and collects input. The server persists and, later, arbitrates. Client and server may both import the engine; neither imports the other, and the engine imports neither. Anything that decides an outcome — damage, a catch, an answer's correctness, whether a tile is walkable — is engine code.

To see the current tree:

```bash
tree packages -I 'node_modules|dist' --dirsfirst
```

## `packages/engine` — the rules

| Path                              | Holds                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/rng.ts`                      | `Rng` (mulberry32, seeded), `hashInts`, `hashString`. The only source of randomness in the engine.                                                            |
| `src/puzzles/types.ts`            | `PuzzleKind`, `Puzzle`, `PuzzleGenerator`, difficulty bounds.                                                                                                  |
| `src/puzzles/generators/*.ts`     | One file per family: `arithmetic.ts` (add, sub, mul, div, missing), `sequence.ts`, `sqrt.ts`. Each exports a `PuzzleGenerator` with its own difficulty tables. |
| `src/puzzles/registry.ts`         | `generatePuzzle(rng, difficulty, kinds)`, `checkAnswer`, `getGenerator`, `clampDifficulty`. Adding a kind = new generator file + one line here + the union type. |
| `src/puzzles/difficulty.ts`       | `puzzleDifficulty(tier, n, level)` and `healingDifficulty(tier)` — the one mapping from "how strong" to "how hard".                                            |
| `src/animals/types.ts`            | `AnimalSpec`, `AttackSpec`, `AnimalInstance`, `Tier`, `Biome`, and `MAX_PARTY` (6), the one party cap the client authority and the server's save validator share. |
| `src/animals/catalog.ts`          | `ANIMALS`, `getAnimal`. The species roster with attacks, powers, habitats.                                                                                    |
| `src/battle/damage.ts`            | `attackDamage`.                                                                                                                                                |
| `src/battle/catch.ts`             | `catchProbability`.                                                                                                                                            |
| `src/battle/types.ts`             | `BattleState`, `BattlePhase`, `BattleIntent`, `BattleEvent`, `BattleOutcome`, `BattleStep`.                                                                     |
| `src/battle/reducer.ts`           | `startBattle(party, wild, options?)`, `applyBattleIntent(state, intent, seed) → { state, events }`, `activeAnimal`, `canSwitchTo(state, partyIndex)` (who may step in now: the reducer's rule, which the client's party list reads too). The whole wild-battle loop; pure. The seed is the authority's, never in the state. The wild animal's miss chance is `WILD_MISS_CHANCE`, exported for tests and not re-exported from `index.ts`. |
| `src/doctor/types.ts`             | `DoctorState`, `DoctorPhase`, `DoctorIntent`, `DoctorEvent`, `DoctorStep`.                                                                                      |
| `src/doctor/reducer.ts`           | `startDoctorVisit(party)`, `applyDoctorIntent(state, intent, seed) → { state, events }`. One visit to a doctor's tent; pure. Same shape and seed rule as the battle reducer: the seed is the authority's, never in the state, fresh per visit. |
| `src/doctor/party.ts`             | `needsHealing(animal)` (who the doctor treats) and the party validation the doctor's entry points share.                                                        |
| `src/doctor/knockout.ts`          | `takeToDoctor(seed, pos, party) → Rescue`: the knock-out rule the authority applies on `ended { outcome: 'lost' }`: where the player stands next, which way they face, the healed party, the message line. |
| `src/party/types.ts`              | `PartyIntent` (`select-lead`, `reorder`, `rename`), `PartyEvent`, `PartyRejection` (codes, not words: the engine holds no player-facing text), `PartyStep`, `PlayerActivity`. |
| `src/party/reducer.ts`            | `applyPartyIntent(party, intent, activity) → { party, events }`: the party rules of [[PRODUCT]] §4 "Party"; pure, and it refuses everything unless `activity` is `explore`. `leadIndex(party)`: the lead, the one definition the battle reducer, the HUD and the pause menu all read. |
| `src/party/names.ts`              | `MAX_NICKNAME_LENGTH`, `normalizeNickname(raw) → string \| undefined`: the one nickname cleaner. `undefined` is no nickname; the client shows the species' name. |
| `src/world/types.ts`              | `Tile`, `TileKind`, `Chunk`, `GridPos`, `Direction`, `CHUNK_SIZE`, `isWalkable`, `isEncounterTile`, `step`.                                                     |
| `src/world/tents.ts`              | `nearestTent(seed, from, maxSteps?) → TentSpot \| null` (the tent, the tile to stand on beside it, the facing, the steps; nearest on foot, breadth-first over walkable tiles), `canTalkToDoctor(seed, pos, facing)`, `TENT_SEARCH_STEPS`. |
| `src/world/generate.ts`           | `generateChunk(seed, cx, cy)`, `tileAtWorld`, `spawnPoint`. Value-noise elevation + moisture → biome → tile kind; tents on a sparse lattice.                    |
| `src/world/encounters.ts`         | `rollEncounter(rng, site, leadTier)`, `encounterTable(biome, distance, leadTier)`, `distanceFromSpawn`, the radius, chance and weight constants (`ONE_TIER_BELOW_WEIGHT`). Biome tables come from the catalog's habitats, weighted by tier relative to the lead's, plus visitors of the lead's tier near spawn where every resident the lead's size or bigger is bigger. The caller picks the lead; the engine only takes its tier. |
| `src/protocol.ts`                 | `Intent`, `GameEvent`, `Authority` — the client ↔ authority contract.                                                                                          |
| `src/index.ts`                    | The public surface. Everything the client or server uses is re-exported here.                                                                                  |
| `test/*.test.ts`                  | vitest. `purity.test.ts` pins the package boundary; the others are property tests over seeds, the difficulty range and the whole catalog. `balance.test.ts` is the species × species simulation that pins the balance targets in [[PRODUCT]] §4 (`SIM=1` prints every policy × accuracy × level table); `battle-sim.ts` is its scripted player. `tents.test.ts` checks `nearestTent` against its own flood fill over the tent lattice; `doctor.test.ts` covers the doctor reducer and the knock-out rule; `party.test.ts` fuzzes the nickname cleaner with hostile Unicode and sweeps the party reducer over random parties. |

### The authority seam (how multiplayer slots in)

```
   UI / renderer            Authority                 engine
 ┌──────────────┐  intent  ┌──────────────┐  calls  ┌──────────┐
 │ keyboard,    │ ───────▶ │ validate,    │ ──────▶ │ rules,   │
 │ Svelte panel │          │ apply, emit  │ ◀────── │ formulas │
 │ Three scene  │ ◀─────── │              │         └──────────┘
 └──────────────┘  event   └──────────────┘
```

`Authority` (`protocol.ts`) is `dispatch(intent)` + `subscribe(listener)`. The client has exactly one authority instance and everything above it is a consumer of events.

- **Today**: `packages/client/src/authority/local.ts` — `LocalAuthority` runs the engine in-process. Its own randomness (the encounter roll after each step, a battle's seed, a doctor visit's seed) is keyed by the world seed and its count of completed steps (and of visits), never by `Math.random`; see [[INVARIANTS]] § Authority. After a battle it emits `party-changed` (the whole party, HP written back, a caught animal added), or after a lost one `taken-to-doctor` (see § Modes); after each heal at the doctor, `party-changed` again. A `party` intent goes to `applyPartyIntent` with what the player is doing (`battle` while one is in progress, `doctor` during a visit, else `explore`) and is always answered with `party-edited`: facts only. The party it starts with passes through `normalizeNickname`, as a rename does.
- **Words**: events carry what happened, and the client chooses the words for its own screens — the battle narration, everything the doctor says, the line after a lost battle, who goes first after a party edit (from `party-edited`), the hint for Enter away from a tent (from `nothing-to-interact`, which carries no words). The engine's `BattleState.log`, `DoctorState.log` and `Rescue.message` are not shown. The authority still sends `message` text for battle results, until the copy extraction moves them to keys.
- **Multiplayer**: a `RemoteAuthority` with the same interface forwards intents over a WebSocket and relays the server's events. The server runs the engine against the shared world and is the source of truth. Nothing in the renderer, input or UI changes.

Two things keep that swap cheap: intents carry only what the player *chose* (a direction, an attack index, an answer string), never a computed outcome; and events describe what *happened* in enough detail to render without re-running the rules.

## `packages/client` — rendering and input

| Path                          | Holds                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`                  | A full-screen `<canvas id="game">` under a `<div id="ui">` overlay. Loads Nunito.                                                                                    |
| `vite.config.ts`              | Dev server (port, `/api` proxy, `TUNNEL`), build options, and `yaml()`: the plugin that turns an imported `.yaml` file into its data at build time. `vitest.config.ts` extends it, so tests load YAML the same way. |
| `src/main.ts`                 | Wires the authority's events to the views and the four controllers, sends each key to the screen that is up (battle, else the doctor's card, else the pause menu, else explore) and switches explore input off while any of them is up, mounts the Svelte app, runs the `requestAnimationFrame` loop (the explore, battle or doctor controller's `update(dt)`, the message line's clock while the explore HUD is on screen, then `renderer.render()`). |
| `src/flags.ts`                | The URL switches, read once: `?zoo`, `?debug` (position and facing on screen), `?party=` (the starting party, e.g. `bear:10,fox`; a typo is ignored). `?lang=` is read by `copy/`. |
| `src/authority/local.ts`      | `LocalAuthority` (see above): moves and the facing they leave, one encounter roll per completed step (for the tier of the lead, `leadIndex`), the battle in progress and the doctor visit in progress (each the engine's state plus the seed it never shows), and results written back — party HP, a caught animal (up to six), each heal, the trip to the tent after a lost battle (`takeToDoctor`). Takes an optional starting party (`?party=`). Party intents: the engine's rules, told what the player is doing. |
| `src/names.ts`                | `nameOf(animal)`: what the screen calls an animal (its nickname as stored, else its species' name), and `speciesName`. Used by the HUD, the pause menu and the message line's line about the lead. |
| `src/state/game.svelte.ts`    | `game`: the `$state` view the Svelte overlay reads (`mode`, `pos`, `facing`, `steps`, `party`, …). Filled only by `game.apply(event)`.                              |
| `src/state/hud.svelte.ts`     | `hud`: what the explore message line says — the latest thing said (a `message`, or a line the client words itself from an event without words: the doctor's goodbye, the knock-out line, the not-at-a-tent hint on `nothing-to-interact`) while fresh, and the doctor prompt or the controls hint under it. `tick(dt)` counts only while the explore HUD is up. After a party edit it says who goes first (`leadNotice`: the new lead, or why one can't be chosen); a `party-changed` clears that line. |
| `src/state/battle.svelte.ts`  | `battle`: the battle screen's `$state` view — what the panel shows and which `screen` the keys drive (`actions`, `party`, `puzzle`, `busy`, `result`), plus each attack's level, kept across battles. Written only by the battle controller. |
| `src/state/doctor.svelte.ts`  | `doctor`: the doctor's card's `$state` view — the party, the doctor's line, the cursor, the puzzle and which `screen` the keys drive (`list`, `puzzle`, `busy`) — plus the cursor helpers. Written only by the doctor controller. |
| `src/state/pause.svelte.ts`   | `pause`: the pause menu's `$state` view — `open`, which `screen` the keys drive (`list`, `options`, `naming`), the cursors, the picked animal (by id) and the typed `draft`. Written by the pause controller, except `draft`, which the name box binds. `MENU_ITEMS` (the rows under the team; Settings joins here) and `partyOptions`. |
| `src/input/keyboard.ts`       | Explore input: held-key tracking plus a 2-deep tap buffer; arrows/WASD → `Direction`, Enter/Space → interact, number keys 1–6 → the party slot to lead. `setEnabled(false)` while the battle screen, the doctor's card or the pause menu is up drops held keys, taps and a pressed number. |
| `src/input/answer.ts`         | `answerKey(input, key)`: typing an answer (digits, a leading minus, Backspace, 7 characters, Enter only once a digit is typed). Shared by every screen that asks a puzzle. |
| `src/explore/controller.ts`   | Explore mode: turns input into `move`/`interact` intents (one per completed step), tweens the player mesh between tiles on `player-moved`, jumps it (facing unchanged) on `player-placed` and (turned to the tent) on `taken-to-doctor`, asks for chunks around it. Ignores events for other players. A number key becomes `select-lead` for the animal in that slot, sent before any step of the same frame. |
| `src/pause/controller.ts`     | The pause menu, opened by Escape in explore: keys → the `pause` view and `party` intents (`select-lead`, `reorder`, `rename`). Shows only what `party-edited` says; closes itself on `battle-started`, `doctor-visit-started` or `welcome`. Leaves every key but Enter, Escape and Tab to the name box. |
| `src/battle/controller.ts`    | Battle mode, from `battle-started` until the result card is left: keys → battle intents, and the authority's battle events played back one beat at a time (narration, HP, scene effects) before the latest state is shown. Ignores updates for any battle but the one on screen. |
| `src/battle/menu.ts`          | The battle menus as pure functions: the action rows (attacks, Leash, Switch, Run), each attack's own level by species and attack (`attackRows`, `levelWord` through `t()`), and what a key does on the menu (`menuKey`) and on the party list (`listKey`). The controller asks, the panel draws. |
| `src/doctor/controller.ts`    | The doctor's card, from `doctor-visit-started` to `doctor-visit-ended`: keys → doctor intents, and the doctor events played back as beats (the judgement, then the heal) before the latest state is shown. Ignores events of any visit but the one on screen (each carries its visit's number). |
| `src/doctor/lines.ts`         | `DoctorLine`: what the doctor says — on the card, the goodbye, the line after a lost battle — as data, and `doctorWords`, which words it from `doctor.*` in the copy files when it is shown. |
| `src/render/renderer.ts`      | `GameRenderer`: WebGL renderer, scene, fixed orthographic camera, lights, chunk cache (5×5 chunks around the player), the player figure, `addFigure` for extra standing figures, idle animation each frame. `setBattle(scene)` draws a battle scene instead of the world. |
| `src/render/battle-scene.ts`  | `BattleScene`: one per session, dressed per battle — biome backdrop, both figures facing each other, the lens-shifted perspective camera that centres them above the panel, and the effects (lunge, shake, puff, hop, faint, recall and appear for a switch, the leash). `battlePanelHeight` mirrors the CSS panel height. |
| `src/render/tiles.ts`         | `buildChunkGroup(chunk)`: one `InstancedMesh` of boxes for ground, plus decoration groups (trees, rocks, tall grass, tent + fire + point light). `groundTop(tile)`: the height figures stand at. |
| `src/render/animals.ts`       | `buildAnimalMesh(speciesId)`, `buildPlayerMesh()`, `animateIdle(figure, t)`: primitive figures for every catalog species and the trainer. Contract: units are tiles, feet on `y = 0`, centred on `x`, facing `+z`; the group's one child is the rig that idles. |
| `src/render/zoo.ts`           | `buildZoo(seed, origin)`: the `?zoo` line-up, one figure per species by the spawn tile. Verification only, never on the normal path.                              |
| `src/render/palette.ts`       | Tile, decoration, trainer and species colours. Mirrors [[DESIGN]] § Palette.                                                                                        |
| `src/ui/App.svelte`           | Screen switch: loading / explore (`Hud`) / the doctor's card (`DoctorCard`, over the world) / the pause menu (`PauseMenu`, over the world) / battle (`BattlePanel`, from the moment the battle scene appears until the result card is left); the `?debug` position badge. |
| `src/ui/Hud.svelte`           | Party cards in battle order (number key, name, HP bar, "tired", the lead outlined and tagged), the keys panel under them, and the message line (from `hud`). |
| `src/ui/PauseMenu.svelte`     | The pause menu: the team list and menu rows, the picked animal's options, the name box. Reads `game` and `pause`; never dispatches. Every word comes from the copy files. |
| `src/ui/BattlePanel.svelte`   | The battle overlay: status boxes, narration line, action menu or party list, puzzle area, result card. Reads `battle`; never dispatches.                           |
| `src/ui/DoctorCard.svelte`    | The doctor's card: the doctor's line, the party list with Bye, the puzzle area (`PuzzlePanel`). Reads `doctor`; never dispatches. Every word through `t()`.     |
| `src/ui/PuzzlePanel.svelte`   | One puzzle being answered: prompt, typed answer, judgement. The one puzzle view ([[UI_SPEC]] § Component reuse).                                                    |
| `src/ui/HpBar.svelte`         | The one HP bar: colour by fraction left (green, amber under half, red under a fifth), always with `hp/max` printed.                                                  |
| `src/styles.css`              | CSS custom properties (panel colours, radius, font, `--battle-panel`, `--doctor-panel`) and the canvas/overlay layout.                                              |
| `src/copy/<code>.yaml`        | The words: every player-facing line, one file per language (`en.yaml`, `da.yaml`), nested keys grouped by screen (`puzzle.keys`). See § Copy.                      |
| `src/copy/languages.ts`       | `LANGUAGES` (the registry: one code per language, in the order the Language setting lists them), `FALLBACK_LANGUAGE` (`en`), `isLanguage`, `COPY` (every file's data). |
| `src/copy/translate.ts`       | `createTranslator(copy, fallback, warn?)`: flattens the files into messages, fills `{param}` and `{param.form}`, picks a plural form by `Intl.PluralRules`, capitalises a value that starts a sentence, falls back to English. Pure. |
| `src/copy/language.svelte.ts` | `language` (`current` as `$state`, `set`, `onChange`), `t(key, params?)`, `languageName`, `chooseLanguage`, `readLanguageHints`: the language on screen, where it starts, and where it is remembered. |
| `src/copy/index.ts`           | The one import path for all of it: `import { t, language } from '../copy'`.                                                                                        |
| `src/copy/yaml.d.ts`          | Types a `.yaml` import as `unknown` data.                                                                                                                           |
| `public/assets/`              | Models, textures, sounds. `CREDITS.md` lists every third-party file.                                                                                                |
| `test/animals.test.ts`        | vitest: every catalog species builds a figure that keeps the contract in `animals.ts` (geometry construction needs no WebGL).                                        |
| `test/local-authority.test.ts`| vitest: the authority's rules around the engine — encounters replay per step, battles start only on encounter tiles, the lead decides who comes out, outcomes write back, the party caps at six, the trip to the tent after a lost battle, the facing it keeps, the doctor visit (walking waits, heals write back, a fresh seed per visit that never leaves it).; party edits (a chosen lead fights, a tired one is refused, nothing changes mid-battle, a chosen fox turns the reed to otters). |
| `test/battle-controller.test.ts` | vitest: the battle screen driven by keys against the real authority — held keys, empty answers, mashed Enter, stale events, per-attack levels across battles, and switching (the party list, Escape, refusals, the knock-out list's guard and free pick, the menu after a switch). The scene is built, never drawn. |
| `test/battle-menu.test.ts`    | vitest: `menu.ts` for every species — each attack row's own level and its easy / medium / hard word, the cursor, what each key picks on every row, the party list's keys. |
| `test/doctor-controller.test.ts` | vitest: the doctor's card driven by keys against the real authority — the cursor skipping fit animals, a miss, a heal, swapping patients mid-puzzle, Escape at any time, the opening guard, held keys and keys during a beat. |
| `test/pause-controller.test.ts` | vitest: the pause menu driven by keys against the real authority — opening and closing, auto-repeat, greyed options, a mashed Enter at the top, letters typed into the name box, an input method's Enter. |
| `test/explore-controller.test.ts` | vitest: explore input against the real authority — a number pressed on the frame a step starts a battle picks the animal that fights. |
| `test/hud.test.ts`            | vitest: the message line — a line fades after 5 s of explore time and waits while the HUD is off screen, the controls hint, the doctor prompt, the doctor's lines worded from events. `lead-notice.test.ts`: the line about who goes first after pick, menu move, rename and a party change. |
| `test/flags.test.ts`          | vitest: the URL switches, and that a misspelt `?party=` is ignored as a whole.                                                                                      |
| `test/css-vars.test.ts`       | vitest: every `var(--x)` in the UI's `.svelte` and `.css` files is defined (an undefined one fails nowhere else). `vitest.config.ts` lets tests read CSS as text.  |
| `test/copy-files.test.ts`     | vitest: one copy file per registered language; every language has exactly English's keys, each reading the same params; no empty or non-text values; plural forms match the language's `Intl.PluralRules`; every key the code passes to `t()` as a literal exists in English, with the params its message reads. |
| `test/copy-runtime.test.ts`   | vitest: `t()`'s rules on made-up copy (placeholders, forms, plurals, capitals, fallback, one warning per gap), `chooseLanguage`, and the store against the real files. |
| `test/hardcoded-text.test.ts` | vitest: no Svelte template prints words of its own (text, worded attributes such as `title` or `aria-label`, string literals a `{…}` prints) beyond `hardcoded-text.baseline.yaml`, which may only shrink. |
| `test/source.ts`              | Helpers for the tests that parse the client's own source: Svelte's AST for components, TypeScript's for modules, so comments never count.                           |

### Copy

```
 src/copy/en.yaml ┐  yaml() at build time          ┌ language.current ($state)
 src/copy/da.yaml ┴─────────────▶ plain objects ───┤ t('key', params) ─▶ Svelte markup
                                                   └ language.onChange ─▶ code outside Svelte
```

- **Where the words live.** Every player-facing line is in `src/copy/<code>.yaml`, nested by screen (`puzzle.keys`, `explore.*`, `party.tired`, `doctor.*`; the rest follows the extraction). Only the client reads the files. Both languages ship in the main bundle; each is a few kB.
- **Loading.** `yaml()` in `vite.config.ts` parses a file when Vite builds, serves or tests it; the bundle holds its data and no YAML parser. A syntax error or a repeated key fails the build.
- **The language on screen.** `language.current` starts from `?lang=` (for that visit only), else the choice remembered on this device (`localStorage['animath.language']`), else the first of `navigator.languages` the game speaks (`da-DK` counts as `da`), else English. `language.set()` switches, remembers (storage failures are ignored), sets `<html lang>` and calls the `onChange` listeners.
- **`t()`** reads `language.current` on every call, so Svelte markup that calls it re-renders the moment the language changes. Code outside Svelte (the Three.js layer, if it ever draws words) calls `t()` when it draws and redraws on `language.onChange`. A sentence stored as a string stays in the language it was made in, so state and events hold keys and params ([[DECISIONS]] § Copy and languages).
- **Gaps.** A key missing from Danish shows in English; a key missing from English shows as the key. In development each gap logs one `console.warn`, which makes `scripts/screenshot.mjs` exit non-zero; production is silent. `copy-files.test.ts` fails on both.
- **Dev server.** An edited copy file swaps the words in place: `language.svelte.ts` accepts the hot update of `languages.ts`, so the game on screen and the `language` store survive it.
- **The engine emits no words** ([[DECISIONS]] § Copy and languages): ids (`speciesId`, attack ids), codes and numbers, which the client words. Puzzle prompts are maths notation (`7 × 8 = ?`) and need none. Until the extraction, English still crosses the seam in two ways: species and attack `name`s in `animals/catalog.ts`, which the client shows, and the `message` event's `text`, a finished sentence `LocalAuthority` writes. The engine's own `BattleState.log`, `DoctorState.log` and `Rescue.message` are English too, but the client does not show them: it words the battle and the doctor from their events. The doctor's lines are kept in state as data (`DoctorLine` in `doctor/lines.ts`, and the message line's `Said` in `state/hud.svelte.ts`) and worded when shown.

### Coordinate system

Engine grid `(x, y)` maps to Three `(x, height, z)` with `z = y`; grid "down" is screen-down because the camera's yaw is fixed. Tiles are unit cubes centred on integer coordinates; the ground top is at `y = 0.5 + 0.25·height` for land and lower for water (`groundTop` in `tiles.ts`). Figures stand with their feet on that top face; the player hops 0.15 during a step. A figure faces `+z` (grid "down", toward the camera) at `rotation.y = 0`; `up` is `π`, `right` is `π/2`, `left` is `-π/2`.

### Modes

Two modes, one on screen at a time. `battle-started` hands the screen to the battle controller: explore input is switched off, the world keeps drawing for a moment so the step into the grass lands, then the battle scene and panel replace it. The authority resolves each battle intent at once; the controller plays the events back as beats and only then shows the new state, so the screen lags the authority on purpose. `battle-ended` puts the authority back in explore at once, but the screen stays on the result card until the player leaves it; only then does explore input come back. Walking during a battle and battle intents outside one are ignored by the authority; party intents during one are refused by the engine (`not-exploring`), because the battle holds its own copy of the party and writes it back at the end.

The pause menu is not a mode either: an overlay in explore, opened by Escape, that switches explore input off while it is open and closes itself on `battle-started` or `welcome`. The authority does not know it is open; it sees only the party intents the menu sends.

The doctor is not a mode: a dialogue card over explore, driven by `doctor-visit-started` / `-updated` / `-ended` (the doctor controller plays each update back as beats, like the battle screen). Each doctor event carries its visit's number (a `DoctorState`'s `step` starts at 0 every visit), and the card ignores events of any other visit, as the battle screen ignores other battles'. The world keeps drawing under it; explore input is off while it is open, and the authority ignores walking during a visit and doctor intents outside one. The authority opens a visit on `interact` when `canTalkToDoctor(seed, pos, facing)` holds, so it tracks the facing the client shows: `down` from `welcome` (both sides reset it there, so a second `welcome` keeps them agreeing), then the `dir` of every `move`, walked or blocked, and the `dir` of `taken-to-doctor`. The client computes the "Press Enter to talk to the doctor" prompt with the same engine function from the same events. After a lost battle the authority emits `battle-ended` and then `taken-to-doctor`, which puts the player beside the tent without a tween, turns them to it and replaces the party; the battle screen's result card ("Good try!", with no closing line) waits on top meanwhile, and the message line words the doctor's line from `taken-to-doctor`. `player-placed` (a move without a tween that keeps the facing) is in the protocol, but nothing sends it today. See [[UI_SPEC]].

## `packages/server` — persistence and (later) authority

| Path                         | Holds                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/index.ts`               | Starts the Hono app on `PORT`.                                                                            |
| `src/app.ts`                 | `createApp()`: logger, `/api/health`, `/api/players`, static serving of `../client/dist` (prod). Testable without a port. |
| `src/env.ts`                 | Loads `.env` (repo root or cwd) with `process.loadEnvFile`; validates `DATABASE_URL`, `PORT`.             |
| `src/db/schema.ts`           | Drizzle schema.                                                                                           |
| `src/db/index.ts`            | `pool`, `db`, `pingDb`.                                                                                   |
| `src/routes/*.ts`            | One Hono sub-app per route group: `health.ts`, `players.ts` (identity + save).                            |
| `src/secrets.ts`             | Player secrets: generate (`randomBytes`), hash (SHA-256), constant-time compare.                          |
| `src/save.ts`                | `SaveV1` — the save envelope — and `validateSave()`, the hand-rolled validator. No schema library.        |
| `scripts/migrate.ts`         | Applies journaled migrations from `drizzle/`.                                                             |
| `drizzle/NNNN_*.sql`         | Hand-written migrations; `drizzle/meta/_journal.json` lists them.                                         |
| `test/*.test.ts`             | Integration tests against `mathgame_test` (see [[DEVELOPMENT]] § Testing ideology).                       |
| `test/global-setup.ts`       | Creates, migrates and truncates `mathgame_test` once per `vitest` run; `vitest.config.ts` injects its URL.|

### Data model

- `players` — `id uuid pk`, `secret_hash text` (SHA-256 of the client-held secret; the secret itself is never stored), `display_name text?`, `created_at`, `last_seen_at` (bumped on every authenticated request). One row per anonymous player.
- `saves` — `player_id uuid pk → players (cascade)`, `data jsonb` (the `SaveV1` envelope below), `updated_at`. One save per player.

Hot fields get promoted from `data` to columns when a query needs them (nearby players, leaderboards).

### HTTP API

Errors are JSON `{ error: string }`. All routes are under `/api`.

| Route                         | Auth  | Response                                                                          |
| ----------------------------- | ----- | --------------------------------------------------------------------------------- |
| `POST /api/players`           | none  | `201 { id: uuid, secret: string }`. The client stores both; the secret is shown once. |
| `GET /api/players/:id/save`   | owner | `200 SaveV1`, or `404` when nothing has been saved.                               |
| `PUT /api/players/:id/save`   | owner | `200 { ok: true }` after an upsert; `400` bad JSON or shape; `413` body over 64 KB. |

**Owner auth** is `Authorization: Bearer <secret>`. Missing or malformed header → `401`; `:id` unknown (or not a uuid) → `404`; secret does not match the stored hash → `401`.

**`SaveV1`** (`src/save.ts`) is a versioned envelope, stored and returned verbatim:

```ts
{
	version: 1,
	seed: number,                 // integer; the world is a pure function of it
	pos: { x: number, y: number }, // integer tile coordinates, any sign
	party: AnimalInstance[]       // 0–6 of { id: string, speciesId: string, nickname?: string, hp: number }
}
```

Required fields are validated strictly (`speciesId` must be in the engine catalog, `hp` a whole number ≥ 0, `id` unique within the party). Any extra field — top-level or per animal — is stored and returned as sent, so a newer client can add data without a server change; bump `version` only when an old document becomes unreadable. "As sent" is JSON semantics: key order and `-0` are not preserved, and a document containing a NUL character, a lone surrogate or a number that overflows to Infinity is a `400`, not a mangled row. The upsert is unconditional — last write wins, with no stale-write guard (see [[DEFERRED]]).

## Ports and processes (development)

| Process     | Port | Started by                       |
| ----------- | ---- | -------------------------------- |
| Vite client | 5180 | `pnpm dev:client`                |
| API server  | 3000 | `pnpm dev:server` (`tsx watch`)  |
| Postgres    | 5433 | `pnpm db:up` (docker compose)    |

Vite proxies `/api` and `/ws` to 3000. In production the server serves the built client itself.

## Repo-level files

- `scripts/screenshot.mjs` — headless Chrome driving the running game with a key script and saving frames (`playwright-core`, `channel: 'chrome'`). The visual verification tool; see `/play` and [[DEVELOPMENT]] § Looking at the game.
- `docker-compose.yml` — local Postgres only.
- `.gtrconfig` — worktree creation copies `.env` and runs `pnpm install`.
- `AGENTS/` — persistent context (this file's siblings). `AGENTS/DNA/` is the guardrail set; the rest is record-keeping.
