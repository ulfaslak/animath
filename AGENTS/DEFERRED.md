# Deferred

Technical items we've intentionally postponed: tech debt, hardening shortcuts, known limitations, and cleanup tasks cheaper to do later. Each entry must have **What**, **Why deferred**, and a concrete **Trigger**.

**Not for features.** Features and product work go in GitHub Issues, not here. If you're adding a user-facing capability, create an issue instead. See CLAUDE.md §"Deferred work" for the full scope rule.

---

### A deploy runs two app containers side by side for a few seconds

**What**: `scripts/deploy.sh` swaps the app without a gap the way lawcel's does: a canary of the new image joins the network under the alias `app` beside the old app, nginx spreads requests over both, then the old one is replaced and the canary removed ([[ARCHITECTURE]] § Production). Presence fits it: on SIGTERM every socket is told to come straight back, the pages put back all the server kept, and a player's public id is the same on every copy ([[ARCHITECTURE]] § Presence › Deploys), so the hop (twice a deploy: the old app replaced, then the canary removed) draws nobody twice. A friendly match's state, kept in one server's memory, would not survive a hop: a match under way when its server stops would be lost.

**Why deferred**: there is no match server yet, and what a match does when its server stops (finish first, hand its state on, or end kindly for both kids) is that PR's call.

**Trigger**: the friendly-match server code ([[DECISIONS]] § Multiplayer). In that PR, decide what a match under way does on SIGTERM, and whether `deploy.sh`'s swap must wait for matches to end.

### A file under `/assets/` is downloaded whole on every visit

**What**: the server marks every client file outside `/immutable/` `no-cache` ([[INVARIANTS]] § Serving), and `serveStatic` sends no `ETag` or `Last-Modified`, so a browser cannot ask "has it changed?" and get a 304: it downloads `index.html` and each file `public/` copied over in full, every visit. `index.html` is 1 kB. Today `public/assets/` holds only `CREDITS.md`, but [[ARCHITECTURE]] plans the models and textures there.

**Why deferred**: nothing under `/assets/` is loaded by the game yet, and the better fix is to keep models out of it altogether.

**Trigger**: the first model or texture the game loads. Import it through Vite (`import url from './fox.glb?url'`), which names it after its content and puts it in `/immutable/`, kept for good; or, for a file that must keep its name, give the server's static files validators (an `ETag` answered with 304).

### Nothing alarms when prod is down

**What**: prod has no uptime monitor. The backup service and the Mac's backup sync alert on failure (to Slack once `MONITORING_SLACK_WEBHOOK_URL` is set; there is no webhook yet, so today to a log line), and Hetzner mails when its nightly image fails; nothing tells anyone when the game stops answering, a certificate fails to renew, or the disk fills. Lawcel runs the same way.

**Why deferred**: the players are one household's kids, who say so when the game is down, and there is no alert channel to send to yet.

