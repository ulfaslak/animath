# UI Spec

How the title and the two modes are laid out and behave. Visual language is in [[DESIGN]]; rules are in [[PRODUCT]].

## Frame

- The game is full-screen: one `<canvas>` filling the window, a DOM overlay (`#ui`) on top. The overlay is `pointer-events: none` except for its children, so the canvas keeps focus.
- Minimum supported viewport is a laptop at 1280×720; the layout must also hold at a tablet's 1024×768 landscape. Phone portrait is out of scope for now (a "turn your device" screen is fine).
- The camera never zooms or rotates. Resizing the window changes how much world is visible horizontally; vertical extent stays 14 tiles.

## Title

The first screen, every time the page opens (except the throwaway switches `?new`, `?party=` and `?zoo`, which go straight into explore), and the one Quit to title returns to. Nothing is started, walked, rolled or saved behind it.

```
┌──────────────────────────────────────────────────────────┐
│                      A n i m a t h                       │
│                                                          │
│  ┌──────────────────────────────┐                        │
│  │ ▸ Continue     Pip 3 animals │     [trainer + team]   │
│  │   New game                   │      (the world,       │
│  │   Language  (English) Dansk  │       drifting)        │
│  │    ↑ ↓ choose · Enter pick   │                        │
│  └──────────────────────────────┘                        │
└──────────────────────────────────────────────────────────┘
```

