# Cheatsheet

Everything a player can do in **today's build**, and how: every key, every hidden behaviour, every exploit. This file is a record of what the game actually does. It is not a plan: intended controls live in [[UI_SPEC]], the list of features in [[PRODUCT]] §5, and the rules in [[PRODUCT]] §4.

**Keep it true.** Any PR that adds, removes or changes an input, a way to reach something, or a behaviour a player could stumble on updates this file in the same PR. If you find an exploit, record it here, and if a kid could use it to break the game, also file it as a `bug`.

## Controls

| Key                   | Mode    | What it does                                                                                                            |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| Arrow keys / W A S D  | Explore | Walk one tile. Hold to keep walking (about 5–6 tiles a second).                                                         |
| Enter / Space         | Explore | Interact. Today it always says "Nothing here yet.", wherever you stand and whatever you face. The on-screen hint doesn't mention this key. |

No other key does anything. Escape, number keys, the mouse and touch are ignored. The page has no URL parameters, debug keys or console hooks.

## The world

- The world is the **same every time**. The seed is fixed (`'prototype'`), so the same map loads on every reload and on every machine.
- You **start at (-2, 6)**, on grass next to a stretch of water. The HUD shows your grid position: pressing Right adds 1 to x, and pressing Down adds 1 to y.
- The world never ends. It is generated in 16×16 chunks as you walk, in every direction.

| Tile                                          | Walk on it? |
| --------------------------------------------- | ----------- |
| Grass                                         | Yes         |
| Tall grass (darker green with little blades)   | Yes. Nothing happens yet; wild encounters will start here. |
| Sand                                          | Yes         |
| Doctor's tent (orange pyramid with a campfire) | Yes. You stand inside it. Nothing happens yet; healing will happen here. The nearest one to the start is at (5, 7). |
| Water                                         | No          |
| Rock                                          | No          |
| Tree                                          | No          |

## Your party

The card in the top-left corner is your party: one Squirrel with full HP (20 of 20). Nothing can hurt or heal it yet, and you can't catch anything, so the party never changes.

## Hidden behaviour

- **A tap is always one step.** A key press shorter than a frame still moves you one tile.
- **Mashing is capped.** At most two taps are queued, so mashing a key does not queue a long walk.
- **Two keys held: the newest wins.** Hold Right, then press Up as well, and you walk up. Let go of Up and you walk right again. There is no diagonal movement.
- **Walking into something turns you to face it** without moving you.
- **Switching windows stops you.** If you tab away with a key held, you stop walking and any queued taps are dropped.
- **Nothing is saved.** A reload puts you back at (-2, 6).

## Exploits and quirks

- **Messages never go away.** After you press Enter, "Nothing here yet." stays on the bottom line until you reload. The "Arrows / WASD to walk" hint also never goes away.
- **You can stand inside a doctor's tent**, because tents count as walkable ground.
