# Product: Animath

## 1. Vision

A cheerful low-poly adventure for kids in which every attack is a math puzzle. You explore a procedurally generated world, meet wild animals in the tall grass, battle them Game Boy Pokémon style with the animals you have already caught, and catch them with a leash when they are weak. Stronger animals ask harder math and hit harder. There is no grinding for levels: an animal is exactly as strong as the puzzles you can solve with it.

Built for the human's kid and their friends. Single player first, then a shared world where they play together and against each other.

The game is called **Animath**. The repo and package names (`mathgame`, `@mathgame/*`) predate the name and stay as they are.

## 2. Players

- **Kids aged roughly 6–12**. Reading level: short words, big text. The puzzle ladder spans from single-digit addition to three-digit multiplication and square roots.
- **Devices**: a laptop/desktop browser with a keyboard first. Tablets with touch controls are a planned follow-up, not a v1 target.
- **No login.** Open the link and you are in. The game is saved in the browser as you play, so a reload, or coming back another day, picks up where you left off; the server keeps a backup under an anonymous id the browser remembers.

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
- Tier ladder in the prototype catalog: squirrel, rabbit, frog (1) · fox, otter (2) · deer (3) · wolf (4) · bear (5). Don't face a bear with a squirrel.
- Each animal has its own mix of puzzles. The squirrel and the rabbit ask sums (adding, taking away, missing numbers; the rabbit's strongest attack a number pattern). The frog counts in hops: its weakest attack asks number patterns, the other two times tables (the strongest either). It lives in the river reeds and sits between the squirrel and the rabbit: 21 HP, attacks of power 4, 5 and 7.

### Wild encounters

- Each step that lands on **tall grass** has a **1-in-10** chance of starting a wild battle: one encounter per ten grass steps on average, whichever animal leads the party, wherever anything could challenge it (below). No other tile ever starts one.
- **The lead decides who comes out.** The lead (§4 "Party") is the first animal in the party that isn't tired, the one that steps into the battle first, and the player can choose it while exploring. With `L` its tier, a species `k = t − L` tiers above it (`k ≥ 0`) weighs what a tier-`(1 + k)` species weighed before the lead mattered, so the rules below are the starter's, moved up by `L − 1` tiers; for a tier-1 lead nothing changed. A species **one tier below** the lead weighs **1/10** of one of the lead's own tier, near home and far away. **Two or more tiers below**, it never comes out.
- The animal comes from the biome's **encounter table**: every species whose habitats include the biome and that may challenge the lead, plus the visitors below. It appears at full HP.
- **Distance rule.** Fierce animals are rare near the start and ordinary far away. With `d` the straight-line distance in tiles from the spawn tile, `danger = clamp((d − 32) / 96, 0, 1)`; a species `k` tiers above the lead weighs `5^(−k·(1−danger))`, one tier below weighs `0.1`, and the weights are normalised within the biome. Inside the **safe radius** (32 tiles) each tier above the lead is five times rarer than the tier below it; from the **wild radius** (128 tiles) out, every species living in the biome from the lead's tier up is equally likely; in between the ratio shrinks smoothly.
- **Visitors near home.** Animals come down to the water and up the hills: at the river and in the mountains, wherever an animal bigger than the lead lives there, every species of the lead's tier that doesn't live there also comes out, as a visitor weighing `1 − danger`: as much as a resident of the lead's tier inside the safe radius, thinning out to nothing at the wild radius. The meadow and the forest get no visitors. With the starter in front, the squirrels and rabbits come down to the frogs' river, and squirrels, rabbits and frogs go up the hills; with a fox or an otter, foxes and otters come up the hills (the river has nothing bigger than an otter, so no visitors there); with a deer, deer do. Far out, for the starter, the river is frogs and otters and the mountains are wolves and bears. The visitors are what keeps the otters rare by the water near home: without the squirrels and rabbits, the frog's river would be one otter in six there, where it is one in sixteen.
- **Nothing to meet.** Where nothing living in a biome is within one tier below the lead, its tall grass stays quiet. In the prototype: a wolf meets nothing at the river, and a bear nothing in the meadow or at the river. The 1/10 only thins smaller animals out where the lead's tier or bigger lives too: where nothing but one-tier-smaller animals lives, every battle is one of them, on the usual 1 grass step in 10, so a deer at the river meets only otters and a wolf in the meadow only deer. A kid meets smaller animals again with a smaller lead, chosen while exploring (§4 "Party").
- With the prototype catalog, near spawn. **Starter (tier 1) in front**: meadow ≈ 45% squirrel, 45% rabbit, 9% fox, 2% deer; forest ≈ 80% squirrel, 16% fox, 3% deer, under 1% wolf or bear; river ≈ 31% each frog, squirrel and rabbit, 6% otter; mountains ≈ 33% each squirrel, rabbit and frog, under 1% wolf or bear. **Fox or otter**: meadow ≈ 71% fox, 14% deer, 7% squirrel, 7% rabbit; forest ≈ 74% fox, 15% deer, 7% squirrel, 4% wolf or bear; river ≈ 91% otter, 9% frog; mountains ≈ 49% fox, 49% otter, 2% wolf or bear. **Bear**: forest and mountains ≈ 91% bear, 9% wolf. Far out, every species living in the biome from the lead's tier up gets an equal share, so for the starter a far forest is 40% wolf or bear and a far river is half frogs, half otters.
- Promises, for every lead: nothing two or more tiers below it ever comes out; inside the safe radius, in every biome where anything its size or bigger lives, its own tier is the majority and animals two or more tiers above it are under 5% together; the share of those never falls, and the share of its own tier never rises, as you walk away from spawn. With the prototype seed the spawn tile is one step from a river reed: with the starter in front an encounter there is a frog, a squirrel or a rabbit 15 times in 16 and an otter 1 time in 16; with a fox in front it is an otter 10 times in 11 and a frog 1 time in 11.
- River banks are sand with **reeds**: ordinary tall-grass tiles, looking like any tall grass, on about 3 bank tiles in 10. That is where frogs and otters live.

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
- Doctors heal one animal in exchange for a solved puzzle: pick an animal, solve its puzzle, and it is back to full HP. Difficulty scales with the animal's tier (`base[tier] + 1`: squirrel, rabbit and frog 2, fox and otter 3, deer 5, wolf 6, bear 8), so healing a bear is harder than healing a squirrel. The puzzle's kind is one the animal's own attacks ask, so a kid meets the kind of sum they already know from battle.
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

### Party

- A party holds up to six animals, in an order the player chooses.
- **The lead is the first animal in party order that is not tired.** It is the one that steps into the next battle and the one wild animals size up before they come out (§4 "Wild encounters"). Once a battle has started, the player decides who is in front: a switch, or picking who steps in after a knock-out (§4 "Battle"); neither changes the party's order. There is no separate "selected" animal: choosing a lead moves it to the front.
- While exploring — not in a battle, not at the doctor — the player can choose any animal that is not tired as the lead, move any animal up or down (a tired one too: a tired animal at the front is simply skipped), and name any animal.
- **Nicknames**: at most 12 characters, from letters (any alphabet), digits, spaces, hyphens, apostrophes and dots. A letter keeps up to four accent marks that belong on it: the usual accents on a Latin, Greek or Cyrillic letter, or its own script's marks for the scripts the engine lists (the Indian scripts, Arabic, Hebrew, Thai, Burmese, Khmer and a dozen more); a script not listed keeps its letters and loses its marks. An accent that no single letter carries counts as a character. Everything else a kid types — emoji, symbols, marks that decorate a letter (an underline, a strike-through, a circle around it) — is left out, runs of spaces become one, and spaces at either end are trimmed. A name with no letter or digit left is no name, and the animal goes by its species' name again.

### Starting out

A new player starts with one tier-1 animal (a squirrel in the prototype). A starter choice of three is planned: the squirrel, the rabbit and the frog, the catalog's three tier-1 animals.

### Saving

- **Always saved, never a save button.** The game is saved in this browser after every step, every battle turn and every catch, and when the page is closed. A reload, or coming back another day on the same browser and the same address, carries on exactly where you were: the same place, facing the same way, the same animals with the same HP.
- **A reload is not an escape.** A battle in progress is saved too: a reload picks it up with the same wild animal, the same HP, and the same puzzle if one was up. The step count is saved, so the animals ahead on a walk stay the ones they were; reloading never rerolls an encounter, a puzzle or a throw.
- **A backup on the server.** Each player's save is also copied to the server, in the background, when the server can be reached. A browser that still knows the player but has lost its save gets the game back from there. The game never waits on the server, and plays and saves the same without it.
- **Two windows.** Both show the same game. A window that falls behind a catch, a battle or anything else made in the other one reloads into the newer game when you look at it, so nothing is ever rolled back. Walking around in both is fine: the window you play in carries on from where you are.
- **A save that won't load** starts a new game with a message ("Your saved game didn't load, so here is a new one."). The old save is kept: it stays where it was until you have played the new game (a battle, a catch), then it is set aside, never deleted. A save made by a newer version of the game is left alone, and this page asks for a reload.
- **Starting fresh** is clearing the site's data in the browser; nothing in the game deletes a save. `?new` in the address plays a new game that is saved nowhere, leaving the saved one alone.

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
- The player is a small trainer figure — a kid in a cap — that faces the way it walks, swings its arms and legs with every step, stands on top of hills and breathes while idle.
- A crude but recognisable low-poly figure for every species, built from primitives with one exaggerated tell each. They fight in battles; the `?zoo` line-up (see [[CHEATSHEET]]) shows them all at once.
- Party HUD: one card per animal in battle order with its number key, its name (nickname if it has one) and an HP bar with numbers; a knocked-out animal is greyed with a "tired" tag, and the lead is outlined and tagged "goes first".
- Choosing the lead from explore: the number keys pick who goes first (§4 "Party"); a tired animal can't go first, and the message line says so.
- Pause menu (Escape in explore): the team in battle order, where an animal can go first, move up or down, or get a nickname typed in a name box, then the Language and Sound settings and "Keep playing". Walking waits while it is open.
- Message line: the latest message for a few seconds, the controls hint for the first few steps, and "Press Enter to talk to the doctor" while the player faces a tent ([[UI_SPEC]] § Explore mode).
- Doctor's tents: facing a tent, Enter opens the doctor's card ([[UI_SPEC]] § Doctor). Pick a hurt or tired animal, solve its puzzle and it is back to full HP; a wrong answer just brings another puzzle; the list stays live during a puzzle; Bye or Escape leaves at any time. With nobody hurt, the doctor says everyone is fit and happy. The doctor speaks English and Danish, like the rest of the game.

### Encounters and battle

- Wild encounters: each step onto tall grass may start a battle, with the species picked by biome, distance from spawn and tier compared with the party's lead (§4 "Wild encounters"). A stronger lead meets stronger animals as often as the starter meets small ones, never anything two or more tiers smaller, and finds some biomes quiet: a bear meets nothing in the meadow or at the river.
- Frogs live in the river reeds, the first of them one step from the start: a third tier-1 animal, green and squat with big eyes, whose attacks ask number patterns and times tables. Squirrels and rabbits still come down to the water near home, so the otters there stay rare.
- Battle mode, Game Boy style ([[UI_SPEC]] § Battle mode): the two animals face each other on a patch of the biome, with status boxes, a narration line, an action menu (every attack with its own level — easy, medium or hard — then Leash, with a word for how likely a catch is, Switch and Run) and the puzzle panel. Every attack is a puzzle answered by typing a number. The wild animal's reply and knock-outs are played out one line at a time.
- Switching animals mid-battle (§4 "Battle"): Switch opens the party list, with tired animals greyed and the one in front marked; the switch takes the turn. After a knock-out the same list asks who goes next, and that pick is free. With a party of one the Switch row is greyed and says to catch a second animal.
- Catching with the leash; a caught animal joins the party (up to six) with the HP it had. With six already, it goes back into the grass.
- HP lost in a battle stays lost afterwards; a knocked-out animal stays tired and sits out battles until healed.
- Losing: when the whole party is tired, the result card says "Good try!", and the player is back in the world beside the nearest tent on foot, facing it, with the whole party healed and the doctor's line on the message line (§4 "Knock-out and healing").

### Saving

- The game saves itself in the browser after every step, battle turn and catch, and on closing the page; a reload or a later visit carries on exactly where you were, in the middle of a battle or a puzzle included (§4 "Saving"). "Welcome back!" on the message line when a saved game is picked up.
- A backup on the server, sent in the background when it can be reached; a browser that lost its save but still knows the player gets its game back from it.
- Two windows of the game never undo each other: the one that falls behind reloads into the newer game when looked at.
- A save that cannot be read starts a new game with a message and is kept, set aside once the new game has been played; a newer version's save is left alone. `?new` plays a game that is saved nowhere.

### Sound and feel

- Sound: short, soft sounds made while the game runs, no sound files ([[DESIGN]] § Sound) — a jingle when a wild animal jumps out, blips on the menus, a chime for a right answer and a soft bonk for a miss, a thump for a hit, a puff when an animal gets tired, the leash's whoosh, tick-tock and its fanfare or boing, a sparkle at the doctor, a ding for a new lead and a fanfare for a win. Every sound goes with something on screen.
- Sound setting: on by default, a Sound row in the pause menu, and M on any screen except while typing; remembered on this device.
- Little flourishes ([[UI_SPEC]] § Sound and juice): an iris that closes on the player and opens on the wild animal, a ring of dust round a tired animal, confetti round a caught one, sparkles along a healed animal's HP bar, the trainer's walk. A system set to reduce motion gets calmer versions.

### Language

- The whole game in Danish and English, the animals' and attacks' names included. It starts in the language the browser prefers (Danish or English, else English); Language in the pause menu switches every word on screen at once and is remembered on this device (`?lang=da` / `?lang=en` in the address picks one for a visit).

### Engine

- Puzzle catalog: 7 kinds across difficulty 1–10, seeded and deterministic.
- Difficulty mapping (tier, attack, level) and healing difficulty.
- Damage and catch-probability formulas.
- Species catalog: 8 placeholder species, tiers 1–5, three of them tier 1 (squirrel, rabbit, frog).
- Wild encounter tables and the per-step roll, indexed on the lead's tier, with visitors of the lead's tier near home at the river and in the mountains where bigger animals live (§4 "Wild encounters").
- Battle reducer: `startBattle` and `applyBattleIntent` play a whole wild battle by the rules in §4 — attacks, puzzles, answers, the wild animal's reply (which can miss an animal its own size or bigger), leash, flee, switching, knock-outs and the player's pick of who steps in — as intents in, events out.
- Party rules (§4 "Party"): `applyPartyIntent` chooses the lead, moves an animal or names it, only while exploring; `normalizeNickname` cleans a typed name; `leadIndex` is the lead that battles and encounters use.
- Doctor rules (§4 "Knock-out and healing"): whether the player faces a tent, a doctor visit that heals one hurt animal per solved puzzle (`startDoctorVisit` and `applyDoctorIntent`, intents in, events out), and the knock-out rule (`takeToDoctor`), which finds the nearest tent on foot and heals the whole party.

### Server

- Health endpoint reporting database reachability.
- Anonymous identity: a player is created with one request and gets an id plus a secret; no account, no login.
- One backup save per player, stored and returned as a versioned document (world seed, position, facing, step count, party of up to six, a battle in progress). A backup lands only with a higher save number than the one stored; a different game or an unreadable save it replaces is kept aside.

## 6. Not yet built

In rough priority order. Each becomes a GitHub issue when picked up.

1. A title screen.
2. Real low-poly animal models (glTF, CC0 sources, see [[DECISIONS]]) with attack animations, replacing the primitive figures.
3. Procedural world v2: rivers that flow, paths, biome shaping, landmarks, spawn tables.
4. Puzzle catalog v2: fractions, decimals, negatives, word problems, per-child adaptive difficulty.
5. Touch controls for tablets.
6. Multiplayer: shared world, other players visible, PvP battles, tokens, shop.
7. Deployment to the Hetzner VPS.
