# UI Spec

How the two modes are laid out and behave. Visual language is in [[DESIGN]]; rules are in [[PRODUCT]].

## Frame

- The game is full-screen: one `<canvas>` filling the window, a DOM overlay (`#ui`) on top. The overlay is `pointer-events: none` except for its children, so the canvas keeps focus.
- Minimum supported viewport is a laptop at 1280×720; the layout must also hold at a tablet's 1024×768 landscape. Phone portrait is out of scope for now (a "turn your device" screen is fine).
- The camera never zooms or rotates. Resizing the window changes how much world is visible horizontally; vertical extent stays 14 tiles.

## Explore mode

```
┌────────────────────────────────────────────────────────┐
│ ┌────────────┐                                         │
│ │ Party HUD  │              (3D world)                 │
│ │ name + HP  │                                         │
│ └────────────┘                                         │
│                                                        │
│                          [player]                      │
│                                                        │
│                                                        │
│               ┌──────────────────────────┐             │
│               │ hint / message line      │             │
│               └──────────────────────────┘             │
└────────────────────────────────────────────────────────┘
```

- **Party HUD** (top-left): one card per animal — name (nickname if set), HP bar with `hp/max` text. Knocked-out animals are greyed with a "tired" tag. Never more than six cards.
- **Message line** (bottom-centre): up to two lines in one box. Above, the latest thing said — a `message` event, a line the client words from an event that carries no words (the doctor's lines; `nothing-to-interact`, Enter away from a tent), or, when the game starts, what it found about the save ("Welcome back!" when a saved game was picked up, or why a new game started: "Your saved game didn't load, so here is a new one.") — for 5 seconds, then it fades; the seconds count only while the explore HUD is on screen, so a line said during a battle or a doctor visit is still there to read afterwards. Below, the controls hint ("Arrows / WASD to walk") until the player has walked 5 steps; bumps don't count, since a key held against a wall bumps every frame. With neither, the box fades away.
- **Interaction prompt**: when the player faces a doctor's tent, the lower line shows "Press Enter to talk to the doctor", in place of the controls hint. Enter anywhere else says "Walk up to a tent to talk to the doctor.", which gives way to the prompt as soon as the player faces a tent.
- **Saving shows nothing**: no icon, no "Saved", and nothing when the server is out of reach, because the game is always saved in the browser.
- **Loading**: "Loading…" over an empty screen until the game has started, which is at once when the browser holds the save; only a browser that has lost its save but still knows the player waits, at most a few seconds, for the server's copy.
- **Controls**: arrows/WASD to walk, Enter/Space to interact, Escape opens the pause menu (party, settings, later: bag). Holding a key keeps walking; a tap moves one tile.
- The grid position is not shown to players. `?debug` in the URL puts the position and facing in the top-right corner.
- The player stays centred; the world scrolls under them. Chunks are built 2 chunks out in every direction so nothing pops in at the edge.

## Battle mode

Borrowed composition from the Game Boy games: your animal from behind at bottom-left, the opponent from the front at top-right, status boxes opposite each sprite, and a panel across the bottom. Our addition is a **puzzle area** that takes real space, because solving is the whole game.

```
┌──────────────────────────────────────────────────────────┐
│ ┌──────────────────┐                                     │
│ │ Wild Otter       │                      [opponent]     │
│ │ ▓▓▓▓▓▓░░░░ 18/32 │                       (front)       │
│ └──────────────────┘                                     │
│                                   ┌──────────────────┐   │
│     [your animal]                 │ Squirrel         │   │
│        (back)                     │ ▓▓▓▓▓▓▓░░  15/20 │   │
│                                   └──────────────────┘   │
│           ( Wild Otter used Splash! 5 damage. )          │
├────────────────────────┬─────────────────────────────────┤
│ ▸ Nut Toss    easy 123 │                                 │
│   Scurry Kick easy 123 │          7 × 8 = ?              │
│   Leash       hard  ●  │           [ 56 ]                │
│   Run                  │ Type the answer, then press Enter│
└────────────────────────┴─────────────────────────────────┘
```

- **Entering**: the step into the grass lands first — the world stays on screen for about 0.3 s after the encounter — and then the battle scene replaces it. The explore HUD goes at once.
- **Scene** (above the panel): a second Three.js scene with its own fixed perspective camera, low behind the player's animal. The image is shifted up (a lens shift, so verticals stay vertical) until the scene is centred in the part of the canvas the panel leaves free. The two animals stand three-quarters on, each turned to face the other, and are scaled towards a common height (by the square root of the ratio, clamped to 0.8–1.6) so an otter and a deer both read at battle size while a bear still looks bigger than a squirrel. Both idle; an attacker lunges; a hit shakes the target; a miss puffs beside it; a tired animal tips over and stays down; the winner hops. Background: the biome's ground colour with tufts of tall grass, plus trees (forest), boulders (mountain) or water behind (river). Nothing stands between the camera and the player's animal.
- **Status boxes**: name, HP bar with numbers. No level (there are none). Opponent box top-left, named "Wild …" so a squirrel meeting a squirrel can tell them apart; player box on the right just above the narration line. A hit pops the damage ("−14") over the box of the animal that took it.
- **Bottom panel**: `clamp(260px, 40vh, 360px)` tall, two columns at 2 : 3 (1 : 1 below 900 px wide, where the attack names need the room).
  - **Actions** (left): one row per attack — its name, how hard its puzzle is at the chosen level, and three level pills — then Leash and Run. The difficulty word reads the engine's 1–10 scale as easy (1–3), medium (4–6), hard (7–8) or super hard (9–10). The level is one choice for all rows and is kept from battle to battle. Keys: up/down or W/S move the cursor (wrapping round); left/right or A/D change the level; 1/2/3 pick that level and attack at once; Enter or Space do the highlighted action. While a turn plays the rows dim and keys do nothing.
  - **Puzzle** (right): until an attack is chosen, "Pick an attack", one sentence about the highlighted row ("Scurry Kick, level 3: a medium puzzle with adding, taking away or missing numbers. It hits for 14.") and a key reminder. Once chosen: the prompt in very large type and an answer box. Number keys type, a minus only as the first character, Backspace deletes, at most seven characters; Enter submits, and does nothing until a digit has been typed. **There is no way back**: once a puzzle is shown the turn is committed ([[PRODUCT]] §4), so Escape does nothing. Correct → the card flashes green and says "Correct!". Wrong → the answer box shakes red and says "Not quite!"; the correct answer is **not** shown (they will meet the puzzle again), and the log says "Missed!".
- **Narration line**: one line above the panel, one beat per event with a hold of about a second each ("Wild Otter used Splash! 5 damage.", "Wild Otter used Splash! It missed.", "Missed! The wild Otter shrugs it off."). Turn order and the opponent's action are visible, never instant.
- **Leash**: a loop on a rope flies in from the trainer's side (off-screen, lower left), wobbles on the animal through a suspense pause ("You throw the leash…"), then holds ("Caught!", and the animal hops) or pops off ("It broke free!"). The odds are never shown as a number (kids should feel it, not compute it): a colour on the Leash row hints, red / amber / green by the wild animal's HP in thirds, and a word says the same thing — strong / weaker / weak — because colour is never the only signal.
- **End**: a result card — "You won!", "You caught a Fox!", "Good try!" (the whole party is tired) or "You got away!" — over the authority's closing message (none after "Good try!": the doctor has the next word, in the world; see § Doctor), with one big button back to explore. Enter or Space press it; for the first 0.8 s the card ignores keys, so an Enter mashed through the last beats cannot skip it.
- **Keys across modes**: keys go to one screen at a time — the battle, else the doctor's card, else explore. A key already held down when the screen changes does nothing in the new one until it is pressed again: battle and the doctor's card ignore auto-repeat, and explore drops held keys and queued taps while either is up.

## Doctor

Talking to a doctor (facing a tent, Enter/Space) opens a dialogue card in explore mode (no mode switch): the doctor's line, a list of the party's hurt animals (tired ones included; healthy ones are shown but can't be picked), and on picking one, a puzzle in the same puzzle component as battle. Solve → healed, with a cheer. Miss → "Not quite! Let's try another one." with a new puzzle, no limit. The list stays live while a puzzle is open: picking another animal swaps the puzzle. Escape or a "Bye" button leaves at any time. Walking waits until the card closes.

```
┌──────────────────────────────────────────────────────────┐
│                     (3D world, player                    │
│                      facing the tent)                    │
├──────────────────────────────────────────────────────────┤
│ (Doctor) Let's help Squirrel! Can you solve this?        │
├────────────────────────┬─────────────────────────────────┤
│ ▸ Squirrel  ▓▓░░  5/20 │                                 │
│   Rabbit tired ░ 0/22  │           9 + ? = 18            │
│   Fox       ▓▓▓ 35/35  │             [ 9 ]               │
│   Bye             Esc  │ Type the answer, then press Enter│
└────────────────────────┴─────────────────────────────────┘
```

- **Layout**: one card across the bottom, `clamp(300px, 44vh, 400px)` tall so six animals and Bye fit at 1024×768, leaving the player and the tent in view above it. The doctor's line runs across its top; below, the party (2) beside the puzzle area (3), as in battle. The explore HUD (party cards, message line) is replaced by the card while it is open.
- **Party list**: every animal in party order with its name, a "tired" tag at 0 HP and the one HP bar; healthy animals are greyed and the cursor skips them; Bye (with its key, Esc) is the last row. The cursor starts on the first animal that needs the doctor, or on Bye when nobody does.
- **Puzzle area**: until an animal is picked, "Pick an animal", one sentence about the highlighted row and a key reminder; with nobody to help, "Time to explore!" and how to say bye. Once picked, the same `PuzzlePanel` as battle, plus "↑ ↓ help another animal" when someone else is hurt too. The right answer is never shown.
- **Keys**: up/down or W/S move the cursor (wrapping round); Enter or Space pick the highlighted animal, or say bye on Bye. In a puzzle, number keys, minus and Backspace type as in battle, Enter answers (only once a digit is typed), and up/down (W/S) swap the puzzle for the previous or next animal who needs the doctor. Escape leaves at any time, in a puzzle and during a beat too. For the first half second after the card opens, it takes no key but Escape, so an Enter mashed at the tent cannot pick an animal unseen.
- **Beats**: a miss shakes the answer box and says "Not quite!" (and the doctor "Not quite! Let's try another one.") for about a second, then the new puzzle appears with an empty box. A right answer flashes the card green with "Correct!" for about a second; then the animal's HP bar fills, its row lights up green and hops, a green "+N" pops over it and the doctor cheers ("Well done! Squirrel feels all better! Who is next?", or "Everyone is fit and happy!" when nobody is left), and a moment later the list takes keys again with the cursor on the next animal who needs the doctor, and the healed one greys out with the other fit ones. Keys other than Escape wait while a beat plays.
- **Words**: everything the doctor says is chosen by the client from the doctor's events, like the battle narration, kept as data and worded from the copy files (`doctor.*`) when shown, so a language switch re-words an open card; the engine decides only what happened.
- **Leaving**: the card closes at once and the doctor's goodbye ("Bye! Come back any time.") is on the message line; the prompt shows under it while the player still faces the tent.

After a lost battle, the result card says "Good try!" and nothing more, and its button returns the player to explore standing beside the nearest tent, facing it, with the party healed and the doctor's line on the message line ("The doctor looked after your animals. Everyone feels better!", or "A doctor came by and looked after your animals…" when no tent was near).

## Pause menu

Escape. Cards for Party (reorder, nickname), Settings (sound, later: touch controls), and Quit to title. All keyboard-navigable.

## Component reuse

One `PuzzlePanel` component serves battle and doctor, and one helper (`input/answer.ts`) turns keys into the typed answer for both. One `HpBar`. One `Card`. New UI reuses these before inventing.
