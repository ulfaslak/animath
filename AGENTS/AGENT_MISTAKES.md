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

### 2026-09-24 — repo setup — a test that greps source matched its own explanatory comment `[not codified]`

The engine purity test asserts no `Math.random` in `src/`; the first run failed on the doc comment in `rng.ts` that says "the engine never calls `Math.random`". Fix: the test strips comments before matching. Lesson: a source-scanning test must decide up front whether prose counts. Would become `[learned]` with a line in [[DEVELOPMENT]] § Testing ideology about source-scanning tests.
