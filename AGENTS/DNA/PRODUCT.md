# Product: Animath

## 1. Vision

A cheerful low-poly adventure for kids in which every attack is a math puzzle. You explore a procedurally generated world, meet wild animals in the tall grass, battle them Game Boy Pokémon style with the animals you have already caught, and catch them with a leash when they are weak. Stronger animals ask harder math and hit harder. There is no grinding for levels: an animal is exactly as strong as the puzzles you can solve with it.

Built for the human's kid and their friends. Single player first, then a shared world where they play together and against each other.

The game is called **Animath**. The repo and package names (`mathgame`, `@mathgame/*`) predate the name and stay as they are.

## 2. Players

- **Kids aged roughly 6–12**. Reading level: short words, big text. The puzzle ladder spans from single-digit addition to three-digit multiplication and square roots.
- **Devices**: a laptop or desktop browser with a keyboard, or a tablet held sideways, played with fingers alone (touch controls, [[UI_SPEC]] § Pointer and touch). A mouse works every menu too. Phones are not a target.
- **No login.** Open the link and you are in. The game is saved in the browser as you play, so a reload, or coming back another day, picks up where you left off; the server keeps a backup under an anonymous id the browser remembers.

## 3. Core loop

Explore → step into tall grass → wild encounter → battle by solving puzzles → catch it (leash) or beat it → heal knocked-out animals at a doctor's tent, and help the animals you don't keep home to the wild for tokens → buy tools with the tokens → venture into fiercer biomes with a stronger party.

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
- **Clearing the way.** With the **axe**, a kid chops down a tree; with the **pickaxe**, breaks a rock: stand next to it, face it, and interact, as with a tent. The tile is ground from then on (a stump on the forest floor, gravel on the mountain), walkable and never tall grass, so it starts no battle; it stays cleared, saved with the game. Trees grow only in the forest and rocks only in the mountains, the snow-capped peaks included. Tall grass, sand, water and tents are never cleared, whatever tools the kid has. Without the tool, facing a tree or a rock says the doctor sells one. Clearing changes where a kid can walk, never who comes out of the grass (§4 "Wild encounters" reads the world as it was made).
- **Room for thousands.** A game keeps every tile its kid cleared, up to about 24 KB of them in the save: thousands of tiles as kids clear them (paths and clearings), fewer only if they are spread one to a chunk all over the world. Past that, the cleared tiles farthest from the kid grow back, a chunk at a time, never one of the 25 chunks round the kid, so the save stays small.

### Animals

