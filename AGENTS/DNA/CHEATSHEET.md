# Cheatsheet

Everything a player can do in **today's build**, and how: every key, every hidden behaviour, every exploit. This file is a record of what the game actually does. It is not a plan: intended controls live in [[UI_SPEC]], the list of features in [[PRODUCT]] §5, and the rules in [[PRODUCT]] §4.

**Keep it true.** Any PR that adds, removes or changes an input, a way to reach something, or a behaviour a player could stumble on updates this file in the same PR. If you find an exploit, record it here, and if a kid could use it to break the game, also file it as a `bug`.

## Controls

| Key                   | Mode    | What it does                                                                                                            |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| Up / Down, W / S      | Title   | Move through Continue (only when a game is saved), New game, Language and Sound. It wraps round. |
| Enter / Space         | Title   | Continue: carry on the saved game exactly where it was, a battle included ("Welcome back!"). New game: pick a first animal (with a game saved, it asks first). Language: switch to the next language. Sound: turn the sound off or on. |
| Left / Right, A / D   | Title   | On Language: switch the language; on Sound: off (left) or on (right), both remembered on this device. On the other rows: nothing. Escape does nothing on the title. |
| Up / Down, W / S; Enter / Space | New game? | "Start a new game?" starts on "No, go back". Enter does nothing for its first moment; then Enter on No goes back, and only Down, then Enter on "Yes, new game" starts over. Up and Down don't wrap. |
| Escape                | New game? | Back to the title, on New game. |
| Left / Right, A / D (Up / Down too) | Starters | Light the next or the previous animal. It wraps round. |
| Enter / Space         | Starters | Pick the lit animal: it hops, and the name box opens. Nothing for the first half second. |
| Escape                | Starters | Back to the title, on New game. |
| Any letter, digit, Space | Starter's name box | Type a name, as in the pause menu's name box (W A S D and Space are letters; 12 characters). |
| Enter                 | Starter's name box | Start the game with that animal and that name; an empty box means no name. Nothing for the first half second, or on a held Enter. |
| Escape                | Starter's name box | Back to the starters, the same one lit. |
| Arrow keys / W A S D  | Explore | Walk one tile. Hold to keep walking (about 5–6 tiles a second). Caps Lock and Shift make no difference.                  |
| Enter / Space         | Explore | Facing a doctor's tent: talk to the doctor (the bottom line says "Press Enter to talk to the doctor" there). Anywhere else it says "Walk up to a tent to talk to the doctor." |
| 1–6                   | Explore | Choose who goes first: the animal on that card moves to the top of your team ("Fox goes first!"), even mid-step. A tired one stays where it is ("Rabbit is tired. Visit the doctor!"), and so does the one that already goes first ("Fox already goes first!"). A number with no card does nothing, and with one animal there are no numbers. |
| Escape                | Explore | Open the pause menu. Walking waits until it closes. |
| M                     | Anywhere | Sound off, or back on. A chip at the top says "Sound is off" (with "Press M to turn it back on") or "Sound is on" for three seconds. Not while you type an answer or a name: there M is a letter (and in a puzzle, nothing). Held down, it flips once. Not in a window that another window has played past (§ Saving). |
| Up / Down, W / S      | Pause menu | Move the cursor through your team, then Language, Sound, "Keep playing" and "Start screen". It wraps round. |
| Enter / Space         | Pause menu | On an animal: open its options on the right. On Language: switch to the next language. On Sound: turn the sound off or on. On "Keep playing": close the menu. The menu stays open after a setting changes. On "Start screen": back to the title, the game saved as it stands; Continue there carries on from the same spot. |
| Left / Right, A / D   | Pause menu | On Language: switch to the other language. On Sound: off (left) or on (right). Everywhere else: nothing. |
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
| Enter / Space         | Battle menu | Do the highlighted thing: attack at that attack's level, throw the leash, open the party list (Switch), or run. On a greyed Switch: nothing. For the first moment after the battle text ends (0.8 s), and while mashed (pressed again within 0.3 s), Enter, Space and 1 / 2 / 3 do nothing. |
| Up / Down, W / S      | Battle switch list | Move through your animals, tired ones and the one in battle included. It wraps round.                     |
| Enter / Space         | Battle switch list | Send the highlighted animal in. On a greyed one (tired, or already in battle) the row shakes and nothing happens. |
| Escape                | Battle switch list | Back to the menu, on Switch. Does nothing when the list came up because your animal got tired: you must pick. |
| 0–9, minus            | Puzzle (battle or doctor) | Type the answer. A minus only works as the first character; at most seven characters.                  |
| Backspace             | Puzzle (battle or doctor) | Delete the last character.                                                                            |
| Enter                 | Puzzle (battle or doctor) | Answer. Nothing happens until you have typed at least one digit.                                      |
| Enter / Space         | Result card | Back to exploring.                                                                                                  |

