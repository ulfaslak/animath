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

### 2026-09-25 — PR #12 (starter balance) — pinned a claim only with inputs where it is vacuous `[learned]`

The wild miss rule is judged each turn against the animal in front, and the PR claimed "a fight against a fiercer animal replays exactly as before misses existed" in PRODUCT, INVARIANTS and a code comment. The evidence was the seed-2024 golden replay, a fox against a squirrel and a rabbit: a party in which no member is ever bigger than the wild animal, so the rule could never fire and the replay could not fail. With `[squirrel, bear]` against a fox, the fox misses the bear once the squirrel is out. Found by the adversarial review. Fix: the claim now says "every turn against a smaller animal", and a test knocks the squirrel out and measures the fox's misses on the bear ([[INVARIANTS]] § "A wild animal misses only an animal of its own tier or fiercer"). Category: **a test on the easy side of a condition** — when a rule is re-evaluated as state changes (the active animal, a phase, a position), test the claim across the change, not with an input that keeps the condition fixed.

### 2026-09-25 — PR #13 (battle UI) — read CSS custom properties nothing defined, and every gate stayed green `[learned]`

The battle panel's first pass sized itself with `var(--battle-panel)` and coloured HP bars with `var(--warn)`, and neither was defined anywhere. `svelte-check`, `vite build` and the browser all accept an undefined custom property without a word; the panel simply lost its height. Found by the first screenshot. Fix: both defined in `styles.css`, and `packages/client/test/css-vars.test.ts` fails on any `var(--x)` the UI reads that nothing defines (with `vitest.config.ts` letting tests read CSS). Category: **a token the type checker cannot see** — CSS variables, like class names and data attributes, are strings nothing checks; a design token needs its own test or it fails silently.

### 2026-09-25 — PR #13 (battle UI) — let the task brief overrule the DNA `[not codified]`

The brief asked for "Not quite — it was 12" after a wrong answer; UI_SPEC says the right answer is not shown. The PR built the brief and rewrote the UI_SPEC line to match, reasoning that the spec's rationale no longer held. The orchestrator corrected it: where a brief contradicts the DNA, the DNA wins. Fix: the answer is hidden again and UI_SPEC restored; the one real DNA drift in the same area (UI_SPEC's "Escape backs out to actions" against PRODUCT §4's "no backing out") was fixed the other way, toward PRODUCT and the reducer. Category: **brief vs guardrail** — a brief is written without the DNA in front of it; when they disagree, build the DNA and flag the conflict rather than editing the guardrail to fit. Would become `[learned]` with a line in CLAUDE.md § DNA: "A task brief never overrides DNA: build the DNA and raise the conflict."

### 2026-09-25 — PR #13 (battle UI) — a guard checked the mode, not the identity `[learned]`

The battle screen ignored `battle-updated` "when no battle is on screen", so a late update from an earlier battle, arriving during the next one, would have ended the new battle on screen. A negative control that removed the guard stayed green, which is how it was found: the test fed the stale event only after leaving the battle, where the guard's absence changed nothing visible. Fix: updates must carry the on-screen battle's wild-animal id (minted per encounter), and `battle-controller.test.ts` delivers a stale update in the middle of the next battle. Category: **a negative control that stays green** means the test never reaches the case the guard is for; and a stale-event guard needs identity (which battle), not just state (is there one).

### 2026-09-25 — PR #13 (battle UI) — a word next to a colour promised more than the colour encodes `[not codified]`

UI_SPEC hints at the leash odds with a colour by the wild animal's HP in thirds, and DESIGN says colour is never the only signal, so the row gained words: "hard / maybe / good chance". But the thirds ignore the species' catch rate, so "good chance" in green sat beside a 6% throw at a bear. Found by the adversarial review. Fix: the words now say what the colour encodes, the animal's strength ("strong / weaker / weak"), and the CHEATSHEET says a fierce animal stays hard to catch. Whether the hint should follow the real odds is a question for the human. Category: **the label must not out-promise the signal** — when text is added for accessibility, it inherits exactly the meaning of the colour, not the meaning the colour was hoped to have. Would become `[learned]` with a line in DESIGN § Accessibility saying so.

### 2026-09-25 — PR #13 (battle UI) — a rule's constant lived in two packages `[learned]`

The client authority let a seventh caught animal go with its own `PARTY_LIMIT = 6`, while the server's save validator had its own `MAX_PARTY = 6`: change one and the client builds a party the server refuses. Found by the adversarial review. Fix: `MAX_PARTY` lives in the engine and both import it. The rest of the write-back (which caught animal joins, the lost-battle rest) still lives in the client authority; [[DEFERRED]] records moving it into the engine. Category: **a rule constant outside the engine** — CLAUDE.md § During work says outcomes are engine code; a number that decides one is part of the rule.

### 2026-09-25 — PR #17 (encounters by lead) — described a normalised weight as a frequency `[not codified]`

One tier below the lead weighs 0.1 against 1 for the lead's own tier. The CHEATSHEET said such animals come out "about 1 battle in 10 where there is any", and the constant's comment said "small animals rarely challenge a bigger one". But the tables are normalised: where only one-tier-smaller animals live, 0.1 is 100% (a deer at the river meets only otters, at the full rate), and far out, where big animals crowd in, the share falls to 2.4%. The tables printed for the same PR showed both, two lines apart. In the same diff, PRODUCT §4 told a kid to "put a smaller animal in front", which the build cannot do yet. Found by the adversarial review. Fix: the prose gives the computed range (2–14% where bigger animals live too, 100% where they don't) and says the lead only changes when the animals before it are tired, and HUMAN_TODO asks whether the one-below-only biomes should keep the full rate. Category: **a weight is not a share** — after normalisation, what a weight means depends on what else is in the table. Quote a share only after computing it at the table's extremes (the row alone, near home, far out). Would become `[learned]` with a line in [[DEVELOPMENT]] § Testing ideology saying a share in prose is computed at those extremes.

### 2026-09-25 — PR #17 (encounters by lead) — multiplied a test's cost by a new dimension without timing it `[learned]`

Existing encounter sweeps (every biome × distance, thousands of rolls, an `expect` per roll) gained "× every lead tier". The file went from about 2 s to 7–9 s. Single tests ran 3–5 s against vitest's 5 s default timeout, and one run failed under load from other worktrees. Found by the adversarial review. Fix: failures are collected and asserted once, the sampling test uses an `Rng` whose every chance comes up, and the file runs in about 3 s; [[DEVELOPMENT]] § Testing ideology now says to keep every test well under the timeout and to time a file again when a sweep gains a dimension. Category: **a sweep costs the product of its dimensions**.
