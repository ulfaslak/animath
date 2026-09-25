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
| `src/animals/types.ts`            | `AnimalSpec`, `AttackSpec`, `AnimalInstance`, `Tier`, `Biome`.                                                                                                 |
| `src/animals/catalog.ts`          | `ANIMALS`, `getAnimal`. The species roster with attacks, powers, habitats.                                                                                    |
| `src/battle/damage.ts`            | `attackDamage`.                                                                                                                                                |
| `src/battle/catch.ts`             | `catchProbability`.                                                                                                                                            |
| `src/battle/types.ts`             | `BattleState`, `BattlePhase`, `BattleIntent`, `BattleEvent`, `BattleOutcome`, `BattleStep`.                                                                     |
| `src/battle/reducer.ts`           | `startBattle(party, wild, options?)`, `applyBattleIntent(state, intent, seed) → { state, events }`, `activeAnimal`. The whole wild-battle loop; pure. The seed is the authority's, never in the state. |
| `src/world/types.ts`              | `Tile`, `TileKind`, `Chunk`, `GridPos`, `Direction`, `CHUNK_SIZE`, `isWalkable`, `isEncounterTile`, `step`.                                                     |
| `src/world/generate.ts`           | `generateChunk(seed, cx, cy)`, `tileAtWorld`, `spawnPoint`. Value-noise elevation + moisture → biome → tile kind; tents on a sparse lattice.                    |
| `src/world/encounters.ts`         | `rollEncounter(rng, site)`, `encounterTable(biome, distance)`, `distanceFromSpawn`, the radius and chance constants. Biome tables come from the catalog's habitats. |
| `src/protocol.ts`                 | `Intent`, `GameEvent`, `Authority` — the client ↔ authority contract.                                                                                          |
| `src/index.ts`                    | The public surface. Everything the client or server uses is re-exported here.                                                                                  |
| `test/*.test.ts`                  | vitest. `purity.test.ts` pins the package boundary; the others are property tests over seeds, the difficulty range and the whole catalog. `balance.test.ts` is the species × species simulation (`SIM=1` prints the tables); `battle-sim.ts` is its scripted player. |

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

- **Today**: `packages/client/src/authority/local.ts` — `LocalAuthority` runs the engine in-process. Its own randomness (the encounter roll after each step, a battle's seed) is keyed by the world seed and its count of completed steps, never by `Math.random`; see [[INVARIANTS]] § Authority. Besides the battle events it emits `party-changed` (the whole party, after a battle) and `player-placed` (put on a tile without walking: the lost-battle rest today, a doctor's tent later).
- **Multiplayer**: a `RemoteAuthority` with the same interface forwards intents over a WebSocket and relays the server's events. The server runs the engine against the shared world and is the source of truth. Nothing in the renderer, input or UI changes.

Two things keep that swap cheap: intents carry only what the player *chose* (a direction, an attack index, an answer string), never a computed outcome; and events describe what *happened* in enough detail to render without re-running the rules.

## `packages/client` — rendering and input

