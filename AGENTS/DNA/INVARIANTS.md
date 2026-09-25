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

For every kind but `sequence`, the smallest and the largest number shown in a prompt are non-decreasing in difficulty (per operation, since `missing` mixes "+ ?" and "× ?"), nothing above difficulty 1 is "+ 1" / "× 1", ten is never a factor, and a puzzle at difficulty `d` shows a bigger number than any puzzle at `d − 2`. For sequences, each pattern's first term has both ends non-decreasing in difficulty and a floor above its ceiling two difficulties down (so no sequence is asked at `d` and at `d − 2`), each pattern's smallest answer never falls, and only difficulty 1 counts by ones. Operands, steps and first terms are drawn from `[lo, hi]` bands (`arithmetic.ts`, `sqrt.ts`, `sequence.ts`), never from `[1, max]` or `[0, max]`. Enforced by `puzzles.test.ts` § difficulty ladder, sampled over 300–900 fixed seeds per (kind, difficulty). Incident: #7 — operands had ceilings only, so a difficulty-3 attack asked "4 + 1", "16 − 15" and "8 + ? = 9" three puzzles in a row, and difficulty 10 could ask "√9", "1, 1, 2, 3, ?" or "0, 10, 20, 30, ?".

### A sequence prompt has exactly one right answer

Every sequence prompt fits exactly one of the patterns a kid is taught — equal gaps, a constant ratio, adding the last two, gaps that grow by a constant — and its last three numbers are evenly spaced only when the whole prompt counts, so the generator's answer is the only right one. Add-the-last-two never starts with a pair `a, b` where `2b = 3a` (its gaps then also grow by a constant) or `b = a` (it then ends in a counting run). Enforced by `puzzles.test.ts` ("no prompt fits two patterns"), which reads every prompt with each pattern, and with "count on from the last three", independently of the generator; sampled over 900 fixed seeds per difficulty. Incident: PR #10 — "2, 3, 5, 8, ?" was asked at difficulty 7–10 expecting 13, while "the gaps grow by one" answers 12; "4, 4, 8, 12, ?" expected 20 where counting on says 16.

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

### A battle ends with probability 1, and HP stays a whole number in `[0, maxHp]` on both sides

Every round the wild animal either hits for its attack's `power`, which is ≥ 1 for every attack in the catalog, or misses, which it can only do against an animal of its own tier or fiercer and then with probability `WILD_MISS_CHANCE` = 0.44 < 1. So each round the party's total HP falls by at least 1 with probability ≥ 0.56 whatever the player answers, and a party of total HP `H` is knocked out within a finite number of rounds with probability 1 (expected at most `H / 0.56` rounds against a player who never hits). Damage is clamped at 0 and `startBattle` refuses an animal outside `0..maxHp`, or two animals sharing an id (a duplicate would give the party phantom HP and make writing HP back ambiguous). Enforced by `battle-reducer.test.ts` over every species pair × 25 seeds with a 60%-accurate random player who also throws the leash and occasionally runs, so every outcome is reached, and by `battle.test.ts` (`power ≥ 1`). Design-time; restated when wild misses arrived (the round no longer always costs HP).

### A wild animal misses only an animal of its own tier or fiercer, and exactly when its roll says so

On its turn the wild animal draws its attack (`rng.int(1, N)`) and then a miss roll (`rng.next()`) from the intent's Rng, both every turn; it misses exactly when its tier is ≤ the tier of the party animal in front *on that turn* and the roll is below `WILD_MISS_CHANCE`, emitting `missed { attacker: 'opponent' }` and leaving the party's HP unchanged. Because the miss roll comes after the attack pick and nothing draws after it, every turn against a smaller animal plays exactly as it did before misses existed, so a battle in which every animal that fights is smaller than the wild one replays exactly as before; once a bigger party member steps in, its turns can miss. Enforced by `battle-reducer.test.ts` § the wild animal, which recomputes both draws for every species pair over 40 seeds and checks a fox that knocks out a squirrel and then misses the bear that steps in at the expected rate, by the catalog sweep, and by the seed-2024 golden replay (a fox against a squirrel and a rabbit), which is unchanged. Incident: PR #8's balance table — with wild animals that never missed, a kid on the easiest puzzle who was always right beat an animal of their own tier 15% of the time.

### A catch happens only on a leash throw whose seeded roll beats `catchProbability`

`leash-thrown.success` is exactly `rng.next() < catchProbability(hp / maxHp, catchRate, leashQuality)` with the battle's own Rng, a success ends the battle `caught` with the wild animal at its current (non-zero) HP, and a failure hands the turn to the wild animal. Enforced by `battle-reducer.test.ts` § the leash, which recomputes the roll independently for every species at four HP bands. Design-time.

