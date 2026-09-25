# Cheatsheet

Everything a player can do in **today's build**, and how: every key, every hidden behaviour, every exploit. This file is a record of what the game actually does. It is not a plan: intended controls live in [[UI_SPEC]], the list of features in [[PRODUCT]] §5, and the rules in [[PRODUCT]] §4.

**Keep it true.** Any PR that adds, removes or changes an input, a way to reach something, or a behaviour a player could stumble on updates this file in the same PR. If you find an exploit, record it here, and if a kid could use it to break the game, also file it as a `bug`.

## Controls

| Key                   | Mode    | What it does                                                                                                            |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| Arrow keys / W A S D  | Explore | Walk one tile. Hold to keep walking (about 5–6 tiles a second).                                                         |
| Enter / Space         | Explore | Interact. Today it always says "Nothing here yet.", wherever you stand and whatever you face. The on-screen hint doesn't mention this key. |
| 1–6                   | Explore | Choose who goes first: the animal on that card moves to the top of your team ("Fox goes first!"), even mid-step. A tired one stays where it is ("Rabbit is tired. Visit the doctor!"), and so does the one that already goes first ("Fox already goes first!"). A number with no card does nothing, and with one animal there are no numbers. |
| Escape                | Explore | Open the pause menu. Walking waits until it closes. |
| Up / Down, W / S      | Pause menu | Move the cursor through your team and then "Keep playing". It wraps round. |
| Enter / Space         | Pause menu | On an animal: open its options on the right. On "Keep playing": close the menu. |
| Up / Down, W / S; Enter / Space | Animal options | Choose and do: Go first, Move up, Move down, New name, Back. Greyed options are skipped: Go first for a tired animal or the one already going first, Move up at the top, Move down at the bottom. Moves happen at once, and the options stay open for the next one. |
| Escape                | Pause menu | Close the menu; from an animal's options, back to the list; from the name box, back to the options without saving. |
| Any letter, digit, Space | Name box | Type the name; W A S D and Space are just letters here. The arrows move the caret, Backspace deletes. The box stops at 12 characters. |
| Enter                 | Name box | Save the name and go back to the list. An empty name gives the species' name back. |
| Up / Down, W / S      | Battle menu | Move the cursor through the attacks, Leash and Run. It wraps round from the top to the bottom.                    |
| Left / Right, A / D   | Battle menu | Pick the level (1, 2 or 3) for the attack. The same level applies to every attack and is remembered for the next battle. |
| 1 / 2 / 3             | Battle menu | On an attack: pick that level and attack straight away. On Leash or Run: nothing.                                   |
| Enter / Space         | Battle menu | Do the highlighted thing: attack at the chosen level, throw the leash, or run.                                      |
| 0–9, minus            | Puzzle  | Type the answer. A minus only works as the first character; at most seven characters.                                    |
| Backspace             | Puzzle  | Delete the last character.                                                                                              |
| Enter                 | Puzzle  | Answer. Nothing happens until you have typed at least one digit.                                                        |
| Enter / Space         | Result card | Back to exploring.                                                                                                  |

