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

**Trigger**: the `RemoteAuthority` / server-side battle PR. Redact `answer` from what goes over the wire there, and decide whether `answer-judged` keeps reporting it after the fact (harmless: the puzzle is spent; the battle screen never shows it).

### A battle's result is written back by the client's authority, not the engine

**What**: when a battle ends, `LocalAuthority.endBattle` decides what it means for the world: the party takes the battle's HP, a caught animal joins if there is room (the cap is the engine's `MAX_PARTY`, but the let-it-go decision is in the authority), a lost battle rests everyone at the spawn tile, and the closing line is chosen. A server authority would have to repeat all of it, and the two copies could drift.

**Why deferred**: there is one authority today, the brief for this work put the outcomes there, and the lost branch is a placeholder the doctor's client work replaces with the engine's `takeToDoctor`.

**Trigger**: the `RemoteAuthority` / server-side battle PR, or earlier if a second outcome rule lands. Move the write-back into an engine function (`concludeBattle(party, endedState) → { party, message }`, beside `takeToDoctor`) and call it from both authorities.

### Anonymous player identity is unauthenticated

**What**: the player secret is a random token the client holds in `localStorage` (`animath.player`) and sends as a bearer header. Only its hash is stored, so a database dump is useless, but anyone who copies the token from the browser owns the player and its backup. No rate limiting on `POST /api/players`: anyone can mint rows, and the game itself leaves unused ones behind (every screenshot run is a new player; a page reloaded before its first `POST` answered makes another). No rotation, and no way to recover a lost secret: a kid whose browser forgets the site (cleared data, another browser or device, Safari deleting a site's storage after seven days without a visit) starts a new game, and their backup waits on the server under an identity nothing holds any more. Only by hand ([[DEVELOPMENT]] § Database) can it be moved to their new player.

**Why deferred**: there is nothing to steal until multiplayer, tokens and a shop exist, and the players are a handful of kids on a tunnel URL. Moving a game between browsers is a feature (a recovery code, or accounts), not a hardening.

**Trigger**: multiplayer with any persistent economy (tokens, purchasable leashes/potions), the first public deploy (rate limiting, and sweeping players with no save), or the first report of a kid losing their save.

### The server stores whatever save the client sends

**What**: `PUT /api/players/:id/save` checks the document's shape, not that the game in it could have happened: an HP above the species' maximum (`restoreGame` cuts it on load), a party of any animals, a position anywhere, a `battle` the server never looks inside (the client checks it with `readBattle` on load). A modified client, or a hand-edited `localStorage` save, is backed up as sent. The saved battle also carries the puzzle's answer, as `BattleState` does ([[CHEATSHEET]] § Exploits).

**Why deferred**: the save is the single-player authority's state, and that authority is the client; the server has nothing to check it against until it runs the game itself.

**Trigger**: the `RemoteAuthority` / server-side battle PR, or anything that makes one player's save matter to another (trading, PvP, a leaderboard). Then the server keeps the state and the client stops sending saves.

### A saved position assumes today's world generator

**What**: a save holds a tile position and a step count, both meaningful only in the world `generateChunk` makes today. A change to world generation that moves tiles under an existing seed can leave a saved player on water or a tree (`restoreGame` then puts them on the spawn tile, far from where they were) or walled in on a patch of walkable tiles, which `restoreGame` does not detect.

**Why deferred**: the generator has not changed since the first save, and the right fix depends on the change: keep old seeds on the old generator, or bump `SAVE_VERSION` with an upgrade that moves saved players to a safe tile near where they were (the knock-out rule's `nearestTent` search is the model).

**Trigger**: any PR that changes what `generateChunk` returns for an existing seed (procedural world v2 in [[PRODUCT]] §6 is one).

### `nearestTent` is a synchronous flood fill that costs up to a few hundred milliseconds

**What**: `nearestTent` (used by `takeToDoctor` after every lost battle) visits about 2·s² tiles for a tent s steps away and generates each one with `tileAtWorld`. Measured over 2,400 walkable starts on 6 seeds: median 10 ms, p99 72 ms, max 180 ms. An adversarial review found 275 ms over 400 seeds. A search that ran all the way to `TENT_SEARCH_STEPS` on open ground would cost several times that, though none has been found. In `LocalAuthority` the search blocks the render thread for that long; in a server authority it would block the event loop for every connection.

**Why deferred**: it runs once per lost battle, while a result card is on screen, and there is no server authority yet. Faster options change the algorithm (visit the tent lattice in order of distance and path-check each candidate, or cap by tiles visited), which is worth doing when there is a second caller or a real report.

**Trigger**: the server-side authority PR, a second caller of `nearestTent` on a per-step path (a "nearest doctor" hint), or a report of a pause after losing a battle.
