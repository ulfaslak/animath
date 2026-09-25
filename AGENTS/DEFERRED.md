# Deferred

Technical items we've intentionally postponed: tech debt, hardening shortcuts, known limitations, and cleanup tasks cheaper to do later. Each entry must have **What**, **Why deferred**, and a concrete **Trigger**.

**Not for features.** Features and product work go in GitHub Issues, not here. If you're adding a user-facing capability, create an issue instead. See CLAUDE.md §"Deferred work" for the full scope rule.

---

### Server runs TypeScript through `tsx` in every environment

**What**: `packages/server` has no bundling step; `pnpm start` is `tsx src/index.ts`. Fine locally. For a VPS deploy the image should ship compiled JS (or a single esbuild bundle) so startup doesn't depend on a dev-time transpiler.

**Why deferred**: there is no deploy yet, and the server is a health endpoint and a migration script. Bundling now is config with nothing to protect.

**Trigger**: the first deploy to the Hetzner VPS (the Dockerfile PR).

### Battle-state types exist without a reducer

**What**: `packages/engine/src/battle/types.ts` defines `BattleState`, `BattlePhase` and `BattleIntent`, and `protocol.ts` carries battle events, but nothing in the engine advances a battle yet — `LocalAuthority` drops `battle` intents. The types are there so the client and server can be written against a stable shape.

**Why deferred**: the battle reducer is the first real gameplay issue, not part of repo setup; designing it inside the setup PR would have meant guessing at UI needs.

**Trigger**: the battle-mode issue. Delete this entry when `applyBattleIntent` lands with tests.

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