**Trigger**: the first players outside the household, the first outage found late, or the Slack webhook arriving. Then an external check of `/api/health` (and the certificate's expiry) that alerts where the backups do.

### The puzzle's answer travels to the client inside `BattleState` and `DoctorState`

**What**: `BattlePhase` (`solving`) and the `puzzle-shown` event carry the whole `Puzzle`, `answer` included, and `answer-judged` repeats it. The doctor reducer copies the shape: `DoctorPhase` (`solving`, `handing-over`, `buying`) and its `puzzle-shown`, `hand-over-shown` and `purchase-shown` carry the answer too (a token sum's answer is the balance after it, which a client can work out anyway). With `LocalAuthority` that is harmless — the client already runs the engine. With a server authority, a modified client could read the answer and never miss (or heal for free). Friendly matches, which a server runs, never carry it: their views and events hold a `ShownPuzzle` (`match/types.ts`, built by `shownPuzzle`), the answerless shape a redaction here can reuse.

**Why deferred**: there is no server authority for wild battles or the doctor, and stripping the answer there is a cheat fix nobody can attempt today.

**Trigger**: a wild battle or a doctor visit run on the server, which [[DECISIONS]] § Multiplayer allows only once a gain can flow between players. Redact `answer` from what goes over the wire there, and decide whether `answer-judged` keeps reporting it after the fact (harmless: the puzzle is spent; the battle screen never shows it). A friendly match is not this item: it runs on the server from the start and sends views without answers ([[DECISIONS]] § Multiplayer).

### A battle's result is written back by the client's authority, not the engine

**What**: when a battle ends, `LocalAuthority.endBattle` decides what it means for the world: the party takes the battle's HP, a caught animal joins (where it goes is the engine's `joinParty`, and with no cap nothing is let go, but the call is the authority's), and the closing line is chosen. Only a lost battle is the engine's (`takeToDoctor`). A server authority would have to repeat the rest, and the two copies could drift.

**Why deferred**: there is one authority today, and the brief for the battle work put the outcomes there.

**Trigger**: a wild battle run on the server ([[DECISIONS]] § Multiplayer: only once a gain can flow between players), or earlier if a second outcome rule lands. Move the write-back into an engine function (`concludeBattle(party, endedState) → { party, outcome }`, beside `takeToDoctor`) and call it from both authorities; let the client word the closing line from the outcome, as it already does for a lost battle.

### Anonymous player identity is unauthenticated

**What**: the player secret is a random token the client holds in `localStorage` (`animath.player`) and sends as a bearer header. Only its hash is stored, so a database dump is useless, but anyone who copies the token from the browser owns the player and its backup. No rate limiting on `POST /api/players` where it runs (development, over the tunnel, with no nginx in front): anyone can mint rows, and the game itself leaves unused ones behind (every fresh browser that starts a game is a new player; a page reloaded before its first `POST` answered makes another). No rotation, and no way to recover a lost secret: a kid whose browser forgets the site (cleared data, another browser or device, Safari deleting a site's storage after seven days without a visit) starts a new game, and their backup waits on the server under an identity nothing holds any more. Moving it to their new player takes a query written by hand; [[DEVELOPMENT]] § Database only restores a player's own backups.

**Why deferred**: the anonymous backup runs only in development now, for a handful of kids on this machine's tunnel: in production every `/api/players` route answers `410` ([[ARCHITECTURE]] § HTTP API), and the backup goes once the human's kid's save has moved to production ([[DECISIONS]] § Saves). A game moves between browsers with an account, which has a password, rate limits and an admin reset.

**Trigger**: the cleanup PR that removes the anonymous backup after the kid's save has moved: delete this item with it. Before then, the first report of a kid losing their save.

### The login and register rate limits live in one process's memory

**What**: `RateLimiter` (`packages/server/src/rate-limit.ts`) counts tries per address, per name and per account in the API process's memory. A restart or a deploy forgets every count, and two processes serving the API at once would each allow the full limit. Wrong passwords from one address shut out only that address, but wrong passwords from five or more addresses together still shut a name out for everyone for a quarter of an hour at a time, the kid on their own device included, and the admin CLI (another process) cannot lift it; only a restart does.

**Why deferred**: there is one API process, and the stakes are a kid's animals, not personal data ([[DECISIONS]] § Accounts). A shared store (a Postgres table, or Redis) is a moving part for a threat nobody has made yet.

**Trigger**: a second process or container serving the API for longer than a deploy's hand-over, or a report of a kid locked out of their name, or of guessing (many `429`s for one name in the logs).

### Many accounts can still fill the disk

**What**: each account stores at most a 1 MiB save and 2 MiB of set-aside saves (`ACCOUNT_BACKUP_BYTES`), and registrations are limited to 30 an hour per address (an IPv4 address or an IPv6 /64). Someone with many addresses can still make many accounts and send each a megabyte of save, about 90 MiB an hour per address at most. Nothing counts the database's size or stops at a quota, so a determined attacker could fill the server's disk, and then every save would fail, the kids' included.

**Why deferred**: there is no public address yet, the game is for a handful of kids, and a quota or a disk alarm is a moving part for an attack nobody has made. A kid's real save is a few kilobytes, so a quota low enough to matter would never touch them.

**Trigger**: the production server's disk passing half full, a registration flood in the logs, or the first deploy with a public domain (then add at least a disk-usage alert to the backup sidecar's checks).

### Cleared tiles are each player's own, so a friend can walk through a tree you still see

**What**: the tiles a kid clears with the axe and the pickaxe (`WorldEdits`) live in that kid's game and save, and the authority walks, restores and knocks out through them ([[DECISIONS]] § Gameplay). With friends in one world, two kids see two different forests: a gap one kid chopped is a tree to the other, who watches them walk through it. Shared edits would put one overlay per world on the server, which would then decide where every kid in that world can walk. Two more things change then: the whole overlay rides on `welcome` today (up to 24 KB), where the server should send each chunk's edits as the chunk comes into view; and `tile-cleared` goes to everyone who sees that chunk, with the chunks that grew back.

**Why deferred**: every single-player rule, walking included, stays in the browser ([[DECISIONS]] § Multiplayer), and a shared edit is a gain that flows between players, so its rule would have to move to the server first. How kids play together will show whether they want it.

**Trigger**: the human asks for clearings friends share, or a report of a kid confused by a friend walking through a tree. Then decide with the human who may clear what in a shared world (a kid could open a path for friends, or clear a forest bare for everyone), and move clearing and the overlay onto the server, one overlay per world.

### The server stores whatever save the client sends

**What**: `PUT /api/players/:id/save` checks the document's shape, not that the game in it could have happened: an HP above the species' maximum (`restoreGame` cuts it on load), a party of any animals, a position anywhere, any number of tokens and any tools, a `battle` the server never looks inside (the client checks it with `readBattle` on load). A modified client, or a hand-edited `localStorage` save, is backed up as sent. The saved battle also carries the puzzle's answer, as `BattleState` does ([[CHEATSHEET]] § Exploits).

**Why deferred**: the save is the single-player authority's state, and that authority is the client, by choice ([[DECISIONS]] § Multiplayer): nothing a player gains can reach another player, and a friendly match changes nothing, so cheating gains nothing.

**Trigger**: the first feature through which a gain can flow between players (trading, match rewards, shared world edits), or that otherwise makes one player's save matter to another (a leaderboard). Then move the rule behind that gain to the server, so the server stops taking the client's word for it.

### A saved position assumes today's world generator

**What**: a save holds tile positions (in the world the player is in, and in each world left behind) and a step count, all meaningful only in the worlds `generateChunk` makes today. A change to world generation that moves tiles under an existing seed can leave a saved player on water or a tree (`restoreGame` then puts them on the spawn tile, far from where they were) or walled in on a patch of walkable tiles, which `restoreGame` does not detect.

**Why deferred**: the generator has changed once since the first save: deep water turned water tiles out in the lakes into deep water, and moved no tile anyone could stand on (0 of 205,861 land tiles within 256 of the prototype spawn changed; `world.test.ts` pins the world within 64 of it by a checksum, [[INVARIANTS]] § World). Only World 1 is pinned: saves stand in other worlds since numbered worlds, and a change to generation moves those too. No save could stand on water before the boat, so none moved. The right fix for a change that does move land depends on the change: keep old seeds on the old generator, or bump `SAVE_VERSION` with an upgrade that moves saved players to a safe tile near where they were (the knock-out rule's `nearestTent` search is the model).

**Trigger**: any PR that changes where a player can stand in an existing seed's world (the checksum in `world.test.ts` goes red first; procedural world v2 in [[PRODUCT]] §6 is one), or one that changes the water a saved player may now be sailing on.

### `nearestTent` is a synchronous flood fill that costs up to a few hundred milliseconds

**What**: `nearestTent` (used by `takeToDoctor` after every lost battle) visits about 2·s² tiles for a tent s steps away and generates each one with `tileAtWorld`. Measured over 2,400 walkable starts on 6 seeds: median 10 ms, p99 72 ms, max 180 ms. An adversarial review found 275 ms over 400 seeds. A search that ran all the way to `TENT_SEARCH_STEPS` on open ground would cost several times that, though none has been found. In `LocalAuthority` it runs inside the keydown of the answer that loses the battle, before the first beat plays, and blocks the page that long; in a server authority it would block the event loop for every connection.

**The game's own world**: the seed is fixed (`'prototype'`), so the numbers that matter are that world's. Over every tall-grass tile within 40 tiles of the start (where a battle can be lost), plus samples out to 400 tiles: median 5–11 ms, max 50 ms in node on an M-series Mac, and 20–40 ms at the slowest of those spots measured in Chrome. Losing at the reed by the start (the usual place): the whole keydown, battle reducer and `takeToDoctor` included, takes 2 ms (Chrome's Event Timing, 2026-09-25). Not perceptible: the first beat after an answer holds for a second anyway.

**With the boat** the search crosses water too, and a battle can be lost out on a lake. It reads the tiles' kinds with `travelKindAt`, which skips the deep-water check (24 more tiles of elevation per deep tile, which made the first cut up to 196 ms). In the prototype world, from 400 random water tiles within 600 of the start: median 7 ms, p99 44 ms, max 50 ms; every one found a tent, the furthest 91 steps away. From land, the boat adds a median 0.2 ms and at most 43 ms, where a lake opens the search out.

**Why deferred**: in the game's world it costs at most a few frames, once per lost battle, and there is no server authority yet.
 Faster options change the algorithm (visit the tent lattice in order of distance and path-check each candidate, or cap by tiles visited), which is worth doing when there is a second caller or a real report.

**Trigger**: the server-side authority PR, a second caller of `nearestTent` on a per-step path (a "nearest doctor" hint), or a report of a pause after losing a battle.

### `reorder` names an absolute slot, which a remote authority's latency can turn stale

**What**: the `reorder` and `move-species` party intents carry the slot, or the place among the cards, to move to (`to`), which the pause menu computes from the party it last saw and the HUD from where a card was dropped. With the in-process `LocalAuthority` every `party-edited` arrives before the next key, so that view is never stale. Over a network, a kid pressing "Move up" twice before the first answer returns sends the same `to` twice: the second is refused (`already-there`) and the press is lost. A drop that lands after another change is refused the same way (`no-such-slot`, `already-there`), or moves the card to a place the kid did not see. `select-lead`, `lead-species` and `rename` name the animal or the species, not a slot, and are unaffected.

**Why deferred**: there is no remote authority, and a relative move (`{ by: -1 }`) is a protocol change best made when the latency is real and can be tried.

**Trigger**: the first party intent sent over a network, which [[DECISIONS]] § Multiplayer keeps in the browser until a gain can flow between players; presence and friendly matches send none.

### `normalizeNickname` follows the host's Unicode tables, and keeps accents for listed scripts only

**What**: two limits of the nickname cleaner.
- **Host tables.** It uses `\p{L}`, `\p{M}`, `\p{Script=…}`, `\p{Script_Extensions=…}`, `\p{Default_Ignorable_Code_Point}` and `normalize('NFKC')`, whose answers come from the JavaScript engine's Unicode version. A letter added in a recent Unicode version is kept by a newer Node and dropped (as unassigned) by an older browser, and Script_Extensions data changes more often still. So two engines can clean the same typed name differently. That is harmless while the authority is the only one that cleans: it stores its result, and every screen shows that. The name boxes' "It will be called …" previews (the pause menu's and the title's) are the only places the client cleans for itself, and they could disagree in that rare case.
- **Listed scripts only.** Accent marks are kept for Latin, Greek and Cyrillic and for the scripts in `SCRIPTS_WITH_MARKS`. Rarer scripts (Meetei Mayek, N'Ko, Adlam, Tai Tham, Baybayin…) keep their letters and lose their vowel signs.
- **Joining controls.** ZWJ and ZWNJ are dropped as default-ignorable, although they change how Sinhala ("ශ්‍රී") and Persian ("علی‌رضا") letters join.

**Why deferred**: the players are Danish and English-speaking kids, and there is one authority, in the browser. The fixes cost more than they are worth today. Every script's marks would need the full, generated list of Unicode scripts, guarded against engines that don't know the newest names. Joiners would need to be kept only between two letters of one script. With a server authority, the server's result is the truth and the client only displays it.

**Trigger**: a player whose name needs one of these, or the server-side authority PR. At that PR, check that nothing but the server cleans a name that is stored, and decide whether the preview needs the server's answer.

### A match shows each player the other's nicknames, cleaned but not checked for rude words

**What**: `matchTeam` keeps each animal's nickname, cleaned by `normalizeNickname`, and `matchView` sends both teams to both players, so a kid sees the other kid's nicknames. The cleaner keeps letters, not manners: a rude word typed as a nickname reaches the other kid, which is the one piece of free text that crosses between players ("There is no chat").

**Why deferred**: the rude-word list comes with the engine's `checkName` (`names.ts`, being built in `feat/worlds-names`), and no screen shows a match yet.

**Trigger**: the `feat/matches` PR that puts a match on screen. With `names.ts` landed by then, drop, in `matchTeam`, a nickname its rules call rude (the animal goes by its species' name), so the server never sends one; without it, show the other side's animals by their species' names only.

### A browser keeps at most 200 games left for a new one

**What**: New game on the title moves the saved game to the first free slot of `animath.save.previous` (`.2` … `.200`) and never writes over one. With all of them taken, the saved game stays in `animath.save` and the new game is not saved in the browser: it plays, is backed up to the server when that is reachable, and after a reload the title offers the old game again (or, once the backup has landed, the page settles with the server and takes the new one). Nothing is lost, but the new game doesn't stick without a server, and nothing tells the kid.

**Why deferred**: every try of a starter puts one game away, but 200 is years of trying at this household's pace, and making room means deleting a kid's game, which [[DECISIONS]] § Saves rules out; the fix is a decision (drop games with nothing in them, a size budget, or letting the server's `save_backups` be the only copy past a point).

**Trigger**: a report of a new game that did not stick, or `animath.save.previous.100` showing up in a kid's browser.

### The doctor's Heal tab lists every animal of a kind, where the HUD shows one card

**What**: the doctor's lists read the party's bundles (`bundles`), and Help home gives each kind of several a row of its own ("Rabbit ×12") that picks the whole kind (#75). Heal still lists each animal, grouped by kind with a line between kinds, and has no row for a kind. So a kid meets twelve rabbits as one card in the HUD and as twelve rows at the doctor's Heal tab.

**Why deferred**: Heal is where each animal's HP shows, and one puzzle already heals the whole kind whichever of its hurt animals is picked. A kind's row there would be a second way to the same puzzle, not a shortcut.

**Trigger**: a save with more than 20 hurt animals of one kind, so the heal list outgrows the card, or a report that Heal and the HUD read as different teams. Then give Heal a row per kind of several that opens its puzzle, as Help home's row picks its animals.

### Two tabs writing the save in the same instant: the one written over is kept aside, not merged

**What**: compare-before-write (`Autosave.commit`) is not atomic across tabs. A page's view of `localStorage` is brought up to date only between tasks, so two tabs that write in the same instant both pass the check, and the first write is lost from the key. A two-page probe in headless Chrome lost 4,999 of 10,000 checked writes. The page written over keeps its own save aside when it finds itself behind (`keepOwnSave`, into `animath.save.replaced`), so nothing is gone. But what the kid did there is no longer in play: they see the other tab's game, and only the human can put the kept one back ([[DEVELOPMENT]] § Database). A lock around the write (Web Locks) would not close it on its own, because the lock's grant and the other page's write reach a page by different routes.

**Why deferred**: one kid cannot make two saves in the same instant. A page writes the save only on the kid's own input, with one exception, which happens once and rarely: taking a bigger game from the server.

**Trigger**: a feature that writes the save without the kid's input (a timer, a reward that grows over time, a second player on one device), or a report of a game found kept aside after playing in two tabs. Then merge a walk-versus-progress race back into play: carry on from the other save when it only walked since this page's previous save, and write this page's progress on top.

### A save over 1 MiB is not backed up, and one over 64 KiB misses the backup sent as the page closes

**What**: a party has no cap, so a save grows with it: about 80 bytes an animal, up to 140 with a long name in 4-byte letters, twice that mid-battle. The tiles a kid cleared take up to `EDITS_BUDGET` more (24,000 characters, far from home past it), which brings the `keepalive` limit below closer: a kid who has chopped thousands of tiles reaches it with some 150 animals mid-battle with long names. The server refuses a body over `SAVE_MAX_BYTES` (1 MiB, about 3,500 animals in the worst case) with a `413`, which the autosave treats as a bug: one `console.error`, and no more backups that visit; the game in the browser is saved as always. Separately, the backup sent on `pagehide` and when the page is hidden uses `fetch`'s `keepalive`, which browsers cap at 64 KiB of body: a bigger save (some 230 animals mid-battle with long names, 400 without) fails that request quietly, and the server's copy waits for the next ordinary backup (1 s after something that matters, 15 s after walking), which a hidden tab still sends.

**Why deferred**: no kid is near either size; catching 400 animals takes well over ten hours of play.

**Trigger**: a save in the `saves` table over 48 KB (`pg_column_size(data)`), or any party past 300 animals. Then send a save too big for `keepalive` without it, and split or compress the backup before it nears `SAVE_MAX_BYTES`.

### A card's list is built whole, however many animals it holds

**What**: opening a card in the HUD or the pause menu builds a row for every animal of that kind at once (the switch list and the doctor's list likewise list the whole team). A card of 120 rabbits took 60–100 ms of script and layout to come up at a load average of 40–77 (six took 4 ms): a hitch of a few frames when the card opens, none while it is open or while walking.

**Why deferred**: a card of a hundred of one kind is far from any kid's team today, and drawing only the rows in view fights the lists' shared columns, which are sized by the longest name.

**Trigger**: a kid's save with a card past 150 animals, or a stutter reported when a card opens. Then draw only the rows in view (fixed row heights, the name column sized from all the names), or build the rows over a few frames.

### A save with more than six animals reads as unreadable to a build from before #66

**What**: the party lost its cap without a new save `version`, since every old document still reads (the rule in [[DECISIONS]] § Saves bumps `version` only when an old document becomes unreadable). But a build from before #66 refuses a party of more than six, and calls such a save `invalid`, not `newer`: it starts a new game, and once the kid has played, sets the big team aside in `animath.save.unreadable` (and the server keeps its copy in `save_backups`). Nothing is lost, but the kid sees "Your saved game didn't load", and the team comes back only by hand. A save of six or fewer still reads in an old build.

**Why deferred**: only an older build meeting a newer save hits it, which today means rolling the tunnel's game back past #66; a `version` bump instead would make every save, small ones too, unreadable to such a build.

**Trigger**: before rolling the game back past #66, or serving two builds behind one address. Then bump `SAVE_VERSION` with an upgrade that only renumbers, so an older build calls a big save `newer` and leaves it alone.


### The link preview's image is a relative URL

**What**: `index.html` gives `og:image` as `/social-preview.jpg`. The Open Graph protocol asks for an absolute URL, and some messengers show no picture for a relative one, though iMessage, Slack and most others resolve it against the page's address.

**Why deferred**: the game has no address of its own yet: the human has not chosen a domain, and until the production server is up the game is shared through a tunnel whose address changes. A hard-coded address would be wrong everywhere it is shared today.

**Trigger**: the production domain is chosen (`MATHGAME_DOMAIN` in `deploy.env`, the one place it is set). Then write it into `og:image` (and add `og:url`), in `index.html` or from the build's environment. The image's build does not read `deploy.env` today (the `.dockerignore` allowlist leaves it out): pass it in as a build argument, as `GIT_SHA` is.

### The presence socket caps sockets in all, not per address

**What**: the presence server holds 1,000 sockets at most and a world 200 players (`presence/socket.ts`, `hub.ts`), and caps each socket's messages, but it does not cap how many sockets one address opens. Behind nginx every socket comes from nginx's own address, so a cap per address has to read the address nginx passes on (`X-Real-IP`), and trust it only from nginx.

**Why deferred**: a cap per address read off the socket itself would count every player as one behind the proxy and lock everyone out together; the production proxy's headers are being set up now, and the players are a few kids who share a link.

**Trigger**: the public deploy is live and its logs show one address holding many sockets, the socket count nears its cap, or a player reports the game saying nobody is here while friends are.

### Presence lives in one server process's memory

**What**: who is in which world, where, and who sees whom (`PresenceHub`) is kept in the memory of the Node process that holds each socket. A restart forgets it (every page says where it is again as its socket comes back, within a second on a deploy), and two processes split every world in two, each half blind to the other: a deploy's swap does that for its few seconds, to a page that opens its socket while two copies run.

**Why deferred**: one process serves the game between deploys; forgetting on a restart costs nothing a page doesn't put back by itself, and a friend missing for the seconds of a swap is back at its next hop.

**Trigger**: a second server process serving at the same time for longer than a deploy's swap (a cluster, a second container kept for load): then presence moves to one place both reach, or each world to one process.
