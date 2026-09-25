# Agent Mistakes

Running log of errors found during self-testing (Phase 2 of the test-fix-learn cycle). Each entry records what went wrong and why, so patterns can be identified during deep cleanses.

Entries tagged `[learned]` have been reviewed AND addressed with a **referenced systemic fix** (a named CLAUDE.md item, DNA update, test, or guard). The tag is strict: it means "a fix exists and here is where", never "an agent read this and agrees it was bad". A `[learned]` with no reference is a tagging error — remove the tag or add the reference.

Entries tagged `[not codified]` are the counterpart: the lesson is real, no guardrail states it anywhere, and the entry names what would have to be written for the tag to become `[learned]`. That set is the backlog.

Format: `### YYYY-MM-DD — <issue/PR ref> — <one-line category>` followed by what was wrong, what caused it, how it was found, and the fix.

---

### 2026-09-24 — repo setup — assumed a default port was free `[learned]`

The client dev server was configured on Vite's default port 5173, which another session's dev server on this machine already held; the browser landed on the other app. Found when the first screenshot showed an error page. Fix: client moved to 5180, the collision documented in [[ENVIRONMENT_NOTES]] § "Ports", and `/play` now checks the port before starting. Category: **shared-machine assumption** — a default that is fine on a clean machine is not fine on one running several projects.

### 2026-09-24 — repo setup — trusted a green build over a rendered frame `[learned]`

`svelte-check` and `vite build` were both clean while every ground tile rendered black: the instanced mesh material had `vertexColors: true` with no colour attribute on the geometry, so the shader read zeros. Only the screenshot caught it. Fix: removed the flag; CLAUDE.md Phase 2 now says a rendering change is unverified until an agent has read a screenshot of it. Category: **rendered result vs. passing gate**.

### 2026-09-25 — PR #8 battle reducer — put the authority's secret in client-visible state `[learned]`

The first cut of `BattleState` carried the battle `seed` so the reducer could derive each intent's Rng from the state alone. The state is what `battle-updated` sends to the client, so under a server authority a client could recompute the next leash roll and only throw when it would land. Found by the Phase 2.5 adversarial review. Fix: the seed is passed to `applyBattleIntent` by the authority on every call and is not in the state; [[INVARIANTS]] § "A battle is a pure function of…" states it and `battle-reducer.test.ts` asserts the state has no `seed` key. Category: **seam** — anything in client-visible state is readable by the client; a value that lets it predict the authority's next move must not be there, however convenient for replay.

### 2026-09-25 — PR #8 battle reducer — used `git checkout -- <file>` to undo a negative control, on uncommitted work `[not codified]`

Negative controls (break a guard with `sed`, watch its test fail) were "restored" with `git checkout -- <file>`, which reverts to the last *commit* — and the review fixes in those files had not been committed yet, so they were wiped and had to be re-written from the conversation. Nothing was lost only because the content was still in context. Cause: treating `git checkout -- file` as "undo my last sed" when it means "discard everything since HEAD". Fix here: commit before any negative control; restore with `cp` from a backup taken beside the file (`cp f f.bak … cp f.bak f`), never with git. Category: **destructive git on uncommitted work** — CLAUDE.md already bans `git checkout <ref> -- .` as a diagnostic; the same command with a single path is no safer. Would become `[learned]` with a line in CLAUDE.md § Protecting existing work naming the negative-control recipe (commit first, back up with `cp`).

### 2026-09-25 — PR #8 battle reducer — validated values at the boundary, not identity or shape `[not codified]`

`startBattle` checked every animal's species and HP range but accepted the same animal twice (phantom HP, ambiguous HP write-back) and a wild animal sharing a party member's id; `applyBattleIntent` handled an unknown intent `type` but threw on `undefined`. Found by the adversarial review. Fix: duplicate ids rejected, non-object intents rejected, both tested. Category: **boundary validation** — a validator that walks fields checks each value in isolation; identity (duplicates across a collection) and shape (is it an object at all) need their own line. Would become `[learned]` with a checklist line in [[DEVELOPMENT]] § Testing ideology for engine entry points.

### 2026-09-25 — PR #6 — the engine minted an identity it could not make unique `[learned]`

`rollEncounter` returned an `AnimalInstance` whose `id` came from the rng stream, so two authorities seeded alike, or one replaying a walk after a reload, produced the same id for different animals, while `AnimalInstance.id` promises uniqueness. The type demanded an id, so the engine invented one. Found by the adversarial review. Fix: the roll returns `WildAnimal = Omit<AnimalInstance, 'id'>` and the authority attaches the id; [[DECISIONS]] § Engine now says ids are minted by the authority. Category: **satisfying a type by fabricating a value the function cannot guarantee** — when a required field can't be honoured, change the return type instead of filling it in.

### 2026-09-25 — PR #6 — a malformed coordinate degraded to the worst outcome instead of failing `[learned]`

A `NaN` distance (a missing `pos` or `spawn`) made every table weight `NaN`, and the weighted pick's float-rounding fallback then returned the last entry: the fiercest species, every time, on the safest tile, with every test green. Found by the adversarial review. Fix: `encounterTable` and `rollEncounter` throw on a non-finite distance, pinned by a test in `encounters.test.ts`. Category: **a fallback branch written for rounding also absorbed garbage input** — a "can't happen" fallback needs a guard upstream, or it becomes the behaviour for every invalid input.

### 2026-09-25 — PR #6 — restored a negative control with `git checkout --` and lost uncommitted fixes `[learned]`

