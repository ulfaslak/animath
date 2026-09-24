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

**What**: `players.secret` is a random string the client will hold in `localStorage` and present on connect. Anyone who copies it owns the player. No rate limiting, no rotation, no way to recover a lost secret.

**Why deferred**: there is nothing to steal until multiplayer, tokens and a shop exist, and the players are a handful of kids on a tunnel URL.

**Trigger**: multiplayer with any persistent economy (tokens, purchasable leashes/potions), or the first report of a kid losing their save.
