# Design

Brand, look and voice. Screen layouts are in [[UI_SPEC]]; gameplay is in [[PRODUCT]].

## Users

Kids aged roughly 6–12, playing alone or with friends in the same room, on a laptop with its keyboard or on a tablet held sideways, with their fingers only. Some are early readers. All of them will find every bug, so the game has to be forgiving of mashed keys, mashed taps and wrong answers.

## Personality

Cheerful, kind, a little silly. The world is sunny and safe. Nothing is scary: a bear is *fierce*, not frightening; a knocked-out animal is *tired*, not hurt. Winning feels big; losing feels like "go again".

## Aesthetic direction

**Colourful, cheerful low-poly.** Flat-shaded geometry, saturated but soft colours, warm sunlight with soft shadows, visible facets. The reference image is a Blender low-poly diorama: a tidy patch of world seen from a fixed diagonal angle, like a toy set on a table. Everything the camera sees should look like it could be picked up.

Rules that follow from that:

- **Fixed camera.** In explore, orthographic, pitched about 50°, yawed about 35°. No zoom, no rotation, ever. The world reads as a diorama because the angle never changes. The battle and the title's starter stage have fixed cameras of their own.
- **Facets, not textures.** Colour comes from materials and lighting, not image textures. `flatShading: true` everywhere.
- **Chunky silhouettes.** Trees are a cone on a cylinder, rocks are a dodecahedron, tents are a pyramid, reeds a thin stalk with a brown head, flowers and bushes a twenty-sided ball, the boat half a cone laid on its side, wide at the stern, with a coral rim and a little deck across its front half. Animals are boxes, spheres and cones with one exaggerated tell each — the squirrel's curled tail, the rabbit's ears, the frog's eyes on top of its head, the deer's antlers — because at the game's camera a bear is 40 px tall and a squirrel 15. A curve is a torus arc (the squirrel's tail) or a five-sided tube tapering to a point (the octopus's arms, the whale's spout). A sea animal is only ever seen swimming, its lower 40% under the water, so its tell stands in its top 60% and reads from the camera above whichever way it swims: the octopus's arms curl up round its head, the starfish stands upright on one arm. Real models keep that vocabulary: few polygons, readable at 40 px tall.
- **Warm light.** One sun (slightly warm white) casting soft shadows, plus a hemisphere fill so shadows stay coloured, never black, and a small warm light at each campfire.
- **Gentle motion.** Steps hop and swing the trainer's arms; grass could sway and fire could flicker. Nothing snaps.
- **A little juice, no new assets.** Moments get a small flourish made from what is already in the game — a lunge, a shake, a ring of dust, a burst of confetti in the palette's colours, sparkles along an HP bar, an iris into battle. A flourish marks a moment the screen already shows; it never hides text or the animal it is about, never leaves the scene, never delays a key and never fills the screen with a flash ([[UI_SPEC]] § Sound and juice). Size one against the thing it frames, in a frame, not by its numbers.

## Palette

Hex values are the ones in `packages/client/src/render/palette.ts` and `styles.css`; change both together.

