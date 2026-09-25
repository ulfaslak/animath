# Cheatsheet

Everything a player can do in **today's build**, and how: every key, every hidden behaviour, every exploit. This file is a record of what the game actually does. It is not a plan: intended controls live in [[UI_SPEC]], the list of features in [[PRODUCT]] §5, and the rules in [[PRODUCT]] §4.

**Keep it true.** Any PR that adds, removes or changes an input, a way to reach something, or a behaviour a player could stumble on updates this file in the same PR. If you find an exploit, record it here, and if a kid could use it to break the game, also file it as a `bug`.

## Controls

| Key                   | Mode    | What it does                                                                                                            |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| Arrow keys / W A S D  | Explore | Walk one tile. Hold to keep walking (about 5–6 tiles a second).                                                         |
| Enter / Space         | Explore | Interact. Today it always says "Nothing here yet.", wherever you stand and whatever you face. The on-screen hint doesn't mention this key. |
| Up / Down, W / S      | Battle menu | Move the cursor through the attacks, Leash and Run. It wraps round from the top to the bottom.                    |
| Left / Right, A / D   | Battle menu | Pick the level (1, 2 or 3) for the attack. The same level applies to every attack and is remembered for the next battle. |
| 1 / 2 / 3             | Battle menu | On an attack: pick that level and attack straight away. On Leash or Run: nothing.                                   |
| Enter / Space         | Battle menu | Do the highlighted thing: attack at the chosen level, throw the leash, or run.                                      |
| 0–9, minus            | Puzzle  | Type the answer. A minus only works as the first character; at most seven characters.                                    |
| Backspace             | Puzzle  | Delete the last character.                                                                                              |
| Enter                 | Puzzle  | Answer. Nothing happens until you have typed at least one digit.                                                        |
| Enter / Space         | Result card | Back to exploring.                                                                                                  |

Escape does nothing anywhere yet — not even in a puzzle: once a puzzle is up, the only way on is to answer it. The mouse and touch are ignored everywhere (the result card's button looks clickable but isn't). The page has no debug keys or console hooks; its one URL parameter is `?zoo` (see § Hidden behaviour).

## The world

- The world is the **same every time**. The seed is fixed (`'prototype'`), so the same map loads on every reload and on every machine.
- You **start at (-2, 6)**, on grass next to a stretch of water. The HUD shows your grid position: pressing Right adds 1 to x, and pressing Down adds 1 to y.
- The world never ends. It is generated in 16×16 chunks as you walk, in every direction.
- **You are a kid in a blue cap** (coral shirt, blue shorts). The figure turns to face the way you last walked or bumped, stands on top of hills rather than sinking into them, and breathes gently while you stand still.

| Tile                                          | Walk on it? |
| --------------------------------------------- | ----------- |
| Grass                                         | Yes         |
| Tall grass (darker green with little blades)   | Yes. Each step onto it has a 1-in-10 chance of a wild battle, unless nothing living there is big enough to take on the animal leading your party (see § Your party). |
| Sand                                          | Yes         |
| Doctor's tent (orange pyramid with a campfire) | No. Walking into it turns you to face it. Pressing Enter while facing it still says "Nothing here yet."; healing will happen here. The nearest one to the start is at (5, 7): walk 6 tiles right and 1 down, and you stand just left of it. |
| Water                                         | No          |
| Rock                                          | No          |
| Tree                                          | No          |

## Finding a battle fast

The tile straight left of the start, (-3, 6), is a river reed: tall grass on the river bank. Near home, with the starting Squirrel in front, squirrels and rabbits come down to the water, and now and then an otter. Press Left and Right in turn (Left, Right, Left, …): every Left lands on the reed. **The 11th step (the sixth Left) always meets a Rabbit**, the 15th a Squirrel, and the first Otter comes on the 97th step. For foxes and the odd deer, walk to the meadow tall grass south-east of the start — the nearest is (2, 7), (3, 7) and (4, 7) — where you meet squirrels and rabbits, sometimes a fox and rarely a deer.

