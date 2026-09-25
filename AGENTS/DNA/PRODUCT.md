# Product: Animath

## 1. Vision

A cheerful low-poly adventure for kids in which every attack is a math puzzle. You explore a procedurally generated world, meet wild animals in the tall grass, battle them Game Boy Pokémon style with the animals you have already caught, and catch them with a leash when they are weak. Stronger animals ask harder math and hit harder. There is no grinding for levels: an animal is exactly as strong as the puzzles you can solve with it.

Built for the human's kid and their friends. Single player first, then a shared world where they play together and against each other.

The game is called **Animath**. The repo and package names (`mathgame`, `@mathgame/*`) predate the name and stay as they are.

## 2. Players

- **Kids aged roughly 6–12**. Reading level: short words, big text. The puzzle ladder spans from single-digit addition to three-digit multiplication and square roots.
- **Devices**: a laptop/desktop browser with a keyboard first. Tablets with touch controls are a planned follow-up, not a v1 target.
- **No login.** Open the link and you are in. Identity is an anonymous id the browser remembers, so progress survives a reload.

## 3. Core loop

Explore → step into tall grass → wild encounter → battle by solving puzzles → catch it (leash) or beat it → heal knocked-out animals at a doctor's tent → venture into fiercer biomes with a stronger party.

## 4. Game rules

This section is the spec the engine implements. Formulas here are the source of truth; the code in `packages/engine` must match them, and a change to either updates the other in the same PR.

### Modes

Two modes only, borrowed from the Game Boy games: **Explore** and **Battle**. Fixed camera angle, no zoom, no rotation. Everything else about the presentation is our own (see [[DESIGN]], [[UI_SPEC]]).

### World

- Grid-based. The player moves one tile at a time in four directions.
- Procedurally generated from a seed, in 16×16 chunks, infinite in every direction. The same seed always yields the same world, so a shared world needs no map download.
- Biomes: **meadow** (easy animals), **forest** (mid), **river** banks (easy–mid, water animals), **mountain** (hard).
- Tiles: grass; **tall grass** (where encounters happen); sand; water, rock and trees (blocked); **tent** (a doctor; blocked too, you talk to the doctor from the tile beside it).
- Doctors sit by a small tent with a campfire, in the woods or near water. Not rare, not everywhere.

### Animals

- A **species** has a tier (1–5), max HP, a catch rate, 1–4 attacks (typically 2–4) and the biomes it lives in.
- **Animals have no levels.** A species' strength is entirely its attack table and HP. Tier is a label for "how fierce", used to scale puzzles and catch odds.
- Attacks are ordered weakest to strongest, n = 1..N. Each attack can be used at level 1, 2 or 3.
- **Damage** grows with both: `damage(n, level) = power_n × [1, 1.6, 2.4][level]`, rounded. Attack N at level 3 is the species' hardest hit; attack 1 at level 1 its softest. Within a species `power` strictly increases with n.
- **Puzzle difficulty** grows the same way: `difficulty(tier, n, level) = base[tier] + 0.75·(n−1) + (level−1)`, clamped to 1..10, with `base = [1, 2, 4, 5, 7]` for tiers 1–5. So a squirrel asks difficulty 1–4 and a bear 7–10.
- Tier ladder in the prototype catalog: squirrel, rabbit (1) · fox, otter (2) · deer (3) · wolf (4) · bear (5). Don't face a bear with a squirrel.

### Wild encounters