### Catch probability is non-increasing in HP fraction and never a certainty

`catchProbability(hp, rate, leash)` is monotonically non-increasing in `hp`, halves every 0.2 of HP, and is capped at 0.95 regardless of leash quality. Enforced by `battle.test.ts` § catchProbability. Design-time.

## Authority

### The authority's randomness is keyed by the world seed and its step count, and its seeds never leave it

`LocalAuthority` rolls one encounter after each completed step with `new Rng(hashInts(worldSeed, hashString('encounter'), steps))` and gives a battle the seed `hashInts(worldSeed, hashString('battle'), steps)` of the step it started on; nothing in it reads `Math.random` or the clock except minting an animal's id, which must be unique rather than replayable. So a walk replays — the same steps meet the same animals and the same puzzles — which is what lets a server running the same code agree with a client. The battle seed stays in the authority: events carry only `BattleState`, which has no seed. Enforced by `packages/client/test/local-authority.test.ts` ("a walk meets the same animals and puzzles at the same steps, each with a fresh id") and, for the state, the engine's `battle-reducer.test.ts`. Design-time.

## World

### The spawn point is walkable

`spawnPoint(seed)` returns a grass tile for every seed; a player never starts inside water or a tree. Enforced by `world.test.ts` over 25 seeds. Design-time.

## Encounters

### Every species in the catalog can be met somewhere

For a lead of tier `L`, each biome's encounter table lists exactly the species living there at tier `L − 1` or above — plus, inside `WILD_RADIUS`, every tier-`L` species as a visitor when the biome's residents of tier `L` or above include none of tier `L` — all with positive weight, and for every species at least one habitat grows tall grass within 8 chunks of spawn. So a tier-1 lead can meet every species, and every lead every species no more than one tier below it. A species whose only habitat never generates tall grass is unreachable — which the otter was, because the river biome was water and sand only, until the banks got reeds. Enforced by `encounters.test.ts` ("lists the residents from one tier below the lead up…", "every species can be met somewhere by every lead it may challenge", "grows tall grass in at least one habitat") over every lead and several seeds.

### Fierce animals are rare near spawn and never rarer further out, whoever leads

For every lead tier `L`: inside `SAFE_RADIUS` tiles of the spawn tile, in every biome where anything of tier `L` or above lives, tier `L` holds the majority of the encounter table and tiers `L + 2` and up together hold under 5%; the share of tiers `L + 2` and up is non-decreasing and the share of tier `L` non-increasing in distance; beyond `WILD_RADIUS` every resident of tier `L` or above has an equal share and no visitor remains. It holds by construction: from its own tier up, a tier-`L` lead's table is exactly the tier-1 table of a catalog `L − 1` tiers smaller, visitors included, and a tier-1 lead's table is exactly the one from before the lead mattered. A biome where every resident of tier `L` or above is bigger than the lead keeps the promise through visitors of tier `L` (`encounters.ts`). A new species or a retuned ratio that breaks any of these fails the suite. Enforced by `encounters.test.ts` § encounterTable, which checks the shift against its own copy of the pre-lead rule. Incident: PR #6's tables kept the promise only in biomes with a tier-1 resident, so near spawn the river was all otters and the mountains 83% wolves — and with the prototype seed the tile next to spawn is a river reed, and in 1 world in 7 the nearest tall grass to spawn is on a mountain.

### Nothing two or more tiers below the lead comes out, and the lead never changes how often something does