Escape opens the pause menu in explore and leaves the doctor's card; in a battle it only backs out of the switch list — not even in a battle puzzle: once a battle puzzle is up, the only way on is to answer it. M is the one key that works the same on every screen, except in a window that another window has played past, which takes no key but Enter and Space (§ Saving). W A S D work the same with Caps Lock on or Shift held, in every menu too, and on a Russian or Greek keyboard they are the keys where W A S D sit on an English one. A key pressed with Ctrl, Cmd or Alt belongs to the browser everywhere: Cmd+D bookmarks, Ctrl+S saves the page, Alt+← goes back, and none of them moves the trainer. A mouse or a finger works every row, button and card too (§ Touch and mouse); walking takes the keys on a laptop and the D-pad on a tablet. The page has no debug keys or console hooks; its URL parameters are `?zoo`, `?lang`, `?debug`, `?party=` and `?new` (see § Hidden behaviour and § Saving). `?new`, `?party=` and `?zoo` skip the title: the game starts at once, and is saved nowhere.

## Touch and mouse

Everything below is a click with a mouse or a tap with a finger, and each is the key beside it: the same thing happens, behind the same waits. The D-pad, Talk, Menu and the number pad are the **touch controls**: they are there from the start on a tablet (a screen whose main pointer is a finger); anywhere, the first touch brings them and the first key pressed on a real keyboard puts them away. A mouse changes nothing.

| Tap or click               | Where                        | What it does                                                                                     |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| D-pad arrow (bottom left)  | Explore, touch               | The arrow key: a tap is one step, a finger held keeps walking, sliding onto another arrow turns, lifting stops. The middle presses nothing. |
| Talk (bottom right)        | Explore, touch               | Enter: facing a tent, talk to the doctor (Talk glows orange there, and the bottom line says "Tap Talk to talk to the doctor"); anywhere else, "Walk up to a tent to talk to the doctor." |
| Menu (beside Talk)         | Explore, touch               | Escape: the pause menu.                                                                          |
| A party card               | Explore                      | Its number key: that animal goes first ("Fox goes first!", or "Rabbit is tired. Visit the doctor!"). With one animal, nothing. |
| "Esc Menu" under the cards | Explore, mouse               | Escape: the pause menu.                                                                          |
| An attack, Leash, Switch or Run | Battle menu             | Highlights it, and nothing more, the highlighted row too: a tap never spends the turn.          |
| easy / medium / hard       | Battle menu, the highlighted attack | Sets that attack's level, and nothing more.                                               |
| Go!                        | Battle menu, switch list     | Enter: do the highlighted row (attack at its level, throw the leash, open the switch list, run), or send the highlighted animal in (a greyed one shakes). Dimmed where Enter would do nothing. |
| An animal                  | Battle switch list           | Highlights it.                                                                                   |
| Back                       | Battle switch list           | Escape: back to the menu, on Switch. Not there after a knock-out.                                |
| Number pad                 | Battle or doctor puzzle, touch | The keys: 1–9, 0, − (only as the first character), ⌫ deletes, OK answers (only once a digit is typed). Each key counts as the finger lands. |
| Anywhere                   | Result card                  | Enter: back to exploring. Not in its first moment, and not from a mash.                          |
| An animal who needs the doctor | Doctor                   | Picks it at once; in a puzzle, swaps to it (what was typed is dropped). A fit one, or the patient itself, does nothing. Nothing at all in the card's first half second. |
| Bye                        | Doctor                       | Escape: leave, at any time.                                                                      |
| A row                      | Pause menu                   | Does it at once: an animal opens its options, Language switches, Sound flips, Keep playing closes, Start screen goes to the title. |
| English / Dansk            | Pause menu, title            | That language. The one already on does nothing.                                                  |
| An option                  | Pause menu, an animal's options | Does it at once; a greyed one does nothing.                                                   |
| Save / Back                | Pause menu's name box        | Enter / Escape.                                                                                  |
| A row                      | Title                        | Does it at once: Continue, New game, Sound.                                                      |
| No, go back / Yes, new game | Title, "Start a new game?"  | Does it at once, after the question's first moment.                                              |
| An animal, or its name     | Title, the starters          | Lights it, and nothing more.                                                                     |
| "Pick the Frog!" / Back    | Title, the starters          | Enter / Escape.                                                                                  |
| "Let's go!" / Back         | Title, the name box          | Enter / Escape.                                                                                  |
| "Get your newest game"     | A window another window has played past | Enter: loads the newest game (§ Saving).                                             |