- Each step that lands on **tall grass** has a **1-in-10** chance of starting a wild battle: one encounter per ten grass steps on average. No other tile ever starts one.
- The animal comes from the biome's **encounter table**: every species whose habitats include the biome, weighted by tier, plus the visitors below. It appears at full HP.
- **Distance rule.** Fierce animals are rare near the start and ordinary far away. With `d` the straight-line distance in tiles from the spawn tile, `danger = clamp((d − 32) / 96, 0, 1)`, and a tier-`t` species weighs `5^(−(t−1)·(1−danger))`, normalised within the biome. Inside the **safe radius** (32 tiles) each tier is five times rarer than the tier below it; from the **wild radius** (128 tiles) out, every species living in the biome is equally likely; in between the ratio shrinks smoothly.
- **Visitors near home.** A biome with no tier-1 animal of its own — the river and the mountains in the prototype — also gets every tier-1 species as a visitor, each weighing `1 − danger`: as much as a tier-1 resident inside the safe radius, thinning out to nothing at the wild radius. Near home the squirrels and rabbits come down to the water and up the hills; far out the river is otters and the mountains are wolves and bears.
- With the prototype catalog, near spawn: meadow ≈ 45% squirrel, 45% rabbit, 9% fox, 2% deer; forest ≈ 80% squirrel, 16% fox, 3% deer, under 1% wolf or bear; river ≈ 45% squirrel, 45% rabbit, 9% otter; mountains ≈ 50% squirrel, 50% rabbit, under 1% wolf or bear. Far out, every species living in the biome gets an equal share, so a far forest is 40% wolf or bear and a far river is all otters.
- Promises: inside the safe radius, in every biome, tier 1 is the majority and tiers 3–5 together are under 5%; the share of fierce animals never falls, and the share of tier 1 never rises, as you walk away from spawn. With the prototype seed the spawn tile is one step from a river reed; an encounter there is a squirrel or a rabbit 10 times in 11 and an otter 1 time in 11.
- River banks are sand with **reeds**: ordinary tall-grass tiles, looking like any tall grass, on about 3 bank tiles in 10. That is where otters are met.

### Battle

- Turn-based, one action per turn, like the Game Boy games. The player's animal is seen from behind, the opponent from the front.
- The player always acts first. A round is one player action followed by the wild animal's reply, unless the action ended the battle.
- Player's turn: pick an attack and a level → a puzzle appears → answer. **Correct** → full damage for that attack and level. **Wrong** → the attack misses (0 damage) and the turn is over. Once an attack is picked there is no backing out: giving up on the puzzle is the same as answering it wrong. No timer in v1; an open question is whether a gentle timer or a speed bonus should exist.
- The puzzle's difficulty comes from the **player's** animal — `difficulty(tier, n, level)` with that species' tier — and its kind is one the chosen attack can ask. A bear in your party asks bear-hard questions.
- Opponent's turn (wild animal): picks one of its attacks uniformly at random and hits for that attack's level-1 damage (its `power`). Wild animals don't solve puzzles. Facing an animal of its **own tier or a fiercer one**, a wild animal is careful and **misses 44% of the time** (11 attacks in 25); facing a **smaller** animal it never misses. It sizes up whoever is in front, turn by turn: a fox never misses your squirrel, but can miss the bear that steps in after it.
- So a kid who always picks the easiest puzzle (the weakest attack at level 1) and gets it right beats an animal of their own tier about 79% of the time, averaged over the catalog's same-tier pairs; right 7 times in 10, about 45%. The starter squirrel against the squirrels and rabbits near home: about 77% and 46%. Against a rabbit alone, the strongest tier-1 animal, it is 62% and 29%. One tier up on the easiest puzzle is still a loss (every time, with the prototype catalog), and a battle in which every animal you send out is smaller than the wild one plays exactly as it did before misses existed.
- Other actions on the player's turn: throw a leash (wild battles), flee (wild battles; always succeeds in v1 and costs nothing), switch animal (later).
- When the player's animal is knocked out and another party member is still standing, the first standing one in party order steps in automatically; the wild animal's turn is then over and the player chooses again. HP lost in a battle stays lost afterwards.
- A battle ends **won** when the wild animal reaches 0 HP, **lost** when the whole party is knocked out, **caught** on a successful leash throw, or **fled**.

### Catching

- Throw a leash when the wild animal is weak. `P(success) = catchRate × leashQuality × 2^(−hp/0.2)` where `hp` is the fraction of HP remaining, capped at 95%.
- Every 20% of HP halves the odds. A squirrel (rate 0.9) at 10% HP ≈ 64%; a bear (rate 0.2) at 10% ≈ 14%, at 50% ≈ 3.5%.
- `leashQuality` is 1 for the starter leash; better leashes come from the future shop.
- A failed throw costs the turn. A caught animal keeps the HP it had when the leash landed.

### Knock-out and healing

