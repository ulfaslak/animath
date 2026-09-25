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
- **Message line** (bottom-centre): the latest `message` event, plus the controls hint until the player has moved a few times. Fades after a few seconds.
- **Interaction prompt**: when the player faces a doctor's tent, the message line shows "Press Enter to talk to the doctor".
- **Controls**: arrows/WASD to walk, Enter/Space to interact, Escape opens the pause menu (party, settings, later: bag). Holding a key keeps walking; a tap moves one tile.
- The player stays centred; the world scrolls under them. Chunks are built 2 chunks out in every direction so nothing pops in at the edge.

## Battle mode

Borrowed composition from the Game Boy games: your animal from behind at bottom-left, the opponent from the front at top-right, status boxes opposite each sprite, and a panel across the bottom. Our addition is a **puzzle area** that takes real space, because solving is the whole game.

```
┌──────────────────────────────────────────────────────────┐
│ ┌──────────────────┐                                     │
│ │ Otter            │                      [opponent]     │
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
- **Status boxes**: name, HP bar with numbers. No level (there are none). Opponent box top-left, player box on the right just above the narration line. A hit pops the damage ("−14") over the box of the animal that took it.
- **Bottom panel**: `clamp(260px, 40vh, 360px)` tall, two columns at 2 : 3 (1 : 1 below 900 px wide, where the attack names need the room).
  - **Actions** (left): one row per attack — its name, how hard its puzzle is at the chosen level, and three level pills — then Leash and Run. The difficulty word reads the engine's 1–10 scale as easy (1–3), medium (4–6), hard (7–8) or super hard (9–10). The level is one choice for all rows and is kept from battle to battle. Keys: up/down or W/S move the cursor (wrapping round); left/right or A/D change the level; 1/2/3 pick that level and attack at once; Enter or Space do the highlighted action. While a turn plays the rows dim and keys do nothing.
  - **Puzzle** (right): until an attack is chosen, "Pick an attack", one sentence about the highlighted row ("Scurry Kick, level 3: a medium puzzle with adding, taking away or missing numbers. It hits for 14.") and a key reminder. Once chosen: the prompt in very large type and an answer box. Number keys type, a minus only as the first character, Backspace deletes, at most seven characters; Enter submits, and does nothing until a digit has been typed. **There is no way back**: once a puzzle is shown the turn is committed ([[PRODUCT]] §4), so Escape does nothing. Correct → the card flashes green and says "Correct!". Wrong → the answer box shakes red and the right answer is shown, "Not quite! It was 56." — the next puzzle is a new one, so seeing the answer is how a kid learns it.
- **Narration line**: one line above the panel, one beat per event with a hold of about a second each ("Wild Otter used Splash! 5 damage."). Turn order and the opponent's action are visible, never instant.
- **Leash**: a loop on a rope flies in from the trainer's side (off-screen, lower left), wobbles on the animal through a suspense pause ("You throw the leash…"), then holds ("Caught!", and the animal hops) or pops off ("It broke free!"). The odds are never shown as a number (kids should feel it, not compute it): the Leash row says hard / maybe / good chance with a red / amber / green dot, by the wild animal's HP in thirds.
- **End**: a result card — "You won!", "You caught a Fox!", "Good try!" (the whole party is tired) or "You got away!" — over the authority's closing message, with one big button back to explore. Enter or Space press it; for the first 0.8 s the card ignores keys, so an Enter mashed through the last beats cannot skip it.
- **Keys across modes**: keys go to one mode at a time. A key already held down when the mode changes does nothing in the new mode until it is pressed again: battle ignores auto-repeat, and explore drops held keys and queued taps while the battle screen is up.

## Doctor

Talking to a doctor opens a dialogue card in explore mode (no mode switch): the doctor's line, a list of the party's tired animals, and on picking one, a puzzle in the same puzzle component as battle. Solve → healed, with a cheer. Miss → "Try again?" with a new puzzle, no limit.

## Pause menu

Escape. Cards for Party (reorder, nickname), Settings (sound, later: touch controls), and Quit to title. All keyboard-navigable.

## Component reuse

One `PuzzlePanel` component serves battle and doctor, and one helper (`input/answer.ts`) turns keys into the typed answer for both. One `HpBar`. One `Card`. New UI reuses these before inventing.
