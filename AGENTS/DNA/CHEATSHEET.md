# Cheatsheet

Everything a player can do in **today's build**, and how: every key, every hidden behaviour, every exploit. This file is a record of what the game actually does. It is not a plan: intended controls live in [[UI_SPEC]], the list of features in [[PRODUCT]] §5, and the rules in [[PRODUCT]] §4.

**Keep it true.** Any PR that adds, removes or changes an input, a way to reach something, or a behaviour a player could stumble on updates this file in the same PR. If you find an exploit, record it here, and if a kid could use it to break the game, also file it as a `bug`.

## Controls

| Key                   | Mode    | What it does                                                                                                            |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| Arrow keys / W A S D  | Explore | Walk one tile. Hold to keep walking (about 5–6 tiles a second).                                                         |
| Enter / Space         | Explore | Facing a doctor's tent: talk to the doctor (the bottom line says "Press Enter to talk to the doctor" there). Anywhere else it says "Walk up to a tent to talk to the doctor." |
| 1–6                   | Explore | Choose who goes first: the animal on that card moves to the top of your team ("Fox goes first!"), even mid-step. A tired one stays where it is ("Rabbit is tired. Visit the doctor!"), and so does the one that already goes first ("Fox already goes first!"). A number with no card does nothing, and with one animal there are no numbers. |
| Escape                | Explore | Open the pause menu. Walking waits until it closes. |
| Up / Down, W / S      | Pause menu | Move the cursor through your team, then Language and "Keep playing". It wraps round. |
| Enter / Space         | Pause menu | On an animal: open its options on the right. On Language: switch to the next language. On "Keep playing": close the menu. |
| Left / Right, A / D   | Pause menu | On Language: switch to the other language. Everywhere else: nothing. |
| Up / Down, W / S; Enter / Space | Animal options | Choose and do: Go first, Move up, Move down, New name, Back. Greyed options are skipped: Go first for a tired animal or the one already going first, Move up at the top, Move down at the bottom. Moves happen at once, and the options stay open for the next one. |
| Escape                | Pause menu | Close the menu; from an animal's options, back to the list; from the name box, back to the options without saving. |
| Any letter, digit, Space | Name box | Type the name; W A S D and Space are just letters here. The arrows move the caret, Backspace deletes. The box stops at 12 characters. |
| Enter                 | Name box | Save the name and go back to the list. An empty name gives the species' name back. |
| Up / Down, W / S      | Doctor  | Move the cursor through the animals who need the doctor and Bye; fit animals are skipped. It wraps round.           |
| Enter / Space         | Doctor  | Pick the highlighted animal (its puzzle appears), or say bye on Bye. Nothing for the first half second after the card opens. |
| Up / Down, W / S      | Doctor puzzle | Swap the puzzle for the previous or next animal who needs the doctor (a fresh puzzle; what you typed is dropped). With only one animal hurt, nothing. |
| Escape                | Doctor  | Leave, at any time: on the list, in a puzzle, even while "Correct!" or "Not quite!" is showing. An animal already healed stays healed. |
| Up / Down, W / S      | Battle menu | Move the cursor through the attacks, Leash, Switch and Run. It wraps round from the top to the bottom.            |
| Left / Right, A / D   | Battle menu | On an attack: make that attack easy, medium or hard. Only the highlighted attack changes; every attack keeps its own level. On Leash, Switch or Run: nothing. |
| 1 / 2 / 3             | Battle menu | On an attack: set it to easy (1), medium (2) or hard (3) and attack straight away. On Leash, Switch or Run: nothing. |
| Enter / Space         | Battle menu | Do the highlighted thing: attack at that attack's level, throw the leash, open the party list (Switch), or run. On a greyed Switch: nothing. |
| Up / Down, W / S      | Battle switch list | Move through your animals, tired ones and the one in battle included. It wraps round.                     |
| Enter / Space         | Battle switch list | Send the highlighted animal in. On a greyed one (tired, or already in battle) the row shakes and nothing happens. |
| Escape                | Battle switch list | Back to the menu, on Switch. Does nothing when the list came up because your animal got tired: you must pick. |
| 0–9, minus            | Puzzle (battle or doctor) | Type the answer. A minus only works as the first character; at most seven characters.                  |
| Backspace             | Puzzle (battle or doctor) | Delete the last character.                                                                            |
| Enter                 | Puzzle (battle or doctor) | Answer. Nothing happens until you have typed at least one digit.                                      |
| Enter / Space         | Result card | Back to exploring.                                                                                                  |