| Role                 | Hex       | Notes                                        |
| -------------------- | --------- | -------------------------------------------- |
| Sky / background     | `#8fd3f4` | Also the fog colour.                         |
| Grass                | `#8bd66b` | The meadow's.                                |
| Tall grass           | `#63b94a` | Darker, so encounter tiles read at a glance; blades `#4fa83d`. |
| Sand                 | `#f3d9a4` |                                              |
| Water                | `#5ec8f2` | Sits lower than land. The shallows along every shore. |
| Deep water           | `#3f9fdc` | The sea: water with water all round it, two tiles out. Bluer and darker than the shallows, so where sea animals live reads at a glance, as tall grass does on land. |
| Rock                 | `#a8a39e` / `#8e8a86`, `#a39e98` | Tile / boulder, in two greys. The peaks (rock at height 3 and up) are paler, `#bdb9b4`, and most of their boulders wear a snow cap, `#f3f6f4` (a cool white, never the figures' warm one). |
| Tree trunk           | `#8b5a3c` |                                              |
| Tree canopy          | `#2c7a43` / `#3a8f4c` / `#2f8a55` | Three dark greens, mixed randomly: trees grow only in the forest. The starter stage's bushes keep `#3e9e4f` / `#62bf5f`. |
| Tent cloth           | `#f2a65a` | Door `#d47c2a`.                              |
| Fire / warm accent   | `#ffb347` | Also the UI accent (`--accent: #ff9f43`).    |
| Trainer (player)     | `#ff7e6b` shirt, `#ffcfb0` skin, `#2f4fa8` shorts, `#3d7be8` cap | The trainers are the only figures in blue shorts, so none reads as an animal. |
| Other trainers       | shirts `#f5c84a`, `#56c271`, `#9b6bd6`, `#f07fb0`, `#3cb8b0`, `#e0553f`, `#6cc3f0`, `#a8d84e`; caps `#2fa39a`, `#ff9f43`, `#f5c84a`, `#7a4fc0`, `#ff7e6b`, `#e0553f` | `TRAINER_LOOKS`: other players wear a shirt and a cap picked by their name, so a friend looks the same on every screen; the trainer's skin and blue shorts stay. No pair is the player's coral and blue, so nobody looks like you. Their boat's rim and pennant are their shirt's colour. |
| Animal fur           | Squirrel `#c9733a`, rabbit `#d9cbb8`, frog `#3aa66a`, fox `#e8762b`, otter `#8a5a3a`, deer `#c48a52`, wolf `#7f858f`, bear `#5a3a28`; at sea crab `#e0553f`, starfish `#f2894e`, turtle `#8cc47e` (shell `#3f7f4c`), dolphin `#6f9fc4`, octopus `#b4589e`, whale `#3d6b9a` | `ANIMAL_COLORS`: one fur (or skin) per species plus an accent for its tell (white tail tip, pink ear, tan muzzle, the frog's pale throat `#e3eea4`). The frog's green is bluer and darker than grass and tall grass, so it never melts into them. The whale's spout is water: the shallows' `#5ec8f2`, with off-white drops. |
| Figure details       | `#fff4e6` / `#2f2a28` | Off-white and near-black for tail tips, chests, noses, eyes. |
| Dust                 | `#f6efe2` | The ring a tired animal lies down in, and the poof where a trainer turns up out of nowhere; fades as it spreads. Never grey smoke. |
| Confetti             | accent, good, warn, water, trainer shirt, off-white, rabbit pink | `CONFETTI_COLORS`: only colours already in the game. |
| Sparkles             | warn `#f5b83d` and good `#56c271`, with off-white in the battle scene, coral and blue on the result card, white at the doctor | The doctor's chunky four-pointed stars: along a healed animal's HP bar, in the battle scene (unlit, so they shine) and round the result card's headline. |
| Token                | warn `#f5b83d`, rim `#c98a12`, inner ring `#fbd67a`, heart `--panel-cream` | A gold coin with a cream heart, the doctor's thank-you: on the doctor's card, in the HUD, beside each price; a "+N" in good, a "−N" in amber `#d99a1e`. |
| Tools                | trunk `#8b5a3c` (mast `#6e4630`), rock `#a8a39e` with a pale edge `#e9e6e2`, water `#5ec8f2`, trainer coral | The shop's pictures (`ItemIcon`): an axe, a pickaxe, a boat with a coral sail, flat and chunky in the world's own colours. The axe and the pickaxe in the trainer's fist while it swings are the same colours, as boxes. |
| Cleared ground       | gravel `#c9c0ad`, on the peaks `#d8d3ca`; fresh wood `#e8c48f` | Where a rock was broken: gravel, warmer and lighter than the rock round it, so it reads as a path, with the mountain's pebbles on it. Where a tree was chopped: the forest floor with a trunk-brown stump, its cut face and a few chips in fresh wood, which the axe also sends flying. |
| The boat             | hull trunk `#8b5a3c`, inside mast `#6e4630`, rim and pennant trainer coral `#ff7e6b` | `BOAT_COLORS`: the shop picture's boat in the world, a rowboat on the trainer's back and under them on the water. |
| Result card's rays   | warn at half strength | A burst behind a new friend's name, fading out at its rim. |
| Butterflies          | rabbit pink `#f5b8c4`, amber `#f5b83d`, off-white, trainer coral, sky `#8fd3f4` | `BUTTERFLY_COLORS`: two five-sided wings on a dark body, a little under half a tile across. |
| UI panel             | `rgba(255,252,245,.92)` | Cream, slightly translucent. Opaque (`--panel-cream`, `#fffcf5`) as the rim round big lettering. |
| Title letters        | `#ff7e6b`, `#ff9f43`, `#56c271`, `#3d7be8`, `#f5b83d` | "Animath" letter by letter: the trainer's coral and blue (`--coral`, `--blue`), the accent, good and warn. |
| UI ink               | `#2d2a32` |                                              |
| Good (HP, correct)   | `#56c271` |                                              |
| Warn (HP under half) | `#f5b83d` | Amber: an HP bar between a half and a fifth, the leash's "maybe". |
| Bad (damage, wrong)  | `#f25f5c` | Also an HP bar under a fifth. Text on Good, Warn and Bad is ink, never white. |

Every ground tile's lightness is shifted by up to ±2.5 points (HSL), so a big field never reads as a grid.

Each biome has its own ground and tall grass (`BIOME_LOOK` in `palette.ts`), so a kid can tell where they are without reading anything. Tall grass keeps one grammar everywhere: a patch darker and greener than the ground round it, with blades standing in it.

| Biome    | Ground    | Tall grass / blades     | What else grows or lies about |
| -------- | --------- | ----------------------- | ----------------------------- |
| Meadow   | `#8bd66b` | `#63b94a` / `#4fa83d`   | Flowers on one grass tile in five, in the off-white, coral and fire orange already in the game. |
| Forest   | `#68b258` | `#4b9a44` / `#357d33`   | A darker floor. Crowded trees: often a young one beside the big one, and a bush (`#2f7d44` / `#3b8a47`) at their foot; never taller than before, since a tree hides the tile behind it. |
| River    | sand      | `#9fc45c` / `#5e9233`   | Reed beds: a yellow-green patch with tall thin reeds, most with a brown head (the trunks' `#8b5a3c`), never the meadow's tall grass on sand. |
| Mountain | `#a6b88f` | `#7b9b5a` / `#587d3c`   | Grey-green turf with pebbles (`#97928c`), too small to look like a rock that blocks; boulder fields, a big boulder with smaller ones round it; snow on the peaks. |
| Sea      | deep water `#3f9fdc` | none; the shallows' `#5ec8f2` in a battle's crests of waves | Nothing grows. In a battle, the deep water's surface over the animals' feet, and a sandy shore far behind. |

Colour is never the only signal: a wrong answer also shakes, a low HP bar also shows a number (a stack's slim bar of all its animals' HP, the count of them tired soon, "3 tired soon").

## Typography

**Nunito** (Google Fonts), weights 600 and 800. Rounded terminals suit the low-poly look and read well for kids.

- Puzzle prompt: 800, very large (≥ 40 px on a laptop). It is the most important text in the game.
- The game's name on the title: 800, 64–112 px, each letter its own colour with a cream rim and a soft shadow, bobbing gently out of step.
- HUD labels: 800, 16–18 px.
- Hints and body: 600, 16 px.
- Numbers in prompts use real operator glyphs: `×`, `÷`, `−`, `√`. Never `*` or `/`.
- A name in a box that would end it with "…" keeps the font's own line height. The box clips its top too, and a tighter line cuts the ring off an Å.

## UI shapes

Cream panels with 16 px radius and a soft drop shadow floating over the 3D scene. Buttons are pill-shaped with the accent colour for the primary action (Go!, OK, Talk, Save).

Touch-sized targets: with the touch controls on, every row and button is at least 48 px tall (`--tap` in `styles.css`), the panels that hold lists grow to fit seven such rows, and the controls a hand uses most sit in the bottom corners, under the thumbs of a kid holding a tablet: the D-pad on the left; Talk, Menu, Go! and the number pad's OK on the right. With a keyboard the battle and doctor lists are tighter (rows from 32 px in battle, 30 px at the doctor), leaving the scene more room; everything else is 48 px on every screen. A pressed button or key gives way a little, so a tap is seen to land.

## Icon

The fox's face, faceted like the figures, on the sky: its fur `#e8762b` in three shades lit from the upper left, off-white cheeks, and near-black ear insides, eyes and nose (`public/favicon.svg`). It still reads as a fox at 16 px, in a tab. A shared link's picture is a real frame of the game, the starters' stage, with "Animath" over it in the title's own letters.

## Voice and copy

Short, warm, second person. One idea per line. Words a seven-year-old reads without help.

- "Squirrel is tired." not "Squirrel has fainted."
- "Not quite! The bear shrugs it off." not "Incorrect answer."
- "You caught a Fox!" with an exclamation mark. Big moments get big copy.
- "Good try!" when the whole party is tired, never "You lost".
- An animal the doctor takes goes **home**, made better: "Bye bye, Fox! It feels much better now." Never "released", "given away", "traded" or "sold"; the tokens are the doctor's thank-you, not a price. Wild animals are grumpy because they are "a little bit sick", never ill, hurt or mean.
- No sarcasm, no "oops", no "error". No text the game can't stand behind if a kid reads it aloud.

Every line exists in each language the game speaks ([[DECISIONS]] § Copy and languages). Each language is written, not translated word for word: say what a kid who speaks it would say.

### Danish

The same voice for a Danish seven-year-old reading alone: short, warm, one idea per line, everyday words. Read every line aloud before it ships; if it sounds like a textbook or a translation, say it the way a Danish parent would.

- Second person "du", never "De".
- "træt" for tired, never "besvimet", "slået ud" or "død".
- "Ikke helt! Bjørnen ryster det af sig." not "Forkert svar." Big moments get big copy and an exclamation mark: "Du fangede en ræv!", "Du vandt!". "Godt forsøgt!" when the whole party is tired, never "Du tabte".
- No anglicisms where Danish has a word a kid knows: "hold", not "team"; "snor", not "leash". Nothing scary: no "dø", "dræbe" or "blod"; the bear hugs ("Bjørnekram"), it doesn't maul.
- Your own animal is called by its name in a label or a call ("Ræv", "Kom så, Ræv!") and with "the" in a sentence ("Ræven er træt.", "Lad os hjælpe ræven!"). A wild one is "en vild ræv" or "den vilde ræv". A nickname replaces all of them and is never translated.
- Danish nouns are *en* or *et*, and the article and "vild" follow: en vild ræv / den vilde ræv, but et vildt egern / det vilde egern. Each species' forms are written out in `da.yaml`, so a sentence never guesses. Don't use a pronoun for an animal ("den", "det") where its gender could be either: "Forbi!" rather than "Den ramte ikke", "Snoren gled af!" rather than "Den slap fri".
- Species names are lower case inside a sentence ("Du fangede et egern!") and capitalised alone, as a name or a label.
- The adjective after "er" follows the noun too: "spillet er klart", "holdet er fuldt", "egernet er godt til…". A line that can hold any species uses words that don't change with it: "Egernet er mester i plus og minus!", never "er god til".
- No comma before "og" or "eller" between two commands ("Skriv svaret og tryk på Enter", "Sig farvel og gå på opdagelse") or before the last item of a list ("sætte det forrest, flytte det eller give det et nyt navn"). Two sentences with a subject each keep theirs: "Dit hold er fuldt, så den vilde ræv hopper hjem."
- Say it the Danish way, not the English one: a hit takes points ("Den vilde ræv mister 4 point."), not "gør 4 i skade"; a switch costs a turn ("Det koster din tur."); a key reminder names what the key does in one word ("Enter vælg"), never "Enter gør det".

| English  | Dansk  | en / et | the …   | a wild …        | the wild …      |
| -------- | ------ | ------- | ------- | --------------- | --------------- |
| Squirrel | egern  | et      | egernet | et vildt egern  | det vilde egern |
| Rabbit   | kanin  | en      | kaninen | en vild kanin   | den vilde kanin |
| Frog     | frø    | en      | frøen   | en vild frø     | den vilde frø   |
| Fox      | ræv    | en      | ræven   | en vild ræv     | den vilde ræv   |
| Otter    | odder  | en      | odderen | en vild odder   | den vilde odder |
| Deer     | hjort  | en      | hjorten | en vild hjort   | den vilde hjort |
| Wolf     | ulv    | en      | ulven   | en vild ulv     | den vilde ulv   |
| Bear     | bjørn  | en      | bjørnen | en vild bjørn   | den vilde bjørn |
| Crab     | krabbe | en      | krabben | en vild krabbe  | den vilde krabbe |
| Starfish | søstjerne | en   | søstjernen | en vild søstjerne | den vilde søstjerne |
| Turtle   | skildpadde | en  | skildpadden | en vild skildpadde | den vilde skildpadde |
| Dolphin  | delfin | en      | delfinen | en vild delfin | den vilde delfin |
| Octopus  | blæksprutte | en | blæksprutten | en vild blæksprutte | den vilde blæksprutte |
| Whale    | hval   | en      | hvalen  | en vild hval    | den vilde hval  |

The words the game uses for its things, the same on every screen:

| English | Dansk | Where |
| --- | --- | --- |
| tired | træt (trætte) | an animal at 0 HP: the tag, every line about it |
| wild | vild / vildt / vilde | a wild animal, following its gender |
| doctor | dyrlæge | the tents, the card ("Dyrlæge"), every line; also when the human says "witch doctor" |
| token | mønt (mønter) | what the doctor gives and the shop takes: "Du har 23 mønter", "2 mønter" on a row |
| heal (the tab) | gør rask | the doctor's first tab ("Gør rask") |
| help home | hjælpe hjem | the tab ("Hjælp hjem"), its button ("Hjælp dem hjem"), "Hjælp dyr hjem" |
| shop | butik | the tab ("Butik"), "Min butik åbner snart" |
| axe / pickaxe / boat | økse / hakke / båd (en) | the tools: "Øksen koster 8", "Her er din økse!"; each form written out in `da.yaml` (`items.*`) |
| chop (a tree) / break (a rock) | fælde / knuse | the prompts ("Tryk på Enter for at fælde træet", "… for at knuse stenen"), the touch button ("Fæld", "Knus"), "Du skal bruge en økse for at fælde træer." |
| can't swim | kan ikke svømme | out on the water: the switch list's tag, "Ræven kan ikke svømme og bliver i båden.", "Dine andre dyr kan ikke svømme." |
| lives in the sea | bor i havet | on land, a sea animal: the switch list's tag, "Krabben bor i havet!", "Dine andre dyr bor i havet." — never "kan ikke gå", which a crab on a beach can |
| stays in the water / swims home | bliver i vandet / svømmer hjem | the end of a battle at sea, and its Run row: never "græsset" out there |
| bye bye (an animal going home) | farvel | "Sig farvel til ræven?", "Farvel, Ræv!" — never "slip", "smid ud" or anything that sounds like getting rid of it |
| leash | snor | the battle row ("Snor"), its card ("Kast snoren"), "Du kaster snoren…" |
| catch | fange | "Du fangede en ræv!", "Svært at fange" |
| team | hold | "Dit hold", "kommer med på dit hold" |
| goes first | først ud | the lead's tag, "Ræven er først ud!", "Sæt forrest" in the menu |
| attack | angreb | "Vælg et angreb" |
| easy / medium / hard | let / mellem / svær | an attack's three levels |
| puzzle | opgave | "Løs en opgave" (the sum itself needs no words) |
| switch | skifte | the battle row ("Skift"), its card ("Skift dyr") |
| run away | løbe væk | the battle row ("Løb væk"), "Du slap væk!" |
| in battle | på banen | the switch list's tag |
| Correct! / Not quite! | Rigtigt! / Ikke helt! | every judged answer |
| hits for (damage) | mister … point | every line about a hit, naming the animal hit: "Den vilde ræv mister 12 point." |
| Go! | Kør! | the battle's button and its keys ("Enter kør"); "Så kører vi!" starts a new game |
| choose (↑ ↓) | flyt | every list's key reminder: "↑ ↓ flyt" |
| Keep playing | Spil videre | the pause menu |
| world | verden (verdener) | the Worlds row and screen ("Verdener", "Verden 42", "Du er i verden 42."), the HUD, the arrival ("Verden 42!") |
| home (the kid's own world) | hjem | "Dit hjem er verden 7.", "Det her er din hjemverden.", "Tag hjem", "Hjemme igen!" |
| go (to a world) | afsted | the Worlds screen's Go row ("Afsted til verden 42!") and its pad's big key ("Afsted") |
| type (digits) | skriv | the Worlds screen's key reminder ("0–9 skriv") |
| Language | Sprog | the title and the pause menu, listing "English" and "Dansk" |
| Who's here | Hvem er her | the pause menu's row and its list of the other players |
| Go to (a player) | gå hen til | "Gå hen til Ada", "Du er ved siden af Ada!" |
| steps away | skridt væk | "7 skridt væk", "cirka 120 skridt væk" |
| is here / went home | er her / gik hjem | the notes: "Ada er her!", "Bo gik hjem" |
| taking a break (in the menu) | holder pause | what another player is busy with: also "kæmper mod et vildt dyr", "hos dyrlægen", "kæmper mod en ven" |

Attack names are short, concrete Danish words or playful compounds a kid can say: Nøddekast, Lynspark, Hop, Stamp, Hulebid, Kvæk, Tungesnert, Stort plask, Nap, Spring, Rævestreg, Plask, Halesmæk, Spark, Hornstød, Bid, Hyl, Ulvespring, Labeslag, Brøl, Bjørnekram, Kæmpetramp.

## Sound

Gentle, synthesized, short. Every sound is made while the game runs, with WebAudio, from a few soft voices written as data (`packages/client/src/audio/cues.ts`, [[DECISIONS]] § Client). There are no sound files and no music yet.

- **Soft and short.** Sine and triangle tones; noise only through a filter, as a whoosh or a puff. Every cue is over in under 1.2 s, starts and ends in silence so nothing clicks, and plays through a modest master volume: kids play with the volume up.
- **Happy things rise.** Good moments climb a major chord: the encounter jingle, the correct chime, the caught and won fanfares, the heal sparkle, the new lead's ding-ding. Menus blip quietly, and an attack's level blip climbs with its level.
- **A miss is a soft bonk.** One round, low note. Never a buzzer, never a falling "wah-wah" that could sound like teasing. A key that can't do anything (a tired animal picked, a greyed row) makes no sound: the screen already says why, and a kid mashing keys must not be scolded.
- **Every cue goes with something on screen.** Sound is never the only signal. The chime comes with "Correct!", the thump with the shake and the "−10", the puff with the animal lying down, the fanfare with the result card. A kid playing with the sound off misses nothing.
- **Off is always one step away.** Sound is on by default. The Sound row (on the title and in the pause menu) and the M key turn it off and on, and the choice is remembered on this device. Turning it off cuts what is playing.
- **Silent until the first press.** Browsers let a page make sound only after a key press, a click or a tap they count as the player's (Escape and the modifier keys don't count), so the game starts silent and wakes on the first one.

## Accessibility

- Every state is readable without colour (numbers on HP bars, icons plus text for hit/miss, "goes first" on the lead's card).
- A word shown beside a colour says exactly what the colour encodes, and no more. If the word promises something the colour does not measure ("good chance" on a colour that only tracks HP), change what the colour measures or change the word.
- Every state is readable without sound (§ Sound): no cue plays for something the screen does not show.
- Keyboard-only play is complete: arrows/WASD, number keys, Enter, Escape, M.
- Touch-only play is complete: the D-pad, Talk, Menu, the number pad, and a tap on every row, button and card ([[UI_SPEC]] § Pointer and touch). A mouse reaches everything a finger does but walking, which is the keyboard's on a laptop. Nothing is only on hover.
- Motion is gentle; no full-screen flashes on a hit. The iris into a battle is a wipe, not a flash.
- A system set to reduce motion (`prefers-reduced-motion: reduce`) gets less of it: smaller movements, a dim instead of the iris, sparkles that twinkle in place ([[UI_SPEC]] § Sound and juice). What happened still shows.
- Text never below 16 px; puzzle prompt never below 32 px.