## The world

- The world is the **same every time**. The seed is fixed (`'prototype'`), so the same map loads on every reload and on every machine.
- A new game **starts at (-2, 6)**, on grass next to a stretch of water; after that, the game starts where you left it (§ Saving). Pressing Right adds 1 to x, and pressing Down adds 1 to y. The screen doesn't show the position unless the URL has `?debug`.
- The world never ends. It is generated in 16×16 chunks as you walk, in every direction.
- **You are a kid in a blue cap** (coral shirt, blue shorts). The figure turns to face the way you last walked or bumped, swings its arms and legs and hops a little with every step, stands on top of hills rather than sinking into them, and breathes gently while you stand still.

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

The tile straight left of the start, (-3, 6), is a river reed: tall grass on the river bank. Frogs live in the reeds, and near home, with the starting Squirrel in front, squirrels and rabbits come down to the water too (a third each), and now and then an otter (1 in 16). In a new game (New game on the title, with any starter, since they are all the same size; or `?new`), press Left and Right in turn (Left, Right, Left, …): every Left lands on the reed. **The 11th step (the sixth Left) always meets a Rabbit**, the 15th a Squirrel, the first Frog comes on the 71st step and the first Otter on the 97th. The steps are counted over the whole game and saved with it, so this only works from the start of a game, not after a reload. For foxes and the odd deer, walk to the meadow tall grass south-east of the start — the nearest is (2, 7), (3, 7) and (4, 7) — where you meet squirrels and rabbits, sometimes a fox and rarely a deer.

**Finding frogs**: any reed on a river bank, near home or far out. They live nowhere else, though near home, while a squirrel, a rabbit or a frog goes first, they also hop up into the mountain grass. Far out the river is half frogs, half otters. With a fox or an otter in front, a frog comes out at the river 1 time in 11, and with anything bigger, never.

Who comes out depends on who leads your party (§ Your party). With a frog or a rabbit in front, the same steps meet the same animals as with the squirrel. With a fox or an otter in front, the same steps on the reed meet an Otter each time until the 147th, which brings the first Frog; after that about 1 battle in 11 there is a frog. With a wolf or a bear in front, the reed never starts a battle.

## Battles

