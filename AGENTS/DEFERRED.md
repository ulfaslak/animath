# Deferred

Technical items we've intentionally postponed: tech debt, hardening shortcuts, known limitations, and cleanup tasks cheaper to do later. Each entry must have **What**, **Why deferred**, and a concrete **Trigger**.

**Not for features.** Features and product work go in GitHub Issues, not here. If you're adding a user-facing capability, create an issue instead. See CLAUDE.md § Soft context for the full scope rule.

---

### The witch doctor's card is not fitted to puzzles with pictures

**What**: `PuzzlePanel` draws a picture kind's picture and question (#191), and the battle gives it the whole panel, but the witch doctor's card, whose heal asks a kind its species' attacks ask, has not been laid out for one: `scripts/doctor-fit.mjs` fills the card with sums only, and nobody has looked at a picture there.

**Why deferred**: no species asks a picture kind yet, so no heal can; the card's fitting (`fit(SIDE_STEPS)`) would be tuned against animals that do not exist.

**Trigger**: the first Arctic species with a picture kind on an attack (#191 step 5): run `doctor-fit.mjs` with a heal of each picture kind, and look at the card at 1024×768 and on a phone, with and without touch.

### A friend's birds are not seen in the air

**What**: another player sees a friend glide (`flight`), but not the bird that flies behind them (their lead in the air) nor a wild bird chasing them (#91): nobody follows them in the other page until they are down, and the wire carries no chaser. Their battle in the air, once it starts, is seen as any battle is: the two birds flying beside them.

**Why deferred**: #91 put flying in multiplayer out of scope. Drawing the lead in the air needs only the `lead` a page already reports (the lead in the air while flying) and `Follower.fly` on the other page; the chaser would need a field on `where` and a protocol bump.

**Trigger**: the human asks for friends' flights to show their birds, or a kid watching a friend fly asks where the bird went.

### A friendly match under way ends on every deploy

**What**: a match lives in the memory of the app that holds both players' sockets (`presence/matches.ts`). When a deploy stops that app (twice a deploy: the old app replaced, then the canary removed), every match under way there ends with no winner, and the pages say the game is updating and offer to play again ([[DECISIONS]] § Multiplayer). The alternatives were to keep matches running while the old app drains (it has 8 s before it exits and Docker's 10 s before the kill, a match takes minutes, two hops a deploy, and any hiccup of a kid's connection meanwhile lands them on the new app, which knows no match) or to hand the state on (the reducer replays from its seed and its log, which Postgres could hold, and the next app would resume it when both come back).

**Why deferred**: a handoff costs a table, a migration and a resume path on the next app, against a match that starts again with one tap each; the game is played by a few kids, and a deploy lands during a match rarely.

**Trigger**: kids report matches cut short by updates, or deploys land in playing hours often enough to matter. Then persist `(seed, parties, log)` per match on each step, and let the next app pick it up when both players say hello, within `awayMs`.

### A file under `/assets/` is downloaded whole on every visit

**What**: the server marks every client file outside `/immutable/` `no-cache` ([[INVARIANTS]] § Serving), and `serveStatic` sends no `ETag` or `Last-Modified`, so a browser cannot ask "has it changed?" and get a 304: it downloads `index.html` and each file `public/` copied over in full, every visit. `index.html` is 3 kB (1.3 kB gzipped). Today `public/assets/` holds only `CREDITS.md`, but [[ARCHITECTURE]] plans the models and textures there.

**Why deferred**: nothing under `/assets/` is loaded by the game yet, and the better fix is to keep models out of it altogether.

**Trigger**: the first model or texture the game loads. Import it through Vite (`import url from './fox.glb?url'`), which names it after its content and puts it in `/immutable/`, kept for good; or, for a file that must keep its name, give the server's static files validators (an `ETag` answered with 304).

### Nothing watches prod while the Mac sleeps

**What**: the health watch (`scripts/health-watch.sh`, [[DEVELOPMENT]] § Errors and health) runs on the developer's Mac and tells, in a macOS notification, when the game stops answering, a certificate is under 14 days, or the game's pages report a new kind of error; it sees nothing while the Mac is asleep, off or offline, and a notification reaches only whoever sits at that Mac. The backup service and the Mac's backup sync alert on failure (to Slack once `MONITORING_SLACK_WEBHOOK_URL` is set; there is no webhook yet, so today to a log line), and Hetzner mails when its nightly image fails; nothing tells anyone when the disk fills (the backup service logs a disk past 85% full, `check_disk` in `scripts/backup.sh`, which reaches Slack only with the webhook). Lawcel runs the same way.

**Why deferred**: the players are one household's kids, who say so when the game is down, and where alerts should go is the human's call ([[HUMAN_TODO]]).

**Trigger**: the first players outside the household, the first outage found late, or the human naming an alert channel (a Slack webhook, an email). Then a check from outside the Mac (an uptime service, or a job on another machine) of `/api/health` and the certificates' dates, alerting where the backups do, beside or instead of the Mac's watch.

### A production error report's stack names places in minified code

**What**: the image ships the client without its source maps (the `Dockerfile` deletes them), so a stack in `admin errors` names places in the minified build (`/immutable/main-BRRoerHC.js:1:23456`), and minified names. Reading one takes the client built at the report's commit, whose maps say where each place is ([[DEVELOPMENT]] § Errors and health).

**Why deferred**: a report's message usually says enough (Safari's names the expression it could not evaluate), and serving maps, or keeping them for a lookup, is a moving part for a report nobody has yet failed to read.

**Trigger**: the first production report whose message and stack do not lead to the bug. Then keep each build's maps off the public site (an artifact of the deploy workflow, say) and give `admin errors` a way to map a stack's places through them.

### Error reports share nginx's guard on POSTs with logging in

**What**: nginx counts every POST from one address in one bucket (`nginx/http.conf`: 60 at once, then one a second), and the pages' error reports are POSTs, as logging in and signing up are. A tab sends three reports an hour at most (`error-reports.ts`), so 20 pages breaking in the same seconds behind one school address send up to 60, which empties the bucket: a kid logging in during those seconds gets nginx's `429`, which the page takes for no answer ("We can't reach the game's home right now"), until the bucket refills at one a second.

**Why deferred**: it takes many kids behind one address whose pages break at once, and a login in the same seconds. A bucket of the reports' own is a rule on a path, which the guard avoids on purpose: nginx and the app spell a path differently.

**Trigger**: players behind one school address, or a `429` on a login traced to error reports in nginx's access log. Then give `POST /api/client-errors` a `location =` of its own in `nginx/app.conf` with a `limit_req` zone of its own, and check that no spelling of an account route reaches it.

### The puzzle's answer travels to the client inside `BattleState` and `DoctorState`

**What**: `BattlePhase` (`solving`) and the `puzzle-shown` event carry the whole `Puzzle`, `answer` included, and `answer-judged` repeats it. The doctor reducer copies the shape: `DoctorPhase` (`solving`, `handing-over`, `buying`) and its `puzzle-shown`, `hand-over-shown` and `purchase-shown` carry the answer too (a token sum's answer is the balance after it, which a client can work out anyway). With `LocalAuthority` that is harmless — the client already runs the engine. With a server authority, a modified client could read the answer and never miss (or heal for free). Friendly matches, which a server runs, never carry it: their views and events hold a `ShownPuzzle` (`match/types.ts`, built by `shownPuzzle`), the answerless shape a redaction here can reuse.

**Why deferred**: there is no server authority for wild battles or doctor visits, and stripping the answer there is a cheat fix nobody can attempt today.

**Trigger**: a wild battle or a doctor visit run on the server, which [[DECISIONS]] § Multiplayer allows only once a gain can flow between players. Redact `answer` from what goes over the wire there, and decide whether `answer-judged` keeps reporting it after the fact (harmless: the puzzle is spent; the battle screen never shows it). A friendly match is not this item: it runs on the server from the start and sends views without answers ([[DECISIONS]] § Multiplayer).

### A battle's result is written back by the client's authority, not the engine

**What**: when a battle ends, `LocalAuthority.endBattle` decides what it means for the world: the party takes the battle's HP, a caught animal joins (where it goes is the engine's `joinParty`, and with no cap nothing is let go, but the call is the authority's), and the closing line is chosen. Only a lost battle's party is the engine's (`knockOut`: tired, or looked after by a witch doctor who came). A server authority would have to repeat the rest, and the two copies could drift.

**Why deferred**: one authority runs wild battles today (`LocalAuthority`), and the brief for the battle work put the outcomes there.

**Trigger**: a wild battle run on the server ([[DECISIONS]] § Multiplayer: only once a gain can flow between players), or earlier if a second outcome rule lands. Move the write-back into an engine function (`concludeBattle(party, endedState) → { party, outcome }`, beside `knockOut`) and call it from both authorities; let the client word the closing line from the outcome.

### The retired anonymous backup's tables stay in every database

**What**: `players`, `saves` and `save_backups` (migrations `0000` to `0002`) held the anonymous per-browser backup, which the development server behind the tunnel kept until the human's kid's game moved to production (2026-09-27, [[DECISIONS]] § Saves). Nothing in the game reads or writes them since, but they stay in every database, production's (where they are empty) included, and no migration may drop or alter them ([[INVARIANTS]] § Server, checked by `migrations.test.ts`). The human's local `mathgame` database keeps the tunnel's games in them, the newest save of each browser that played there before the retirement, which `admin export-local-save` reads ([[DEVELOPMENT]] § Moving a kid's game to production). The schema (`db/schema.ts`) still describes them.

**Why deferred**: those rows are the only copy off the kids' own browsers of the games played through the tunnel: a kid who has not moved yet (one of the human's kid's friends, say) can still have theirs moved from them. Dropping the tables takes a migration that runs on production too, for tables that are empty there, and the cleanup that retired the backup was asked to keep production's schema history simple. Three empty tables cost nothing.

**Trigger**: the human says the tunnel's games have all moved or may go, or a new table wants one of these names (`players` is the likely one, with more to multiplayer), whichever comes first. Then keep a copy of the local rows outside the repository first (`pg_dump -t players -t saves -t save_backups`), and in one PR: a migration that drops the three tables, the invariant and its check in `migrations.test.ts` retired with it, `export-local-save` and `save-export.ts` gone (they read nothing else), the tables out of the schema, and this item deleted.

### The login and register rate limits live in one process's memory

**What**: `RateLimiter` (`packages/server/src/rate-limit.ts`) counts tries per address, per name and per account in the API process's memory. A restart or a deploy forgets every count, and two processes serving the API at once would each allow the full limit; so does the error reports' limit per address (`REPORT_LIMITS`, `routes/client-errors.ts`). Wrong passwords from one address shut out only that address, but wrong passwords from five or more addresses together still shut a name out for everyone for a quarter of an hour at a time, the kid on their own device included, and the admin CLI (another process) cannot lift it; only a restart does.

**Why deferred**: there is one API process, and the stakes are a kid's animals, not personal data ([[DECISIONS]] § Accounts). A shared store (a Postgres table, or Redis) is a moving part for a threat nobody has made yet.

**Trigger**: a second process or container serving the API for longer than a deploy's hand-over, or a report of a kid locked out of their name, or of guessing (many `429`s for one name in the logs).

### Many accounts can still fill the disk

**What**: each account stores at most a 1 MiB save and 2 MiB of set-aside saves (`ACCOUNT_BACKUP_BYTES`), and registrations are limited to 30 an hour per address (an IPv4 address or an IPv6 /64). Someone with many addresses can still make many accounts and send each a megabyte of save, about 90 MiB an hour per address at most. Nothing counts the database's size or stops at a quota, and the backup service's disk check (85% full) reaches only its log until the Slack webhook arrives ("Nothing watches prod while the Mac sleeps"), so a determined attacker could fill the server's disk, and then every save would fail, the kids' included.

**Why deferred**: the game is for a handful of kids, and a quota is a moving part for an attack nobody has made. A kid's real save is a few kilobytes, so a quota low enough to matter would never touch them.

**Trigger**: the production server's disk passing half full, or a registration flood in the logs.

### Cleared tiles are each player's own, so a friend can walk through a tree you still see

**What**: the tiles a kid clears with the axe and the pickaxe (`WorldEdits`) live in that kid's game and save, and the authority walks, restores and knocks out through them ([[DECISIONS]] § Gameplay). With friends in one world, two kids see two different forests: a gap one kid chopped is a tree to the other, who watches them walk through it. Shared edits would put one overlay per world on the server, which would then decide where every kid in that world can walk. Two more things change then: the whole overlay rides on `welcome` today (up to 24 KB), where the server should send each chunk's edits as the chunk comes into view; and `tile-cleared` goes to everyone who sees that chunk, with the chunks that grew back.

**Why deferred**: every single-player rule, walking included, stays in the browser ([[DECISIONS]] § Multiplayer), and a shared edit is a gain that flows between players, so its rule would have to move to the server first. How kids play together will show whether they want it.

**Trigger**: the human asks for clearings friends share, or a report of a kid confused by a friend walking through a tree. Then decide with the human who may clear what in a shared world (a kid could open a path for friends, or clear a forest bare for everyone), and move clearing and the overlay onto the server, one overlay per world.

### The server stores whatever save the client sends

**What**: `PUT /api/account/save`, and the guest game a registration brings, are checked for the document's shape, not for whether the game in it could have happened: an HP above the species' maximum (`restoreGame` cuts it on load), a party of any animals, a position anywhere, any number of tokens and any tools, a `battle` the server never looks inside (the client checks it with `readBattle` on load). A modified client, or a hand-edited `localStorage` save, is stored in the account as sent. The saved battle also carries the puzzle's answer, as `BattleState` does ([[CHEATSHEET]] § Exploits and quirks).

**Why deferred**: the save is the single-player authority's state, and that authority is the client, by choice ([[DECISIONS]] § Multiplayer): nothing a player gains can reach another player, and a friendly match changes nothing, so cheating gains nothing.

**Trigger**: the first feature through which a gain can flow between players (trading, match rewards, shared world edits), or that otherwise makes one player's save matter to another (a leaderboard). Then move the rule behind that gain to the server, so the server stops taking the client's word for it.

### A saved position assumes today's world generator

**What**: a save holds tile positions (in the world the player is in, and in each world left behind) and a step count, all meaningful only in the worlds `generateChunk` makes today. A change to world generation that moves tiles under an existing seed can leave a saved player on water or a tree (`restoreGame` then puts them on the spawn tile, far from where they were) or walled in on a patch of walkable tiles, which `restoreGame` does not detect.

**Why deferred**: the generator has changed once since the first save: deep water turned water tiles out in the lakes into deep water, and moved no tile anyone could stand on (0 of 205,861 land tiles within 256 of the prototype spawn changed; `world.test.ts` pins the world within 64 of it by a checksum, [[INVARIANTS]] § World). Only World 1 is pinned: saves stand in other worlds since numbered worlds, and a change to generation moves those too. No save could stand on water before the boat, so none moved. The right fix for a change that does move land depends on the change: keep old seeds on the old generator, or bump `SAVE_VERSION` with an upgrade that moves saved players to a safe tile near where they were (the knock-out rule's `nearestTent` search is the model).

**Trigger**: any PR that changes where a player can stand in an existing seed's world (the checksum in `world.test.ts` goes red first; procedural world v2 in [[PRODUCT]] §6 is one), or one that changes the water a saved player may now be sailing on.

### `nearestTent` is a synchronous flood fill that costs up to a few hundred milliseconds the first time it reads a place

**What**: `nearestTent` visits about 2·s² tiles for a tent s steps away. Since the way to the witch doctor (the arrow a tired team follows, `DoctorWay`) looks again at every step, it reads the ground from a cache of whole chunks (`tents.ts`, [[INVARIANTS]] § "A tent search answers the same whatever was searched before"), so a search where the last one looked is cheap: over 1,539 steps of random walks in six worlds, at a load average of 50, median 0.19 ms, p99 17 ms, max 22 ms (main before the cache, the same walks: median 0.89 ms, p99 34 ms, max 141 ms). The first search in a place still makes every chunk it touches: from 300 random walkable starts in 300 worlds, at the same load, median 57 ms, p90 217 ms, max 1 s (main: 43, 243 and 781 ms). It runs where a battle is lost, a go-to lands or a trip arrives (`knockOut`, `careFor`, `doctorComes`: only for a team that needs the witch doctor, and never for a kid with the glider), and for the arrow wherever a tired team is put without a step (`DoctorWay` after a reload, a go-to or a trip, reaching up to `DOCTOR_WAY_STEPS`), each once; in a server authority a cold one would block the event loop for every connection.

**World 1** (the seed `'prototype'`, where every game from before numbered worlds stands; a new game starts in a world from 2 to 9999, which the 300 worlds above sample): over every tall-grass tile within 40 tiles of the start (where a battle can be lost), plus samples out to 400 tiles: median 5–11 ms, max 50 ms in node on an M-series Mac, and 20–40 ms at the slowest of those spots measured in Chrome, before the cache. Losing at the reed by the start (the usual place): the whole keydown, battle reducer and the tent search included, took 2 ms (Chrome's Event Timing, 2026-09-25). Not perceptible: the first beat after an answer holds for a second anyway.

**With the boat** the search crosses water too, and a battle can be lost out on a lake. It reads deep water as water, as `travelKindAt` does, sparing the deep-water check (24 more tiles of elevation per deep tile). In the prototype world, from 400 random water tiles within 600 of the start: median 7 ms, p99 44 ms, max 50 ms; every one found a tent, the furthest 91 steps away.

**Why deferred**: in World 1 a cold search costs at most a few frames, and in the other worlds a few at the median (the numbers above), once per lost battle or trip; and no server runs the rules that call it ([[DECISIONS]] § Multiplayer). Faster options change the algorithm (visit the tent lattice in order of distance and path-check each candidate, or cap by tiles visited).

**Trigger**: the first PR that handles a lost battle, a go-to or a trip on the server, or a report of a pause after losing a battle or while walking to the witch doctor.

### `reorder` names an absolute slot, which a remote authority's latency can turn stale

**What**: the `reorder` and `move-species` party intents carry the slot, or the place among the cards, to move to (`to`), which the pause menu computes from the party it last saw and the HUD from where a card was dropped. With the in-process `LocalAuthority` every `party-edited` arrives before the next key, so that view is never stale. Over a network, a kid pressing "Move up" twice before the first answer returns sends the same `to` twice: the second is refused (`already-there`) and the press is lost. A drop that lands after another change is refused the same way (`no-such-slot`, `already-there`), or moves the card to a place the kid did not see. `select-lead`, `lead-species` and `rename` name the animal or the species, not a slot, and are unaffected.

**Why deferred**: there is no remote authority, and a relative move (`{ by: -1 }`) is a protocol change best made when the latency is real and can be tried.

**Trigger**: the first party intent sent over a network, which [[DECISIONS]] § Multiplayer keeps in the browser until a gain can flow between players; presence and friendly matches send none.

### `normalizeNickname` follows the host's Unicode tables, and keeps accents for listed scripts only

**What**: three limits of the nickname cleaner.
- **Host tables.** It uses `\p{L}`, `\p{M}`, `\p{Script=…}`, `\p{Script_Extensions=…}`, `\p{Default_Ignorable_Code_Point}` and `normalize('NFKC')`, whose answers come from the JavaScript engine's Unicode version. A letter added in a recent Unicode version is kept by a newer Node and dropped (as unassigned) by an older browser, and Script_Extensions data changes more often still. So two engines can clean the same typed name differently. That is harmless where the stored name is what shows: the authority stores its result, and the kid's own screens show that. Two places clean again: the name boxes' "It will be called …" previews (the pause menu's and the title's), in the browser, and a friendly match, whose server cleans every nickname a page brings (`matchTeam`) with Node's tables and shows both players the result; either could differ from the stored name in that rare case.
- **Listed scripts only.** Accent marks are kept for Latin, Greek and Cyrillic and for the scripts in `SCRIPTS_WITH_MARKS`. Rarer scripts (Meetei Mayek, N'Ko, Adlam, Tai Tham, Baybayin…) keep their letters and lose their vowel signs.
- **Joining controls.** ZWJ and ZWNJ are dropped as default-ignorable, although they change how Sinhala ("ශ්‍රී") and Persian ("علی‌رضا") letters join.

**Why deferred**: the players are Danish and English-speaking kids, and the only authority that stores a nickname is in the browser. The fixes cost more than they are worth today. Every script's marks would need the full, generated list of Unicode scripts, guarded against engines that don't know the newest names. Joiners would need to be kept only between two letters of one script. With a server authority, the server's result is the truth and the client only displays it.

**Trigger**: a player whose name needs one of these, or the first rename run on the server. At that PR, check that nothing but the server cleans a name that is stored, and decide whether the preview needs the server's answer.

### A browser keeps at most 200 games left for a new one

**What**: New game on the title moves the saved game to the first free slot of `animath.save.previous` (`.2` … `.200`; an account's `previous` key alike) and never writes over one. With all of them taken, the saved game stays in the save key and the new game is not saved in the browser: it plays, and after a reload the title offers the old game again. An account's new game goes to the server when that is reachable, and once it has landed the page settles with the server and takes it; a guest's lives only as long as the page. No saved game is lost, but the new one doesn't stick, and nothing tells the kid.

**Why deferred**: every try of a starter puts one game away, but 200 is years of trying at this household's pace, and making room means deleting a kid's game, which [[DECISIONS]] § Saves rules out; the fix is a decision (drop games with nothing in them, a size budget, or, for an account, letting the server's `account_save_backups` be the only copy past a point).

**Trigger**: a report of a new game that did not stick, or `animath.save.previous.100` showing up in a kid's browser.

### The witch doctor's Heal tab lists every animal of a kind, where the HUD shows one card

**What**: the witch doctor's lists read the party's bundles (`bundles`), and Set free gives each kind of several a row of its own ("Rabbit ×12") that picks the whole kind (#75). Heal still lists each animal, grouped by kind with a line between kinds, and has no row for a kind. So a kid meets twelve rabbits as one card in the HUD and as twelve rows at the witch doctor's Heal tab.

**Why deferred**: Heal is where each animal's HP shows, and one puzzle already heals the whole kind whichever of its hurt animals is picked. A kind's row there would be a second way to the same puzzle, not a shortcut.

**Trigger**: a save with more than 20 hurt animals of one kind, so the heal list outgrows the card, or a report that Heal and the HUD read as different teams. Then give Heal a row per kind of several that opens its puzzle, as Set free's row picks its animals.

### Two tabs writing the save in the same instant: the one written over is kept aside, not merged

**What**: compare-before-write (`Autosave.commit`) is not atomic across tabs. A page's view of `localStorage` is brought up to date only between tasks, so two tabs that write in the same instant both pass the check, and the first write is lost from the key. A two-page probe in headless Chrome lost 4,999 of 10,000 checked writes. The page written over keeps its own save aside when it finds itself behind (`keepOwnSave`, into `animath.save.replaced`), so nothing is gone. But what the kid did there is no longer in play: they see the other tab's game, and only the human can put the kept one back ([[DEVELOPMENT]] § Database). A lock around the write (Web Locks) would not close it on its own, because the lock's grant and the other page's write reach a page by different routes.

**Why deferred**: one kid cannot make two saves in the same instant. A page writes the save only on the kid's own input, with one exception, which happens once and rarely: taking a bigger game from the server.

**Trigger**: a feature that writes the save without the kid's input (a timer, a reward that grows over time, a second player on one device), or a report of a game found kept aside after playing in two tabs. Then merge a walk-versus-progress race back into play: carry on from the other save when it only walked since this page's previous save, and write this page's progress on top.

### An account's save over 1 MiB does not reach the server, and one over 64 KiB misses the send as the page closes

**What**: a party has no cap, so a save grows with it: about 80 bytes an animal, up to 140 with a long name in 4-byte letters, twice that mid-battle. The tiles a kid cleared take up to `EDITS_BUDGET` more (24,000 characters, far from home past it), which brings the `keepalive` limit below closer: a kid who has chopped thousands of tiles reaches it with some 150 animals mid-battle with long names. The server refuses a body over `SAVE_MAX_BYTES` (1 MiB, about 3,500 animals in the worst case) with a `413`, which the autosave treats as a bug: one `console.error`, and nothing more sent that visit; the game in the browser is saved as always. Separately, the save sent on `pagehide` and when the page is hidden uses `fetch`'s `keepalive`, which browsers cap at 64 KiB of body: a bigger save (some 230 animals mid-battle with long names, 400 without) fails that request quietly, and the server's copy waits for the next ordinary send (1 s after something that matters, 15 s after walking), which a hidden tab still makes.

**Why deferred**: no kid is near either size; catching 400 animals takes well over ten hours of play.

**Trigger**: a save in the `account_saves` table over 48 KB (`pg_column_size(data)`), or any party past 300 animals. Then send a save too big for `keepalive` without it, and split or compress the save before it nears `SAVE_MAX_BYTES`.

### A card's list is built whole, however many animals it holds

**What**: opening a card in the HUD or the pause menu builds a row for every animal of that kind at once (the switch list and the witch doctor's list likewise list the whole team). A card of 120 rabbits took 60–100 ms of script and layout to come up at a load average of 40–77 (six took 4 ms): a hitch of a few frames when the card opens, none while it is open or while walking.

**Why deferred**: a card of a hundred of one kind is far from any kid's team today, and drawing only the rows in view fights the lists' shared columns, which are sized by the longest name.

**Trigger**: a kid's save with a card past 150 animals, or a stutter reported when a card opens. Then draw only the rows in view (fixed row heights, the name column sized from all the names), or build the rows over a few frames.

### Presence and friendly matches live in one server process's memory

**What**: who is in which world, where, and who sees whom (`PresenceHub`), and the invites and matches (`Matches`), are kept in the memory of the Node process that holds each socket. A restart forgets it (every page says where it is again as its socket comes back, within a second on a deploy), and two processes split every world in two, each half blind to the other (and two players on different processes can't challenge each other: the one asked is not there, 'gone'): a deploy's swap does that for its few seconds, to a page that opens its socket while two copies run.

**Why deferred**: one process serves the game between deploys; forgetting on a restart costs nothing a page doesn't put back by itself, and a friend missing for the seconds of a swap is back at its next hop.

**Trigger**: a second server process serving at the same time for longer than a deploy's swap (a cluster, a second container kept for load): then presence moves to one place both reach, or each world to one process.

### An older build drops a saved battle that a newer build's content, other than a new id, made

**What**: an older build calls a save a newer build's (`readSave`'s `newer`) only by the ids in it ([[INVARIANTS]] § "A save a newer build wrote…"): a later `version`, a species, or a battle's realm or puzzle kind it does not have. A newer build that grows existing content without a new id makes battles an older one cannot pick up: an attack added to a species (the saved puzzle's `attackIndex` is past the older list), a realm a species newly goes to (an animal that may not fight there), a new battle phase, a raised `maxHp` or difficulty. `readBattle` drops such a battle as if the kid had run away, and the older build's next write, a same-game save with a higher `seq`, replaces it in the browser and on the server with no copy kept: the wild animal and the puzzle are gone, and nothing else is (the party's HP is the save's own).

**Why deferred**: no change so far is one (#89's species came with new ids, and #91 gave seven birds that had shipped a new realm, `air`, whose id is seen), and classifying these battles as `newer` is not safe: content has shrunk as well as grown (the turtle lost its third attack, `shell-spin`, in the PR that made the sea animals twins), so an older save can hold the same shapes, and calling it newer would lock that kid out of their game for good.

**Trigger**: the first PR that adds an attack to a species that has shipped, a realm older builds know to one, a battle phase, or raises a species' `maxHp` or the difficulty range. That PR bumps `SAVE_VERSION` with an upgrade that changes nothing but the number (every older document stays readable, and an older build calls every newer one `newer`), or keeps the save's text aside wherever a load drops a battle.

### Two server test runs in one checkout at once share its test database

**What**: each checkout's server tests have a database of their own ([[DEVELOPMENT]] § Database), so runs in two worktrees never meet. Two runs started in the same checkout at once (a `pnpm test` in the background and a `pnpm -F @mathgame/server test` beside it) still share it, and meet what runs in two worktrees met before #100: the second's global setup empties the tables under the first, both register the same account names (one gets a `409`), and the second's truncate can deadlock with the first's queries and fail its setup. The first run ever in a checkout can also race itself to create the database.

**Why deferred**: an agent runs one suite at a time in its own worktree. A database per run costs a create and a migration on every run, and a cleanup for every run that dies; a lock held for a whole run keeps a second run waiting as long as a `vitest` in watch mode stays open.

**Trigger**: a server test failure traced to two runs in one checkout.

### A big screen that could afford 2 pixels per CSS pixel draws 1.5

**What**: `pixelRatioFor` ([[DECISIONS]] § Client) draws every screen bigger than a phone at 1.5 device pixels per CSS pixel, on an M-series Mac or a new iPad Pro as on an older iPad. Edges there are a little softer than at 2.

**Why deferred**: stepping the ratio up on a device fast enough to keep 60 frames a second needs to know what bounds its frames, and neither Safari (no GPU timer query) nor the frame rate says: an iPad in Low Power Mode caps frames at 30 as a slow GPU would, and a busy main thread slows them too. A fixed ratio never guesses wrong.

**Trigger**: the human or a kid finds the world soft on a big screen, or Safari ships `EXT_disjoint_timer_query_webgl2`. Then raise it towards 2 while measured GPU time leaves room, and never above what kept 60.

### A campfire's glow is painted on the main thread

**What**: a tent's glow (`campfire.ts`) is worked out in JavaScript when its chunk comes into the ring, some two thousand triangles of the ground, the tent and every prop within 3.5 tiles: about 3 ms on this Mac, and on a CPU four times slower about 25 ms a tent (three tents, 76 ms, on 2026-09-28), spread over the ring's work (`ChunkRing.work`) in steps of a few milliseconds (`glowSteps`); walking back and forth across chunk borders there, the worst frame took 28 to 42 ms of main thread. The glow is painted again whenever its chunk is built.

**Why deferred**: it is off screen when it runs (the ring's edge), one tent at a time, and spreading it is what the ring's work already does. Painting it in a worker, or keeping the glow of the tents seen last, costs a worker's plumbing or memory for a hitch nobody has reported.

**Trigger**: a frame over 50 ms traced to `paintGlows` on a real tablet, or a report of a stutter when a tent comes into the ring. Then paint in a Web Worker (the glow is pure arithmetic on tiles and shapes) and hand the arrays back.

### An account's name is checked once, when the account is made

**What**: presence shows an account holder by the account's name (`presence/socket.ts`), which `checkName` judged at registration (`routes/account.ts`) and nothing judges again, where a guest's name is checked at every `hello` and a saved name at every load (`restoreGame`). If the name rules grow (a word added to the rude list in `names.ts`), an account named before keeps its name and shows it to other players, and [[INVARIANTS]] § "A player's name is always one `checkName` keeps" stops holding for it.

**Why deferred**: the rules have not changed since accounts shipped, and a name the rules come to refuse needs somewhere to go: an account has no way to change its name, and its kid logs in by it.

**Trigger**: the first change to the name rules after accounts shipped. In the same PR, check every account's name against the new rules, and decide how an account whose name they refuse is shown to others and renamed.