Escape opens the pause menu in explore and leaves the doctor's card; in a battle it only backs out of the switch list — not even in a battle puzzle: once a battle puzzle is up, the only way on is to answer it. The mouse and touch are ignored everywhere but on the button of the card a window shows when another window has played past it (§ Saving). The result card's and the doctor's buttons, the party cards and the pause menu's rows look clickable but aren't; a click in the name box only moves the caret. The page has no debug keys or console hooks; its URL parameters are `?zoo`, `?lang`, `?debug`, `?party=` and `?new` (see § Hidden behaviour and § Saving).

## The world

- The world is the **same every time**. The seed is fixed (`'prototype'`), so the same map loads on every reload and on every machine.
- A new game **starts at (-2, 6)**, on grass next to a stretch of water; after that, the game starts where you left it (§ Saving). Pressing Right adds 1 to x, and pressing Down adds 1 to y. The screen doesn't show the position unless the URL has `?debug`.
- The world never ends. It is generated in 16×16 chunks as you walk, in every direction.
- **You are a kid in a blue cap** (coral shirt, blue shorts). The figure turns to face the way you last walked or bumped, stands on top of hills rather than sinking into them, and breathes gently while you stand still.

| Tile                                          | Walk on it? |
| --------------------------------------------- | ----------- |
| Grass                                         | Yes         |
| Tall grass (darker green with little blades)   | Yes. Each step onto it has a 1-in-10 chance of a wild battle, unless nothing living there is big enough to take on the animal leading your party (see § Your party). |
| Sand                                          | Yes         |
| Doctor's tent (orange pyramid with a campfire) | No. Walking into it turns you to face it, and then Enter talks to the doctor (see § The doctor). |
| Water                                         | No          |
| Rock                                          | No          |
| Tree                                          | No          |

## Finding a battle fast

The tile straight left of the start, (-3, 6), is a river reed: tall grass on the river bank. Frogs live in the reeds, and near home, with the starting Squirrel in front, squirrels and rabbits come down to the water too (a third each), and now and then an otter (1 in 16). In a new game (a new browser, a private window or `?new`), press Left and Right in turn (Left, Right, Left, …): every Left lands on the reed. **The 11th step (the sixth Left) always meets a Rabbit**, the 15th a Squirrel, the first Frog comes on the 71st step and the first Otter on the 97th. The steps are counted over the whole game and saved with it, so this only works from the start of a game, not after a reload. For foxes and the odd deer, walk to the meadow tall grass south-east of the start — the nearest is (2, 7), (3, 7) and (4, 7) — where you meet squirrels and rabbits, sometimes a fox and rarely a deer.

**Finding frogs**: any reed on a river bank, near home or far out. They live nowhere else, though near home, while a squirrel, a rabbit or a frog goes first, they also hop up into the mountain grass. Far out the river is half frogs, half otters. With a fox or an otter in front, a frog comes out at the river 1 time in 11, and with anything bigger, never.

Who comes out depends on who leads your party (§ Your party). With a frog or a rabbit in front, the same steps meet the same animals as with the squirrel. With a fox or an otter in front, the same steps on the reed meet an Otter each time until the 147th, which brings the first Frog; after that about 1 battle in 11 there is a frog. With a wolf or a bear in front, the reed never starts a battle.

## Battles

