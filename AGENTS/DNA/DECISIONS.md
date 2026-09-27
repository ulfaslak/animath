# Decisions

Flat lookup of rulings, organized by domain. No justifications — just decisions.

## Language & tooling

TypeScript everywhere, strict, ES2022, `verbatimModuleSyntax`.
pnpm workspace with three packages: `@mathgame/engine`, `@mathgame/client`, `@mathgame/server`. Root scripts fan out with `pnpm -r`.
Node 26, pnpm 12. Dependency build scripts need approval in `pnpm-workspace.yaml` (`allowBuilds`).
Prettier with tabs, single quotes, no trailing commas, print width 100. Markdown is not formatted.
vitest for tests, `tsc --noEmit` / `svelte-check` for type checks.
No React, ever. No SvelteKit either: the client is a plain Vite app.

## Engine

The engine is a **pure TypeScript package with zero dependencies** and no access to the DOM, Three.js, Node or the network. `lib: ["ES2022"]` in its tsconfig enforces it at compile time; a test enforces it at runtime.
All randomness comes from a seeded `Rng`, or a seed, passed in by the caller. `Math.random` and `Date.now` are banned in the engine.
The world is a pure function of `(seed, chunkX, chunkY)`; per-tile randomness is keyed by coordinates via `hashInts`, never by call order.
What a player changes in the world is an overlay the authority keeps and saves (`WorldEdits`: the tiles they cleared), laid over the seeded world, never a change to the generator.
A species lists the realms it lives in (`land`, `water`), and an encounter happens in the realm of its tile: only species living there come out. An amphibious species lives in both. An animal of the water is a species in the catalog living in the water realm, not a catalog of its own.
Instance ids (`AnimalInstance.id`) are minted by the authority, never by the engine. An engine function that creates an animal returns it without an id (`WildAnimal`).
Grid world, 16×16 chunks, four-direction movement, screen-space `y` grows downward.
Puzzle answers are whole numbers only. Prompts are plain strings until a kind needs more.
Difficulty is an integer 1..10. Every puzzle generator declares the range it supports.
Gameplay formulas (damage, catch probability, difficulty mapping) live in the engine and nowhere else; [[PRODUCT]] §4 states them in prose and the two must agree.
Game state changes only through **intents** validated by an **authority** that emits **events** (`protocol.ts`). The client UI and renderer are consumers of events, never mutators of state.

## Gameplay