Who comes out depends on who leads your party (§ Your party). With a fox or an otter in front, the same steps on the reed meet an Otter every time; with a wolf or a bear in front, the reed never starts a battle.

## Battles

- **You always go first.** Pick an attack and a level, answer the puzzle, then the wild animal answers with one of its attacks. Facing an animal its own size or bigger it sometimes misses ("It missed."); a smaller one it never misses.
- **Higher level, harder sum, bigger hit.** Each attack row says how hard its puzzle is at the chosen level (easy, medium, hard, super hard), and the box on the right says what kind of maths it asks and how much damage it does.
- **A wrong answer misses** ("Not quite!", then "Missed! The wild Rabbit shrugs it off."). The right answer is not shown.
- **Picking an attack can't be undone.** Leaving the puzzle is not possible; typing anything wrong counts as a miss.
- **Leash**: the row says "strong", "weaker" or "weak" (red, amber or green dot) by how much HP the wild animal has left, in thirds. It is about HP only: a fierce animal stays hard to catch even when it says "weak" (a bear at a third of its HP breaks free about 94 times in 100). A throw that breaks free costs your turn.
- **Run** always works and costs nothing.
- **When your animal is tired** (0 HP), the next animal in your party that isn't tired steps in by itself, and you choose again.
- **Win, catch, or run**: a card says what happened; press Enter to walk on from the same tile. HP you lost stays lost.
- **Lose** (every animal tired): "Good try!" — everyone rests back to full HP and you are put back on the start tile, (-2, 6). (A stand-in: later you will be taken to the nearest doctor's tent.)

## Your party

The cards in the top-left corner are your party. You start with one Squirrel at full HP (20 of 20). Every animal you catch joins the end of the list, with the HP it had when the leash landed, up to six. With six already, a caught animal goes back into the grass. An animal at 0 HP is greyed out with a "tired" tag and sits out battles. Nothing heals except losing a battle (everyone back to full) and reloading the page (everything back to the start).

**Your lead decides what comes out of the grass.** The lead is the first card that isn't tired: the animal that steps into the next battle. Wild animals size it up:

- Nothing two or more tiers smaller than the lead ever comes out. One tier smaller comes out now and then (about 1 battle in 10 where there is any).
- Everything else is the mix the starter meets, moved up to the lead's size. With a fox in front, near home, the meadow is about 71% foxes, 14% deer and 14% squirrels or rabbits; the forest mostly foxes, sometimes a deer, rarely a wolf or a bear; the river all otters; the mountains foxes and otters that come up the hills, rarely a wolf or a bear.
- It still starts a battle on 1 grass step in 10 wherever anything could, whoever leads: the same steps as with the starter, only the animal differs.
- Where nothing is big enough, the grass is quiet: with a wolf in front, the river; with a bear in front, the meadow and the river. A deer at the river meets only otters, and a wolf in the meadow only deer.

To meet smaller animals again, put a smaller animal in front. Today the Squirrel you start with leads until it is tired. Then the next card that isn't tired leads, until a lost battle heals everyone and puts the Squirrel back in front.

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
- **Nothing is saved.** A reload puts you back at (-2, 6) with one full-HP Squirrel.
- **`?zoo` shows every animal.** Open `http://localhost:5180/?zoo` and one of each species stands in a row two or three tiles from the start, in catalog order — squirrel, rabbit, fox, otter, deer, wolf, bear — facing you. They are scenery: you walk straight through them and nothing else changes. It exists to check the figures, not to play with.

## Exploits and quirks

- **Losing is a free full heal.** Since nothing else heals yet, a hurt party can lose a battle on purpose (answer wrong) to rest back to full HP at the start tile. Reloading does the same and also forgets every caught animal.
- **A bear in front walks through the meadow and the river in peace.** Nothing there is big enough to challenge it, so no battle ever starts; the same goes for a wolf at the river.
- **Messages never go away.** After a battle or pressing Enter, the last message stays on the bottom line until the next one. The "Arrows / WASD to walk" hint also never goes away.
