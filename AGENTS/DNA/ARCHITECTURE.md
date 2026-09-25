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
| `src/battle/reducer.ts`           | `startBattle(party, wild, options?)`, `applyBattleIntent(state, intent, seed) → { state, events }`, `activeAnimal`. The whole wild-battle loop; pure. The seed is the authority's, never in the state. The wild animal's miss chance is `WILD_MISS_CHANCE`, exported for tests and not re-exported from `index.ts`. |
| `src/doctor/types.ts`             | `DoctorState`, `DoctorPhase`, `DoctorIntent`, `DoctorEvent`, `DoctorStep`.                                                                                      |
| `src/doctor/reducer.ts`           | `startDoctorVisit(party)`, `applyDoctorIntent(state, intent, seed) → { state, events }`. One visit to a doctor's tent; pure. Same shape and seed rule as the battle reducer: the seed is the authority's, never in the state, fresh per visit. |
| `src/doctor/party.ts`             | `needsHealing(animal)` (who the doctor treats) and the party validation the doctor's entry points share.                                                        |
| `src/doctor/knockout.ts`          | `takeToDoctor(seed, pos, party) → Rescue`: the knock-out rule the authority applies on `ended { outcome: 'lost' }`: where the player stands next, which way they face, the healed party, the message line. |
| `src/world/types.ts`              | `Tile`, `TileKind`, `Chunk`, `GridPos`, `Direction`, `CHUNK_SIZE`, `isWalkable`, `isEncounterTile`, `step`.                                                     |
| `src/world/tents.ts`              | `nearestTent(seed, from, maxSteps?) → TentSpot \| null` (the tent, the tile to stand on beside it, the facing, the steps; nearest on foot, breadth-first over walkable tiles), `canTalkToDoctor(seed, pos, facing)`, `TENT_SEARCH_STEPS`. |
| `src/world/generate.ts`           | `generateChunk(seed, cx, cy)`, `tileAtWorld`, `spawnPoint`. Value-noise elevation + moisture → biome → tile kind; tents on a sparse lattice.                    |
| `src/world/encounters.ts`         | `rollEncounter(rng, site, leadTier)`, `encounterTable(biome, distance, leadTier)`, `distanceFromSpawn`, the radius, chance and weight constants (`ONE_TIER_BELOW_WEIGHT`). Biome tables come from the catalog's habitats, weighted by tier relative to the lead's, plus visitors of the lead's tier near spawn where every resident the lead's size or bigger is bigger. The caller picks the lead; the engine only takes its tier. |
| `src/protocol.ts`                 | `Intent`, `GameEvent`, `Authority` — the client ↔ authority contract.                                                                                          |
| `src/index.ts`                    | The public surface. Everything the client or server uses is re-exported here.                                                                                  |
| `test/*.test.ts`                  | vitest. `purity.test.ts` pins the package boundary; the others are property tests over seeds, the difficulty range and the whole catalog. `balance.test.ts` is the species × species simulation that pins the balance targets in [[PRODUCT]] §4 (`SIM=1` prints every policy × accuracy × level table); `battle-sim.ts` is its scripted player. `tents.test.ts` checks `nearestTent` against its own flood fill over the tent lattice; `doctor.test.ts` covers the doctor reducer and the knock-out rule. |

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

- **Today**: `packages/client/src/authority/local.ts` — `LocalAuthority` runs the engine in-process. Its own randomness (the encounter roll after each step, a battle's seed, a doctor visit's seed) is keyed by the world seed and its count of completed steps (and of visits), never by `Math.random`; see [[INVARIANTS]] § Authority. After a battle it emits `party-changed` (the whole party, HP written back, a caught animal added), or after a lost one `taken-to-doctor` (see § Modes); after each heal at the doctor, `party-changed` again.
- **Words**: events carry what happened, and the client chooses the words for its own screens — the battle narration, everything the doctor says, the line after a lost battle. The engine's `BattleState.log`, `DoctorState.log` and `Rescue.message` are not shown. The authority still sends `message` text for battle results and for Enter away from a tent.
- **Multiplayer**: a `RemoteAuthority` with the same interface forwards intents over a WebSocket and relays the server's events. The server runs the engine against the shared world and is the source of truth. Nothing in the renderer, input or UI changes.

Two things keep that swap cheap: intents carry only what the player *chose* (a direction, an attack index, an answer string), never a computed outcome; and events describe what *happened* in enough detail to render without re-running the rules.

## `packages/client` — rendering and input

