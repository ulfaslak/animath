# Deferred

Technical items we've intentionally postponed: tech debt, hardening shortcuts, known limitations, and cleanup tasks cheaper to do later. Each entry must have **What**, **Why deferred**, and a concrete **Trigger**.

**Not for features.** Features and product work go in GitHub Issues, not here. If you're adding a user-facing capability, create an issue instead. See CLAUDE.md §"Deferred work" for the full scope rule.

---

### Server runs TypeScript through `tsx` in every environment

**What**: `packages/server` has no bundling step; `pnpm start` is `tsx src/index.ts`. Fine locally. For a VPS deploy the image should ship compiled JS (or a single esbuild bundle) so startup doesn't depend on a dev-time transpiler.

**Why deferred**: there is no deploy yet, and the server is a health check, the player and save routes, and a migration script. Bundling now is config with nothing to protect.

**Trigger**: the first deploy to the Hetzner VPS (the Dockerfile PR).

### The puzzle's answer travels to the client inside `BattleState` and `DoctorState`

**What**: `BattlePhase` (`solving`) and the `puzzle-shown` event carry the whole `Puzzle`, `answer` included, and `answer-judged` repeats it. The doctor reducer copies the shape: `DoctorPhase` (`solving`) and its `puzzle-shown` carry the answer too. With `LocalAuthority` that is harmless — the client already runs the engine. With a server authority, a modified client could read the answer and never miss (or heal for free).

**Why deferred**: there is no server authority yet, and stripping the answer means a second `Puzzle` shape (or a redacting step in the protocol) for a cheat nobody can attempt today.

**Trigger**: the `RemoteAuthority` / server-side battle PR. Redact `answer` from what goes over the wire there, and decide whether `answer-judged` keeps reporting it after the fact (harmless: the puzzle is spent; the battle screen never shows it).

### A battle's result is written back by the client's authority, not the engine

**What**: when a battle ends, `LocalAuthority.endBattle` decides what it means for the world: the party takes the battle's HP, a caught animal joins if there is room (the cap is the engine's `MAX_PARTY`, but the let-it-go decision is in the authority), and the closing line is chosen. Only a lost battle is the engine's (`takeToDoctor`). A server authority would have to repeat the rest, and the two copies could drift.

**Why deferred**: there is one authority today, and the brief for the battle work put the outcomes there.

**Trigger**: the `RemoteAuthority` / server-side battle PR, or earlier if a second outcome rule lands. Move the write-back into an engine function (`concludeBattle(party, endedState) → { party, outcome }`, beside `takeToDoctor`) and call it from both authorities; let the client word the closing line from the outcome, as it already does for a lost battle.

### Anonymous player identity is unauthenticated

