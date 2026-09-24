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
┌────────────────────────────────────────────────────────┐
│ ┌─────────────────┐                                    │
│ │ Opponent name   │                       [opponent]   │
│ │ HP ▓▓▓▓▓░░░░░   │                        (front)     │
│ └─────────────────┘                                    │
│                                                        │
│                                  ┌─────────────────┐   │
│      [your animal]               │ Your animal     │   │
│         (back)                   │ HP ▓▓▓▓▓▓▓▓░░   │   │
│                                  └─────────────────┘   │
├──────────────────────┬─────────────────────────────────┤
│ ACTIONS              │ PUZZLE                          │
│ ▸ Nut Toss  [1][2][3]│                                 │
│   Scurry    [1][2][3]│        7 × 8 = ?                │
│   Leash              │      [ 56 ]        (Enter)      │
│   Run                │                                 │
└──────────────────────┴─────────────────────────────────┘
```

- **Scene** (top ~60%): a second Three.js scene with its own fixed camera, low behind the player's animal, looking up at the opponent. Both models idle; an attack plays a short lunge; a hit shakes the target; a miss shows a puff. Background is a stylised patch of the biome the battle started in.
- **Status boxes**: name, HP bar with numbers. No level (there are none). Opponent box top-left, player box mid-right, mirroring the sprites.
- **Bottom panel** (~40%): two columns.
  - **Actions** (left): the animal's attacks, each with three level buttons; then Leash and Run. Keyboard: up/down to pick an attack, 1/2/3 to pick a level (or left/right then Enter). Disabled actions are greyed with a one-word reason.
  - **Puzzle** (right): empty with a soft prompt ("Pick an attack") until an attack is chosen; then the prompt in very large type, a number input, and a submit button. Number keys type, Backspace deletes, Enter submits, Escape backs out to actions. Correct → green flash, damage number flies to the opponent. Wrong → red shake, the correct answer is **not** shown (they will meet the puzzle again), "Missed!" in the log.
- **Log line**: one line above the panel narrates the turn ("Bear used Swipe! 19 damage."). Turn order and the opponent's action are visible, never instant.
- **Leash**: a throw animation, then a suspense pause, then "Caught!" or "It broke free!" The odds are never shown as a number (kids should feel it, not compute it); a colour on the leash button hints (green/amber/red by HP thirds).
- **End**: a result card (won / caught / tired / ran away) with one big button back to explore.

## Doctor

Talking to a doctor opens a dialogue card in explore mode (no mode switch): the doctor's line, a list of the party's tired animals, and on picking one, a puzzle in the same puzzle component as battle. Solve → healed, with a cheer. Miss → "Try again?" with a new puzzle, no limit.

## Pause menu

Escape. Cards for Party (reorder, nickname), Settings (sound, later: touch controls), and Quit to title. All keyboard-navigable.

## Component reuse

One `PuzzlePanel` component serves battle and doctor. One `HpBar`. One `Card`. New UI reuses these before inventing.
