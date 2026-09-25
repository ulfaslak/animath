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

- **Party HUD** (top-left): one card per animal, in battle order — the number key that makes it go first (as a key cap), name (nickname if set, cut with an ellipsis when it does not fit), HP bar with `hp/max` text. Knocked-out animals are greyed with a "tired" tag. The lead ([[PRODUCT]] §4 "Party") is outlined in the accent colour, its key cap filled, and tagged "goes first", so it reads without colour too. With a party of one there is nobody to choose between: no key caps, no tag. Under the cards, a small panel shows the keys: "1–n Pick who goes first" and "Esc Menu". Never more than six cards; six fit at 1024×768.
- **Message line** (bottom-centre): the latest `message` event, plus the controls hint until the player has moved a few times. Fades after a few seconds.
- **Interaction prompt**: when the player faces a doctor's tent, the message line shows "Press Enter to talk to the doctor".
- **Controls**: arrows/WASD to walk, Enter/Space to interact, number keys 1–6 choose who goes first (the animal in that slot moves to the front; a tired one stays put and the message line says it is tired), Escape opens the pause menu. Holding a key keeps walking; a tap moves one tile.
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
- **Leash**: a loop on a rope flies in from the trainer's side (off-screen, lower left), wobbles on the animal through a suspense pause ("You throw the leash…"), then holds ("Caught!", and the animal hops) or pops off ("It broke free!"). The odds are never shown as a number (kids should feel it, not compute it): the Leash row hints at the real chance — the engine's `catchProbability` for this animal at the HP on screen, with this leash — as a colour and the same thing in words, because colour is never the only signal: green "Good chance!" at one in two or better, amber "Maybe" at one in five or better, red "Hard to catch" below that. A fierce animal can stay "Hard to catch" all the way down (a bear never reaches one in five).
- **End**: a result card — "You won!", "You caught a Fox!", "Good try!" (the whole party is tired) or "You got away!" — over the authority's closing message, with one big button back to explore. Enter or Space press it; for the first 0.8 s the card ignores keys, so an Enter mashed through the last beats cannot skip it.
- **Keys across modes**: keys go to one screen at a time — the battle while it is up, else the pause menu while it is open, else explore. A key already held down when the screen changes does nothing in the new one until it is pressed again: battle and the pause menu ignore auto-repeat, and explore drops held keys and queued taps while the battle screen or the pause menu is up.

## Doctor

Talking to a doctor (facing a tent, Enter/Space) opens a dialogue card in explore mode (no mode switch): the doctor's line, a list of the party's hurt animals (tired ones included; healthy ones are shown but can't be picked), and on picking one, a puzzle in the same puzzle component as battle. Solve → healed, with a cheer. Miss → "Not quite! Let's try another one." with a new puzzle, no limit. The list stays live while a puzzle is open: picking another animal swaps the puzzle. Escape or a "Bye" button leaves at any time. Walking waits until the card closes.

After a lost battle, the result card's button returns the player to explore standing beside the nearest tent, facing it, with the party healed and the doctor's line on the message line.

## Pause menu

Escape in explore opens it; never in a battle (Escape there does nothing) or at the doctor (Escape there leaves). An overlay, not a mode: the world keeps drawing under a dim backdrop, and walking waits until it closes (a step already started lands).

```
┌──────────────────────────────────────────────────────────────┐
│ Paused                                                       │
│                                                              │
│   Your team                                ┌───────────────┐ │
│   1 Pip  Squirrel  ▓▓▓▓░ 20/20 goes first  │ Fox           │ │
│   2 Rabbit         ░░░░░  0/22      tired  │ ▸ Go first    │ │
│  [3 Fox            ▓▓░░░ 12/35           ] │   Move up     │ │
│   ( Keep playing )                         │  (Move down)  │ │
│                                            │   New name    │ │
│                                            │   Back        │ │
│                                            └───────────────┘ │
│                                                              │
│              ↑ ↓ choose · Enter do it · Esc back             │
└──────────────────────────────────────────────────────────────┘
```

- **Left**: "Your team" in battle order — slot number, name (with the species beside a nickname), HP bar with numbers, "tired" or "goes first" — then the menu rows ("Keep playing"; Settings and Quit to title join here when there is something to set and a title to quit to). Up/down or W/S move the cursor, wrapping round; Enter or Space pick; Escape closes the menu.
- **Right**: what can be done with the picked animal, which stays outlined in the list: **Go first** (not for a tired animal or the lead), **Move up**, **Move down**, **New name**, **Back**. Options that can't be done are greyed and the cursor skips them; one that becomes impossible under the cursor (the animal reached the top) does nothing, so mashing Enter never overshoots. Moves happen at once and the list re-sorts with a short slide. Escape goes back to the list, with the cursor on the animal wherever it now is. Before anything is picked, the panel says what picking does.
- **Name box**: New name opens a text box with the current nickname selected, the species' name as the placeholder, a line saying what a name may hold, and — when the typed text will not be stored as shown — what the animal will be called ("It will be called Pip."). Every key but Enter, Escape and Tab types: W A S D and Space are letters here, and the arrows move the caret. Enter saves (an empty name gives the species' name back), Escape goes back to the options without saving, and the box keeps the focus while it is open. An input method's Enter and Escape are its own.
- The key reminder at the bottom follows the screen: "↑ ↓ choose · Enter pick · Esc close", "↑ ↓ choose · Enter do it · Esc back", "Enter save · Esc back".
- It holds at 1024×768 with six animals and a 12-character name.

## Component reuse

One `PuzzlePanel` component serves battle and doctor, and one helper (`input/answer.ts`) turns keys into the typed answer for both. One `HpBar`. One `Card`. New UI reuses these before inventing.
