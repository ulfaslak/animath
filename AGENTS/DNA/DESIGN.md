# Design

Brand, look and voice. Screen layouts are in [[UI_SPEC]]; gameplay is in [[PRODUCT]].

## Users

Kids aged roughly 6–12, playing alone on a laptop or with friends in the same room. Some are early readers. All of them will find every bug, so the game has to be forgiving of mashed keys and wrong answers.

## Personality

Cheerful, kind, a little silly. The world is sunny and safe. Nothing is scary: a bear is *fierce*, not frightening; a knocked-out animal is *tired*, not hurt. Winning feels big; losing feels like "go again".

## Aesthetic direction

**Colourful, cheerful low-poly.** Flat-shaded geometry, saturated but soft colours, warm sunlight with soft shadows, visible facets. The reference image is a Blender low-poly diorama: a tidy patch of world seen from a fixed diagonal angle, like a toy set on a table. Everything the camera sees should look like it could be picked up.

Rules that follow from that:

- **Fixed camera.** Orthographic, pitched about 50°, yawed about 35°. No zoom, no rotation, ever. The world reads as a diorama because the angle never changes.
- **Facets, not textures.** Colour comes from materials and lighting, not image textures. `flatShading: true` everywhere.
- **Chunky silhouettes.** Trees are a cone on a cylinder, rocks are a dodecahedron, tents are a pyramid. Animals are boxes, spheres and cones with one exaggerated tell each — the squirrel's curled tail, the rabbit's ears, the deer's antlers — because at the game's camera a bear is 40 px tall and a squirrel 15. Real models keep that vocabulary: few polygons, readable at 40 px tall.
- **Warm light.** One sun (slightly warm white) casting soft shadows, plus a hemisphere fill so shadows stay coloured, never black.
- **Gentle motion.** Steps hop and swing the trainer's arms, grass could sway, fire flickers. Nothing snaps.
- **A little juice, no new assets.** Moments get a small flourish made from what is already in the game — a lunge, a shake, a ring of dust, a burst of confetti in the palette's colours, sparkles along an HP bar, an iris into battle. A flourish marks a moment the screen already shows; it never hides text or the animal it is about, never leaves the scene, never delays a key and never fills the screen with a flash ([[UI_SPEC]] § Sound and juice). Size one against the thing it frames, in a frame, not by its numbers.

## Palette

Hex values are the ones in `packages/client/src/render/palette.ts` and `styles.css`; change both together.

| Role                 | Hex       | Notes                                        |
| -------------------- | --------- | -------------------------------------------- |
| Sky / background     | `#8fd3f4` | Also the fog colour.                         |
| Grass                | `#8bd66b` | Per-tile lightness jitter ±5% breaks the grid |
| Tall grass           | `#63b94a` | Darker, so encounter tiles read at a glance. |
| Sand                 | `#f3d9a4` |                                              |
| Water                | `#5ec8f2` | Sits lower than land.                        |
| Rock                 | `#a8a39e` / `#8e8a86` | Tile / boulder.                    |
| Tree trunk           | `#8b5a3c` |                                              |
| Tree canopy          | `#3e9e4f` / `#62bf5f` | Two greens, mixed randomly.        |
| Tent cloth           | `#f2a65a` | Door `#d47c2a`.                              |
| Fire / warm accent   | `#ffb347` | Also the UI accent (`--accent: #ff9f43`).    |
| Trainer (player)     | `#ff7e6b` shirt, `#ffcfb0` skin, `#2f4fa8` shorts, `#3d7be8` cap | The only blue figure, so it never reads as an animal. |
| Animal fur           | Squirrel `#c9733a`, rabbit `#d9cbb8`, fox `#e8762b`, otter `#8a5a3a`, deer `#c48a52`, wolf `#7f858f`, bear `#5a3a28` | `ANIMAL_COLORS`: one fur per species plus an accent for its tell (white tail tip, pink ear, tan muzzle). |
| Figure details       | `#fff4e6` / `#2f2a28` | Off-white and near-black for tail tips, chests, noses, eyes. |
| Dust                 | `#f6efe2` | The ring a tired animal lies down in; fades as it spreads. Never grey smoke. |
| Confetti             | accent, good, warn, water, trainer shirt, off-white, rabbit pink | `CONFETTI_COLORS`: only colours already in the game. |
| UI panel             | `rgba(255,252,245,.92)` | Cream, slightly translucent.       |
| UI ink               | `#2d2a32` |                                              |
| Good (HP, correct)   | `#56c271` |                                              |
| Warn (HP under half) | `#f5b83d` | Amber: an HP bar between a half and a fifth, the leash's "maybe". |
| Bad (damage, wrong)  | `#f25f5c` | Also an HP bar under a fifth. Text on Good, Warn and Bad is ink, never white. |

Colour is never the only signal: a wrong answer also shakes, a low HP bar also shows a number.

## Typography

**Nunito** (Google Fonts), weights 600 and 800. Rounded terminals suit the low-poly look and read well for kids.