To watch a test go red, a guard was stripped from `encounters.ts` with `sed` and the file "restored" with `git checkout -- <file>`. The file also held uncommitted fix commits' worth of edits, so the checkout reverted those too; noticed only because a `grep -c` after the restore printed 0. Fix: re-applied the edits. Rule already in CLAUDE.md § Protecting existing work (`git checkout <ref> -- .` is not a diagnostic). Category: **a restore that targets the last commit, not the last state** — before flipping a line for a negative control, commit first, or restore by re-editing, never with git.

### 2026-09-24 — repo setup — a test that greps source matched its own explanatory comment `[not codified]`

The engine purity test asserts no `Math.random` in `src/`; the first run failed on the doc comment in `rng.ts` that says "the engine never calls `Math.random`". Fix: the test strips comments before matching. Lesson: a source-scanning test must decide up front whether prose counts. Would become `[learned]` with a line in [[DEVELOPMENT]] § Testing ideology about source-scanning tests.

### 2026-09-25 — PR #5 (save routes) — compared a database timestamp to an application one `[learned]`

A test asserted `last_seen_at` (written from Node's `new Date()`) was later than `created_at` (the column's `now()` default) and failed: the Postgres container's clock runs ~120 ms ahead of the host, so the "later" write carried the earlier time. Fix: the server writes every timestamp with `sql\`now()\``; the offset is recorded in [[ENVIRONMENT_NOTES]] § "The Postgres container's clock". Category: **two clocks** — a row default and an application `Date` are different clocks even on one machine; pick one per table.

### 2026-09-25 — PR #5 (save routes) — validated the shape of a document, not whether the store could hold it `[learned]`

The save validator checked types, ranges and lengths and passed a document through to `jsonb`, which then threw on a NUL character or a lone surrogate (a 500 on a public route) and silently stored `null` for a number `JSON.parse` had turned into `Infinity`. Found by the adversarial reviewer. Fix: a storability walk over the whole document, extras included, with tests and a negative control; the ARCHITECTURE prose now says what "stored as sent" means. Category: **validator stops at the type** — a validator that admits arbitrary extra fields must also check the one thing the type system cannot: that the storage layer accepts every value it lets through.

### 2026-09-25 — PR #10 (#7 puzzle floors) — floored the parameter the bug named, not every parameter that shapes the output `[learned]`

The fix gave counting sequences a step floor, because the incident was a step of 1 at difficulty 10, but left their first term at `[0, 5d]`: "0, 10, 20, 30, ?" stayed askable at every difficulty from 4 to 10, and 40% of difficulty-10 sequences were word-for-word difficulty-8 ones. In the same PR a commit claimed "no × 10 freebie at difficulty 4" after removing 10 from the small factor only; the big factor still made "10 × 7" one puzzle in five. Both were found by the adversarial review. Fix: every parameter of a prompt (steps, first terms, both factors) comes from a band, and the tests check what the kid reads — first terms two difficulties apart, the factors in the prompt and the answer — not the table that was edited ([[INVARIANTS]] § "Operands climb with difficulty"). Category: **verified the knob, not the output** — when a property is about what a player sees, enumerate every input that reaches the screen and test the rendered prompt, not the variable you changed.

### 2026-09-25 — PR #10 (#7 puzzle floors) — a re-solve proved an answer was right, not that it was the only right one `[learned]`

`puzzles.test.ts` re-solves every prompt independently, and it passed for "2, 3, 5, 8, ?" (answer 13) because its solver tries equal gaps, then ratios, then add-the-last-two, and stops at the first fit — while "the gaps grow by one" fits the same prompt and says 12. "4, 4, 8, 12, ?" (20) was likewise fine by the solver and read as 16 by any kid counting on. Found while reading difficulty-10 puzzles as a kid would, and by the adversarial review. Fix: the sequence generator skips both kinds of start, and a test reads every prompt with every pattern (plus "count on from the last three") and requires them all to agree ([[INVARIANTS]] § "A sequence prompt has exactly one right answer"). Category: **first match hides ambiguity** — a solver that returns the first rule that fits proves the generator's answer is *a* right answer; uniqueness needs every rule applied and compared.

### 2026-09-25 — PR #11 (doctor rules) — shipped a rule whose result no event could carry across the seam `[learned]`

`takeToDoctor` returns where the player stands, which way they face and the healed party, and the PR's UI_SPEC promised all three after a lost battle. But `protocol.ts` had no event that could deliver them. `player-moved` would tween the player across a hundred tiles, and nothing after `welcome` carried a party. The PR leaned on events another branch had in flight (`player-placed`, `party-changed`), which were not on `main` and had no facing anyway, so the client and authority could disagree about whether the player faced the tent. Found by the Phase 2.5 adversarial review. Fix: a `taken-to-doctor` event carrying `pos`, `dir`, `tent` and `party`. Category: **seam** — an engine rule is not finished until an event on `main` can carry its whole result to the client; CLAUDE.md § During work "Think about the seam" already says so, and an unmerged branch's protocol does not count.

### 2026-09-25 — PR #11 (doctor rules) — wrote DNA prose about another package's behaviour from memory `[learned]`

Two new DNA lines described today's client without checking it. ARCHITECTURE said the client faces `down` "at `welcome`", but it sets `down` once, on page load, so a reconnect would desynchronise facing. PRODUCT §5 said Enter at a tent "does nothing" while CHEATSHEET, in the same diff, said it shows "Nothing here yet.". Found by the adversarial review. Fix: both lines rewritten against `explore/controller.ts` and `authority/local.ts`. Category: **prose is a claim** — the Phase 2 taxonomy in CLAUDE.md already lists it; it applies to lines about code outside the diff, and to two new lines in the same diff that describe one behaviour.