Escape does nothing in a battle — not even in a puzzle: once a puzzle is up, the only way on is to answer it. The mouse and touch are ignored everywhere (the result card's button, the party cards and the pause menu's rows look clickable but aren't; a click in the name box only moves the caret). The page has no debug keys or console hooks; its URL parameters are `?zoo` and `?party=` (see § Hidden behaviour).

## The world

- The world is the **same every time**. The seed is fixed (`'prototype'`), so the same map loads on every reload and on every machine.
- You **start at (-2, 6)**, on grass next to a stretch of water. The HUD shows your grid position: pressing Right adds 1 to x, and pressing Down adds 1 to y.
- The world never ends. It is generated in 16×16 chunks as you walk, in every direction.
- **You are a kid in a blue cap** (coral shirt, blue shorts). The figure turns to face the way you last walked or bumped, stands on top of hills rather than sinking into them, and breathes gently while you stand still.

| Tile                                          | Walk on it? |
| --------------------------------------------- | ----------- |
| Grass                                         | Yes         |
| Tall grass (darker green with little blades)   | Yes. Each step onto it has a 1-in-10 chance of a wild battle. |
| Sand                                          | Yes         |
| Doctor's tent (orange pyramid with a campfire) | No. Walking into it turns you to face it. Pressing Enter while facing it still says "Nothing here yet."; healing will happen here. The nearest one to the start is at (5, 7): walk 6 tiles right and 1 down, and you stand just left of it. |
| Water                                         | No          |
| Rock                                          | No          |
| Tree                                          | No          |

## Finding a battle fast

The tile straight left of the start, (-3, 6), is a river reed: tall grass on the river bank. Near home, squirrels and rabbits come down to the water, and now and then an otter. Press Left and Right in turn (Left, Right, Left, …): every Left lands on the reed. **The 11th step (the sixth Left) always meets a Rabbit**, the 15th a Squirrel, and the first Otter comes on the 97th step. For foxes and the odd deer, walk to the meadow tall grass south-east of the start — the nearest is (2, 7), (3, 7) and (4, 7) — where you meet squirrels and rabbits, sometimes a fox and rarely a deer.

## Battles

- **You always go first.** Pick an attack and a level, answer the puzzle, then the wild animal answers with one of its attacks. Facing an animal its own size or bigger it sometimes misses ("It missed."); a smaller one it never misses.
- **Higher level, harder sum, bigger hit.** Each attack row says how hard its puzzle is at the chosen level (easy, medium, hard, super hard), and the box on the right says what kind of maths it asks and how much damage it does.
- **A wrong answer misses** ("Not quite!", then "Missed! The wild Rabbit shrugs it off."). The right answer is not shown.
- **Picking an attack can't be undone.** Leaving the puzzle is not possible; typing anything wrong counts as a miss.
- **Leash**: the row says how likely a catch is right now, with a dot of the same colour: "Good chance!" (green, one in two or better), "Maybe" (amber, one in five or better) or "Hard to catch" (red). It follows the real odds, so it changes as the animal's HP drops and depends on the species: a rabbit at full HP is "Hard to catch" and at 2 HP a "Good chance!"; a fox turns "Maybe" below about a third of its HP and "Good chance!" only at 1 HP; a bear is "Hard to catch" all the way down. A throw that breaks free costs your turn.
- **Run** always works and costs nothing.
- **When your animal is tired** (0 HP), the next animal in your party that isn't tired steps in by itself, and you choose again.
- **Win, catch, or run**: a card says what happened; press Enter to walk on from the same tile. HP you lost stays lost.
- **Lose** (every animal tired): "Good try!" — everyone rests back to full HP and you are put back on the start tile, (-2, 6). (A stand-in: later you will be taken to the nearest doctor's tent.)

## Your party

The cards in the top-left corner are your party, in battle order. You start with one Squirrel at full HP (20 of 20). Every animal you catch joins the end of the list, with the HP it had when the leash landed, up to six. With six already, a caught animal goes back into the grass. An animal at 0 HP is greyed out with a "tired" tag and sits out battles. Nothing heals except losing a battle (everyone back to full) and reloading the page (everything back to the start).

- **Who goes first**: the first card that isn't tired, outlined in orange and tagged "goes first". It steps into the next battle; when it gets tired, the next card down that isn't tired steps in. Press a card's number, or pick "Go first" in the pause menu, to move that animal to the top. The numbers on the cards follow the order, so the animal you picked becomes 1 and the others move down one.
- **Moving and naming**: in the pause menu (Escape) any animal can move up or down, a tired one too — a tired animal on top is skipped, and the tag stays with the first one standing. "New name" gives an animal a nickname, which the cards, the menu and battles all use ("Go, Pip!").
- **What a name can be**: up to 12 letters (any alphabet, so "Søren" works), digits, spaces, hyphens, apostrophes and dots. Emoji and other symbols are left out when you press Enter, extra spaces are squeezed, and a name with no letter or digit left — empty, spaces, only emoji — means no nickname: the animal is called by its species again. The name box shows "It will be called …" before you press Enter whenever the name will come out different from what you typed.

## Hidden behaviour

- **A tap is always one step.** A key press shorter than a frame still moves you one tile.
- **Mashing is capped.** At most two taps are queued, so mashing a key does not queue a long walk.
- **Two keys held: the newest wins.** Hold Right, then press Up as well, and you walk up. Let go of Up and you walk right again. There is no diagonal movement.
- **Walking into something turns you to face it** without moving you.
- **Switching windows stops you.** If you tab away with a key held, you stop walking and any queued taps are dropped.
- **Keys don't leak between walking and battling.** An arrow still held down when a battle starts does nothing in the battle until you press it again, and keys pressed in a battle never become steps.
- **Keys wait while a battle turn plays.** From your answer until the menu comes back, every key is ignored — mashing Enter can't pick anything by accident — and the result card ignores keys for its first moment too.
- **The same walk meets the same animals.** Encounters are decided by how many steps you have taken since the page loaded, so after a reload the same route meets the same animals at the same steps (see § Finding a battle fast).
- **Leading zeros are fine**: "09" is the same answer as "9".
- **Walking waits in the pause menu.** Opening it mid-step lets that step land, then nothing moves until the menu closes. An arrow still held when the menu opens or closes does nothing until you press it again, and a battle can never start while the menu is open.
- **Nothing is saved.** A reload puts you back at (-2, 6) with one full-HP Squirrel, and forgets names and order.
- **`?party=` picks your starting team.** `http://localhost:5180/?party=rabbit,fox:0,bear:40:Big Bear` starts with those animals instead of the Squirrel: species ids separated by commas, each with an optional `:HP` (full when left out, kept between 0 and the species' maximum) and `:name` (cleaned like a typed one). Unknown species are skipped and at most six are kept. It exists to check the party screens without catching five animals first — and anyone who knows it can start with a bear.
- **`?zoo` shows every animal.** Open `http://localhost:5180/?zoo` and one of each species stands in a row two or three tiles from the start, in catalog order — squirrel, rabbit, fox, otter, deer, wolf, bear — facing you. They are scenery: you walk straight through them and nothing else changes. It exists to check the figures, not to play with.

## Exploits and quirks

- **Losing is a free full heal.** Since nothing else heals yet, a hurt party can lose a battle on purpose (answer wrong) to rest back to full HP at the start tile. Reloading does the same and also forgets every caught animal.
- **Messages never go away.** After a battle, pressing Enter or choosing who goes first, the last message stays on the bottom line until the next one. The "Arrows / WASD to walk" hint also never goes away.
- **A nickname can be anything made of letters**, including another animal's name or "Wild Fox": a squirrel called "Bear" is still a squirrel, and one called "Wild Fox" shows "Wild Fox" in its own status box in battle.
