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