| Path                          | Holds                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`                  | A full-screen `<canvas id="game">` under a `<div id="ui">` overlay. Loads Nunito.                                                                                    |
| `src/main.ts`                 | Wires the authority's events to the views and the three controllers, sends each key to the screen that is up (battle, else the doctor's card, else explore), mounts the Svelte app, runs the `requestAnimationFrame` loop (the controllers' `update(dt)`, the message line's clock while the explore HUD is up, then `renderer.render()`). |
| `src/flags.ts`                | The URL switches, read once: `?zoo`, `?debug` (position and facing on screen), `?party=` (the starting party, e.g. `bear:10,fox`; a typo is ignored).                |
| `src/authority/local.ts`      | `LocalAuthority` (see above): moves and the facing they leave, one encounter roll per completed step (for the tier of the first animal that isn't tired), the battle in progress and the doctor visit in progress (each the engine's state plus the seed it never shows), and results written back — party HP, a caught animal (up to six), each heal, the trip to the tent after a lost battle (`takeToDoctor`). Takes an optional starting party (`?party=`). |
| `src/state/game.svelte.ts`    | `game`: the `$state` view the Svelte overlay reads (`mode`, `pos`, `facing`, `moves`, `party`, …). Filled only by `game.apply(event)`.                              |
| `src/state/hud.svelte.ts`     | `hud`: what the explore message line says — the latest thing said (a `message`, or the doctor's goodbye and knock-out line worded from their events) while fresh, and the doctor prompt or the controls hint under it. `tick(dt)` counts only while the explore HUD is up. |
| `src/state/battle.svelte.ts`  | `battle`: the battle screen's `$state` view — what the panel shows and which `screen` the keys drive (`actions`, `puzzle`, `busy`, `result`). Written only by the battle controller. |
| `src/state/doctor.svelte.ts`  | `doctor`: the doctor's card's `$state` view — the party, the doctor's line, the cursor, the puzzle and which `screen` the keys drive (`list`, `puzzle`, `busy`) — plus the cursor helpers. Written only by the doctor controller. |
| `src/input/keyboard.ts`       | Explore input: held-key tracking plus a 2-deep tap buffer; arrows/WASD → `Direction`, Enter/Space → interact. `setEnabled(false)` while the battle screen or the doctor's card is up drops held keys and taps. |
| `src/input/answer.ts`         | `answerKey(input, key)`: typing an answer (digits, a leading minus, Backspace, 7 characters, Enter only once a digit is typed). Shared by every screen that asks a puzzle. |
| `src/explore/controller.ts`   | Explore mode: turns input into `move`/`interact` intents (one per completed step), tweens the player mesh between tiles on `player-moved`, jumps it (facing unchanged) on `player-placed` and (turned to the tent) on `taken-to-doctor`, asks for chunks around it. Ignores events for other players. |
| `src/battle/controller.ts`    | Battle mode, from `battle-started` until the result card is left: keys → battle intents, and the authority's battle events played back one beat at a time (narration, HP, scene effects) before the latest state is shown. Ignores updates for any battle but the one on screen. |
| `src/doctor/controller.ts`    | The doctor's card, from `doctor-visit-started` to `doctor-visit-ended`: keys → doctor intents, and the doctor events played back as beats (the judgement, then the heal) before the latest state is shown. |
| `src/doctor/lines.ts`         | `doctorLines`: everything the doctor says — on the card, the goodbye, the line after a lost battle — in one place, chosen by event.                              |
| `src/render/renderer.ts`      | `GameRenderer`: WebGL renderer, scene, fixed orthographic camera, lights, chunk cache (5×5 chunks around the player), the player figure, `addFigure` for extra standing figures, idle animation each frame. `setBattle(scene)` draws a battle scene instead of the world. |
| `src/render/battle-scene.ts`  | `BattleScene`: one per session, dressed per battle — biome backdrop, both figures facing each other, the lens-shifted perspective camera that centres them above the panel, and the effects (lunge, shake, puff, hop, faint, the leash). `battlePanelHeight` mirrors the CSS panel height. |
| `src/render/tiles.ts`         | `buildChunkGroup(chunk)`: one `InstancedMesh` of boxes for ground, plus decoration groups (trees, rocks, tall grass, tent + fire + point light). `groundTop(tile)`: the height figures stand at. |
| `src/render/animals.ts`       | `buildAnimalMesh(speciesId)`, `buildPlayerMesh()`, `animateIdle(figure, t)`: primitive figures for every catalog species and the trainer. Contract: units are tiles, feet on `y = 0`, centred on `x`, facing `+z`; the group's one child is the rig that idles. |
| `src/render/zoo.ts`           | `buildZoo(seed, origin)`: the `?zoo` line-up, one figure per species by the spawn tile. Verification only, never on the normal path.                              |
| `src/render/palette.ts`       | Tile, decoration, trainer and species colours. Mirrors [[DESIGN]] § Palette.                                                                                        |
| `src/ui/App.svelte`           | Screen switch: loading / explore (`Hud`) / the doctor's card (`DoctorCard`, over the world) / battle (`BattlePanel`, from the moment the battle scene appears until the result card is left); the `?debug` position badge. |
| `src/ui/Hud.svelte`           | Party list with HP bars and "tired" tags, and the message line (from `hud`).                                                                                        |
| `src/ui/BattlePanel.svelte`   | The battle overlay: status boxes, narration line, action menu, puzzle area, result card. Reads `battle`; never dispatches.                                         |
| `src/ui/DoctorCard.svelte`    | The doctor's card: the doctor's line, the party list with Bye, the puzzle area (`PuzzlePanel`). Reads `doctor`; never dispatches. Its own words sit in one `words` object. |
| `src/ui/PuzzlePanel.svelte`   | One puzzle being answered: prompt, typed answer, judgement. The one puzzle view ([[UI_SPEC]] § Component reuse).                                                    |
| `src/ui/HpBar.svelte`         | The one HP bar: colour by fraction left (green, amber under half, red under a fifth), always with `hp/max` printed.                                                  |
| `src/styles.css`              | CSS custom properties (panel colours, radius, font, `--battle-panel`, `--doctor-panel`) and the canvas/overlay layout.                                              |
| `public/assets/`              | Models, textures, sounds. `CREDITS.md` lists every third-party file.                                                                                                |
| `test/animals.test.ts`        | vitest: every catalog species builds a figure that keeps the contract in `animals.ts` (geometry construction needs no WebGL).                                        |
| `test/local-authority.test.ts`| vitest: the authority's rules around the engine — encounters replay per step, battles start only on encounter tiles, the lead decides who comes out, outcomes write back, the party caps at six, the trip to the tent after a lost battle, the facing it keeps, the doctor visit (walking waits, heals write back, a fresh seed per visit that never leaves it). |
| `test/battle-controller.test.ts` | vitest: the battle screen driven by keys against the real authority — held keys, empty answers, mashed Enter, stale events. The scene is built, never drawn.     |
| `test/doctor-controller.test.ts` | vitest: the doctor's card driven by keys against the real authority — the cursor skipping fit animals, a miss, a heal, swapping patients mid-puzzle, Escape at any time, the opening guard, held keys and keys during a beat. |
| `test/hud.test.ts`            | vitest: the message line — a line fades after 5 s of explore time and waits while the HUD is off screen, the controls hint, the doctor prompt, the doctor's lines worded from events. |
| `test/flags.test.ts`          | vitest: the URL switches, and that a misspelt `?party=` is ignored as a whole.                                                                                      |
| `test/css-vars.test.ts`       | vitest: every `var(--x)` in the UI's `.svelte` and `.css` files is defined (an undefined one fails nowhere else). `vitest.config.ts` lets tests read CSS as text.  |

### Coordinate system

Engine grid `(x, y)` maps to Three `(x, height, z)` with `z = y`; grid "down" is screen-down because the camera's yaw is fixed. Tiles are unit cubes centred on integer coordinates; the ground top is at `y = 0.5 + 0.25·height` for land and lower for water (`groundTop` in `tiles.ts`). Figures stand with their feet on that top face; the player hops 0.15 during a step. A figure faces `+z` (grid "down", toward the camera) at `rotation.y = 0`; `up` is `π`, `right` is `π/2`, `left` is `-π/2`.

### Modes

Two modes, one on screen at a time. `battle-started` hands the screen to the battle controller: explore input is switched off, the world keeps drawing for a moment so the step into the grass lands, then the battle scene and panel replace it. The authority resolves each battle intent at once; the controller plays the events back as beats and only then shows the new state, so the screen lags the authority on purpose. `battle-ended` puts the authority back in explore at once, but the screen stays on the result card until the player leaves it; only then does explore input come back. Walking during a battle and battle intents outside one are ignored by the authority.

The doctor is not a mode: a dialogue card over explore, driven by `doctor-visit-started` / `-updated` / `-ended` (the doctor controller plays each update back as beats, like the battle screen). The world keeps drawing under it; explore input is off while it is open, and the authority ignores walking during a visit and doctor intents outside one. The authority opens a visit on `interact` when `canTalkToDoctor(seed, pos, facing)` holds, so it tracks the facing the client shows: `down` from `welcome` (both sides reset it there, so a second `welcome` keeps them agreeing), then the `dir` of every `move`, walked or blocked, and the `dir` of `taken-to-doctor`. The client computes the "Press Enter to talk to the doctor" prompt with the same engine function from the same events. After a lost battle the authority emits `battle-ended` and then `taken-to-doctor`, which puts the player beside the tent without a tween, turns them to it and replaces the party; the battle screen's result card waits on top meanwhile. `player-placed` (a move without a tween that keeps the facing) is in the protocol, but nothing sends it today. See [[UI_SPEC]].

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
