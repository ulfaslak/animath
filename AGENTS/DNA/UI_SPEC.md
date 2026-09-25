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
│ │ Wild Otter       │                      [opponent]     │
│ │ ▓▓▓▓▓▓░░░░ 18/32 │                       (front)       │
│ └──────────────────┘                                     │
│                                   ┌──────────────────┐   │
│     [your animal]                 │ Squirrel         │   │
│        (back)                     │ ▓▓▓▓▓▓▓░░  15/20 │   │
│                                   └──────────────────┘   │
│           ( Wild Otter used Splash! 5 damage. )          │
├──────────────────────────────────┬───────────────────────┤
│ ▸ Nut Toss   (easy) medium  hard │                       │
│   Scurry Kick               hard │       7 × 8 = ?       │
│   Leash                strong ●  │         [ 56 ]        │
│   Switch                         │    Type the answer,   │
│   Run                            │    then press Enter   │
└──────────────────────────────────┴───────────────────────┘
```

- **Entering**: the step into the grass lands first — the world stays on screen for about 0.3 s after the encounter — and then the battle scene replaces it. The explore HUD goes at once.
- **Scene** (above the panel): a second Three.js scene with its own fixed perspective camera, low behind the player's animal. The image is shifted up (a lens shift, so verticals stay vertical) until the scene is centred in the part of the canvas the panel leaves free. The two animals stand three-quarters on, each turned to face the other, and are scaled towards a common height (by the square root of the ratio, clamped to 0.8–1.6) so an otter and a deer both read at battle size while a bear still looks bigger than a squirrel. Both idle; an attacker lunges; a hit shakes the target; a miss puffs beside it; a tired animal tips over and stays down; an animal called back shrinks away and the one sent in grows into its place with a little bounce; the winner hops. Background: the biome's ground colour with tufts of tall grass, plus trees (forest), boulders (mountain) or water behind (river). Nothing stands between the camera and the player's animal.
- **Status boxes**: name, HP bar with numbers. No level (there are none). Opponent box top-left, named "Wild …" so a squirrel meeting a squirrel can tell them apart; player box on the right just above the narration line. A hit pops the damage ("−14") over the box of the animal that took it. When another animal steps in, the player box shows its HP at once; the bar never slides from the last animal's.
- **Bottom panel**: `clamp(260px, 40vh, 360px)` tall, two columns at 2 : 3 (1 : 1 below 900 px wide, where the attack names need the room).
  - **Actions** (left): one row per attack, then Leash, Switch and Run. Every attack row has its **own level**, and the three levels are called **easy, medium and hard**: the highlighted row shows three level buttons with those words, its level lit; every other attack row shows its level's word. The word names the level, not the puzzle's place on the engine's 1–10 scale: a bear's "easy" is still a bear-hard puzzle ([[PRODUCT]] §4). Levels are remembered per attack of each species for as long as the page is open (a squirrel's Nut Toss keeps its level from battle to battle; a reload starts every attack at easy). Keys: up/down or W/S move the cursor (wrapping round); left/right or A/D change the highlighted attack's level, and only its own; 1/2/3 set the highlighted attack to that level and attack at once; Enter or Space do the highlighted action. Switch is greyed when nobody can step in, and Enter on it does nothing. While a turn plays the rows dim and keys do nothing. After a switch the menu starts on the new animal's first attack.
  - **Puzzle** (right): until an attack is chosen, "Pick an attack", one sentence about the highlighted row ("Scurry Kick on hard: adding, taking away, or missing numbers. It hits for 14.", the kinds joined as the language lists them, or for Switch "Send in a different animal. It uses up your turn." — "You need a second animal to switch. Catch one with the leash!" with a party of one, "Your other animals are tired." when nobody else is standing) and a key reminder. Once chosen: the prompt in very large type and an answer box. Number keys type, a minus only as the first character, Backspace deletes, at most seven characters; Enter submits, and does nothing until a digit has been typed. **There is no way back**: once a puzzle is shown the turn is committed ([[PRODUCT]] §4), so Escape does nothing. Correct → the card flashes green and says "Correct!". Wrong → the answer box shakes red and says "Not quite!"; the correct answer is **not** shown (they will meet the puzzle again), and the log says "Missed!".
  - **Party list** (left, in place of the actions): Switch opens it. One row per party member in party order — name (nickname if set), HP bar with numbers, and a tag: "in battle" on the one in front, "tired" on a knocked-out one; both are greyed and can't be picked. The right card says "Pick an animal", one sentence about the highlighted animal ("Send in Rabbit. Then the wild animal gets a turn.", "Rabbit is tired and needs a rest.", "Squirrel is already in the battle.") and the keys. The cursor starts on the first animal who can step in and visits every row; up/down or W/S move it (wrapping round); Enter or Space send the highlighted animal in, and on a greyed one the row gives a little shake instead; Escape goes back to the menu, on the Switch row.
  - **After a knock-out**, when someone else is still standing, the same list comes up by itself: the narration says "Squirrel is tired. Who goes next?", the sentence ends "Then it's your turn." (the pick is free), and there is no way back: Escape does nothing until an animal is picked. For its first 0.8 s the list ignores Enter and Space, like the result card, so an Enter mashed through the knock-out can't pick for the kid.
- **Narration line**: one line above the panel, one beat per event with a hold of about a second each ("Wild Otter used Splash! 5 damage.", "Wild Otter used Splash! It missed.", "Missed! The wild Otter shrugs it off."). A switch reads "Come back, Squirrel!" then "Go, Rabbit!" before the wild animal's reply; picking who goes next after a knock-out reads only "Go, Rabbit!". Turn order and the opponent's action are visible, never instant.
- **Leash**: a loop on a rope flies in from the trainer's side (off-screen, lower left), wobbles on the animal through a suspense pause ("You throw the leash…"), then holds ("Caught!", and the animal hops) or pops off ("It broke free!"). The odds are never shown as a number (kids should feel it, not compute it): a colour on the Leash row hints, red / amber / green by the wild animal's HP in thirds, and a word says the same thing — strong / weaker / weak — because colour is never the only signal.
- **End**: a result card — "You won!", "You caught a Fox!", "Good try!" (the whole party is tired) or "You got away!" — over the authority's closing message, with one big button back to explore. Enter or Space press it; for the first 0.8 s the card ignores keys, so an Enter mashed through the last beats cannot skip it.
- **Keys across modes**: keys go to one mode at a time. A key already held down when the mode changes does nothing in the new mode until it is pressed again: battle ignores auto-repeat, and explore drops held keys and queued taps while the battle screen is up.

## Doctor

Talking to a doctor (facing a tent, Enter/Space) opens a dialogue card in explore mode (no mode switch): the doctor's line, a list of the party's hurt animals (tired ones included; healthy ones are shown but can't be picked), and on picking one, a puzzle in the same puzzle component as battle. Solve → healed, with a cheer. Miss → "Not quite! Let's try another one." with a new puzzle, no limit. The list stays live while a puzzle is open: picking another animal swaps the puzzle. Escape or a "Bye" button leaves at any time. Walking waits until the card closes.

After a lost battle, the result card's button returns the player to explore standing beside the nearest tent, facing it, with the party healed and the doctor's line on the message line.

## Pause menu

Escape. Cards for Party (reorder, nickname), Settings (sound, later: touch controls), and Quit to title. All keyboard-navigable.

## Component reuse

One `PuzzlePanel` component serves battle and doctor, and one helper (`input/answer.ts`) turns keys into the typed answer for both. One `HpBar`. One `Card`. New UI reuses these before inventing.

A component that shows one thing — an animal's HP bar, its name — is keyed by that thing's id wherever a different thing can take its place on screen, so a transition never runs from one animal's value to another's (a newcomer's bar must not drain from the full bar of the animal that left).