- A **species** has a tier (1–5), max HP, a catch rate, 1–4 attacks (typically 2–4) and the biomes it lives in.
- **Animals have no levels.** A species' strength is entirely its attack table and HP. Tier is a label for "how fierce", used to scale puzzles, to decide who comes out of the grass for which lead, and whether a wild animal can miss; catch odds come from each species' own catch rate.
- Attacks are ordered weakest to strongest, n = 1..N. Each attack can be used at level 1, 2 or 3.
- **Damage** grows with both: `damage(n, level) = power_n × [1, 1.6, 2.4][level]`, rounded. Attack N at level 3 is the species' hardest hit; attack 1 at level 1 its softest. Within a species `power` strictly increases with n.
- **Puzzle difficulty** grows the same way. An attack's easy level asks `base[tier] + 0.75·(n−1)`, rounded, with `base = [1, 2, 4, 5, 7]` for tiers 1–5, but never more than 8; each level up asks exactly one more: `difficulty(tier, n, level) = min(round(base[tier] + 0.75·(n−1)), 8) + (level−1)`. So a squirrel asks difficulty 1–4 and a bear 7–10, and every level of an attack asks one difficulty more than the one below it, all the way to 10: medium and hard never ask at the same difficulty. Neighbouring difficulties can still share a puzzle now and then ("Puzzles" below promises bigger numbers two difficulties apart), so a harder level asks harder sums on average, not every time. The cap of 8 only reaches the bear's two strongest attacks, Maul and Crush, which ask 8, 9 and 10 (they asked 9, 10 and 10 before it, #32): their easy and medium each got a step easier for the same damage. Four attacks in the bear's four difficulties must share ladders. Roar, Maul and Crush all ask 8, 9 and 10, so at a given difficulty only the kind of sum and the damage set them apart, and Crush hits hardest.
- Tier ladder in the prototype catalog: squirrel, rabbit, frog (1) · fox, otter (2) · deer (3) · wolf (4) · bear (5). Don't face a bear with a squirrel.
- Each animal has its own mix of puzzles. The squirrel and the rabbit ask sums (adding, taking away, missing numbers, which on their second attack at hard can hide a times-table factor, "Puzzles" below; the rabbit's strongest attack a number pattern). The frog counts in hops: its weakest attack asks number patterns, the other two times tables (the strongest either). It lives in the river reeds and sits between the squirrel and the rabbit: 21 HP, attacks of power 4, 5 and 7.

### Wild encounters

- Each step that lands on **tall grass** has a **1-in-10** chance of starting a wild battle: one encounter per ten grass steps on average, whichever animal leads the party, wherever anything could challenge it (below). No other tile ever starts one.
- **The lead decides who comes out.** The lead (§4 "Party") is the first animal in the party that isn't tired, the one that steps into the battle first, and the player can choose it while exploring. With `L` its tier, a species `k = t − L` tiers above it (`k ≥ 0`) weighs what a tier-`(1 + k)` species weighed before the lead mattered, so the rules below are the starter's, moved up by `L − 1` tiers; for a tier-1 lead nothing changed. A species **one tier below** the lead weighs **1/10** of one of the lead's own tier, near home and far away. **Two or more tiers below**, it never comes out.
- The animal comes from the biome's **encounter table**: every species whose habitats include the biome and that may challenge the lead, plus the visitors below. It appears at full HP.
- **Distance rule.** Fierce animals are rare near the start and ordinary far away. With `d` the straight-line distance in tiles from the spawn tile, `danger = clamp((d − 32) / 96, 0, 1)`; a species `k` tiers above the lead weighs `5^(−k·(1−danger))`, one tier below weighs `0.1`, and the weights are normalised within the biome. Inside the **safe radius** (32 tiles) each tier above the lead is five times rarer than the tier below it; from the **wild radius** (128 tiles) out, every species living in the biome from the lead's tier up is equally likely; in between the ratio shrinks smoothly.
- **Visitors near home.** Animals come down to the water and up the hills: at the river and in the mountains, wherever an animal bigger than the lead lives there, every species of the lead's tier that doesn't live there also comes out, as a visitor weighing `1 − danger`: as much as a resident of the lead's tier inside the safe radius, thinning out to nothing at the wild radius. The meadow and the forest get no visitors. With the starter in front, the squirrels and rabbits come down to the frogs' river, and squirrels, rabbits and frogs go up the hills; with a fox or an otter, foxes and otters come up the hills (the river has nothing bigger than an otter, so no visitors there); with a deer, deer do. Far out, for the starter, the river is frogs and otters and the mountains are wolves and bears. The visitors are what keeps the otters rare by the water near home: without the squirrels and rabbits, the frog's river would be one otter in six there, where it is one in sixteen.
- **Nothing to meet.** Where nothing living in a biome is within one tier below the lead, its tall grass stays quiet. In the prototype: a wolf meets nothing at the river, and a bear nothing in the meadow or at the river. The 1/10 only thins smaller animals out where the lead's tier or bigger lives too: where nothing but one-tier-smaller animals lives, every battle is one of them, on the usual 1 grass step in 10, so a deer at the river meets only otters and a wolf in the meadow only deer. A kid meets smaller animals again with a smaller lead, chosen while exploring (§4 "Party").
- With the prototype catalog, near spawn. **Starter (tier 1) in front**: meadow ≈ 45% squirrel, 45% rabbit, 9% fox, 2% deer; forest ≈ 80% squirrel, 16% fox, 3% deer, under 1% wolf or bear; river ≈ 31% each frog, squirrel and rabbit, 6% otter; mountains ≈ 33% each squirrel, rabbit and frog, under 1% wolf or bear. **Fox or otter**: meadow ≈ 71% fox, 14% deer, 7% squirrel, 7% rabbit; forest ≈ 74% fox, 15% deer, 7% squirrel, 4% wolf or bear; river ≈ 91% otter, 9% frog; mountains ≈ 49% fox, 49% otter, 2% wolf or bear. **Bear**: forest and mountains ≈ 91% bear, 9% wolf. Far out, every species living in the biome from the lead's tier up gets an equal share, so for the starter a far forest is 40% wolf or bear and a far river is half frogs, half otters.
- Promises, for every lead: nothing two or more tiers below it ever comes out; inside the safe radius, in every biome where anything its size or bigger lives, its own tier is the majority and animals two or more tiers above it are under 5% together; the share of those never falls, and the share of its own tier never rises, as you walk away from spawn. With the prototype seed the spawn tile is one step from a river reed: with the starter in front an encounter there is a frog, a squirrel or a rabbit 15 times in 16 and an otter 1 time in 16; with a fox in front it is an otter 10 times in 11 and a frog 1 time in 11.
- River banks are sand with **reeds**: ordinary tall-grass tiles, where encounters go, drawn as reed beds so they read as the river's, on about 3 bank tiles in 10. That is where frogs and otters live.

### Battle

- Turn-based, one action per turn, like the Game Boy games. The player's animal is seen from behind, the opponent from the front.
- The player always acts first. A round is one player action followed by the wild animal's reply, unless the action ended the battle.
- Player's turn: pick an attack and a level → a puzzle appears → answer. **Correct** → full damage for that attack and level. **Wrong** → the attack misses (0 damage) and the turn is over. Once an attack is picked there is no backing out: giving up on the puzzle is the same as answering it wrong. No timer in v1; an open question is whether a gentle timer or a speed bonus should exist.
- The puzzle's difficulty comes from the **player's** animal — `difficulty(tier, n, level)` with that species' tier — and its kind is one the chosen attack can ask. A bear in your party asks bear-hard questions.
- Opponent's turn (wild animal): picks one of its attacks uniformly at random and hits for that attack's level-1 damage (its `power`). Wild animals don't solve puzzles. Facing an animal of its **own tier or a fiercer one**, a wild animal is careful and **misses 44% of the time** (11 attacks in 25); facing a **smaller** animal it never misses. It sizes up whoever is in front, turn by turn: a fox never misses your squirrel, but can miss the bear that steps in after it.
- So a kid who always picks the easiest puzzle (the weakest attack at level 1) and gets it right beats an animal of their own tier about 80% of the time, averaged over the catalog's same-tier pairs; right 7 times in 10, about 46%. The starter squirrel against the squirrels and rabbits of the meadow near home: about 77% and 45%; against the frogs, squirrels and rabbits by the river, 77% and 43%. Against a rabbit alone, the strongest tier-1 animal, it is 62% and 29%; against a frog, 76% and 39%. A frog in front wins about as often as a rabbit: 96% against a squirrel, 72% against a rabbit, 79% against another frog, and near home, against everything that comes out, 76% and 50% (the squirrel: 72% and 44%). One tier up on the easiest puzzle is still a loss (every time, with the prototype catalog), and a battle in which every animal you send out is smaller than the wild one plays exactly as if wild animals never missed.
- Other actions on the player's turn: throw a leash (wild battles), flee (wild battles; always succeeds in v1 and costs nothing), or switch animals.
- **Switching**: instead of acting, send in another party member. The switch is the turn: the wild animal replies at once, against the newcomer, and sizes it up like any animal in front, so bringing in a bigger animal makes a miss possible. You can't switch to the animal already in front or to a tired one, and not in the middle of a puzzle: once an attack is picked, the turn is committed. Every switch you choose hands the wild animal a turn, so switching back and forth only wears your party down and can never stall a battle.
- When the player's animal is knocked out and another party member is still standing, the player picks who steps in: any animal that isn't tired. That switch is free (the wild animal has just had its turn), and then the player chooses an action. HP lost in a battle stays lost afterwards.
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
- Doctors heal a whole species in exchange for a solved puzzle: pick an animal, solve its puzzle, and it and every other hurt animal of its species in the team are back to full HP. Difficulty scales with the tier (`base[tier] + 1`: squirrel, rabbit and frog 2, fox and otter 3, deer 5, wolf 6, bear 8), so healing bears is harder than healing squirrels, and it is the same for one bear as for three. The puzzle's kind is one the animal's own attacks ask, so a kid meets the kind of sum they already know from battle.
- **A wrong answer at the doctor costs nothing.** HP stays where it was and a different puzzle takes its place, as many times as it takes. The player can pick another animal, go back to the list or leave at any time.
- If every animal in the party is knocked out, the player is taken to the nearest doctor's tent and stands beside it, facing it, and the doctor heals the whole party for free. No other penalty (assumption: this is a kids' game).
- **Nearest means on foot**: the fewest steps over walkable ground, never through water, rock, trees or another tent. A tent on an island or boxed in by trees is never where the player wakes up, so they always land somewhere they could have walked to. Ties go to the tent further up, then further left, then the side in front of the door (below the tent), then left, right and behind. If no tent is within 200 steps, a doctor comes to the player instead: they stay where they are, and the party is healed all the same.

### Tokens and the doctor's shop

- **Why wild animals attack.** They are a little bit sick, which makes them grumpy. An animal the kid brings to the doctor is made better and goes home to the wild, and the doctor thanks the kid with **tokens**.
- **Tokens** are a whole number, never below 0, saved with the game. A new game starts with none.
- **Helping animals home.** At the doctor the kid picks any animals of the team, tired ones too (the doctor makes them better first), and always keeps at least one that isn't tired, so the team can still battle when it walks on. Each animal of tier `k` brings `k·(k + 1)` tokens: **2, 6, 12, 20, 30** for tiers 1 to 5. A bigger animal is harder to catch and needs a bigger lead to meet (§4 "Wild encounters"), so it brings more, and catching the smallest animals over and over is the slow way to the shop.
- **The shop** sells tools, one of each, for good: the **axe** (8 tokens; chops trees), the **pickaxe** (13; breaks rocks) and the **boat** (21; sails on water). A tool is on sale only once what it does is built: the axe and the pickaxe are, the boat is not yet. While nothing is, the shop says new things are coming soon. With too few tokens, or a tool already owned, the tool can't be bought, and the card says why.
- **Every token that changes hands is a sum.** Helping animals home asks "You have 12 tokens. You get 8 more. How many will you have?" (`12 + 8 = ?`), once per hand-over however many animals go; buying asks "You have 23 tokens. The axe costs 8. How many will you have left?" (`23 − 8 = ?`). The numbers are the real ones, the engine judges the answer, and only the right answer completes it: the animals go home and the tokens are counted in, or the tool is the kid's and its price comes off. A wrong answer says "Not quite! Try again." and asks the same sum again, at no cost. Backing out, picking something else or leaving is always free, and nothing happens that was not answered.
- **A gentle confirm** comes before a hand-over's sum: "Say bye bye to Fox and Rabbit?", with "No, not now" lit first.
- **What the numbers are for** (a model, not a promise; the numbers are for tuning after play): a kid battles near home with the starter in front, about one battle a minute and a half, catches something in about 2 battles of 5, and hands most catches over. By the engine's own battles, encounter tables and catch odds, with a 7-year-old's pace for each puzzle and beat, that is **0.6 tokens a minute** if every catch goes home and 0.46 if 3 in 4 do, so the axe is in reach after **13–17 minutes**, the pickaxe after **21–28** and the boat after **34–46**: the three prices keep the 3 : 5 : 8 of the 15, 25 and 40 minutes aimed at. A kid who farms squirrels and rabbits at the reed by the start, throwing the leash at every one, gets about 1.2–1.4 tokens a minute: the axe in 6–7 minutes and the boat in about 15–17, twice as fast, not ten times. A fox in front earns about 1.6 a minute, a bear far out about 4.4, so a stronger team brings the later tools sooner.
- **Losing is not a way to tokens**: nothing about a lost battle gives or takes any.

### Puzzles

- Kinds in v1: addition, subtraction, multiplication, division, missing operand ("7 + ? = 12"), next number in a sequence, square root. Every answer is a whole number.
- Difficulty is a 1–10 scalar. Each kind declares the range it supports; each attack declares the kinds it can ask; the engine picks a kind that fits.
- **Every operand comes from a band with a floor and a ceiling**, so a harder attack never asks an easier question: a difficulty-3 attack cannot ask "4 + 1". Both ends of every band climb with difficulty (neither ever falls). For every kind but sequences a puzzle always shows a bigger number than any puzzle of the same kind two difficulties down; a sequence is never one that two difficulties down could ask.
  - Addition, subtraction and the missing addend draw both numbers from one band per difficulty: 1–5 · 6–10 · 11–20 · 21–50 · 51–100 · 101–200 · 201–500 · 501–1000 · 1001–5000 · 5001–10000. Subtraction is the same fact family read backwards (`(x + y) − x`), so nothing is ever "− 0" or "− itself".
  - Multiplication, division and the missing factor are a **big** factor times a **small** one (the times table). Big: 2–5 · 6–9 · 6–9 · 11–20 · 21–50 · 21–50 · 51–100 · 51–100 · 101–500 for difficulties 2–10; small: 2–5 · 2–5 · 6–9 · 6–9 · 6–9 · 11–20 · 11–20 · 21–50 · 21–50. So difficulty 2 is the small tables, 4 is the hard corner of the table (6–9 by 6–9), 5 is teens by a digit, 7 is two-digit by two-digit. Ten is never a factor: "10 × 7" is a freebie. Division is the family backwards (`(big × small) ÷ small`), from difficulty 3; the missing factor hides the big one. From difficulty 4, half of the missing-number puzzles are a missing factor ("4 × ? = 20") instead of a missing addend.
  - Square roots ask for a root in 2–5 · 4–8 · 6–10 · 9–12 · 11–15 · 13–20 · 16–30 · 21–50 for difficulties 3–10.
  - Counting sequences step by 1–2 at difficulty 1, 2–5 at 2, from `d` up to `2d + 2` at 3–9, and 10–25 at 10; only difficulty 1 counts by ones. They start from 0–5 at difficulty 1, 6–10 at 2, and so on in fives up to 46–50 at 10, so two difficulties never ask the same counting sequence.
  - The other sequence patterns join as difficulty climbs — doubling at 3 (tripling too from 6), squares at 5, triangle numbers and add-the-last-two at 7 — and each starts further along the higher it goes: a pattern's first term at difficulty `d` is always bigger than any first term it had at `d − 2`. So a textbook opening ("1, 2, 4, 8", "1, 4, 9, 16", "1, 3, 6, 10") is asked only within a difficulty of the one that introduces it, and at difficulty 10 doubling or tripling starts from 15–25, squares from 8²–12², triangle numbers from the 6th–10th and add-the-last-two from a first term of 6–10.
  - Every sequence has one right answer. It fits exactly one pattern, and it never ends in three evenly spaced numbers unless it counts all the way: "2, 3, 5, 8, ?" is never asked (adding the last two says 13, "the gaps grow by one" says 12), nor is "4, 4, 8, 12, ?" (20, but a kid counting on from the end says 16).
- Input is a number. Answers are judged by the engine, never by the UI.
- The catalog is designed to grow: the kinds to come are in §6, not v1.

### Party

- A party holds up to six animals, in an order the player chooses.
- **The lead is the first animal in party order that is not tired.** It is the one that steps into the next battle and the one wild animals size up before they come out (§4 "Wild encounters"). Once a battle has started, the player decides who is in front: a switch, or picking who steps in after a knock-out (§4 "Battle"); neither changes the party's order. There is no separate "selected" animal: choosing a lead moves it to the front.
- While exploring — not in a battle, not at the doctor — the player can choose any animal that is not tired as the lead, move any animal up or down (a tired one too: a tired animal at the front is simply skipped), and name any animal.
- **Nicknames**: at most 12 characters, from letters (any alphabet), digits, spaces, hyphens, apostrophes and dots. A letter keeps up to four accent marks that belong on it: the usual accents on a Latin, Greek or Cyrillic letter, or its own script's marks for the scripts the engine lists (the Indian scripts, Arabic, Hebrew, Thai, Burmese, Khmer and a dozen more); a script not listed keeps its letters and loses its marks. An accent that no single letter carries counts as a character. Everything else a kid types — emoji, symbols, marks that decorate a letter (an underline, a strike-through, a circle around it) — is left out, runs of spaces become one, and spaces at either end are trimmed. A name with no letter or digit left is no name, and the animal goes by its species' name again.

### Starting out

- The game opens on a **title screen**: Continue (when there is a saved game), New game, and the Language and Sound settings. A throwaway game (below) skips it.
- **New game** lets the player pick their first animal from the **starters**: every tier-1 species (the squirrel, the rabbit and the frog in the prototype; a species added at tier 1 is a starter too). The picked animal can be given a name, or none; the name is cleaned like any nickname (§4 "Party"). The game starts at the spawn tile, facing down, with that one animal at full HP, nothing walked and no doctor visited.
- Every starter is the same size, so every starter meets the same animals on the same steps.
- A throwaway game (`?new`, `?zoo`, `?shop`, or a `?party=` or `?tokens=` without a typo) skips the title, is saved nowhere, and starts with a squirrel, or the `?party=` party, and no tokens, or the `?tokens=` tokens.
- **New game while a game is saved** asks first, and the answer starts on "No". Starting over puts the saved game away: it is kept in the browser and on the server, never deleted, but the game has no way to go back to it; that is a job for the human ([[DEVELOPMENT]] § Database).

### Saving

- **Always saved, never a save button.** The game is saved in this browser after every change (a step or a bump, a battle turn, a catch, a heal, animals helped home, tokens given or spent, a tree chopped or a rock broken, a change to the team), and when the page is hidden or closed. A reload, or coming back another day on the same browser and the same address, carries on exactly where you were: the same place, facing the same way, the same animals with the same HP.
- **A reload is not an escape.** A battle in progress is saved too: a reload picks it up with the same wild animal, the same HP, and the same puzzle if one was up. The step count is saved, so the animals ahead on a walk stay the ones they were; reloading never rerolls an encounter, a battle's puzzle or a throw. A doctor visit is not saved: a reload ends it, what it healed stays healed, and a hand-over or a purchase whose sum was answered stays done; one waiting for its sum never happened.
- **A backup on the server.** Each player's save is also copied to the server, in the background, when the server can be reached. A browser that still knows the player but has lost its save gets the game back from there. The game never waits on the server, except for a moment at start in that case (2.5 s at most), and plays and saves the same without it. A browser that won't store anything says so ("This browser can't keep your game, so it starts new every time.").
- **Two windows.** Both show the same game. A window that falls behind a catch, a battle or anything else made in the other one takes no more play. When you come to it, it loads the newer game and says "You were playing in another window. Here's your newest game!". While it is on screen but you play in the other one, a card says "You kept playing in another window." When the other window starts a new game, this one goes back to the title as soon as you look at it, with Continue on the new game. Nothing is ever rolled back, and nothing played in a window that is behind is thrown away, because none is taken. Walking around in both is fine: the window you play in carries on from where you are.
- **A save that won't load** leaves the title with New game only (unless the server's backup of the game can be read: then Continue picks that up), and the new game starts with a message ("Your saved game didn't load, so here is a new one."). The old save is kept: it stays where it was until you have picked a starter, then it is set aside, never deleted. A save made by a newer version of the game is left alone, and the title asks for a reload.
- **Starting fresh** is New game on the title (§4 "Starting out"): the saved game is put away, not deleted. Nothing in the game deletes a save; clearing the site's data in the browser does. `?new` in the address (like `?party=`, `?zoo`, `?tokens=` and `?shop`) plays a throwaway game that is saved nowhere, leaving the saved one alone.
- **Quit to title** (the pause menu's Start screen row) saves the game as it stands and goes back to the title, where Continue picks it up exactly there.

### Multiplayer (future, shapes today's architecture)

- One shared world per server. Kids see each other walking around.
- Kids can battle each other; winning earns tokens too (§4 "Tokens and the doctor's shop").
- The doctor's shop sells more: better leashes, potions and the like.
- Still login-free: an anonymous identity is enough.

## 5. Feature inventory

What is built and observable today. Keep current: add a bullet when a feature ships, remove it when one is deleted, move items up from §6 as they land.

### Title

- The title screen comes first ([[UI_SPEC]] § Title): "Animath" in big bouncing letters over the world where the game stands, the trainer and the team (or, for a new player, the starters) breathing beside it, the camera drifting slowly. Continue (with the name of the animal that goes first and how many there are), New game, and the Language and Sound settings.
- New game shows the starters side by side, big, and the lit one's card names every kind of sum its attacks ask; the kid picks one with the arrows and Enter, and names it or not. With a saved game, New game asks first ("Start a new game?"), and only a deliberate "Yes" starts over.
- Quit to title: the pause menu's Start screen row saves and goes back to the title; Continue carries on from the same spot.
- Every row, language and choice takes a click or a tap; on the starters a tap on an animal or its name lights it and "Pick the Frog!" picks it.

### Touch and mouse

- Pointer everywhere ([[UI_SPEC]] § Pointer and touch): every row, button and card a key reaches also takes a click or a tap, as the same key press, behind the same guards. In a battle a tap only highlights a row (an attack, Leash, Switch, Run, an animal on the switch list) or sets an attack's level, and Go! does it, since a pick spends the turn; on the starters a tap only lights an animal; everywhere else a tap does the row at once. The result card goes on from a tap anywhere. A tap counts only on what the finger went down on, on the screen it went down on, so a thumb lifted as a battle starts presses nothing.
- Touch controls on a tablet, or after any touch: a D-pad that walks as the arrow keys do (hold to keep walking), Talk and Menu buttons that work with the other thumb still on the D-pad, and a number pad beside every puzzle, so the tablet's own keyboard never covers a sum. Rows and buttons a finger tall; hints that say "tap"; the name boxes use the tablet's keyboard, with the box moved clear of it. A key pressed on a real keyboard switches back to the keys.
- The page behaves as a game on a tablet: no zooming, scrolling, pull-to-refresh or text selection under a finger, and a tablet held upright is asked to turn sideways.

### Explore

- Procedural chunked world with four biomes that read at a glance ([[DESIGN]] § Palette): the meadow's bright grass and flowers, the forest's darker floor crowded with dark pines, young trees and bushes, river banks of sand with reed beds, the mountains' grey-green turf with pebbles, boulder fields and snow on the peaks. Water, tall grass (reeds at the river), trees, rocks and doctor tents, rendered low-poly with a fixed camera.
- The lead walks behind the trainer ([[UI_SPEC]] § Explore mode): the animal that goes first follows one tile behind, bouncing along and turning as it walks, and never gets in the way. When who goes first changes it swaps with a little pop; while every animal is tired nobody follows, until the doctor makes one fit.
- Butterflies flutter over the land round the trainer (and behind the title): decoration, never an animal to meet.
- Grid movement with arrow keys / WASD (Caps Lock or not); blocked tiles (water, rock, trees, doctor tents) stop you; a tap always moves one tile. Browser shortcuts (Cmd+D, Ctrl+S) are left to the browser.
- Chopping and breaking (§4 "World"): facing a tree with the axe, "Press Enter to chop the tree" (the touch controls' Talk reads "Chop" and glows); Enter swings the axe over the trainer's shoulder, and the tree tips over away from the trainer and shrinks away with a few chips of wood flying, leaving a stump. With the pickaxe a rock shakes and cracks into pebbles, leaving gravel, snow and all on the peaks. The trainer walks through the gap at once. Without the tool, the first bump into a tree or a rock says the doctor sells one (once a game), and Enter there says it each time. A chop and a crack sound as the tool lands. Calmer with reduced motion.
- The player is a small trainer figure — a kid in a cap — that faces the way it walks, swings its arms and legs with every step, stands on top of hills and breathes while idle.
- A crude but recognisable low-poly figure for every species, built from primitives with one exaggerated tell each. They fight in battles; the `?zoo` line-up (see [[CHEATSHEET]]) shows them all at once.
- Party HUD: one card per animal in battle order with its name (nickname if it has one) and an HP bar with numbers; a knocked-out animal is greyed with a "tired" tag. With two or more animals each card shows its number key, and the lead is outlined and tagged "goes first".
- Tokens in the top right corner (a gold coin with a heart, "23 tokens"), and under them the tools the kid owns, each with its picture and name.
- Choosing the lead from explore: the number keys pick who goes first (§4 "Party"); a tired animal can't go first, and the message line says so.
- Pause menu (Escape in explore): the team in battle order, where an animal can go first, move up or down, or get a nickname typed in a name box, then the Language and Sound settings, "Keep playing" and "Start screen" (Quit to title). Walking waits while it is open.
- Message line: the latest message for a few seconds, the controls hint for the first few steps, and what Enter does in front of the player: "Press Enter to talk to the doctor" while facing a tent, "Press Enter to chop the tree" or "… break the rock" while facing one with its tool ([[UI_SPEC]] § Explore mode).
- Doctor's tents: facing a tent, Enter opens the doctor's card ([[UI_SPEC]] § Doctor), with three tabs, the kid's tokens beside the doctor's line, and a list that scrolls, grouped by species, for a team of any size. **Heal**: pick a hurt or tired animal, solve its puzzle and it and every other hurt animal of its kind are back to full HP; a wrong answer just brings another puzzle; the list stays live during a puzzle. **Help home**: pick animals to go home to the wild (never the last one that isn't tired), each showing the tokens it brings; "Help them home" asks "Say bye bye to …?" with "No, not now" first, then the sum of the tokens the kid will have; the right answer waves them goodbye ("Bye bye, Fox! It feels much better now.") and counts the tokens in. **Shop**: the tools on sale (the axe and the pickaxe) with their pictures, prices and what they do; buying asks the sum of the tokens left, and the right answer hands the tool over. While no tool is on sale, the shop says new things are coming soon. Escape or Back goes back from a puzzle, Bye leaves at any time. The doctor speaks English and Danish, like the rest of the game, and tells why wild animals are grumpy: they are a little bit sick.

### Encounters and battle

- Wild encounters: each step onto tall grass may start a battle, with the species picked by biome, distance from spawn and tier compared with the party's lead (§4 "Wild encounters"). A stronger lead meets stronger animals as often as the starter meets small ones, never anything two or more tiers smaller, and finds some biomes quiet: a bear meets nothing in the meadow or at the river.
- Frogs live in the river reeds, the first of them one step from the start: a third tier-1 animal, green and squat with big eyes, whose attacks ask number patterns and times tables. Squirrels and rabbits still come down to the water near home, so the otters there stay rare.
- Battle mode, Game Boy style ([[UI_SPEC]] § Battle mode): the two animals face each other on a patch of the biome, with status boxes, a narration line, an action menu (every attack with its own level — easy, medium or hard — then Leash, with a word for how likely a catch is, Switch and Run) and the puzzle panel. Every attack is a puzzle answered by typing a number. The wild animal's reply and knock-outs are played out one line at a time. Mashing through them never picks: every choice that spends something or can't be taken back (the battle's menu, lists and result card, the doctor's list, the title's confirm, starters and name box, and Talk) waits for a quiet moment before a press counts, and Go! lights up when it would.
- Switching animals mid-battle (§4 "Battle"): Switch opens the party list, with tired animals greyed and the one in front marked; the switch takes the turn. After a knock-out the same list asks who goes next, and that pick is free. With a party of one the Switch row is greyed and says to catch a second animal.
- Catching with the leash; a caught animal joins the party (up to six) with the HP it had. With six already, the Leash row says the team is full in place of the odds, and a caught animal hops home: the card says "Good throw!", never that it was caught.
- HP lost in a battle stays lost afterwards; a knocked-out animal stays tired and sits out battles until healed.
- Losing: when the whole party is tired, the result card says "Good try!", and the player is back in the world beside the nearest tent on foot, facing it, with the whole party healed and the doctor's line on the message line (§4 "Knock-out and healing").

### Saving

- The game saves itself in the browser after every change (the tokens and tools, and every tree chopped or rock broken, too), and when the page is hidden or closed; a reload or a later visit carries on exactly where you were, in the middle of a battle or a puzzle included (§4 "Saving"). "Welcome back!" on the message line when the first Continue after opening the page picks the saved game up.
- A backup on the server, sent in the background when it can be reached; a browser that lost its save but still knows the player gets its game back from it.
- Two windows of the game never undo each other: the one that falls behind takes no play, says so on a card while you play in the other, and loads the newer game ("Here's your newest game!") when you come to it.
- A save that cannot be read starts a new game with a message and is kept, set aside once the new game has been played; a newer version's save is left alone. `?new`, `?party=`, `?zoo`, `?tokens=` and `?shop` play a game that is saved nowhere.

### Sound and feel

- Sound: short, soft sounds made while the game runs, no sound files ([[DESIGN]] § Sound) — a jingle when a wild animal jumps out, blips on the menus, a chime for a right answer and a soft bonk for a miss, a thump for a hit, a puff when an animal gets tired, the leash's whoosh, tick-tock and its fanfare or boing, a sparkle at the doctor, coins clinking when tokens change hands, a ding for a new lead and a fanfare for a win. Every sound goes with something on screen.
- Sound setting: on by default, a Sound row in the pause menu and on the title, and M on any screen except while typing; remembered on this device.
- Little flourishes ([[UI_SPEC]] § Sound and juice): an iris that closes on the player and opens on the wild animal, a tired animal lying down to rest in a ring of dust with z's rising over it, sparkles along a healed animal's HP bar, the trainer's walk and the lead's bouncing behind it. A system set to reduce motion gets calmer versions.
- Big moments feel big: a caught animal cheers with a spin and stars while confetti bursts round it and two poppers rain confetti over the scene, and its result card shows its name in big letters over a burst of rays; a win gets a hop and a few stars, and stars round "You won!".

### Language

- The whole game in Danish and English, the animals' and attacks' names included. It starts in the language the browser prefers (Danish or English, else English); Language in the pause menu and on the title switches every word on screen at once and is remembered on this device (`?lang=da` / `?lang=en` in the address picks one for a visit).

### Engine

- Puzzle catalog: 7 kinds across difficulty 1–10, seeded and deterministic.
- Difficulty mapping (tier, attack, level) and healing difficulty.
- Damage and catch-probability formulas.
- Species catalog: 8 placeholder species, tiers 1–5, three of them tier 1 (squirrel, rabbit, frog).
- Wild encounter tables and the per-step roll, indexed on the lead's tier, with visitors of the lead's tier near home at the river and in the mountains where bigger animals live (§4 "Wild encounters").
- Battle reducer: `startBattle` and `applyBattleIntent` play a whole wild battle by the rules in §4 — attacks, puzzles, answers, the wild animal's reply (which can miss an animal its own size or bigger), leash, flee, switching, knock-outs and the player's pick of who steps in — as intents in, events out.
- Party rules (§4 "Party"): `applyPartyIntent` chooses the lead, moves an animal or names it, only while exploring; `normalizeNickname` cleans a typed name; `leadIndex` is the lead that battles and encounters use.
- The starter rule (§4 "Starting out"): `STARTERS` (every tier-1 species) and `chooseStarter`, which refuses anything else and cleans the starter's name; the authority's `new-game` intent asks it.
- World generation (§4 "World"): `generateChunk` builds any 16×16 chunk from the seed (biomes, tall grass and reeds, trees, rocks, water, tents on a sparse lattice), `spawnPoint` finds the start, and `nearestTent` the nearest tent on foot, by the paths the kid cleared too.
- World edits (§4 "World"): `WorldEdits`, the tiles a kid cleared, over the seeded world (`editedTileAt`, `editedChunk`); `clearTile` checks and does a clear (the tool owned, the tile a tree or a rock, beside the kid and faced), and keeps the save's share within its budget.
- The save document (§4 "Saving"): one shape, `SaveV1`, that the client and the server check and read the same way (`validateSave`, `readSave`, `restoreGame`, and `canReplace` for which save wins), with the tokens, the tools owned and the tiles cleared.
- Doctor rules (§4 "Knock-out and healing", "Tokens and the doctor's shop"): whether the player faces a tent, a doctor visit (`startDoctorVisit` and `applyDoctorIntent`, intents in, events out) that heals a hurt species per solved puzzle, helps animals home for tokens (`tokensForTier`) and sells tools, each behind the sum of the tokens after it (`tokenPuzzle`), and the knock-out rule (`takeToDoctor`), which finds the nearest tent on foot and heals the whole party.
- The item catalog: `ITEMS` (the axe, the pickaxe and the boat, with prices and whether each is on sale: the axe and the pickaxe are) and `hasItem`, the check a tool's effect asks.

### Server

- Health endpoint reporting database reachability.
- Anonymous identity: a player is created with one request and gets an id plus a secret; no account, no login.
- One backup save per player, stored and returned as a versioned document (world seed, position, facing, the step and doctor-visit counts, the game's id and the save's number, a party of up to six, a battle in progress). A backup lands only with a higher save number than the one stored; a different game or an unreadable save it replaces is kept aside.

## 6. Not yet built

In rough priority order. Each becomes a GitHub issue when picked up.

1. The boat doing its job, going on sale in the shop as it lands: it sails on water (with sea animals on deep water, the human's son asked). The axe and the pickaxe have landed (§4 "World").
2. Real low-poly animal models (glTF, CC0 sources, see [[DECISIONS]]) with attack animations, replacing the primitive figures.
3. Procedural world v2: rivers that flow, paths, biome shaping, landmarks.
4. Puzzle catalog v2: fractions, decimals, negatives, percentages, word problems, per-child adaptive difficulty.
5. Multiplayer: shared world, other players visible, PvP battles, tokens for winning, more in the shop.
6. Deployment to the Hetzner VPS.