The rules are [[PRODUCT]] §4; these are the choices behind them.
A battle lets the player switch animals, because the human asked for it ("need ability to change combat animal during fight"). A switch costs the turn.
Who comes out of the tall grass is sized to the lead's tier, because the human asked for it ("index challenger animals based on the tier of the selected animal"), and nothing more than one tier below the lead ever comes out.
Who comes out of the tall grass also depends on the ground around it, because the human asked for it ("idk if animals are located near their natural habitats but that would make sense. amphibious near water, wood animals near trees, animals that like clifffs and terrain near rocks, etc."). Every species favours one kind of ground: water, trees, rocks or open grass. The ground only weighs the animals the biome and the lead already allow, and never decides whether a step starts a battle. Near spawn it only chooses among animals of the same tier, so the start stays exactly as gentle as the biome tables make it; it moves the tiers themselves only as `danger` rises.
The player chooses the lead while exploring, because the human asked for it ("the ability to change the *selected* animal during explore mode").
A party has no cap: every animal caught joins it, because the human asked for it ("let's not put a cap on how many animals you can carry. indeed, let the user carry as many as they want").
The party is shown as one card per species, the animals of a kind stacked on it, and the player orders the cards by dragging them, because the human asked for it ("let's [stack] cards for same animals in the UI. user can mouseover cards to reveal the animal and HP underneath. and simply scroll cards on overflow. user can drag animal card (bundles) to change the vertical alignment").
The party is kept in species bundles, so the cards top to bottom are the battle order: a caught animal joins the end of its kind's bundle, and choosing a lead moves its bundle to the front.
Tokens are earned in single player, at the doctor, for animals helped home, because the human asked for it: "the doctor could take some of these animals off you for "tokens". the whole narrative is that the animals you catch (that attack you in the wild) are actally a little bit sick and the ones the doctor takes of you gets healing and released into the wild".
The doctor sells things for tokens, because the human asked for it: "then we introduce that the witch doctor can actually sell things. my son requested a wood axe for chopping down trees, a pickaxe for chopping down rock and a boat for allowing him to go on water (where on deep water he could encounter wild sea animals)". The seller is the same doctor (dyrlæge); "witch doctor" was the human's shorthand, not a new character.
An item goes on sale only once what it does is built: each item in the engine's catalog carries `available`, and the change that builds an item's effect turns it on. Kids play `main` live, and a kid never pays for a tool that does nothing.
The axe chops down trees and the pickaxe breaks rocks, because the human asked for it: "my son requested a wood axe for chopping down trees, a pickaxe for chopping down rock". Enter (the touch controls' Talk) facing the tree or the rock does it, as facing a tent talks to the doctor; the tile is plain ground from then on, for good. Nothing else can be cleared: not tall grass, sand, water or a tent.
The tiles a player clears are theirs, kept in their own game and save, world by world: to a friend in the same world, the trees they chopped still stand, because every single-player rule, walking included, stays in the browser (§ Multiplayer). Sharing them waits for its trigger ([[DEFERRED]] "Cleared tiles are each player's own").
Who comes out of the grass never reads what a player cleared: encounter tables, and the ground round a tall-grass tile that habitat weighs, are the seeded world's. A path chopped through a forest is for walking; it does not change which animals live there, so the odds [[PRODUCT]] §4 states hold for every kid, and no kid can farm a species by clearing its trees.
Every token that changes hands is a sum the kid works out, because the human asked for it: "obviously for buying stuff (token transaction) there's an easy math puzzle the player has to solve, forcing them to calc how many tokensthey have left after spending thetokens". A purchase completes only on the right answer to `tokens − price`, and a hand-over only on the right answer to `tokens + reward`: one sum per hand-over, however many animals go home.
One healing puzzle heals every hurt animal of the picked animal's species, at that species' healing difficulty: with a team of many of a kind, a puzzle per animal would be a chore.
The boat takes the player out on the water, and only animals that swim fight there, because the human asked for it: "a boat for allowing him to go on water (where on deep water he could encounter wild sea animals). you can't fight on water unless you have an amphibious animal (otter, frog, etc). in water you obv only catch water animals. if you have the boat, it appears as a "small upside down boat" on your back and you simply walk into the water and a boat animates (rotates, translates and scales) to sit under you, smooth like that." Every species goes on land, in the water, or both (`realms`), and fights only where it can go: on land every land and amphibious animal, out on the water the amphibious ones and the sea animals. The lead is the first animal standing that can fight where the player is; with none, nothing challenges the player there, so a kid can always sail in peace.
Deep water is its own place, the sea biome: water with water all round it, two tiles out, so the shallows along every shore are at least two tiles wide and a narrow river has none. The sea animals live there and nowhere else; the frog and the otter, who swim, still live by the river, so "in water you obv only catch water animals" means the sea's own: out at sea only sea animals come out.
Deep water is the sea's tall grass: each step onto it rolls the same 1-in-10 as a step onto tall grass, from a table built by the same rules (tiers from the lead, the distance from spawn), with no visitors. The shallows start nothing, so a river is always crossed in peace.
The sea animals are six, one tier each from 1 to 5 (two at tier 1: a crab and a starfish, then a turtle, a dolphin, an octopus and a whale), each with the numbers of the land animal of its tier (HP, catch rate, attack powers), so the land's balance carries over unchanged and a sea battle is as fair as a land one of its size. Their puzzles are their own mix, and the two small ones never ask a times table.
A sea animal lives only in the water (realm water): it is no starter, it never goes first on land, and at the doctor, whose tent is on land, a kid always keeps one animal standing that can fight on land when others go home. Out at sea every animal in a battle swims with the lower 40% of its height under the surface, as it does behind the boat.
Without a swimmer standing, the lead on land rides in the boat, and out on the water a swimmer follows the boat: the follower shows, in the world, who can fight there.

## Client

Three.js (WebGL) for rendering. Flat-shaded low-poly meshes, one directional light with shadows, hemisphere fill, and a small warm light at each campfire.
Fixed orthographic camera: pitch 50°, yaw 35°, 14 tiles of viewport height. No zoom, no rotation, no perspective changes in explore mode. Battle mode uses its own fixed camera, and so does the title's starter stage.
Svelte 5 (runes) for the DOM overlay only — HUD, menus, the puzzle panel. Svelte reads game state from a `$state` view that is filled from authority events; components never dispatch to the engine directly, they go through the authority.
Placeholder geometry (boxes, cones) is acceptable until real models arrive. Real models are glTF.
Ground tiles render as one `InstancedMesh` per chunk.
Font: Nunito (Google Fonts). Rounded, friendly.
Sound is synthesized while the game runs, with WebAudio, from cue data in `src/audio/`: no sound files, no audio library. Cues play from the screens (controllers, the HUD), where events become visuals; the authority and the engine know nothing of sound.
Mouse and touch are key presses: a click or a tap on the overlay sends the key it stands for through the keyboard's own path (`input/press.ts`), plus the pointer's own keys for a row, a level, a language, and the party column's cards, animals and dropped cards. There is no second path from a pointer to an action.
Touch controls (D-pad, Talk, Menu, number pad, finger-sized rows) show where the main pointer is coarse, then follow the latest input: a touch shows them, a real keyboard's key hides them. The same build serves laptops and tablets.
Dev server on port **5180** (5173 belongs to another project on this machine).

## Copy and languages

All player-facing copy lives in per-language YAML files, `packages/client/src/copy/<code>.yaml`, because the human asked for it ("all copy lives in yaml files (not in code)"). Code refers to copy by key (`t('puzzle.keys')`) and holds no player-facing words, in TypeScript or in a Svelte template.
The game speaks English (`en`) and Danish (`da`), because the human asked for it ("my kid speaks danish. supported languages for now should be danish and english"). English is the fallback, so every key exists in English. The player switches language on the title or in the pause menu; the choice is remembered on the device.
Adding a language is adding a file and one registry line.
YAML is parsed at build time. The browser gets plain objects and ships no YAML parser.
The engine is language-free: species and attacks have ids, not names; events and refusals are codes; a line an authority sends is a copy key with numbers and species by id, never a string. The client picks the words.
Words are picked when they are shown, from the language on screen. State and events carry keys and params, never finished sentences, so changing the language re-words everything at once, without a reload.
A species' names, articles included, are written out per language as forms (`name`, `a`, `the`, `wild`, `aWild`, `theWild`), never built from rules: Danish articles and adjectives follow the noun's gender.

## Assets

Only CC0 or attribution-licensed assets. Candidate sources: Kenney, Quaternius, Poly Pizza — verify the license on each download.
Every third-party file is listed in `packages/client/public/assets/CREDITS.md` before it is added.
No generated-by-AI art claims without checking the generator's license terms.

## Server

Node with Hono (`@hono/node-server`). Serves the built client in production; Vite proxies `/api` and `/ws` to it in development.
WebSockets via `ws`, for presence and friendly matches. The server runs the same engine as the browser; which rules it decides, and which stay in the browser, is § Multiplayer.
Postgres via Drizzle ORM (`node-postgres` driver). Local Postgres in Docker on host port **5433**.
Migrations are hand-written SQL in `packages/server/drizzle/`, idempotent (`IF NOT EXISTS`), with a matching `_journal.json` entry. `drizzle-kit generate` is not used.
The anonymous identity, a `players` row with a client-held secret, exists for the per-browser backup (§ Saves) and goes with it. Accounts do not build on it (§ Accounts).
Env from a repo-root `.env` loaded with `process.loadEnvFile`; no dotenv package.

## Saves

The save is local first, because the human asked for it: "need to persist state in localstorage so reloads are safe and users can come back to their game later and continue playing". The whole game lives in the browser's `localStorage` and is rewritten after every change (a step, a battle turn, a catch), so the game is persistent with no server at all.
The server holds a backup of each player's save, sent in the background. The game never waits for it, except at start in a browser that has an identity but no readable save of its own, and then only briefly. This anonymous per-browser backup stays, working, in development until the human's kid's save has moved to production, and is off in production; then it goes, and a cleanup PR removes its code. No migration drops or alters its tables or their data ([[INVARIANTS]] § Server).
A reload never loses progress: a battle in progress is saved too, and a reload picks it up where it was, mid-puzzle included.
One document shape for both copies, `SaveV1`, defined and checked in the engine. A new field is optional and needs no version bump; `version` goes up only when an old document becomes unreadable, with an upgrade that reads it.
A page never writes over a save it has not seen; when two write in the same instant, which `localStorage` cannot order, the one written over keeps its save aside. Several tabs share one `localStorage`; a page that falls behind another tab's save takes no more play until it has reloaded into the newest game, and never reloads behind the kid's back (the rules: [[INVARIANTS]] § Saves).
Between the browser's save and the server's backup the higher `seq` wins, both ways: the server takes a backup only with a higher `seq` than the one it holds (`409` otherwise), and a browser takes the server's game when that is higher. No game is lost on the way: a save the server replaces with a different game, or cannot read, goes to `save_backups`, and the browser's own game, when the server's wins, to `animath.save.replaced`.
A save the game cannot read is set aside, never deleted: in `animath.save.unreadable` once the kid has played the new game, on the server in `save_backups`.
There is no way in the game to delete a save. New game on the title puts the saved game away, never deletes it: in the browser under `animath.save.previous`, on the server in `save_backups`; the game has no way back to it, only the human does. `?new`, `?party=`, `?zoo`, `?tokens=` and `?shop` play a throwaway game that reads and writes nothing and skips the title. Clearing the site's data is the only ordinary way to lose one.
A new game starts with a starter the player picks, and only a tier-1 species is a starter (the engine's rule, asked by the authority's `new-game` intent). Continue hands the authority the save the client holds (`start({ game })`).
Per-device preferences (the language, sound on or off) have their own `localStorage` keys and are never part of the save.

## Multiplayer

The browser runs every single-player rule, for guests and account holders alike: walking, encounters, wild battles, catching, the doctor, the shop, the tools and the boat stay in `LocalAuthority`, and the browser's `localStorage` save stays the working copy, so the game plays with no server at all and plays on when the connection drops. The server is the authority only for what two players share: presence (who is in which world, where, and doing what) and friendly matches (a match's state, its puzzles, and judging the answers). It takes the positions and the teams clients report on trust, because nothing a player gains can reach another player and a match changes nothing, so cheating gains nothing. A rule moves to the server when a gain can flow between players: trading, match rewards, shared world edits ([[DEFERRED]] "The server stores whatever save the client sends").
A world is a number from 1 to 9999, each number its own seed, because the human asked for it ("if we could let the user pick seeds to transition between instances of the world that would be cool. because i want multiplayer now! [...] so if my kid wants to play with his friend they pick the same seed and they can find each other"). World 1 is exactly today's world (the seed `hashString('prototype')`), so every game saved so far is in it, unchanged, and has it as its home. A new game starts in a random world from 2 to 9999, which is its home, so strangers don't all pile into one. Where a player stands, which way they face and the tiles they cleared are kept per world; the party, the tokens, the items and the name go with the player.
Every player has a name, guests included: others see it above their character, and it is their username if they make an account, because the human asked for it ("users need a name for their character (that is also their username when/if they log in), and when they see other characters they see their name"). Whether a name is allowed is engine code, so the browser and the server judge it by the same rules.
Players in the same world see each other through presence, over one WebSocket at `/api/ws` on the game's own origin, so an account holder's session cookie goes along and the one proxy path that serves the API serves it too; a guest sends a random guest id kept in `localStorage`. A client reports its tile, facing, lead, boat and what it is busy with when they change; the server relays that to the players near it in the same world, and sends everyone in the world, less often, who is there and roughly where. The first message carries a protocol version, and a client too old for the server reloads itself while exploring, which is safe because its save is local. The messages and their checks are engine code, shared by both sides. There is no chat, because the human said so ("there's no chat in game").
Two players in the same world can fight a friendly match, and it changes nothing: HP, knock-outs, tokens and the party are exactly as they were, and both go back to exploring where they stood, because the human asked for it ("user interaction is they can fight each other. there is no transaction from the outcome of a match, it's just for fun (for now)"). The match runs on the server, in the engine's match reducer with a seed only the server holds, and each player gets a view of it without the answers. Each side brings the first three animals of its party that can fight on land, at full health.