`rollEncounter(rng, site, leadTier)` never returns a species below `leadTier − 1`, where `leadTier` is the tier of the party's first animal that isn't tired (the authority's call). The encounter chance is the roll's first draw and no table feeds into it, so wherever the biome has anything within one tier below the lead or bigger, a step starts a battle for a tier-5 lead exactly when it would for a tier-1 lead; where the biome has nothing, the roll is `null` without a draw. A stronger lead therefore meets as many animals as the starter, only bigger ones, except in the biomes where it meets none. Enforced by `encounters.test.ts` (the floor over every lead, biome and distance and in sampled rolls on both sides of both axes; "the lead never changes whether a step starts a battle", seed for seed) and by `packages/client/test/local-authority.test.ts` § the lead, which walks the reed by spawn with a squirrel, a fox (in front, and behind a tired squirrel) and a bear. Design-time: the human's rule, 2026-09-25.

### An encounter can only start on an encounter tile

`rollEncounter` returns `null` for every tile kind that `isEncounterTile` rejects, without drawing from the rng, so a walk's random stream depends only on the grass steps taken. Enforced by `encounters.test.ts` § rollEncounter. Design-time.

## Doctor

### A knock-out never strands the player

`takeToDoctor` either leaves the player where they were or puts them on a walkable tile next to a tent, facing it, that is reachable on foot from where the battle was lost. That holds because `nearestTent` is a breadth-first search over walkable tiles from the player, not a straight-line nearest: the tent nearest as the crow flies can be on an island or boxed in by trees, and a kid put there could never walk away, with the position saved. Enforced by `tents.test.ts`, which checks `nearestTent` against its own flood fill over the tent lattice from random starts of every kind and sign and never lets a boxed-in tent be chosen, and by `doctor.test.ts` § takeToDoctor. Design-time.

### A wrong answer at the doctor changes nothing, and healing stops at full

In a doctor visit, an answer `checkAnswer` rejects leaves every animal's HP as it was and puts a different puzzle in place of the one missed; a right one sets exactly the picked animal to its `maxHp`; no step lowers an HP or raises one above `maxHp`. Enforced by `doctor.test.ts` over every species at three HP levels × 25 seeds × every shape of wrong answer, and by a check on every step of every visit that each HP change comes with a `healed` event. Design-time.

### A doctor visit is a pure function of `(seed, party, intents)` and keeps the seed out of its state

Like a battle: `applyDoctorIntent(state, intent, seed)` never mutates its input, draws the n-th accepted intent's puzzles from `new Rng(hashInts(seed, n))`, and returns the same state reference with one `rejected` event for an intent that does not fit. The seed is not in `DoctorState`, which goes to the client; a client that knew it could see the next puzzle before asking for it. Enforced by `doctor.test.ts` (frozen input on every step, the replay sweep, and a check of the state's keys). Design-time.

## Party

### The party changes only while exploring

`applyPartyIntent(party, intent, activity)` refuses every intent — choosing a lead, moving, naming — unless `activity` is `explore`, returning the same party with one `rejected { reason: 'not-exploring' }`. A battle, and a doctor visit, each work on their own copy of the party and write it back when they end: an edit made in the meantime would be undone, and a lead chosen mid-battle would name a different animal than the one fighting. The authority says what the player is doing; the engine applies the rule. Enforced by `party.test.ts` ("changes nothing outside explore") and `local-authority.test.ts` (mid-battle edits are refused, and the battle writes back the party it began with). Design-time.

### The lead is `leadIndex`, wherever it is shown or used

The animal the HUD and the pause menu mark "goes first", the one `startBattle` sends out, the one that steps in after a knock-out, and the one whose tier the authority passes to `rollEncounter` are all `leadIndex(party)`: the first animal in party order with HP above 0. Nothing computes the lead another way, and there is no stored "selected" animal to drift from it: choosing a lead (`select-lead`) moves that animal to the front, and is refused for a tired one. Enforced by `party.test.ts` (after every accepted `select-lead`, and after every move, `startBattle` sends out `leadIndex`) and `local-authority.test.ts` ("a chosen lead is the animal that steps into the next battle", "choosing a lead in explore changes who comes out"). Design-time; anything new that depends on the lead reads it here.

### A stored nickname is a fixed point of `normalizeNickname`

Every nickname in the authority's party came out of `normalizeNickname`, and cleaning it again changes nothing: 1 to 12 code points of letters (each with at most four marks that belong on it: on a Latin, Greek or Cyrillic letter one of the listed accents; on another letter a mark of its own script, for the listed scripts, or a named generic mark such as an Arabic vowel), digits, `-`, `'`, `.` and single inner spaces, at least one letter or digit, NFKC, no mark on anything but a letter, and nothing default-ignorable (the Hangul fillers are Unicode "letters" that draw as nothing, so a name of them would look blank). Every way a nickname enters the party goes through it — a `rename`, and the party the authority starts with (`?party=` today, a loaded save when saves land) — so every screen shows a name as stored and they all agree. One cleaning pass is not enough — about 1 random string in 400 changes on a second pass, because dropping a character can put two Hangul jamo side by side for NFKC to join, and NFKC can turn a letter into an apostrophe look-alike — so the cleaner repeats until a pass changes nothing. Enforced by `party.test.ts` (6,000 strings drawn from hostile Unicode ranges, every rename in random runs of edits, checks that a plainly typed name, in Latin letters or in alphabets that put marks on letters, comes back as typed, and a named list of decorating marks that must all go) and `local-authority.test.ts` ("a party it starts with is cleaned like a rename"). Design-time; a one-pass cleaner fails the fuzz. The adversarial reviews of the party-pause PR found, in turn: every mark dropped (misspelling Hindi and Hebrew names); a cap of two that misspelled Burmese "ကျော်" and pointed Hebrew; and a block list of decorations that missed the underline, the overline and a dozen more. The rule is now an allow rule (a mark stays only on a letter it belongs on), and the named lists pin all three.