| Path                          | Holds                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`                  | A full-screen `<canvas id="game">` under a `<div id="ui">` overlay. Loads Nunito.                                                                                    |
| `src/main.ts`                 | Wires the authority's events to the game view and both mode controllers, sends each key to the mode on screen, mounts the Svelte app, runs the `requestAnimationFrame` loop (the explore or battle controller's `update(dt)`, then `renderer.render()`). |
| `src/authority/local.ts`      | `LocalAuthority` (see above): moves, one encounter roll per completed step, the battle in progress (the engine's state plus the seed it never shows), and the result written back — party HP, a caught animal (up to six), the lost-battle rest. |
| `src/state/game.svelte.ts`    | `game`: the `$state` view the Svelte overlay reads (`mode`, `pos`, `party`, `message`, …). Filled only by `game.apply(event)`.                                      |
| `src/state/battle.svelte.ts`  | `battle`: the battle screen's `$state` view — what the panel shows and which `screen` the keys drive (`actions`, `puzzle`, `busy`, `result`). Written only by the battle controller. |
| `src/input/keyboard.ts`       | Explore input: held-key tracking plus a 2-deep tap buffer; arrows/WASD → `Direction`, Enter/Space → interact. `setEnabled(false)` while the battle screen is up drops held keys and taps. |
| `src/input/answer.ts`         | `answerKey(input, key)`: typing an answer (digits, a leading minus, Backspace, 7 characters, Enter only once a digit is typed). Shared by every screen that asks a puzzle. |
| `src/explore/controller.ts`   | Explore mode: turns input into `move`/`interact` intents (one per completed step), tweens the player mesh between tiles on `player-moved`, jumps it on `player-placed`, asks for chunks around it. |
| `src/battle/controller.ts`    | Battle mode, from `battle-started` until the result card is left: keys → battle intents, and the authority's battle events played back one beat at a time (narration, HP, scene effects) before the latest state is shown. Ignores updates for any battle but the one on screen. |
| `src/render/renderer.ts`      | `GameRenderer`: WebGL renderer, scene, fixed orthographic camera, lights, chunk cache (5×5 chunks around the player), the player figure, `addFigure` for extra standing figures, idle animation each frame. `setBattle(scene)` draws a battle scene instead of the world. |
| `src/render/battle-scene.ts`  | `BattleScene`: one per session, dressed per battle — biome backdrop, both figures facing each other, the lens-shifted perspective camera that centres them above the panel, and the effects (lunge, shake, puff, hop, faint, the leash). `battlePanelHeight` mirrors the CSS panel height. |
| `src/render/tiles.ts`         | `buildChunkGroup(chunk)`: one `InstancedMesh` of boxes for ground, plus decoration groups (trees, rocks, tall grass, tent + fire + point light). `groundTop(tile)`: the height figures stand at. |
| `src/render/animals.ts`       | `buildAnimalMesh(speciesId)`, `buildPlayerMesh()`, `animateIdle(figure, t)`: primitive figures for every catalog species and the trainer. Contract: units are tiles, feet on `y = 0`, centred on `x`, facing `+z`; the group's one child is the rig that idles. |
| `src/render/zoo.ts`           | `buildZoo(seed, origin)`: the `?zoo` line-up, one figure per species by the spawn tile. Verification only, never on the normal path.                              |
| `src/render/palette.ts`       | Tile, decoration, trainer and species colours. Mirrors [[DESIGN]] § Palette.                                                                                        |
| `src/ui/App.svelte`           | Mode switch: loading / explore (`Hud`) / battle (`BattlePanel`, from the moment the battle scene appears until the result card is left).                           |
| `src/ui/Hud.svelte`           | Party list with HP bars and "tired" tags, bottom hint line.                                                                                                         |
| `src/ui/BattlePanel.svelte`   | The battle overlay: status boxes, narration line, action menu, puzzle area, result card. Reads `battle`; never dispatches.                                         |
| `src/ui/PuzzlePanel.svelte`   | One puzzle being answered: prompt, typed answer, judgement. The one puzzle view ([[UI_SPEC]] § Component reuse).                                                    |
| `src/ui/HpBar.svelte`         | The one HP bar: colour by fraction left (green, amber under half, red under a fifth), always with `hp/max` printed.                                                  |
| `src/styles.css`              | CSS custom properties (panel colours, radius, font, `--battle-panel`) and the canvas/overlay layout.                                                                |
| `public/assets/`              | Models, textures, sounds. `CREDITS.md` lists every third-party file.                                                                                                |
| `test/animals.test.ts`        | vitest: every catalog species builds a figure that keeps the contract in `animals.ts` (geometry construction needs no WebGL).                                        |
| `test/local-authority.test.ts`| vitest: the authority's rules around the engine — encounters replay per step, battles start only on encounter tiles, outcomes write back, the party caps at six, the lost-battle rest. |
| `test/battle-controller.test.ts` | vitest: the battle screen driven by keys against the real authority — held keys, empty answers, mashed Enter, stale events. The scene is built, never drawn.     |

### Coordinate system

Engine grid `(x, y)` maps to Three `(x, height, z)` with `z = y`; grid "down" is screen-down because the camera's yaw is fixed. Tiles are unit cubes centred on integer coordinates; the ground top is at `y = 0.5 + 0.25·height` for land and lower for water (`groundTop` in `tiles.ts`). Figures stand with their feet on that top face; the player hops 0.15 during a step. A figure faces `+z` (grid "down", toward the camera) at `rotation.y = 0`; `up` is `π`, `right` is `π/2`, `left` is `-π/2`.

### Modes

Two modes, one on screen at a time. `battle-started` hands the screen to the battle controller: explore input is switched off, the world keeps drawing for a moment so the step into the grass lands, then the battle scene and panel replace it. The authority resolves each battle intent at once; the controller plays the events back as beats and only then shows the new state, so the screen lags the authority on purpose. `battle-ended` puts the authority back in explore at once, but the screen stays on the result card until the player leaves it; only then does explore input come back. Walking during a battle and battle intents outside one are ignored by the authority. See [[UI_SPEC]].

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