**What**: the player secret is a random token the client holds in `localStorage` (`animath.player`) and sends as a bearer header. Only its hash is stored, so a database dump is useless, but anyone who copies the token from the browser owns the player and its backup. No rate limiting on `POST /api/players`: anyone can mint rows, and the game itself leaves unused ones behind (every fresh browser that starts a game is a new player; a page reloaded before its first `POST` answered makes another). No rotation, and no way to recover a lost secret: a kid whose browser forgets the site (cleared data, another browser or device, Safari deleting a site's storage after seven days without a visit) starts a new game, and their backup waits on the server under an identity nothing holds any more. Moving it to their new player takes a query written by hand; [[DEVELOPMENT]] § Database only restores a player's own backups.

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

**What**: `nearestTent` (used by `takeToDoctor` after every lost battle) visits about 2·s² tiles for a tent s steps away and generates each one with `tileAtWorld`. Measured over 2,400 walkable starts on 6 seeds: median 10 ms, p99 72 ms, max 180 ms. An adversarial review found 275 ms over 400 seeds. A search that ran all the way to `TENT_SEARCH_STEPS` on open ground would cost several times that, though none has been found. In `LocalAuthority` it runs inside the keydown of the answer that loses the battle, before the first beat plays, and blocks the page that long; in a server authority it would block the event loop for every connection.

**The game's own world**: the seed is fixed (`'prototype'`), so the numbers that matter are that world's. Over every tall-grass tile within 40 tiles of the start (where a battle can be lost), plus samples out to 400 tiles: median 5–11 ms, max 50 ms in node on an M-series Mac, and 20–40 ms at the slowest of those spots measured in Chrome. Losing at the reed by the start (the usual place): the whole keydown, battle reducer and `takeToDoctor` included, takes 2 ms (Chrome's Event Timing, 2026-09-25). Not perceptible: the first beat after an answer holds for a second anyway.

**Why deferred**: in the game's world it costs at most a few frames, once per lost battle, and there is no server authority yet. Faster options change the algorithm (visit the tent lattice in order of distance and path-check each candidate, or cap by tiles visited), which is worth doing when there is a second caller or a real report.

**Trigger**: the server-side authority PR, a second caller of `nearestTent` on a per-step path (a "nearest doctor" hint), or a report of a pause after losing a battle.

### `reorder` names an absolute slot, which a remote authority's latency can turn stale

**What**: the `reorder` party intent carries the slot to move to (`to`), which the pause menu computes from the party it last saw. With the in-process `LocalAuthority` every `party-edited` arrives before the next key, so that view is never stale. Over a network, a kid pressing "Move up" twice before the first answer returns sends the same `to` twice: the second is refused (`already-there`) and the press is lost. `select-lead` and `rename` name the animal, not a slot, and are unaffected.

**Why deferred**: there is no remote authority, and a relative move (`{ by: -1 }`) is a protocol change best made when the latency is real and can be tried.

**Trigger**: the `RemoteAuthority` / WebSocket PR.

### `normalizeNickname` follows the host's Unicode tables, and keeps accents for listed scripts only

**What**: two limits of the nickname cleaner.
- **Host tables.** It uses `\p{L}`, `\p{M}`, `\p{Script=…}`, `\p{Script_Extensions=…}`, `\p{Default_Ignorable_Code_Point}` and `normalize('NFKC')`, whose answers come from the JavaScript engine's Unicode version. A letter added in a recent Unicode version is kept by a newer Node and dropped (as unassigned) by an older browser, and Script_Extensions data changes more often still. So two engines can clean the same typed name differently. That is harmless while the authority is the only one that cleans: it stores its result, and every screen shows that. The name boxes' "It will be called …" previews (the pause menu's and the title's) are the only places the client cleans for itself, and they could disagree in that rare case.
- **Listed scripts only.** Accent marks are kept for Latin, Greek and Cyrillic and for the scripts in `SCRIPTS_WITH_MARKS`. Rarer scripts (Meetei Mayek, N'Ko, Adlam, Tai Tham, Baybayin…) keep their letters and lose their vowel signs.
- **Joining controls.** ZWJ and ZWNJ are dropped as default-ignorable, although they change how Sinhala ("ශ්‍රී") and Persian ("علی‌رضا") letters join.

**Why deferred**: the players are Danish and English-speaking kids, and there is one authority, in the browser. The fixes cost more than they are worth today. Every script's marks would need the full, generated list of Unicode scripts, guarded against engines that don't know the newest names. Joiners would need to be kept only between two letters of one script. With a server authority, the server's result is the truth and the client only displays it.

**Trigger**: a player whose name needs one of these, or the server-side authority PR. At that PR, check that nothing but the server cleans a name that is stored, and decide whether the preview needs the server's answer.

### A browser keeps at most 200 games left for a new one

**What**: New game on the title moves the saved game to the first free slot of `animath.save.previous` (`.2` … `.200`) and never writes over one. With all of them taken, the saved game stays in `animath.save` and the new game is not saved in the browser: it plays, is backed up to the server when that is reachable, and after a reload the title offers the old game again (or, once the backup has landed, the page settles with the server and takes the new one). Nothing is lost, but the new game doesn't stick without a server, and nothing tells the kid.

**Why deferred**: every try of a starter puts one game away, but 200 is years of trying at this household's pace, and making room means deleting a kid's game, which [[DECISIONS]] § Saves rules out; the fix is a decision (drop games with nothing in them, a size budget, or letting the server's `save_backups` be the only copy past a point).

**Trigger**: a report of a new game that did not stick, or `animath.save.previous.100` showing up in a kid's browser.

### The screenshot script blocks the API's HTTP requests, not a WebSocket

**What**: `scripts/screenshot.mjs` keeps runs off every real server by aborting requests to `/api/` (`context.route`), and a route never sees a WebSocket. Vite also proxies `/ws` to the API, so once the client talks to the server over `/ws`, every screenshot run reaches the human's server again. The script then needs to refuse that socket too, as a server that is down would, unless `--api`.

**Why deferred**: the client opens no WebSocket and the server serves none. Playwright's WebSocket routing (`routeWebSocket`) swaps the page's `WebSocket` class for its own, which Vite's hot-reload socket would then go through as well: a risk to every run, for a path nothing uses yet.

**Trigger**: the first client code that opens a WebSocket (the `RemoteAuthority` PR).

### Two tabs writing the save in the same instant: the one written over is kept aside, not merged

**What**: compare-before-write (`Autosave.commit`) is not atomic across tabs. A page's view of `localStorage` is brought up to date only between tasks, so two tabs that write in the same instant both pass the check, and the first write is lost from the key. A two-page probe in headless Chrome lost 4,999 of 10,000 checked writes. The page written over keeps its own save aside when it finds itself behind (`keepOwnSave`, into `animath.save.replaced`), so nothing is gone. But what the kid did there is no longer in play: they see the other tab's game, and only the human can put the kept one back ([[DEVELOPMENT]] § Database). A lock around the write (Web Locks) would not close it on its own, because the lock's grant and the other page's write reach a page by different routes.

**Why deferred**: one kid cannot make two saves in the same instant. A page writes the save only on the kid's own input, with one exception, which happens once and rarely: taking a bigger game from the server.

**Trigger**: a feature that writes the save without the kid's input (a timer, a reward that grows over time, a second player on one device), or a report of a game found kept aside after playing in two tabs. Then merge a walk-versus-progress race back into play: carry on from the other save when it only walked since this page's previous save, and write this page's progress on top.
