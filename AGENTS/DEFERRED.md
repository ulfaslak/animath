# Deferred

Technical items we've intentionally postponed: tech debt, hardening shortcuts, known limitations, and cleanup tasks cheaper to do later. Each entry must have **What**, **Why deferred**, and a concrete **Trigger**.

**Not for features.** Features and product work go in GitHub Issues, not here. If you're adding a user-facing capability, create an issue instead. See CLAUDE.md §"Deferred work" for the full scope rule.

---

### Server runs TypeScript through `tsx` in every environment

**What**: `packages/server` has no bundling step; `pnpm start` is `tsx src/index.ts`. Fine locally. For a VPS deploy the image should ship compiled JS (or a single esbuild bundle) so startup doesn't depend on a dev-time transpiler.

**Why deferred**: there is no deploy yet, and the server is a health endpoint and a migration script. Bundling now is config with nothing to protect.

**Trigger**: the first deploy to the Hetzner VPS (the Dockerfile PR).

### The puzzle's answer travels to the client inside `BattleState` and `DoctorState`

**What**: `BattlePhase` (`solving`) and the `puzzle-shown` event carry the whole `Puzzle`, `answer` included, and `answer-judged` repeats it. The doctor reducer copies the shape: `DoctorPhase` (`solving`) and its `puzzle-shown` carry the answer too. With `LocalAuthority` that is harmless — the client already runs the engine. With a server authority, a modified client could read the answer and never miss (or heal for free).

**Why deferred**: there is no server authority yet, and stripping the answer means a second `Puzzle` shape (or a redacting step in the protocol) for a cheat nobody can attempt today.

**Trigger**: the `RemoteAuthority` / server-side battle PR. Redact `answer` from what goes over the wire there (`BattlePhase.solving` and `puzzle-shown`). Keep it in `answer-judged`: the battle screen shows it after a wrong answer ("Not quite! It was 12."), and by then the puzzle is spent.

### The authority's step counter is not saved

**What**: `LocalAuthority` keys every encounter roll and battle seed by its count of completed steps (see [[INVARIANTS]] § Authority), and the count starts at 0 on every page load. Without saves that is harmless — a reload puts everything back to the start. With saves, a reloaded player at a saved position would replay the encounters of steps 1, 2, 3… again, and a kid could learn that the 11th step after a reload always meets the same animal.

**Why deferred**: nothing is saved yet; the counter is one number that belongs in the save envelope beside `pos` and `party`.

**Trigger**: the client save/load PR. Save the step count with the position and restore it on load (an extra field in `SaveV1` needs no server change).

### Anonymous player identity is unauthenticated

**What**: the player secret is a random token the client will hold in `localStorage` and send as a bearer header. Only its hash is stored, so a database dump is useless, but anyone who copies the token from the browser owns the player. No rate limiting on `POST /api/players` (anyone can mint rows), no rotation, no way to recover a lost secret.

**Why deferred**: there is nothing to steal until multiplayer, tokens and a shop exist, and the players are a handful of kids on a tunnel URL.

**Trigger**: multiplayer with any persistent economy (tokens, purchasable leashes/potions), the first public deploy (rate limiting), or the first report of a kid losing their save.

### The save envelope type lives only in the server

**What**: `SaveV1` and its validator are in `packages/server/src/save.ts`. The client will need the same shape to write saves, and client and server may not import each other, so the client would have to redeclare it. The natural shared home is the engine (`protocol.ts` already carries the identical `welcome` payload: `seed`, `pos`, `party`).

**Why deferred**: the server PR could not touch the engine while other engine work was in flight; a redeclared type is a small, visible duplication.

**Trigger**: the client save/load PR. Move the type (not the validator) to the engine and import it from both sides.

### Saves have no stale-write guard

**What**: `PUT /api/players/:id/save` is an unconditional upsert: the last request to arrive wins. A retried request that lands after a newer save, or two tabs holding the same id + secret and autosaving on a timer, roll the persisted save back to an older document — a caught animal vanishes. `SaveV1` carries no sequence number or client timestamp to order writes by.

**Why deferred**: nothing writes saves yet, and the guard is half a protocol (the client must send a counter and handle a 409 by reloading) that should be designed with the client's autosave in hand, not guessed at from the server side. Adding an optional field later is not a `version` bump: unknown fields are already accepted.

**Trigger**: the client save/load PR. Add a monotonically increasing `seq` (or `savedAt`) to `SaveV1`, make the upsert conditional on it, and answer `409` when the stored document is newer.

### `nearestTent` is a synchronous flood fill that costs up to a few hundred milliseconds

**What**: `nearestTent` (used by `takeToDoctor` after every lost battle) visits about 2·s² tiles for a tent s steps away and generates each one with `tileAtWorld`. Measured over 2,400 walkable starts on 6 seeds: median 10 ms, p99 72 ms, max 180 ms. An adversarial review found 275 ms over 400 seeds. A search that ran all the way to `TENT_SEARCH_STEPS` on open ground would cost several times that, though none has been found. In `LocalAuthority` the search blocks the render thread for that long; in a server authority it would block the event loop for every connection.

**Why deferred**: it runs once per lost battle, while a result card is on screen, and there is no server authority yet. Faster options change the algorithm (visit the tent lattice in order of distance and path-check each candidate, or cap by tiles visited), which is worth doing when there is a second caller or a real report.

**Trigger**: the server-side authority PR, a second caller of `nearestTent` on a per-step path (a "nearest doctor" hint), or a report of a pause after losing a battle.
