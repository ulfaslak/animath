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

### Operands climb with difficulty: every band has a floor, and both ends are non-decreasing

For every kind but `sequence`, the smallest and the largest number shown in a prompt are non-decreasing in difficulty (per operation, since `missing` mixes "+ ?" and "× ?"), nothing above difficulty 1 is "+ 1" / "× 1", and a puzzle at difficulty `d` shows a bigger number than any puzzle at `d − 2`. For sequences, each pattern's smallest answer is non-decreasing in difficulty and strictly bigger two difficulties up, and only difficulty 1 counts by ones. Operands, steps and starting terms are drawn from `[lo, hi]` bands (`arithmetic.ts`, `sqrt.ts`, `sequence.ts`), never from `[1, max]`. Enforced by `puzzles.test.ts` § difficulty ladder over 300–600 seeds per (kind, difficulty). Incident: #7 — operands had ceilings only, so a difficulty-3 attack asked "4 + 1", "16 − 15" and "8 + ? = 9" three puzzles in a row, and difficulty 10 could ask "√9" or "1, 1, 2, 3, ?".

### A sequence prompt fits exactly one pattern

Every sequence prompt fits exactly one of the patterns a kid is taught — equal gaps, a constant ratio, adding the last two, gaps that grow by a constant — so the generator's answer is the only right one. Add-the-last-two never starts with a pair `a, b` where `2b = 3a`, because its gaps then also grow by a constant. Enforced by `puzzles.test.ts` ("no prompt fits two patterns"), which reads every prompt with each pattern independently of the generator. Incident: PR #10 — "2, 3, 5, 8, ?" was asked at difficulty 7–10 expecting 13, while "the gaps grow by one" answers 12.

### Answers are judged in the engine, never in the UI

`checkAnswer(puzzle, input)` is the only place a submitted answer is compared. The UI passes the raw string through; the authority calls `checkAnswer` and emits the result. When the authority moves to the server, a client cannot claim a hit it did not earn. Enforced by review (grep the client for `=== puzzle.answer` / `.answer ===` during Phase 2.5). Design-time.

### Difficulty is monotonic in tier, attack index and level

`puzzleDifficulty(tier, n, level)` never decreases when any argument increases, and `(1, 1, 1)` maps to 1 while `(5, 4, 3)` maps to 10. Enforced by `puzzles.test.ts` § difficulty mapping. Design-time.

## Battle

### Within a species, damage strictly increases with attack index and with level

`attackDamage(spec, n, level, solved)` is strictly greater than `attackDamage(spec, n−1, level, solved)` and than `attackDamage(spec, n, level−1, solved)`; attack N at level 3 is the species maximum and attack 1 at level 1 its minimum. Holds because `power` strictly increases along `attacks` and the level multipliers `[1, 1.6, 2.4]` are increasing; rounding cannot break it as long as consecutive powers differ by ≥ 1. Enforced by `battle.test.ts` over every species in the catalog — a new species with a non-increasing power table fails the suite. Design-time.

### A wrong answer deals zero damage

`attackDamage(…, solved = false)` is 0. No partial credit, no consolation hit. In the reducer, an `answer-judged` with `correct: false` is followed by `missed`, never by a player `hit`, and the opponent's HP is unchanged — for any input, including an empty string; a correct one is always followed by a `hit` for exactly `attackDamage`. Enforced by `battle.test.ts` and `battle-reducer.test.ts` § answers over every species pair. Design-time.

### A battle is a pure function of `(seed, party, wild, leashQuality, intents)` and never mutates its input

`applyBattleIntent(state, intent, seed)` returns a new state and leaves the one it was given untouched; the Rng for the n-th accepted intent is `new Rng(hashInts(seed, n))`, so replaying the same intent log from the same seed yields identical states and events, and a rejected intent (wrong phase, bad attack index or level, not an object) returns the same state reference with a single `rejected` event. The seed is passed by the authority on every call and is **not** in `BattleState`: the state goes to the client, and a client that knew the seed could predict every leash roll and every wild attack. This is what lets a client and a server agree without trusting each other. Enforced by `battle-reducer.test.ts`: the catalog sweep deep-freezes every input state, the replay test plays every species pair from the same seed twice and compares, and a test asserts the state has no `seed` key. Design-time.

### A battle always ends, and HP stays a whole number in `[0, maxHp]` on both sides

Every round the wild animal hits for its attack's `power`, which is ≥ 1 for every attack in the catalog, so the party's total HP strictly decreases each round whatever the player answers; damage is clamped at 0 and `startBattle` refuses an animal outside `0..maxHp`, or two animals sharing an id (a duplicate would give the party phantom HP and make writing HP back ambiguous). Enforced by `battle-reducer.test.ts` over every species pair × 25 seeds with a 60%-accurate random player who also throws the leash and occasionally runs, so every outcome is reached, and by `battle.test.ts` (`power ≥ 1`). Design-time.

### A catch happens only on a leash throw whose seeded roll beats `catchProbability`

`leash-thrown.success` is exactly `rng.next() < catchProbability(hp / maxHp, catchRate, leashQuality)` with the battle's own Rng, a success ends the battle `caught` with the wild animal at its current (non-zero) HP, and a failure hands the turn to the wild animal. Enforced by `battle-reducer.test.ts` § the leash, which recomputes the roll independently for every species at four HP bands. Design-time.

### Catch probability is non-increasing in HP fraction and never a certainty

`catchProbability(hp, rate, leash)` is monotonically non-increasing in `hp`, halves every 0.2 of HP, and is capped at 0.95 regardless of leash quality. Enforced by `battle.test.ts` § catchProbability. Design-time.

## World

### The spawn point is walkable

`spawnPoint(seed)` returns a grass tile for every seed; a player never starts inside water or a tree. Enforced by `world.test.ts` over 25 seeds. Design-time.

## Encounters

### Every species in the catalog can be met somewhere

Each biome's encounter table lists exactly the species whose habitats include it, all with positive weight, and for every species at least one habitat grows tall grass within 8 chunks of spawn. A species whose only habitat never generates tall grass is unreachable — which the otter was, because the river biome was water and sand only, until the banks got reeds. Enforced by `encounters.test.ts` ("every species has a biome", "grows tall grass in at least one habitat") over several seeds.

### Fierce animals are rare near spawn and never rarer further out

Inside `SAFE_RADIUS` tiles of the spawn tile, in any biome where a tier-1 species lives, tier 1 holds the majority of the encounter table and tiers 3–5 together hold under 5%; the tier-3+ share is non-decreasing in distance; beyond `WILD_RADIUS` every species in a biome has an equal share. A new species or a retuned ratio that breaks any of these fails the suite. Enforced by `encounters.test.ts` § encounterTable. Design-time.

### An encounter can only start on an encounter tile

`rollEncounter` returns `null` for every tile kind that `isEncounterTile` rejects, without drawing from the rng, so a walk's random stream depends only on the grass steps taken. Enforced by `encounters.test.ts` § rollEncounter. Design-time.