## Accounts

Accounts are optional: a guest plays on `localStorage` alone for as long as they like, and only a player who makes an account has their game kept in the server's database, because the human asked for it ("for simple onboarding users start playing immediately when they come on the site. state is managed in local storage, but after each played hour they are prompted to create a username and password so they can log in. it's only once they are logged in we start persisting their state in a postgres db on our server. but that process should be seamless, and if they play in their browser forever without logging, that's probably fine too."). The one exception is the anonymous backup, in development only, until it goes (§ Saves). The username is the character's name, unique whatever its case; a kid whose name is taken picks another, and the character takes it too.
An account is a username and a password, nothing more: no email and no second factor, because the human asked for it ("no 2fa or email validation, just keep their username and hash their pw, there's no PII so easy does it"). The password is hashed with Node's built-in scrypt and a salt of its own, so hashing adds no dependency. A session is an HttpOnly, SameSite=Lax cookie, Secure in production, with a one-year sliding expiry; the database keeps its token hashed, and logging out deletes it. Logging in and registering are rate-limited per IP and per name. With no email, a forgotten password is reset, or an account deleted, by the human with an admin command.
`localStorage` keeps the guest game and the account game in separate slots, so logging in never swaps one game for another behind a kid's back: registering moves the guest game into the account, logging in leaves the guest game where it is, and logging out goes back to it (or to the title). A logged-in game still saves to `localStorage` first and then to the server, with optimistic concurrency on `seq`; the server checks it with the engine's validator and keeps the 1 MiB limit. On load and on login the newer save wins, and a `409` means another device got ahead: the page loads the server's copy and says so kindly.

## Development

All implementation work happens in a git worktree via `git gtr new`, never on `main`.
GitHub Issues (repo `ulfaslak/mathgame`) is the tracker. PRs merge with `--merge`.
Rendering changes are verified by reading a screenshot from `scripts/screenshot.mjs`; engine changes by vitest; balance changes by a property test over the whole catalog.

## Deployment

The game runs on a dedicated Hetzner VPS that mirrors lawcel's setup (Docker Compose behind nginx, Postgres in the same compose), except that there is no staging: a push to main without `[skip deploy]` gates on check, test and lint and goes straight to production. The human asked for it ("i'd prefer it if you copied my setup on ../lawcel exactly [...] well it's just a fun game, so nevermind a staging environment, push to main (unless skip tags) builds and goes on prod immediately"). The server is the game's own, to keep it apart from the business product on lawcel's, and the setup is lawcel's because it works. Until it is up, the game is shared from this machine through a tunnel (ngrok or cloudflared; how: [[DEVELOPMENT]] § Sharing the game through a tunnel).
No third-party backend services (no Convex, Supabase, Firebase). Postgres and a Node process are the whole stack.