- **You always go first.** Pick an attack and a level, answer the puzzle, then the wild animal answers with one of its attacks. Facing an animal its own size or bigger it sometimes misses ("It missed."); a smaller one it never misses.
- **Harder sum, bigger hit.** Every attack has its own level, easy, medium or hard, shown on its row; the box on the right says what kind of maths it asks and how much damage it does. The words are the attack's own three steps, not a scale shared by every animal: a bear's easy Crush is still a very hard sum.
- **A wrong answer misses** ("Not quite!", then "Missed! The wild Rabbit shrugs it off."). The right answer is not shown.
- **Picking an attack can't be undone.** Leaving the puzzle is not possible; typing anything wrong counts as a miss.
- **Leash**: the row says how likely a catch is right now, with a dot of the same colour: "Good chance!" (green, one in two or better), "Maybe" (amber, one in five or better) or "Hard to catch" (red). It follows the real odds, so it changes as the animal's HP drops and depends on the species: a rabbit at full HP is "Hard to catch" and at 2 HP a "Good chance!"; a frog is slippery, "Maybe" from 8 HP down and a "Good chance!" only at 2 HP or less; a fox turns "Maybe" below about a third of its HP and "Good chance!" only at 1 HP; a bear is "Hard to catch" all the way down. A throw that breaks free costs your turn.
- **Run** always works and costs nothing.
- **Switch** sends in another animal ("Come back, Squirrel!", "Go, Rabbit!"). It costs your turn: the wild animal has a go at the newcomer straight away. It is greyed with only one animal in your party ("You need a second animal to switch. Catch one with the leash!") and when everyone else is tired.
- **When your animal is tired** (0 HP) and someone else isn't, the party list comes up: "Squirrel is tired. Who goes next?" Pick anyone who isn't tired. That pick is free (the wild animal doesn't get a turn), and then you choose what to do.
- **Win, catch, or run**: a card says what happened; press Enter to walk on from the same tile. HP you lost stays lost.
- **Lose** (every animal tired): "Good try!" — press Enter and you are standing beside the nearest doctor's tent (nearest on foot, never across water), facing it, with the whole party at full HP, and the bottom line says "The doctor looked after your animals. Everyone feels better!". From the reed by the start that is (4, 7), just left of the tent at (5, 7). If no tent is within 200 steps, you stay where you were and it says "A doctor came by…" instead.

## The doctor

- **Finding one**: the nearest tent to the start is at (5, 7). Walk 7 tiles right, all on grass, to (5, 6), then press Down: you bump into the tent and face it. (From the left, (4, 7) is tall grass.) Standing next to a tent without facing it is not enough: press the arrow toward it first.
- **Talking**: press Enter while facing the tent. A card opens at the bottom of the screen with the doctor's line, your party on the left and a puzzle area on the right. Your party cards in the corner go away while it is open, and walking waits.
- **Healing**: pick an animal who is hurt or tired and solve its puzzle: it is back to full HP ("Well done! Squirrel feels all better!", its row lights up green and a green "+15" pops over it). One puzzle heals one animal. The puzzle is a kind the animal's own attacks ask (so a frog gets a number pattern or a times table), and harder for fiercer animals: difficulty 2 for a squirrel, a rabbit or a frog, 3 for a fox or an otter, 5 for a deer, 6 for a wolf, 8 for a bear.
- **A wrong answer costs nothing**: "Not quite! Let's try another one." and a different puzzle, as many times as it takes. The right answer is not shown.
- **Fit animals** are shown greyed and can't be picked. With nobody hurt the doctor says "Hello! Your animals are all fit and happy." and Enter just says bye.
- **Leaving**: Bye (Enter on it) or Escape, at any time. The doctor says "Bye! Come back any time." on the bottom line.

## Your party

The cards in the top-left corner are your party, in battle order. You start with one Squirrel at full HP (20 of 20). Every animal you catch joins the end of the list, with the HP it had when the leash landed, up to six. With six already, a caught animal goes back into the grass. An animal at 0 HP is greyed out with a "tired" tag and sits out battles. Animals heal at a doctor's tent (one puzzle each), and all at once for free when you lose a battle. Reloading changes nothing: the party comes back exactly as it was, in the same order, with the same names and the same animal first.

- **Who goes first**: the first card that isn't tired, outlined in orange and tagged "goes first". It steps into the next battle. If it gets tired in a battle you pick who steps in, and afterwards the first card down that isn't tired goes first. Press a card's number, or pick "Go first" in the pause menu, to move that animal to the top. The numbers on the cards follow the order, so the animal you picked becomes 1 and the others move down one.
- **Moving and naming**: in the pause menu (Escape) any animal can move up or down, a tired one too — a tired animal on top is skipped, and the tag stays with the first one standing. "New name" gives an animal a nickname, which the cards, the menu and battles all use ("Go, Pip!").
- **What a name can be**: up to 12 letters (any alphabet, so "Søren" and "राम" work; an accent Unicode keeps separate from its letter, like a Hindi vowel sign, counts as a letter, and a few rarer alphabets keep their letters but lose their accents), digits, spaces, hyphens, apostrophes and dots. Emoji, other symbols and the text-generator tricks (underlined, struck-through or circled letters) are left out when you press Enter, extra spaces are squeezed, and a name with no letter or digit left — empty, spaces, only emoji — means no nickname: the animal is called by its species again. The name box shows "It will be called …" before you press Enter whenever the name will come out different from what you typed.

**Your lead decides what comes out of the grass.** Wild animals size up the animal that goes first:

- Nothing two or more tiers smaller than the lead ever comes out. One tier smaller comes out now and then where animals the lead's size or bigger live too: near home 1 battle in 7 to 1 in 13 (a fox in the meadow meets a squirrel or a rabbit 1 time in 7), and far out, where big animals are common, as rarely as 1 in 40.
- Everything else is the mix the starter meets, moved up to the lead's size. With a fox in front, near home, the meadow is about 71% foxes, 14% deer and 14% squirrels or rabbits; the forest mostly foxes, sometimes a deer, rarely a wolf or a bear; the river otters, and a frog 1 time in 11; the mountains foxes and otters that come up the hills, rarely a wolf or a bear.
- It still starts a battle on 1 grass step in 10 wherever anything could, whoever leads: the same steps as with the starter, only the animal differs.
- Where nothing is big enough, the grass is quiet: with a wolf in front, the river; with a bear in front, the meadow and the river. Where only one-tier-smaller animals live, every battle is one of them, still on 1 grass step in 10: a deer at the river meets only otters, and a wolf in the meadow only deer.

To meet smaller animals again, put a smaller animal in front: press its number, or pick "Go first" in the pause menu. A lost battle heals everyone and keeps the order, so the first card leads again.

## Hidden behaviour

- **A tap is always one step.** A key press shorter than a frame still moves you one tile.
- **Mashing is capped.** At most two taps are queued, so mashing a key does not queue a long walk.
- **Two keys held: the newest wins.** Hold Right, then press Up as well, and you walk up. Let go of Up and you walk right again. There is no diagonal movement.
- **Walking into something turns you to face it** without moving you.
- **Switching windows stops you.** If you tab away with a key held, you stop walking and any queued taps are dropped.
- **Keys don't leak between walking and battling.** An arrow still held down when a battle starts does nothing in the battle until you press it again, and keys pressed in a battle never become steps.
- **Attack levels are remembered, per attack and per kind of animal, until you reload.** Set a squirrel's Nut Toss to hard and it is hard in the next battle too, and for every squirrel you have; a rabbit's attacks keep their own. After a switch the menu starts on the new animal's first attack.
- **Switching can't be used to stall.** Every switch you choose gives the wild animal a turn, so switching back and forth only wears your party down.
- **Keys wait while a battle turn plays.** From your answer until the menu comes back, every key is ignored — mashing Enter can't pick anything by accident — and the result card ignores keys for its first moment too, as does the "Who goes next?" list after a knock-out (Enter and Space only; the arrows move at once).
- **The doctor's card is the same.** It ignores every key but Escape for its first half second, and while "Correct!" or "Not quite!" is showing. A key held down when it opens does nothing until pressed again, and keys pressed at the doctor never become steps.
- **Messages fade.** A line on the bottom of the screen stays for 5 seconds of walking about, then fades. A line said during a battle or at the doctor waits for you: after a battle the result's line is still there when you are back in the world. "Walk up to a tent…" goes as soon as you face a tent, where the prompt takes over. A line about who goes first also goes at once when a battle or the doctor changes your party.
- **The controls hint goes away** after your first 5 steps. Bumping into things doesn't count, however long you hold the key. It comes back for 5 steps after every reload.
- **The same walk meets the same animals.** Encounters are decided by how many steps you have taken in this game, so two new games walked the same way meet the same animals at the same steps (see § Finding a battle fast). The count is saved, so a reload carries on with the next step: it never replays the animals behind you. The doctor's puzzles work the same way.
- **Leading zeros are fine**: "09" is the same answer as "9".
- **Walking waits in the pause menu.** Opening it mid-step lets that step land, then nothing moves until the menu closes. An arrow still held when the menu opens or closes does nothing until you press it again, and a battle can never start while the menu is open. A reload with the menu open comes back to the world, the menu closed; a name typed but not yet saved with Enter is gone.
- **Danish or English, everywhere.** The game starts in Danish if your browser prefers Danish, else in English. Language in the pause menu switches every word at once — the animals' and attacks' names too ("Ræv", "Nøddekast") — even with a line still on the bottom of the screen, which changes language with the rest, and the game remembers the choice on this computer. `?lang=da` or `?lang=en` in the address picks one for that visit without changing what is remembered. Puzzles are the same sums in both languages, and so is typing the answer. A name you give an animal is never translated: "Nøddi" is Nøddi in both.
- **`?zoo` shows every animal.** Open `http://localhost:5180/?zoo` and one of each species stands in a row two or three tiles from the start, in catalog order — squirrel, rabbit, frog, fox, otter, deer, wolf, bear — facing you. They are scenery: you walk straight through them and nothing else changes. It exists to check the figures, not to play with.
- **`?debug` shows where you are**: the grid position and the way you face (`5, 6 · down`) in the top-right corner.
- **`?party=` picks your starting party**, for looking at screens that need one: `?party=squirrel:5,rabbit:0,fox` starts with a squirrel at 5 HP, a tired rabbit and a fox at full HP, in a throwaway game like `?new`: nothing is loaded or saved, and the saved game is left alone. Species are the catalog ids (`squirrel`, `rabbit`, `frog`, `fox`, `otter`, `deer`, `wolf`, `bear`), HP is optional (full by default) and clamped to the species, at most six. Anything misspelt and the game starts as usual. Switches combine: `?debug&party=bear`.

## Saving

- **Everything is saved as you go**, in this browser: after every step, every battle turn and every catch, and when you close the tab. There is no save button and nothing to wait for. Reload, or come back another day, and you are where you were, facing the way you were, with the same animals and HP. The message line says "Welcome back!".
- **A reload in a battle picks the battle up**: the same wild animal, the same HP, and the same puzzle if one was up, or the list of who steps in after a knock-out (what you had typed is gone, and so are the levels you had picked). The narration starts again with "A wild … appears!". A reload after you answered, while the turn is still being told, skips to what happened: the answer already counted.
- **The saved game belongs to the browser and the address.** Another browser, a private window, `localhost` instead of the shared link, or a different link is a different game. A kid who comes back through the same link on the same browser finds their game.
- **Two tabs or windows of the game.** Both start as the same game. When one catches an animal, wins, loses, plays a battle turn, heals or changes the team, the other is behind: it ignores every key. A hidden tab loads the newer game when you switch to it. A window on screen next to the one you play in shows a card, "You kept playing in another window. Get your newest game [Enter]", and loads it when you click into that window or on the button, or press Enter or Space. Either way it then says "You were playing in another window. Here's your newest game!". A window you are using loads by itself at most 3 times a minute; after that it shows the card and waits for Enter, which always works. While a window is behind, typing in its name box shows no letters and a Space there does nothing; Enter still loads the newest game. Walking in either is fine: the one you use carries on from where it is. Nothing a tab did is ever lost to the other one, and a tab that is behind never lets you play on in it.
- **Start a new game**: clear this site's data in the browser (the padlock or site-settings menu, "Delete data" or "Clear cookies and site data"), then reload. Nothing inside the game deletes a save. `http://…/?new` plays a new game in that tab that is saved nowhere; drop `?new` and the saved game is back, untouched. A private window is also a new game, kept only while the window is open.
- **A save that won't load** (after an update the game cannot read it) gives a new game and says "Your saved game didn't load, so here is a new one." The old save stays until you play the new game (a battle, a catch, a heal, or a change to your team), and is then kept aside, not deleted. Walking about or talking to the doctor doesn't count. A save written by a newer version of the game is not touched: the page says to reload.
- **No server, no problem.** The game saves in the browser whether or not the server is running. It also keeps a backup on the server when it can reach it; if the server is down it tries a few times, then again after the next battle.

## Exploits and quirks

- **Losing is a free full heal.** Healing at the doctor costs one puzzle per animal, but losing a battle on purpose (answer wrong) heals the whole party for nothing and puts you by the nearest tent. Reloading heals nothing and forgets nothing.
- **A hard doctor's puzzle can be skipped**: answer anything (a wrong answer costs nothing and brings another puzzle), swap to another animal and back, or say bye and talk again. By design: at the doctor, nothing is lost by missing. A reload while the doctor's card is open closes it; anything healed stays healed.
- **The save is plain text in the browser.** Anyone who opens the browser's developer tools can read and edit `animath.save` in the site's local storage: change HP, add animals, move anywhere. In the middle of a puzzle it also holds the puzzle's answer. The server backup takes whatever the browser sends. Harmless in a single-player game; it matters once games are shared ([[DEFERRED]]).
- **A bear in front walks through the meadow and the river in peace.** Nothing there is big enough to challenge it, so no battle ever starts; the same goes for a wolf at the river. With a bear in the team, its number key turns this on and off as you walk: put the bear first to cross the meadow without a battle, then a squirrel first to meet rabbits again.
- **A small lead with a big fighter.** The animal that goes first decides how fierce the animals you meet are, but anyone can fight them. Put the Squirrel first, switch to a Bear on the first turn of every battle, and the Squirrel never gets tired, so it stays first: you keep meeting squirrels and rabbits and beat them with Bear-sized hits (and Bear-hard sums). Without switching, the Squirrel would soon be tired and the Bear would go first.
- **`?party=` is a cheat**: anyone who edits the URL can start with a bear (and so walk the meadow in peace). It is there for testing, and the game it starts is never saved.
- **A nickname can be anything made of letters**, including another animal's name or "Wild Fox": a squirrel called "Bear" is still a squirrel, and one called "Wild Fox" shows "Wild Fox" in its own status box in battle.