- Puzzle prompt: 800, very large (≥ 40 px on a laptop). It is the most important text in the game.
- HUD labels: 800, 16–18 px.
- Hints and body: 600, 16 px.
- Numbers in prompts use real operator glyphs: `×`, `÷`, `−`, `√`. Never `*` or `/`.

## UI shapes

Cream panels with 16 px radius and a soft drop shadow floating over the 3D scene. Big touch-sized targets (≥ 48 px) even on desktop, so touch controls need no redesign later. Buttons are pill-shaped with the accent colour for the primary action.

## Voice and copy

Short, warm, second person. One idea per line. Words a seven-year-old reads without help.

- "Squirrel is tired." not "Squirrel has fainted."
- "Not quite! The bear shrugs it off." not "Incorrect answer."
- "You caught a Fox!" with an exclamation mark. Big moments get big copy.
- "Good try!" when the whole party is tired, never "You lost".
- No sarcasm, no "oops", no "error". No text the game can't stand behind if a kid reads it aloud.

Every line exists in each language the game speaks ([[DECISIONS]] § Copy and languages). Each language is written, not translated word for word: say what a kid who speaks it would say.

### Danish

The same voice for a Danish seven-year-old reading alone: short, warm, one idea per line, everyday words.

- Second person "du", never "De".
- "træt" for tired: "Ræv er træt." Never "besvimet", "slået ud" or "død".
- "Ikke helt! Bjørnen ryster det af sig." not "Forkert svar." Big moments get big copy and an exclamation mark: "Du fangede en ræv!" "Godt forsøgt!" when the whole party is tired, never "Du tabte".
- No anglicisms where Danish has a word a kid knows: "hold", not "team". Nothing scary: no "dø", "dræbe" or "blod".
- The animal that goes first is "først ud" ("Ræv er først ud!"), and the menu option that puts one there is "Sæt forrest". The pause menu is "Pause", and closing it is "Spil videre".
- A species is a noun. Your own animal goes by its name, the nickname or else the species with a capital ("Kom så, Ræv!"). A wild one gets an article, lower case: "En vild ræv dukker op!", "Den vilde ræv er træt."
- Danish nouns are *en* or *et*, and the article and "vild" follow: en vild ræv / den vilde ræv, but et vildt egern / det vilde egern. The copy files give each species its forms, so a sentence never guesses.

| English  | Dansk  | en / et | the …   |
| -------- | ------ | ------- | ------- |
| Squirrel | egern  | et      | egernet |
| Rabbit   | kanin  | en      | kaninen |
| Fox      | ræv    | en      | ræven   |
| Otter    | odder  | en      | odderen |
| Deer     | hjort  | en      | hjorten |
| Wolf     | ulv    | en      | ulven   |
| Bear     | bjørn  | en      | bjørnen |

## Sound

Gentle, synthesized, short. Every sound is made while the game runs, with WebAudio, from a few soft voices written as data (`packages/client/src/audio/cues.ts`, [[DECISIONS]] § Client). There are no sound files and no music yet.

- **Soft and short.** Sine and triangle tones; noise only through a filter, as a whoosh or a puff. Every cue is over in under 1.2 s, starts and ends in silence so nothing clicks, and plays through a modest master volume: kids play with the volume up.
- **Happy things rise.** Good moments climb a major chord: the encounter jingle, the correct chime, the caught and won fanfares, the heal sparkle, the new lead's ding-ding. Menus blip quietly, and an attack's level blip climbs with its level.
- **A miss is a soft bonk.** One round, low note. Never a buzzer, never a falling "wah-wah" that could sound like teasing. A key that can't do anything (a tired animal picked, a greyed row) makes no sound: the screen already says why, and a kid mashing keys must not be scolded.
- **Every cue goes with something on screen.** Sound is never the only signal. The chime comes with "Correct!", the thump with the shake and the "−10", the puff with the animal lying down, the fanfare with the result card. A kid playing with the sound off misses nothing.
- **Off is always one step away.** Sound is on by default. The pause menu's Sound row and the M key turn it off and on, and the choice is remembered on this device. Turning it off cuts what is playing.
- **Silent until the first key.** Browsers let a page make sound only after a key press, so the game starts silent and wakes on the first key.

## Accessibility

- Every state is readable without colour (numbers on HP bars, icons plus text for hit/miss, "goes first" on the lead's card).
- A word shown beside a colour says exactly what the colour encodes, and no more. If the word promises something the colour does not measure ("good chance" on a colour that only tracks HP), change what the colour measures or change the word.
- Every state is readable without sound (§ Sound): no cue plays for something the screen does not show.
- Keyboard-only play is complete: arrows/WASD, number keys, Enter, Escape, M.
- Motion is gentle; no full-screen flashes on a hit. The iris into a battle is a wipe, not a flash.
- A system set to reduce motion (`prefers-reduced-motion: reduce`) gets less of it: smaller movements, a dim instead of the iris, sparkles that twinkle in place ([[UI_SPEC]] § Sound and juice). What happened still shows.
- Text never below 16 px; puzzle prompt never below 32 px.