- **A battle opens with a circle.** A little tune plays, a circle closes on you (the step into the grass still lands) and opens again on the wild animal.
- **You always go first.** Pick an attack and a level, answer the puzzle, then the wild animal answers with one of its attacks. Facing an animal its own size or bigger it sometimes misses ("It missed."); a smaller one it never misses.
- **Harder sum, bigger hit.** Every attack has its own level, easy, medium or hard, shown on its row; the box on the right says what kind of maths it asks and how much damage it does. The words are the attack's own three steps, not a scale shared by every animal: a bear's easy Crush is still a very hard sum. Each level is a step up in difficulty from the one below it on every attack, the bear's strongest too: medium and hard never ask at the same difficulty (a puzzle can now and then come up at both, since neighbouring difficulties overlap a little). A bear's Roar, Maul and Crush ask at the same three difficulties, and Crush hits hardest.
- **A wrong answer misses** ("Not quite!", then "Missed! The wild Rabbit shrugs it off."). The right answer is not shown.
- **Picking an attack can't be undone.** Leaving the puzzle is not possible; typing anything wrong counts as a miss.
- **Leash**: the row says how likely a catch is right now, with a dot of the same colour: "Good chance!" (green, one in two or better), "Maybe" (amber, one in five or better) or "Hard to catch" (red). It follows the real odds, so it changes as the animal's HP drops and depends on the species: a rabbit at full HP is "Hard to catch" and at 2 HP a "Good chance!"; a frog is slippery, "Maybe" from 8 HP down and a "Good chance!" only at 2 HP or less; a fox turns "Maybe" below about a third of its HP and "Good chance!" only at 1 HP; a bear is "Hard to catch" all the way down. A throw that breaks free costs your turn. One that holds bursts into confetti round the animal. With six animals in your team the row says "Team is full" instead, with no dot: the leash still works, but a caught animal hops home, and the card says "Good throw!" and "Your team is full, so the wild Rabbit hops home."
- **Run** always works and costs nothing.
- **Switch** sends in another animal ("Come back, Squirrel!", "Go, Rabbit!"). It costs your turn: the wild animal has a go at the newcomer straight away. It is greyed with only one animal in your party ("You need a second animal to switch. Catch one with the leash!") and when everyone else is tired.
- **When your animal is tired** (0 HP) and someone else isn't, the party list comes up: "Squirrel is tired. Who goes next?" Pick anyone who isn't tired. That pick is free (the wild animal doesn't get a turn), and then you choose what to do.
- **Win, catch, or run**: a card says what happened; press Enter to walk on from the same tile. HP you lost stays lost.
- **Lose** (every animal tired): "Good try!" — press Enter and you are standing beside the nearest doctor's tent (nearest on foot, never across water), facing it, with the whole party at full HP, and the bottom line says "The doctor looked after your animals. Everyone feels better!". From the reed by the start that is (4, 7), just left of the tent at (5, 7). If no tent is within 200 steps, you stay where you were and it says "A doctor came by…" instead.

## The doctor

- **Finding one**: the nearest tent to the start is at (5, 7). Walk 7 tiles right, all on grass, to (5, 6), then press Down: you bump into the tent and face it. (From the left, (4, 7) is tall grass.) Standing next to a tent without facing it is not enough: press the arrow toward it first.
- **Talking**: press Enter while facing the tent. A card opens at the bottom of the screen with the doctor's line, your party on the left and a puzzle area on the right. Your party cards in the corner go away while it is open, and walking waits.
- **Healing**: pick an animal who is hurt or tired and solve its puzzle: it is back to full HP ("Well done! Squirrel feels all better!", its row lights up green, a green "+15" pops over it and stars sparkle along its HP bar). One puzzle heals one animal. The puzzle is a kind the animal's own attacks ask (so a frog gets a number pattern or a times table), and harder for fiercer animals: difficulty 2 for a squirrel, a rabbit or a frog, 3 for a fox or an otter, 5 for a deer, 6 for a wolf, 8 for a bear.
- **A wrong answer costs nothing**: "Not quite! Let's try another one." and a different puzzle, as many times as it takes. The right answer is not shown.
- **Fit animals** are shown greyed and can't be picked. With nobody hurt the doctor says "Hello! Your animals are all fit and happy." and Enter just says bye.
- **Leaving**: Bye (Enter on it) or Escape, at any time. The doctor says "Bye! Come back any time." on the bottom line.

## Your party

The cards in the top-left corner are your party, in battle order. You start with the animal you picked on the title, at full HP (a Squirrel 20 of 20, a Rabbit 22 of 22, a Frog 21 of 21), named or not; a throwaway game (`?new`) starts with a Squirrel. Every animal you catch joins the end of the list, with the HP it had when the leash landed, up to six. With six already, a caught animal hops home (the Leash row says "Team is full" before you throw). An animal at 0 HP is greyed out with a "tired" tag and sits out battles. Animals heal at a doctor's tent (one puzzle each), and all at once for free when you lose a battle. Reloading changes nothing: the party comes back exactly as it was, in the same order, with the same names and the same animal first.

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
- **Switching windows stops you.** If you tab away with a key held, or the page is hidden, you stop walking and any queued taps are dropped. So does pressing Ctrl, Cmd or Alt mid-walk; press the arrow again to walk on.
- **Letting go always stops you.** A key let go with Shift held down stops the walk like any other.
- **Keys don't leak between walking and battling.** An arrow still held down when a battle starts does nothing in the battle until you press it again, and keys pressed in a battle never become steps.
- **Nor does the D-pad.** A finger still on the D-pad when a battle, the doctor or the menu takes the screen walks nothing there, and nothing when you are back, until you lift it and press again.
- **Taps wait where keys wait.** The result card's first moment, the menu's first moment after the battle text, the doctor's card's first half second, a turn playing: a tap does nothing there, as Enter does nothing.
- **A key hides the touch controls; a touch brings them back.** Typing a name with the tablet's own keyboard hides nothing.
- **A tablet held upright** shows "Turn your tablet sideways to play!" over everything, and takes no taps until it is turned.
- **No zooming or scrolling on a tablet**: pinching, double-tapping, pulling down or pressing long on the game does nothing (the name boxes still select and edit).
- **Attack levels are remembered, per attack and per kind of animal, until you reload.** Set a squirrel's Nut Toss to hard and it is hard in the next battle too, and for every squirrel you have; a rabbit's attacks keep their own. After a switch the menu starts on the new animal's first attack.
- **Switching can't be used to stall.** Every switch you choose gives the wild animal a turn, so switching back and forth only wears your party down.
- **Keys wait while a battle turn plays.** From your answer until the menu comes back, every key is ignored, and for the menu's first moment (0.8 s) after the battle text ends — after the opening lines too — Enter, Space and 1 / 2 / 3 still do nothing. Mashing never picks: an Enter, Space or number pressed less than 0.3 s after the one before does nothing on the menu, however long you keep it up, so mashing through the text can't pick the next attack by accident. Stop for a moment, press once, and it picks. The arrows move at once. The result card and the "Who goes next?" list after a knock-out work the same way (Enter and Space; the arrows move at once).
- **The doctor's card is the same.** It ignores every key but Escape for its first half second, and while "Correct!" or "Not quite!" is showing. A key held down when it opens does nothing until pressed again, and keys pressed at the doctor never become steps.
- **Messages fade.** A line on the bottom of the screen stays for 5 seconds of walking about, then fades. A line said during a battle or at the doctor waits for you: after a battle the result's line is still there when you are back in the world. "Walk up to a tent…" goes as soon as you face a tent, where the prompt takes over. A line about who goes first also goes at once when a battle or the doctor changes your party.
- **The controls hint goes away** after your first 5 steps. Bumping into things doesn't count, however long you hold the key. It comes back for 5 steps after every reload.
- **The same walk meets the same animals.** Encounters are decided by how many steps you have taken in this game, so two new games walked the same way meet the same animals at the same steps (see § Finding a battle fast). The count is saved, so a reload carries on with the next step: it never replays the animals behind you. The doctor's puzzles work the same way.
- **Leading zeros are fine**: "09" is the same answer as "9".
- **Sound waits for your first key.** The game is silent until you press a key or touch the screen, because browsers allow sound only after one. Escape and Shift don't count; the first arrow, letter, number or Enter wakes it, and so does the first tap or click.
- **Sound off is remembered** on this device, across reloads. The first time, it is on.
- **Less motion if your computer asks for it.** With "reduce motion" turned on in the system's settings, the game moves less: a soft dim instead of the circle that closes into a battle, a lower hop and smaller arm swings when walking, smaller lunges and shakes, fewer confetti pieces, numbers and sparkles that fade in place.
- **Walking waits in the pause menu.** Opening it mid-step lets that step land, then nothing moves until the menu closes. An arrow still held when the menu opens or closes does nothing until you press it again, and a battle can never start while the menu is open. A reload with the menu open comes back to the world, the menu closed; a name typed but not yet saved with Enter is gone.
- **Danish or English, everywhere.** The game starts in Danish if your browser prefers Danish, else in English. Language in the pause menu, or on the title, switches every word at once — the animals' and attacks' names too ("Ræv", "Nøddekast") — even with a line still on the bottom of the screen, which changes language with the rest, and the game remembers the choice on this computer. `?lang=da` or `?lang=en` in the address picks one for that visit without changing what is remembered. Puzzles are the same sums in both languages, and so is typing the answer. A name you give an animal is never translated: "Nøddi" is Nøddi in both.
- **The title waits for you.** Nothing happens behind it: no step, no battle, no save. The world drifts past and your team (or, the first time, the squirrel, the rabbit and the frog) breathes beside the trainer, but they are scenery.
- **Mashing Enter never starts over.** On the title with a game saved, the cursor starts on Continue, so a mashed Enter carries on your game. "Start a new game?" starts on "No, go back" and ignores Enter for its first moment, so mashed Enters only bounce between it and the title; starting over takes Down, then Enter. The starters and the name box ignore Enter for their first half second, so an Enter mashed on New game can't pick a starter or skip its name unseen.
- **`?zoo` shows every animal.** Open `http://localhost:5180/?zoo` and one of each species stands in a row two or three tiles from the start, in catalog order — squirrel, rabbit, frog, fox, otter, deer, wolf, bear — facing you. They are scenery: you walk straight through them and nothing else changes. It skips the title and plays a throwaway game, like `?new`: nothing is saved. It exists to check the figures, not to play with. `?zoo=tired` lays the same line-up down to rest, as a tired animal lies in a battle, with its z's.
- **`?debug` shows where you are**: the grid position and the way you face (`5, 6 · down`) in the top-right corner, and under it, once anything has made a sound, the last four sounds the game asked for, newest last (`♪ move · confirm · correct · hit`, with ✕ while sound is off).
- **`?party=` picks your starting party**, for looking at screens that need one: `?party=squirrel:5,rabbit:0,fox` starts with a squirrel at 5 HP, a tired rabbit and a fox at full HP, in a throwaway game like `?new`: nothing is loaded or saved, and the saved game is left alone. Species are the catalog ids (`squirrel`, `rabbit`, `frog`, `fox`, `otter`, `deer`, `wolf`, `bear`), HP is optional (full by default) and clamped to the species, at most six. Anything misspelt and the game starts as usual. Switches combine: `?debug&party=bear`.

## Saving

- **Everything is saved as you go**, in this browser: after every step, every battle turn and every catch, and when you close the tab. There is no save button and nothing to wait for. Reload, or come back another day, and the title's Continue puts you where you were, facing the way you were, with the same animals and HP. The message line says "Welcome back!".
- **Start screen** (the pause menu's last row) saves the game as it stands and goes back to the title, with no question asked: Continue there carries on from the same step, and the same animals are waiting in the grass.
- **A reload in a battle picks the battle up** (Continue on the title): the same wild animal, the same HP, and the same puzzle if one was up, with its attack lit at its level in the menu beside it, or the list of who steps in after a knock-out (what you had typed is gone, and so are the levels you had picked for the other attacks). The narration starts again with "A wild … appears!". A reload after you answered, while the turn is still being told, skips to what happened: the answer already counted.
- **The saved game belongs to the browser and the address.** Another browser, a private window, `localhost` instead of the shared link, or a different link is a different game. A kid who comes back through the same link on the same browser finds their game.
- **Two tabs or windows of the game.** Both start as the same game. When one catches an animal, wins, loses, plays a battle turn, heals or changes the team, the other is behind: it ignores every key. A hidden tab loads the newer game when you switch to it. A window on screen next to the one you play in shows a card, "You kept playing in another window. Get your newest game [Enter]", and loads it when you click into that window or on the button, or press Enter or Space. Either way it goes straight back into play, without the title, and says "You were playing in another window. Here's your newest game!" (a tab that was on the title opens the title again, with Continue on the newer game). A window you are using loads by itself at most 3 times a minute; after that it shows the card and waits for Enter, which always works. While a window is behind, typing in its name box shows no letters and a Space there does nothing; Enter still loads the newest game. When one tab starts a new game, the other goes to the title as soon as you look at it, with Continue on the new game. Walking in either is fine: the one you use carries on from where it is. Nothing a tab did is ever lost to the other one: a game one tab left for a new one is put away with the rest, and a tab that is behind never lets you play on in it.
- **Start a new game**: New game on the title. With a game saved it asks "Start a new game?" first, and "Yes, new game" puts the saved game away: it is kept in this browser (`animath.save.previous`, then `.2`, `.3`, …) and on the server, and never deleted, but there is no way in the game to go back to it (the human can: [[DEVELOPMENT]] § Database). Nothing inside the game deletes a save; clearing this site's data in the browser does. `http://…/?new` plays a new game in that tab that is saved nowhere; drop `?new` and the saved game is back, untouched. A private window is also a new game, kept only while the window is open.
- **A save that won't load** (after an update the game cannot read it) leaves the title with New game only; once you have picked a starter the message line says "Your saved game didn't load, so here is a new one." The old save stays where it was until then, and is then kept aside, not deleted. A save written by a newer version of the game is not touched: the title says to reload the page, and a new game started there is not saved.
- **No server, no problem.** The game saves in the browser whether or not the server is running. It also keeps a backup on the server when it can reach it; if the server is down it tries a few times, then again after the next battle.

## Exploits and quirks

- **Losing is a free full heal.** Healing at the doctor costs one puzzle per animal, but losing a battle on purpose (answer wrong) heals the whole party for nothing and puts you by the nearest tent. Reloading heals nothing and forgets nothing.
- **A hard doctor's puzzle can be skipped**: answer anything (a wrong answer costs nothing and brings another puzzle), swap to another animal and back, or say bye and talk again. By design: at the doctor, nothing is lost by missing. A reload while the doctor's card is open closes it; anything healed stays healed.
- **The save is plain text in the browser.** Anyone who opens the browser's developer tools can read and edit `animath.save` in the site's local storage: change HP, add animals, move anywhere. In the middle of a puzzle it also holds the puzzle's answer. The server backup takes whatever the browser sends. Harmless in a single-player game; it matters once games are shared ([[DEFERRED]]).
- **A bear in front walks through the meadow and the river in peace.** Nothing there is big enough to challenge it, so no battle ever starts; the same goes for a wolf at the river. With a bear in the team, its number key turns this on and off as you walk: put the bear first to cross the meadow without a battle, then a squirrel first to meet rabbits again.
- **A small lead with a big fighter.** The animal that goes first decides how fierce the animals you meet are, but anyone can fight them. Put the Squirrel first, switch to a Bear on the first turn of every battle, and the Squirrel never gets tired, so it stays first: you keep meeting squirrels and rabbits and beat them with Bear-sized hits (and Bear-hard sums). Without switching, the Squirrel would soon be tired and the Bear would go first.
- **`?party=` is a cheat**: anyone who edits the URL can start with a bear (and so walk the meadow in peace). It is there for testing, and the game it starts is never saved.
- **A nickname can be anything made of letters**, including another animal's name or "Wild Fox": a squirrel called "Bear" is still a squirrel, and one called "Wild Fox" shows "Wild Fox" in its own status box in battle.
