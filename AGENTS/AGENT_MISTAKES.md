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

### 2026-09-24 — repo setup — a test that greps source matched its own explanatory comment `[not codified]`

The engine purity test asserts no `Math.random` in `src/`; the first run failed on the doc comment in `rng.ts` that says "the engine never calls `Math.random`". Fix: the test strips comments before matching. Lesson: a source-scanning test must decide up front whether prose counts. Would become `[learned]` with a line in [[DEVELOPMENT]] § Testing ideology about source-scanning tests.