- An animal at 0 HP is **knocked out** and can't battle until healed.
- **Talking to a doctor**: stand on a tile next to a tent, face it and interact. Walking into a tent turns you to face it. Standing beside it without facing it is not enough.
- The doctor helps any animal below full HP, knocked out or only hurt.
- Doctors heal one animal in exchange for a solved puzzle: pick an animal, solve its puzzle, and it is back to full HP. Difficulty scales with the animal's tier (`base[tier] + 1`: squirrel and rabbit 2, fox and otter 3, deer 5, wolf 6, bear 8), so healing a bear is harder than healing a squirrel. The puzzle's kind is one the animal's own attacks ask, so a kid meets the kind of sum they already know from battle.
- **A wrong answer at the doctor costs nothing.** HP stays where it was and a different puzzle takes its place, as many times as it takes. The player can pick another animal or leave at any time.
- If every animal in the party is knocked out, the player is taken to the nearest doctor's tent and stands beside it, facing it, and the doctor heals the whole party for free. No other penalty (assumption: this is a kids' game).
- **Nearest means on foot**: the fewest steps over walkable ground, never through water, rock, trees or another tent. A tent on an island or boxed in by trees is never where the player wakes up, so they always land somewhere they could have walked to. Ties go to the tent further up, then further left, then the side in front of the door (below the tent), then left, right and behind. If no tent is within 200 steps, a doctor comes to the player instead: they stay where they are, and the party is healed all the same.

### Puzzles

- Kinds in v1: addition, subtraction, multiplication, division, missing operand ("7 + ? = 12"), next number in a sequence, square root. Every answer is a whole number.
- Difficulty is a 1–10 scalar. Each kind declares the range it supports; each attack declares the kinds it can ask; the engine picks a kind that fits.
- **Every operand comes from a band with a floor and a ceiling**, so a harder attack never asks an easier question: a difficulty-3 attack cannot ask "4 + 1". Both ends of every band climb with difficulty (neither ever falls). For every kind but sequences a puzzle always shows a bigger number than any puzzle of the same kind two difficulties down; a sequence is never one that two difficulties down could ask.
  - Addition, subtraction and the missing addend draw both numbers from one band per difficulty: 1–5 · 6–10 · 11–20 · 21–50 · 51–100 · 101–200 · 201–500 · 501–1000 · 1001–5000 · 5001–10000. Subtraction is the same fact family read backwards (`(x + y) − x`), so nothing is ever "− 0" or "− itself".
  - Multiplication, division and the missing factor are a **big** factor times a **small** one (the times table). Big: 2–5 · 6–9 · 6–9 · 11–20 · 21–50 · 21–50 · 51–100 · 51–100 · 101–500 for difficulties 2–10; small: 2–5 · 2–5 · 6–9 · 6–9 · 6–9 · 11–20 · 11–20 · 21–50 · 21–50. So difficulty 2 is the small tables, 4 is the hard corner of the table (6–9 by 6–9), 5 is teens by a digit, 7 is two-digit by two-digit. Ten is never a factor: "10 × 7" is a freebie. Division is the family backwards (`(big × small) ÷ small`); the missing factor hides the big one.
  - Square roots ask for a root in 2–5 · 4–8 · 6–10 · 9–12 · 11–15 · 13–20 · 16–30 · 21–50 for difficulties 3–10.
  - Counting sequences step by 1–2 at difficulty 1, 2–5 at 2, and from `d` up to `2d + 2` after that (up to 25 at difficulty 10); only difficulty 1 counts by ones. They start from 0–5 at difficulty 1, 6–10 at 2, and so on in fives up to 46–50 at 10, so two difficulties never ask the same counting sequence.
  - The other sequence patterns join as difficulty climbs — doubling at 3 (tripling too from 6), squares at 5, triangle numbers and add-the-last-two at 7 — and each starts further along the higher it goes: a pattern's first term at difficulty `d` is always bigger than any first term it had at `d − 2`. So a textbook opening ("1, 2, 4, 8", "1, 4, 9, 16", "1, 3, 6, 10") is asked only within a difficulty of the one that introduces it, and at difficulty 10 doubling or tripling starts from 15–25, squares from 8²–12², triangle numbers from the 6th–10th and add-the-last-two from a first term of 6–10.
  - Every sequence has one right answer. It fits exactly one pattern, and it never ends in three evenly spaced numbers unless it counts all the way: "2, 3, 5, 8, ?" is never asked (adding the last two says 13, "the gaps grow by one" says 12), nor is "4, 4, 8, 12, ?" (20, but a kid counting on from the end says 16).
- Input is a number. Answers are judged by the engine, never by the UI.
- The catalog is designed to grow: fractions, decimals, negatives, percentages, word problems, adaptive difficulty per child are all future kinds, not v1.

### Starting out

A new player starts with one tier-1 animal (a squirrel in the prototype). A starter choice of three is planned.

### Multiplayer (future, shapes today's architecture)

