# Decisions

Flat lookup of rulings, organized by domain. No justifications — just decisions.

## Language & tooling

TypeScript everywhere, strict, ES2022, `verbatimModuleSyntax`.
pnpm workspace with three packages: `@mathgame/engine`, `@mathgame/client`, `@mathgame/server`. Root scripts fan out with `pnpm -r`.
Node 26, pnpm 12. Dependency build scripts need approval in `pnpm-workspace.yaml` (`allowBuilds`).
Prettier with tabs, single quotes, no trailing commas, print width 100. Markdown is not formatted.
vitest for tests, `tsc --noEmit` / `svelte-check` for type checks.
No React, ever. No SvelteKit either: the client is a plain Vite app.

## Engine

The engine is a **pure TypeScript package with zero dependencies** and no access to the DOM, Three.js, Node or the network. `lib: ["ES2022"]` in its tsconfig enforces it at compile time; a test enforces it at runtime.
All randomness comes from a seeded `Rng` passed in by the caller. `Math.random` and `Date.now` are banned in the engine.
The world is a pure function of `(seed, chunkX, chunkY)`; per-tile randomness is keyed by coordinates via `hashInts`, never by call order.
Instance ids (`AnimalInstance.id`) are minted by the authority, never by the engine. An engine function that creates an animal returns it without an id (`WildAnimal`).
Grid world, 16×16 chunks, four-direction movement, screen-space `y` grows downward.
Puzzle answers are whole numbers only. Prompts are plain strings until a kind needs more.
Difficulty is an integer 1..10. Every puzzle generator declares the range it supports.
Gameplay formulas (damage, catch probability, difficulty mapping) live in the engine and nowhere else; [[PRODUCT]] §4 states them in prose and the two must agree.
Game state changes only through **intents** validated by an **authority** that emits **events** (`protocol.ts`). The client UI and renderer are consumers of events, never mutators of state.

## Client

Three.js (WebGL) for rendering. Flat-shaded low-poly meshes, one directional light with shadows, hemisphere fill.
Fixed orthographic camera: pitch 50°, yaw 35°, 14 tiles of viewport height. No zoom, no rotation, no perspective changes in explore mode. Battle mode uses its own fixed camera.
Svelte 5 (runes) for the DOM overlay only — HUD, menus, the puzzle panel. Svelte reads game state from a `$state` view that is filled from authority events; components never dispatch to the engine directly, they go through the authority.
Placeholder geometry (boxes, cones) is acceptable until real models arrive. Real models are glTF.
Ground tiles render as one `InstancedMesh` per chunk.
Font: Nunito (Google Fonts). Rounded, friendly.
Sound is synthesized while the game runs, with WebAudio, from cue data in `src/audio/`: no sound files, no audio library. Cues play from the screens (controllers, the HUD), where events become visuals; the authority and the engine know nothing of sound.
Dev server on port **5180** (5173 belongs to another project on this machine).

## Copy and languages

All player-facing copy lives in per-language YAML files, `packages/client/src/copy/<code>.yaml`. Code refers to copy by key (`t('puzzle.keys')`) and holds no player-facing words, in TypeScript or in a Svelte template.
The game speaks English (`en`) and Danish (`da`). English is the fallback, so every key exists in English. The player switches language in the pause menu; the choice is remembered on the device.
Adding a language is adding a file and one registry line.
YAML is parsed at build time. The browser gets plain objects and ships no YAML parser.
The engine is language-free: species and attacks have ids, not names; events and refusals are codes; a line an authority sends is a copy key with numbers and species by id, never a string. The client picks the words.
Words are picked when they are shown, from the language on screen. State and events carry keys and params, never finished sentences, so changing the language re-words everything at once, without a reload.
A species' names, articles included, are written out per language as forms (`name`, `a`, `the`, `wild`, `aWild`, `theWild`), never built from rules: Danish articles and adjectives follow the noun's gender.

## Assets

Only CC0 or attribution-licensed assets. Candidate sources: Kenney, Quaternius, Poly Pizza — verify the license on each download.
Every third-party file is listed in `packages/client/public/assets/CREDITS.md` before it is added.
No generated-by-AI art claims without checking the generator's license terms.

## Server

Node with Hono (`@hono/node-server`). Serves the built client in production; Vite proxies `/api` and `/ws` to it in development.
WebSockets via `ws` when multiplayer arrives. The server will run the same engine and be authoritative for anything persisted or shared.
Postgres via Drizzle ORM (`node-postgres` driver). Local Postgres in Docker on host port **5433**.
Migrations are hand-written SQL in `packages/server/drizzle/`, idempotent (`IF NOT EXISTS`), with a matching `_journal.json` entry. `drizzle-kit generate` is not used.
Player identity is anonymous: a `players` row with a client-held secret. Accounts, if ever, attach to it.
Env from a repo-root `.env` loaded with `process.loadEnvFile`; no dotenv package.

## Saves

The save is local first, because the human asked for it: "need to persist state in localstorage so reloads are safe and users can come back to their game later and continue playing". The whole game lives in the browser's `localStorage` and is rewritten after every change (a step, a battle turn, a catch), so the game is persistent with no server at all.
The server holds a backup of each player's save, sent in the background. The game never waits for it, except at start in a browser that has an identity but no readable save of its own, and then only briefly.
A reload never loses progress: a battle in progress is saved too, and a reload picks it up where it was, mid-puzzle included.
One document shape for both copies, `SaveV1`, defined and checked in the engine. A new field is optional and needs no version bump; `version` goes up only when an old document becomes unreadable, with an upgrade that reads it.
A page never writes over a save it has not seen. Several tabs share one `localStorage`: before each write a page checks that the stored save is the one it last read or wrote, carries on from another tab's save only when that tab merely walked, and otherwise stops saving and reloads into the newer game.
The server takes a backup only with a higher `seq` than the one it holds (`409` otherwise), and keeps any save it replaces with a different game, or cannot read, in `save_backups`.
A save the game cannot read is set aside, never deleted: in `animath.save.unreadable` once the kid has played the new game, on the server in `save_backups`.
There is no way in the game to delete a save. New game on the title puts the saved game away, never deletes it: in the browser under `animath.save.previous`, on the server in `save_backups`; the game has no way back to it, only the human does. `?new`, `?party=` and `?zoo` play a throwaway game that reads and writes nothing and skips the title. Clearing the site's data is the only ordinary way to lose one.
A new game starts with a starter the player picks, and only a tier-1 species is a starter (the engine's rule, asked by the authority's `new-game` intent). Continue hands the authority the save the client holds (`start({ game })`); a server authority would take a `continue` intent instead.
Per-device preferences (the language) have their own `localStorage` keys and are never part of the save.

## Development

All implementation work happens in a git worktree via `git gtr new`, never on `main`.
GitHub Issues (repo `ulfaslak/mathgame`) is the tracker. PRs merge with `--merge`.
Rendering changes are verified by reading a screenshot from `scripts/screenshot.mjs`; engine changes by vitest; balance changes by a property test over the whole catalog.

## Deployment

Not yet. When it comes: Docker Compose on the existing Hetzner VPS behind nginx, Postgres in the same compose, same shape as lawcel. Until then the game is shared from this machine through a tunnel (ngrok or cloudflared) with `TUNNEL=1 pnpm dev:client`.
No third-party backend services (no Convex, Supabase, Firebase). Postgres and a Node process are the whole stack.
