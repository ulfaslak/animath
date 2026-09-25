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
- **Gentle motion.** Steps hop, grass could sway, fire flickers. Nothing snaps.

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
- "Good try!" when the whole party is tired, never "You lost". "Not quite! It was 12." after a wrong answer: the right answer, said kindly.
- No sarcasm, no "oops", no "error". No text the game can't stand behind if a kid reads it aloud.

## Accessibility

- Every state is readable without colour (numbers on HP bars, icons plus text for hit/miss).
- Keyboard-only play is complete: arrows/WASD, number keys, Enter, Escape.
- Motion is gentle; no full-screen flashes on a hit.
- Text never below 16 px; puzzle prompt never below 32 px.
