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

### `reorder` names an absolute slot, which a remote authority's latency can turn stale

**What**: the `reorder` party intent carries the slot to move to (`to`), which the pause menu computes from the party it last saw. With the in-process `LocalAuthority` every `party-edited` arrives before the next key, so that view is never stale. Over a network, a kid pressing "Move up" twice before the first answer returns sends the same `to` twice: the second is refused (`already-there`) and the press is lost. `select-lead` and `rename` name the animal, not a slot, and are unaffected.

**Why deferred**: there is no remote authority, and a relative move (`{ by: -1 }`) is a protocol change best made when the latency is real and can be tried.

**Trigger**: the `RemoteAuthority` / WebSocket PR.

### `normalizeNickname` follows the host's Unicode tables, and keeps accents for listed scripts only

**What**: two limits of the nickname cleaner.
- **Host tables.** It uses `\p{L}`, `\p{M}`, `\p{Script=…}`, `\p{Script_Extensions=…}`, `\p{Default_Ignorable_Code_Point}` and `normalize('NFKC')`, whose answers come from the JavaScript engine's Unicode version. A letter added in a recent Unicode version is kept by a newer Node and dropped (as unassigned) by an older browser, and Script_Extensions data changes more often still. So two engines can clean the same typed name differently. That is harmless while the authority is the only one that cleans: it stores its result, and every screen shows that. The name box's "It will be called …" preview is the one place the client cleans for itself, and it could disagree in that rare case.
- **Listed scripts only.** Accent marks are kept for Latin, Greek and Cyrillic and for the scripts in `SCRIPTS_WITH_MARKS`. Rarer scripts (Meetei Mayek, N'Ko, Adlam, Tai Tham, Baybayin…) keep their letters and lose their vowel signs.
- **Joining controls.** ZWJ and ZWNJ are dropped as default-ignorable, although they change how Sinhala ("ශ්‍රී") and Persian ("علی‌رضا") letters join.

**Why deferred**: the players are Danish and English-speaking kids, and there is one authority, in the browser. The fixes cost more than they are worth today. Every script's marks would need the full, generated list of Unicode scripts, guarded against engines that don't know the newest names. Joiners would need to be kept only between two letters of one script. With a server authority, the server's result is the truth and the client only displays it.

**Trigger**: a player whose name needs one of these, or the server-side authority PR. At that PR, check that nothing but the server cleans a name that is stored, and decide whether the preview needs the server's answer.
