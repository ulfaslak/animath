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
| `src/battle/reducer.ts`           | `startBattle(party, wild, options?)`, `applyBattleIntent(state, intent, seed) → { state, events }`, `activeAnimal`. The whole wild-battle loop; pure. The seed is the authority's, never in the state. The wild animal's miss chance is `WILD_MISS_CHANCE`, exported for tests and not re-exported from `index.ts`. |
| `src/world/types.ts`              | `Tile`, `TileKind`, `Chunk`, `GridPos`, `Direction`, `CHUNK_SIZE`, `isWalkable`, `isEncounterTile`, `step`.                                                     |
| `src/world/generate.ts`           | `generateChunk(seed, cx, cy)`, `tileAtWorld`, `spawnPoint`. Value-noise elevation + moisture → biome → tile kind; tents on a sparse lattice.                    |
| `src/world/encounters.ts`         | `rollEncounter(rng, site)`, `encounterTable(biome, distance)`, `distanceFromSpawn`, the radius and chance constants. Biome tables come from the catalog's habitats, plus tier-1 visitors near spawn where a biome has no tier-1 resident. |
| `src/protocol.ts`                 | `Intent`, `GameEvent`, `Authority` — the client ↔ authority contract.                                                                                          |
| `src/index.ts`                    | The public surface. Everything the client or server uses is re-exported here.                                                                                  |
| `test/*.test.ts`                  | vitest. `purity.test.ts` pins the package boundary; the others are property tests over seeds, the difficulty range and the whole catalog. `balance.test.ts` is the species × species simulation that pins the balance targets in [[PRODUCT]] §4 (`SIM=1` prints every policy × accuracy × level table); `battle-sim.ts` is its scripted player. |

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

- **Today**: `packages/client/src/authority/local.ts` — `LocalAuthority` runs the engine in-process.
- **Multiplayer**: a `RemoteAuthority` with the same interface forwards intents over a WebSocket and relays the server's events. The server runs the engine against the shared world and is the source of truth. Nothing in the renderer, input or UI changes.

Two things keep that swap cheap: intents carry only what the player *chose* (a direction, an attack index, an answer string), never a computed outcome; and events describe what *happened* in enough detail to render without re-running the rules.

## `packages/client` — rendering and input

| Path                          | Holds                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`                  | A full-screen `<canvas id="game">` under a `<div id="ui">` overlay. Loads Nunito.                                                                                    |
| `src/main.ts`                 | Wires authority → game view + explore controller, mounts the Svelte app, runs the `requestAnimationFrame` loop (`explore.update(dt)`, `renderer.render()`).        |
| `src/authority/local.ts`      | `LocalAuthority` (see above).                                                                                                                                       |
| `src/state/game.svelte.ts`    | `game`: the `$state` view the Svelte overlay reads. Filled only by `game.apply(event)`.                                                                             |
| `src/input/keyboard.ts`       | Held-key tracking plus a 2-deep tap buffer; arrows/WASD → `Direction`, Enter/Space → interact.                                                                      |
| `src/explore/controller.ts`   | Explore mode: turns input into `move`/`interact` intents (one per completed step), tweens the player mesh between tiles on `player-moved`, asks for chunks around it. |
| `src/render/renderer.ts`      | `GameRenderer`: WebGL renderer, scene, fixed orthographic camera, lights, chunk cache (5×5 chunks around the player), the player figure, `addFigure` for extra standing figures, idle animation each frame. |
| `src/render/tiles.ts`         | `buildChunkGroup(chunk)`: one `InstancedMesh` of boxes for ground, plus decoration groups (trees, rocks, tall grass, tent + fire + point light). `groundTop(tile)`: the height figures stand at. |
| `src/render/animals.ts`       | `buildAnimalMesh(speciesId)`, `buildPlayerMesh()`, `animateIdle(figure, t)`: primitive figures for every catalog species and the trainer. Contract: units are tiles, feet on `y = 0`, centred on `x`, facing `+z`; the group's one child is the rig that idles. |
| `src/render/zoo.ts`           | `buildZoo(seed, origin)`: the `?zoo` line-up, one figure per species by the spawn tile. Verification only, never on the normal path.                              |
| `src/render/palette.ts`       | Tile, decoration, trainer and species colours. Mirrors [[DESIGN]] § Palette.                                                                                        |
| `src/ui/App.svelte`           | Mode switch: loading / explore (`Hud`) / battle (panel to come).                                                                                                    |
| `src/ui/Hud.svelte`           | Party list with HP bars, bottom hint line.                                                                                                                          |
| `src/styles.css`              | CSS custom properties (panel colours, radius, font) and the canvas/overlay layout.                                                                                   |
| `public/assets/`              | Models, textures, sounds. `CREDITS.md` lists every third-party file.                                                                                                |
| `test/animals.test.ts`        | vitest: every catalog species builds a figure that keeps the contract in `animals.ts` (geometry construction needs no WebGL).                                        |

### Coordinate system

Engine grid `(x, y)` maps to Three `(x, height, z)` with `z = y`; grid "down" is screen-down because the camera's yaw is fixed. Tiles are unit cubes centred on integer coordinates; the ground top is at `y = 0.5 + 0.25·height` for land and lower for water (`groundTop` in `tiles.ts`). Figures stand with their feet on that top face; the player hops 0.15 during a step. A figure faces `+z` (grid "down", toward the camera) at `rotation.y = 0`; `up` is `π`, `right` is `π/2`, `left` is `-π/2`.

### Modes

Explore is implemented. Battle mode will be a second controller + a second scene (own camera, two figures from `animals.ts`, back and front view) and a Svelte panel; the mode switch is driven by `battle-started` / `battle-ended` events. See [[UI_SPEC]].

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

- `scripts/screenshot.mjs` — headless Chrome screenshot of the running game (`playwright-core`, `channel: 'chrome'`). The visual verification tool; see `/play`.
- `docker-compose.yml` — local Postgres only.
- `.gtrconfig` — worktree creation copies `.env` and runs `pnpm install`.
- `AGENTS/` — persistent context (this file's siblings). `AGENTS/DNA/` is the guardrail set; the rest is record-keeping.