- One shared world per server. Kids see each other walking around.
- Kids can battle each other; winning earns tokens.
- Tokens buy better leashes, potions and the like from a shop.
- Still login-free: an anonymous identity is enough.

## 5. Feature inventory

What is built and observable today. Keep current: add a bullet when a feature ships, remove it when one is deleted, move items up from §6 as they land.

### Explore

- Procedural chunked world with four biomes, water, sand, tall grass (including reeds on river banks), trees, rocks and doctor tents, rendered low-poly with a fixed camera.
- Grid movement with arrow keys / WASD; blocked tiles (water, rock, trees, doctor tents) stop you; a tap always moves one tile.
- The player is a small trainer figure — a kid in a cap — that faces the way it walks, stands on top of hills and breathes while idle.
- A crude but recognisable low-poly figure for every species, built from primitives with one exaggerated tell each. They fight in battles; the `?zoo` line-up (see [[CHEATSHEET]]) shows them all at once.
- Party HUD: one card per animal with its name and an HP bar with numbers; a knocked-out animal is greyed with a "tired" tag.

### Encounters and battle

- Wild encounters: each step onto tall grass may start a battle, with the species picked by biome, tier and distance from spawn (§4 "Wild encounters").
- Battle mode, Game Boy style ([[UI_SPEC]] § Battle mode): the two animals face each other on a patch of the biome, with status boxes, a narration line, an action menu (every attack at three levels, with how hard its puzzle is, then Leash and Run) and the puzzle panel. Every attack is a puzzle answered by typing a number. The wild animal's reply, knock-outs and the automatic switch to the next animal are played out one line at a time.
- Catching with the leash; a caught animal joins the party (up to six) with the HP it had. With six already, it goes back into the grass.
- HP lost in a battle stays lost afterwards; a knocked-out animal stays tired and sits out battles until healed.
- **Placeholder for losing**: when the whole party is tired, everyone rests back to full HP and the player is put back on the start tile ("Everyone is tired. You rest and feel better."). §4 says the player is taken to the nearest doctor's tent; that replaces this when doctor healing lands (§6).

### Engine

- Puzzle catalog: 7 kinds across difficulty 1–10, seeded and deterministic.
- Difficulty mapping (tier, attack, level) and healing difficulty — the healing one is not used by anything yet.
- Damage and catch-probability formulas.
- Species catalog: 7 placeholder species, tiers 1–5.
- Wild encounter tables and the per-step roll, with tier-1 visitors near home in the river and the mountains (§4 "Wild encounters").
- Battle reducer: `startBattle` and `applyBattleIntent` play a whole wild battle by the rules in §4 — attacks, puzzles, answers, the wild animal's reply (which can miss an animal its own size or bigger), leash, flee, knock-outs and automatic party switching — as intents in, events out.
- Doctor rules (§4 "Knock-out and healing"): whether the player faces a tent, a doctor visit that heals one hurt animal per solved puzzle (`startDoctorVisit` and `applyDoctorIntent`, intents in, events out), and the knock-out rule (`takeToDoctor`), which finds the nearest tent on foot and heals the whole party. Not wired to the client yet: pressing Enter at a tent still just says "Nothing here yet.", and a lost battle ends in the placeholder rest above.

### Server

- Health endpoint reporting database reachability.
- Anonymous identity: a player is created with one request and gets an id plus a secret; no account, no login.
- One save per player, stored and returned as a versioned document (world seed, position, party of up to six). The client does not use it yet.

## 6. Not yet built

In rough priority order. Each becomes a GitHub issue when picked up.

1. Party management: reorder, nicknames (catching ships, §5).
2. Doctor healing at tents in the client: the doctor's dialogue card, and the trip to the tent after a lost battle, replacing the placeholder rest in §5. The engine rules are built (§5).
3. Save/load in the client: create the anonymous player on first visit, keep the secret, load the save on boot and write it as the game progresses (the server routes exist, see [[ARCHITECTURE]] § HTTP API).
4. Real low-poly animal models (glTF, CC0 sources, see [[DECISIONS]]) with attack animations, replacing the primitive figures.
5. Procedural world v2: rivers that flow, paths, biome shaping, landmarks, spawn tables.
6. Puzzle catalog v2: fractions, decimals, negatives, word problems, per-child adaptive difficulty.
7. Touch controls for tablets.
8. Multiplayer: shared world, other players visible, PvP battles, tokens, shop.
9. Deployment to the Hetzner VPS.