- **Backdrop**: the world where the game stands (the saved spot, or the spawn tile with no save), seen through the explore camera pointed a little aside so the trainer stands right of centre, clear of the menu: the same angle, no zoom, no turn, drifting slowly (a sway of about a tile, over half a minute). The trainer faces the saved way; the team stands on the walkable tiles nearest it (with no save, the starters do), breathing. They are scenery and go when the game starts.
- **Name**: "Animath" at the top, each letter in a palette colour (coral, orange, green, blue, amber) with a cream rim, bobbing gently out of step; still with reduced motion.
- **Menu** (a card at the left): **Continue** (only with a saved game; beside it the name of the team's first animal that is standing and the team's size, "Pip 3 animals"), **New game**, **Language** (every language in its own words, the one on screen lit). Up/down or W/S move the cursor, wrapping; Enter or Space pick; left/right or A/D change the language on its row (Enter too), and do nothing on the others. Escape does nothing. The cursor starts on the first row: Continue when there is one. Under the rows, a key reminder, and a line when start-up found a save the page can't pick up (a newer build's, or no storage at all).
- **Confirm** (New game with a saved game): a card over a dim backdrop, "Start a new game?", "Your game with Pip is put away safely.", "You start again with a new animal.", then **No, go back** (lit first) and **Yes, new game**. Up/down pick, without wrapping; Enter or Space do it; Escape goes back. For its first 0.8 s it ignores Enter and Space, so however Enter is mashed on New game, starting over takes a deliberate Down first. Back returns to the menu on New game.
- **Starters** (New game without a save, or Yes): the 3D starter stage replaces the world: every starter in catalog order side by side on a round meadow with tufts, flowers and bushes, big (scaled towards a common height), the lit one on a warm ring, facing the camera and bouncing, the others turned towards it. "Pick your first animal!" across the top; each animal's name in a tag under its feet (the lit tag orange); a card at the bottom with the lit one's name and the kinds of sums its attacks ask ("Rabbit loves adding, taking away, missing numbers, and number patterns!") and the keys. Left/right (A/D, and up/down) move, wrapping; Enter or Space pick, after the screen has been up 0.5 s; Escape goes back to the menu on New game. The row is as long as the starter list.
- **Name box** (after a pick; the picked one hops for joy): the card asks "What will you call your Rabbit?" over a name box with the species as its placeholder, the name rule, and "Leave it empty and it is just called Rabbit." (or, when the typed text will not be stored as shown, what it will be called). It works like the pause menu's name box: every key but Enter, Escape and Tab types; Enter starts the game (an empty box starts it without a name), after the box has been up 0.5 s and never on auto-repeat; Escape goes back to the starters with the same one lit.
- **Starting**: the game begins at the spawn tile with the explore HUD and the controls hint, the message line saying what start-up found about the save when there was something (the save that didn't load); Continue says "Welcome back!".
- It holds at 1024×768 in both languages.

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
- **Message line** (bottom-centre): up to two lines in one box. Above, the latest thing said — a `message` event, a line the client words from an event that carries no words (the doctor's lines; `nothing-to-interact`, Enter away from a tent), or, when the game starts, what it found about the save ("Welcome back!" when a saved game was picked up, or why a new game started: "Your saved game didn't load, so here is a new one.") — for 5 seconds, then it fades; the seconds count only while the explore HUD is on screen, so a line said during a battle or a doctor visit is still there to read afterwards. Below, the controls hint ("Arrows / WASD to walk") until the player has walked 5 steps; bumps don't count, since a key held against a wall bumps every frame. With neither, the box fades away. After a party edit that changes who goes first, the line names the new lead ("Fox goes first!"), or says why an animal can't be chosen; a line about the lead goes at once when a battle or the doctor changes the party.
- **Interaction prompt**: when the player faces a doctor's tent, the lower line shows "Press Enter to talk to the doctor", in place of the controls hint. Enter anywhere else says "Walk up to a tent to talk to the doctor.", which gives way to the prompt as soon as the player faces a tent.
- **Saving shows nothing**: no icon, no "Saved", and nothing when the server is out of reach, because the game is always saved in the browser.
- **Loading**: "Loading…" over an empty screen until the title (or a throwaway game) is up, which is at once when the browser holds the save; only a browser that has lost its save but still knows the player waits, at most a few seconds, for the server's copy.
- **Controls**: arrows/WASD to walk, Enter/Space to interact, number keys 1–6 choose who goes first (the animal in that slot moves to the front; a tired one stays put and the message line says it is tired and needs the doctor), Escape opens the pause menu. Holding a key keeps walking; a tap moves one tile.
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
  - **Puzzle** (right): until an attack is chosen, "Pick an attack", one sentence about the highlighted row ("Scurry Kick on hard: adding, taking away, missing numbers, or times tables. It hits for 14.": what a puzzle at that level can actually be — the engine's `puzzleTopics`, so a hard missing number that sits in a times table is named as times tables — joined as the language lists them, or for Switch "Send in a different animal. It uses up your turn." — "You need a second animal to switch. Catch one with the leash!" with a party of one, "Your other animals are tired." when nobody else is standing) and a key reminder. Once chosen: the prompt in very large type and an answer box. Number keys type, a minus only as the first character, Backspace deletes, at most seven characters; Enter submits, and does nothing until a digit has been typed. **There is no way back**: once a puzzle is shown the turn is committed ([[PRODUCT]] §4), so Escape does nothing. Correct → the card flashes green and says "Correct!". Wrong → the answer box shakes red and says "Not quite!"; the correct answer is **not** shown (they will meet the puzzle again), and the narration line says "Missed!".
  - **Party list** (left, in place of the actions): Switch opens it. One row per party member in party order — name (nickname if set), HP bar with numbers, and a tag: "in battle" on the one in front, "tired" on a knocked-out one; both are greyed and can't be picked. The right card says "Pick an animal", one sentence about the highlighted animal ("Send in Rabbit. Then the wild animal gets a turn.", "Rabbit is tired and needs a rest.", "Squirrel is already in the battle.") and the keys. The cursor starts on the first animal who can step in and visits every row; up/down or W/S move it (wrapping round); Enter or Space send the highlighted animal in, and on a greyed one the row gives a little shake instead; Escape goes back to the menu, on the Switch row.
  - **After a knock-out**, when someone else is still standing, the same list comes up by itself: the narration says "Squirrel is tired. Who goes next?", the sentence ends "Then it's your turn." (the pick is free), and there is no way back: Escape does nothing until an animal is picked. For its first 0.8 s the list ignores Enter and Space, like the result card, so an Enter mashed through the knock-out can't pick for the kid.
- **Narration line**: one line above the panel, one beat per event with a hold of about a second each ("Wild Otter used Splash! 5 damage.", "Wild Otter used Splash! It missed.", "Missed! The wild Otter shrugs it off."). A switch reads "Come back, Squirrel!" then "Go, Rabbit!" before the wild animal's reply; picking who goes next after a knock-out reads only "Go, Rabbit!". Turn order and the opponent's action are visible, never instant.
- **Leash**: a loop on a rope flies in from the trainer's side (off-screen, lower left), wobbles on the animal through a suspense pause ("You throw the leash…"), then holds ("Caught!", and the animal hops) or pops off ("It broke free!"). The odds are never shown as a number (kids should feel it, not compute it): the Leash row hints at the real chance — the engine's `catchProbability` for this animal at the HP on screen, with this leash — as a colour and the same thing in words, because colour is never the only signal: green "Good chance!" at one in two or better, amber "Maybe" at one in five or better, red "Hard to catch" below that. A fierce animal can stay "Hard to catch" all the way down (a bear never reaches one in five).
- **End**: a result card — "You won!", "You caught a Fox!", "Good try!" (the whole party is tired) or "You got away!" — over the authority's closing message (none after "Good try!": the doctor has the next word, in the world; see § Doctor), with one big button back to explore. Enter or Space press it; for the first 0.8 s the card ignores keys, so an Enter mashed through the last beats cannot skip it.
- **Keys across modes**: keys go to one screen at a time — the title, else the battle, else the doctor's card, else the pause menu, else explore. A key already held down when the screen changes does nothing in the new one until it is pressed again: battle, the doctor's card and the pause menu ignore auto-repeat, and explore drops held keys, queued taps and a pressed number while any of them is up.

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

Escape in explore opens it; never in a battle (Escape there does nothing) or at the doctor (Escape there leaves). An overlay, not a mode: the world keeps drawing under a dim backdrop, and walking waits until it closes (a step already started lands).

```
┌──────────────────────────────────────────────────────────────┐
│ Paused                                                       │
│                                                              │
│   Your team                                ┌───────────────┐ │
│   1 Pip  Squirrel  ▓▓▓▓░ 20/20 goes first  │ Fox           │ │
│   2 Rabbit         ░░░░░  0/22      tired  │ ▸ Go first    │ │
│  [3 Fox            ▓▓░░░ 12/35           ] │   Move up     │ │
│   Language            [English]  Dansk     │  (Move down)  │ │
│   ( Keep playing )                         │   New name    │ │
│                                            │   Back        │ │
│                                            └───────────────┘ │
│                                                              │
│              ↑ ↓ choose · Enter do it · Esc back             │
└──────────────────────────────────────────────────────────────┘
```

- **Left**: "Your team" in battle order — slot number, name (with the species beside a nickname), HP bar with numbers, "tired" or "goes first" — then the menu rows: Language, "Keep playing" and "Start screen" (Quit to title: the game is saved as it stands and the title opens, with Continue on it; no confirm, since nothing is lost; a quieter pill than Keep playing). Up/down or W/S move the cursor, wrapping round; Enter or Space pick; Escape closes the menu.
- **Language**: the row lists every language in its own words ("English", "Dansk"), the one on screen lit, so a kid finds theirs whatever language the screen is in. Enter or Space, or left/right (A/D) on the row, switch to the next language: every word on screen changes at once, the menu stays open, and the choice is remembered on this device.
- **Right**: what can be done with the picked animal, which stays outlined in the list: **Go first** (not for a tired animal or the lead), **Move up**, **Move down**, **New name**, **Back**. Options that can't be done are greyed and the cursor skips them; one that becomes impossible under the cursor (the animal reached the top) does nothing, so mashing Enter never overshoots. Moves happen at once and the list re-sorts with a short slide. Escape goes back to the list, with the cursor on the animal wherever it now is. Before anything is picked, the panel says what picking does.
- **Name box**: New name opens a text box with the current nickname selected, the species' name as the placeholder, a line saying what a name may hold, and — when the typed text will not be stored as shown — what the animal will be called ("It will be called Pip."). Every key but Enter, Escape and Tab types: W A S D and Space are letters here, and the arrows move the caret. Enter saves (an empty name gives the species' name back), Escape goes back to the options without saving, and the box keeps the focus while it is open. An input method's Enter and Escape are its own.
- The key reminder at the bottom follows the screen: "↑ ↓ choose · Enter pick · Esc close" ("↑ ↓ choose · ← → or Enter change the language · Esc close" on the Language row), "↑ ↓ choose · Enter do it · Esc back", "Enter save · Esc back".
- It holds at 1024×768 with six animals and a 12-character name, in either language.

## Component reuse

One `PuzzlePanel` component serves battle and doctor, and one helper (`input/answer.ts`) turns keys into the typed answer for both. One `HpBar`. Every card — the HUD's, the battle panel's, the doctor's, the pause menu, the title's — has one look, from the tokens `--panel-bg`, `--radius` and `--hud-shadow` in `styles.css`, not from a shared component. New UI reuses these before inventing.

A component that shows one thing — an animal's HP bar, its name — is keyed by that thing's id wherever a different thing can take its place on screen, so a transition never runs from one animal's value to another's (a newcomer's bar must not drain from the full bar of the animal that left).
