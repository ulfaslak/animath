# Invariants

What must stay true at runtime, and the failure that taught it.

**Admission test: could you write a test that fails when this stops being true?** If yes, it belongs here. A choice among alternatives goes in [[DECISIONS]]. Where code lives goes in [[ARCHITECTURE]]. Anything a player can observe goes in [[PRODUCT]]. A fact that is here is not in those files — a second copy drifts, and the two disagree silently.

**One entry per invariant.** The `###` heading states the rule, phrased so it can be violated. Under it: the mechanism that enforces it, and the incident that made it necessary (or "design-time" when it was set before any incident).

An entry that no longer matches the code is a bug in one of them. Find out which before you trust it.

---

## Engine purity

### The engine imports nothing from outside its own package

No DOM, no Three.js, no Node built-ins, no npm packages. It must run byte-for-byte identically in a browser and on the server, because multiplayer moves the authority from one to the other. Enforced twice: `packages/engine/tsconfig.json` has `lib: ["ES2022"]` and `types: []`, so a reference to `window` or `process` fails to compile; `test/purity.test.ts` scans every source file and fails on a non-relative import. Design-time.

### The engine never reads ambient randomness or the clock

Every random draw goes through an `Rng` the caller constructed from a seed, and nothing reads `Date.now`. A battle, a chunk, a puzzle can then be replayed exactly from `(seed, intents)`, which is what lets a client predict and a server verify without disagreeing. Enforced by `test/purity.test.ts` (comment-stripped source grep) and by `rng.test.ts` / `world.test.ts` / `puzzles.test.ts` asserting equal output for equal seeds. Design-time.

### A chunk is a pure function of `(seed, cx, cy)`

Generating chunk `(4, −2)` alone yields the same tiles as generating it after `(3, −2)`, and tile `(x, y)` is the same whether asked via its chunk or via `tileAtWorld`. Per-tile randomness is derived from `hashInts(seed, x, y, …)`, never from a shared generator whose state depends on call order. Enforced by `world.test.ts` ("pure function", "no seams"). Design-time.

## Puzzles

### Every puzzle's answer is a whole number and matches its prompt

For every kind, at every difficulty in the kind's declared range, `answer` is an integer and an independent re-solve of `prompt` yields it. Division builds the dividend from the answer; square roots square the answer; sequences are generated from a closed form. Enforced by `puzzles.test.ts`, which re-parses each prompt with its own solver over 200 seeds per (kind, difficulty). Design-time.

### Answers are judged in the engine, never in the UI

`checkAnswer(puzzle, input)` is the only place a submitted answer is compared. The UI passes the raw string through; the authority calls `checkAnswer` and emits the result. When the authority moves to the server, a client cannot claim a hit it did not earn. Enforced by review (grep the client for `=== puzzle.answer` / `.answer ===` during Phase 2.5). Design-time.

### Difficulty is monotonic in tier, attack index and level

`puzzleDifficulty(tier, n, level)` never decreases when any argument increases, and `(1, 1, 1)` maps to 1 while `(5, 4, 3)` maps to 10. Enforced by `puzzles.test.ts` § difficulty mapping. Design-time.

## Battle

### Within a species, damage strictly increases with attack index and with level

`attackDamage(spec, n, level, solved)` is strictly greater than `attackDamage(spec, n−1, level, solved)` and than `attackDamage(spec, n, level−1, solved)`; attack N at level 3 is the species maximum and attack 1 at level 1 its minimum. Holds because `power` strictly increases along `attacks` and the level multipliers `[1, 1.6, 2.4]` are increasing; rounding cannot break it as long as consecutive powers differ by ≥ 1. Enforced by `battle.test.ts` over every species in the catalog — a new species with a non-increasing power table fails the suite. Design-time.

### A wrong answer deals zero damage

`attackDamage(…, solved = false)` is 0. No partial credit, no consolation hit. Enforced by `battle.test.ts`. Design-time.

### Catch probability is non-increasing in HP fraction and never a certainty

`catchProbability(hp, rate, leash)` is monotonically non-increasing in `hp`, halves every 0.2 of HP, and is capped at 0.95 regardless of leash quality. Enforced by `battle.test.ts` § catchProbability. Design-time.

## World

### The spawn point is walkable

`spawnPoint(seed)` returns a grass tile for every seed; a player never starts inside water or a tree. Enforced by `world.test.ts` over 25 seeds. Design-time.

### Doctor's tents appear in every direction from the start

The tent lattice is tested with a modulo that is never negative. JavaScript's `%` keeps the sign of the left operand, so `x % 23 === 5` can never hold for a negative `x`. Any lattice or periodic placement over world coordinates must use the same non-negative `mod`. Enforced by `world.test.ts` ("places tents in every quadrant"). Taught by #2: for the `'prototype'` seed, every tent sat south-east of (0, 0), and a player who went north or west would never have found a doctor.
