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
- Tiles: grass; **tall grass** (where encounters happen); sand; water, rock and trees (blocked); **tent** (a doctor).
- Doctors sit by a small tent with a campfire, in the woods or near water. Not rare, not everywhere.

### Animals

- A **species** has a tier (1–5), max HP, a catch rate, 1–4 attacks (typically 2–4) and the biomes it lives in.
- **Animals have no levels.** A species' strength is entirely its attack table and HP. Tier is a label for "how fierce", used to scale puzzles and catch odds.
- Attacks are ordered weakest to strongest, n = 1..N. Each attack can be used at level 1, 2 or 3.
- **Damage** grows with both: `damage(n, level) = power_n × [1, 1.6, 2.4][level]`, rounded. Attack N at level 3 is the species' hardest hit; attack 1 at level 1 its softest. Within a species `power` strictly increases with n.
- **Puzzle difficulty** grows the same way: `difficulty(tier, n, level) = base[tier] + 0.75·(n−1) + (level−1)`, clamped to 1..10, with `base = [1, 2, 4, 5, 7]` for tiers 1–5. So a squirrel asks difficulty 1–4 and a bear 7–10.
- Tier ladder in the prototype catalog: squirrel, rabbit (1) · fox, otter (2) · deer (3) · wolf (4) · bear (5). Don't face a bear with a squirrel.

### Battle

- Turn-based, one action per turn, like the Game Boy games. The player's animal is seen from behind, the opponent from the front.
- The player always acts first. A round is one player action followed by the wild animal's reply, unless the action ended the battle.
- Player's turn: pick an attack and a level → a puzzle appears → answer. **Correct** → full damage for that attack and level. **Wrong** → the attack misses (0 damage) and the turn is over. Once an attack is picked there is no backing out: giving up on the puzzle is the same as answering it wrong. No timer in v1; an open question is whether a gentle timer or a speed bonus should exist.
- The puzzle's difficulty comes from the **player's** animal — `difficulty(tier, n, level)` with that species' tier — and its kind is one the chosen attack can ask. A bear in your party asks bear-hard questions.
- Opponent's turn (wild animal): picks one of its attacks uniformly at random and hits for that attack's level-1 damage (its `power`). Wild animals don't solve puzzles and never miss.
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
- Doctors heal one animal in exchange for a solved puzzle. Difficulty scales with the animal's tier (`base[tier] + 1`), so healing a bear is harder than healing a squirrel.
- If every animal in the party is knocked out, the player is taken to the nearest doctor's tent. No other penalty (assumption: this is a kids' game).

### Puzzles

- Kinds in v1: addition, subtraction, multiplication, division, missing operand ("7 + ? = 12"), next number in a sequence, square root. Every answer is a whole number.
- Difficulty is a 1–10 scalar. Each kind declares the range it supports; each attack declares the kinds it can ask; the engine picks a kind that fits.
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

- Procedural chunked world with four biomes, water, sand, tall grass, trees, rocks and doctor tents, rendered low-poly with a fixed camera.
- Grid movement with arrow keys / WASD; blocked tiles stop you; a tap always moves one tile.
- Party HUD (name + HP bar per animal).

### Engine (no UI yet)

- Puzzle catalog: 7 kinds across difficulty 1–10, seeded and deterministic.
- Difficulty mapping (tier, attack, level) and healing difficulty.
- Damage and catch-probability formulas.
- Species catalog: 7 placeholder species, tiers 1–5.
- Battle reducer: `startBattle` and `applyBattleIntent` play a whole wild battle by the rules in §4 — attacks, puzzles, answers, the wild animal's reply, leash, flee, knock-outs and automatic party switching — as intents in, events out. Not wired to the client yet, so nothing on screen changes.

### Server

- Health endpoint reporting database reachability.
- `players` and `saves` tables for anonymous identity and progress (nothing writes them yet).

## 6. Not yet built

In rough priority order. Each becomes a GitHub issue when picked up.

1. Battle mode: the battle scene and the puzzle panel, driven by the engine's battle reducer (the reducer itself is built, see §5).
2. Wild encounters in tall grass, weighted by biome and tier.
3. Catching with the leash; party management.
4. Doctor healing at tents.
5. Save/load through the server with the anonymous identity.
6. Real low-poly animal models with idle/attack animations (CC0 sources, see [[DECISIONS]]).
7. Procedural world v2: rivers that flow, paths, biome shaping, landmarks, spawn tables.
8. Puzzle catalog v2: fractions, decimals, negatives, word problems, per-child adaptive difficulty.
9. Touch controls for tablets.
10. Multiplayer: shared world, other players visible, PvP battles, tokens, shop.
11. Deployment to the Hetzner VPS.
