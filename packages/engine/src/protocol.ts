import type { AnimalInstance } from './animals/types.js';
import type { BattleEvent, BattleIntent, BattleState } from './battle/types.js';
import type { DoctorEvent, DoctorIntent, DoctorState } from './doctor/types.js';
import type { Line } from './lines.js';
import type { NameRejection } from './names.js';
import type { NewGameRejection } from './party/starters.js';
import type { ItemId } from './items/catalog.js';
import type { MatchEvent, MatchSide } from './match/types.js';
import type { PartyEvent, PartyIntent } from './party/types.js';
import type { ChunkRef } from './world/edits.js';
import type { TakeOffRejection } from './world/flight.js';
import type { ClearableKind, Direction, GridPos } from './world/types.js';
import type { TravelRejection } from './world/worlds.js';

/**
 * The client ↔ authority protocol.
 *
 * The client never mutates game state. It sends *intents* ("I want to walk
 * left", "I answer 42") to an `Authority`, which validates them against the
 * rules and emits *events* describing what actually happened. Every
 * single-player rule runs in `LocalAuthority`, in the client process, for
 * every player; what two players share (who is where, a friendly match) is
 * the server's to decide ([[DECISIONS]] § Multiplayer). Either way the UI and
 * renderer only send intents and read events.
 */

export type Intent =
	| { type: 'move'; dir: Direction }
	/**
	 * Enter, or the touch controls' Talk: whatever the player faces. A tent
	 * opens a doctor visit (`canTalkToDoctor`); a tree or a rock is cleared
	 * with its tool (`clearTile`: `tile-cleared`, or `tool-needed` without
	 * the tool); anything else is `nothing-to-interact`.
	 */
	| { type: 'interact' }
	| { type: 'battle'; intent: BattleIntent }
	/** Only during a doctor visit. A visit starts with `interact` while `canTalkToDoctor` holds. */
	| { type: 'doctor'; intent: DoctorIntent }
	/**
	 * Reorder or rename the party (the pause menu). The authority passes what
	 * the player is doing to `applyPartyIntent`, which accepts it only while
	 * exploring. Always answered with a `party-edited`.
	 */
	| { type: 'party'; intent: PartyIntent }
	/**
	 * Start a new game with the starter the player picked, the name they gave
	 * it, and the player's own name, as typed (the title's name box and
	 * starter screen). The engine's `chooseStarter` checks the starter: one
	 * of `STARTERS`, a nickname that is text, cleaned like a rename; and
	 * `checkName` the player's name (without one, the game asks for it later).
	 * Only while no game is under way, which is at the title. The game starts
	 * in a world the authority picks, its home. Answered with `welcome`
	 * (`newGame: true`), or `new-game-refused`.
	 */
	| { type: 'new-game'; speciesId: string; nickname?: string; name?: string }
	/**
	 * The player's name, as typed (a game saved before names asks for one on
	 * load). `checkName` checks it. While a game is under way, whatever the
	 * player is doing. Answered with `name-chosen`, or `name-refused`.
	 */
	| { type: 'choose-name'; name: string }
	/**
	 * Go to world `world`, a world number as the player chose it. Only while
	 * exploring: in a battle, at the doctor or in the air it does nothing. The engine's
	 * `travel` checks it and remembers the world left. Answered with
	 * `travelled`, or `travel-refused`.
	 */
	| { type: 'travel'; world: number }
	/**
	 * Go to another player in this world, who stands at `near` (the presence
	 * server's word for where: [[DECISIONS]], the server is the authority for
	 * where players are). Only while exploring. The authority puts the player
	 * on `arrivalSpot` beside that tile, in its own world as the player left
	 * it: `player-placed`, or `go-to-refused` when there is nowhere to stand.
	 * No step is taken, so no encounter is rolled.
	 */
	| { type: 'go-to'; near: GridPos }
	/**
	 * Space held (the touch controls' Fly): take off with the glider, the way
	 * the player faces (the engine's `takeOff`). Only while exploring.
	 * Answered with `took-off`, or `take-off-refused` when there is no glider
	 * or nowhere to land in the `GLIDE_TILES` ahead.
	 */
	| { type: 'take-off' }
	/**
	 * In the air: one tile on (the screen sends one each time the last tile is
	 * flown, at the glide's pace, for as long as Space is held and after it,
	 * on to the landing tile). Answered with `glided`, and `bird-follows` when
	 * a bird notices the glider over the tile. At the reach it goes no
	 * further: a glide past it lands there (`landed`), so the reach is always
	 * flown over before it is landed on.
	 */
	| { type: 'glide' }
	/**
	 * In the air: come down, on the first tile at or after the one the glider
	 * is over that the player can stand on (`landFlight`), every tile on to it
	 * entered as a glide enters one (a bird may notice the glider over it:
	 * `bird-follows`). Answered with `landed`, `tile-cleared` when the landing
	 * chops a tree or breaks a rock, and `battle-started` (a battle in the
	 * air) when a bird followed the glider down.
	 */
	| { type: 'land' }
	/**
	 * Leave the game for the title (the pause menu's Quit to title). Only
	 * while exploring: in a battle, at the doctor or in the air it does
	 * nothing, so no way out of any of them opens through the title. The game
	 * stops where it stands, and a later start picks it up there. Answered
	 * with `game-left`; after it nothing walks, rolls or saves until a game
	 * starts.
	 */
	| { type: 'leave-game' }
	/**
	 * A friendly match took a step: `events` are that step's, as the match's
	 * own authority (the server) sent them to this player, who plays `side`,
	 * in match `match` (its id), whose view says `step` intents accepted now.
	 * The player's right answers among them count as solved puzzles, as a
	 * right answer in a battle does (`countSolved` with `side`); the other
	 * player's never do, and nothing else in the game changes (a match is the
	 * server's: [[DECISIONS]] § Multiplayer). In any mode while a game is
	 * under way. A step of a match is counted once: one at or below a step
	 * already counted for that match is ignored, as is a batch that is not
	 * one step's events (`MAX_MATCH_EVENTS` at most, with no holes, and at
	 * most one `answer-judged`), a side that is not `a` or `b`, or a step or a
	 * match id that is not one. The answers were judged by the server; the
	 * authority only counts, so a step adds at most one puzzle solved. Answered with `solved-changed` when a right answer of
	 * the player's was among them, else with nothing.
	 */
	| {
			type: 'match-answers';
			match: string;
			step: number;
			side: MatchSide;
			events: readonly MatchEvent[];
	  };

export type GameEvent =
	/**
	 * The game starts, or starts over: a new game, or one picked up from a
	 * save. Carries the facing too, so a restored player looks the way they
	 * did, the tokens and items, the puzzles solved (`solved`), and the animal
	 * book's species seen, caught and set free (`seen`, `caught`, `freed`). A `battle-started` follows when the save
	 * was taken mid-battle. `newGame` tells the two apart: true for a game
	 * that begins here (a starter just picked, or a throwaway game), false for
	 * one picked up. `world` is the world number the player is in and `seed`
	 * its generator seed (`worldSeed(world)`), `home` the world the game began
	 * in, `name` the player's name (null until chosen). `edits` are the tiles
	 * the player has cleared in `world`, in `WorldEdits`' text form: the world
	 * is the seed's, as they left it.
	 */
	| {
			type: 'welcome';
			playerId: string;
			name: string | null;
			world: number;
			home: number;
			seed: number;
			pos: GridPos;
			facing: Direction;
			party: AnimalInstance[];
			tokens: number;
			items: string[];
			solved: number;
			seen: string[];
			caught: string[];
			freed: string[];
			newGame: boolean;
			edits: string[];
	  }
	/** `new-game` was refused, and nothing started: why, as a code. */
	| { type: 'new-game-refused'; reason: NewGameRejection }
	/** The player has a name now (`choose-name`): the name as `checkName` keeps it. */
	| { type: 'name-chosen'; playerId: string; name: string }
	/** `choose-name` was refused, and the name is as it was: why, as a code the client words kindly. */
	| { type: 'name-refused'; reason: NameRejection }
	/**
	 * The player went to another world (`travel`): the world left is
	 * remembered, and this is the world reached, in `welcome`'s terms: its
	 * number and seed, where they stand and face, and the tiles they cleared
	 * there. Put the player on `pos` without a tween and draw the new world.
	 * `firstVisit`: they had not been there (or it was forgotten), and stand at
	 * its spawn. Party, tokens and items travel unchanged.
	 */
	| {
			type: 'travelled';
			playerId: string;
			world: number;
			seed: number;
			pos: GridPos;
			facing: Direction;
			edits: string[];
			firstVisit: boolean;
	  }
	/** `travel` went nowhere: why, as a code. */
	| { type: 'travel-refused'; reason: TravelRejection }
	/** The player left the game for the title (`leave-game`). No game is under way now. */
	| { type: 'game-left' }
	| { type: 'player-moved'; playerId: string; pos: GridPos; dir: Direction }
	| { type: 'player-blocked'; playerId: string; dir: Direction }
	/**
	 * The player was put on a tile without walking there: `go-to` put them
	 * beside another player (`arrivalSpot`), facing `dir`, towards them. It can
	 * be hundreds of tiles away, so there is nothing to tween: the client shows
	 * them there at once, with a poof. No step was taken, so nothing was rolled.
	 */
	| { type: 'player-placed'; playerId: string; pos: GridPos; dir: Direction }
	/**
	 * `go-to` found nowhere near that spot the player could stand and walk on
	 * from (`arrivalSpot` is null): out at sea without a boat, say. Nothing
	 * changed; the client says so in its own words.
	 */
	| { type: 'go-to-refused'; reason: 'no-room' }
	| { type: 'battle-started'; state: BattleState }
	/**
	 * One battle intent was applied. `events` is what happened, in order, and
	 * `state` is the battle after all of them; animate the events, then show
	 * the state. When the last event is `ended`, a `battle-ended` follows.
	 */
	| { type: 'battle-updated'; state: BattleState; events: readonly BattleEvent[] }
	| { type: 'battle-ended'; state: BattleState }
	/**
	 * The party changed outside a battle turn: HP written back after a battle
	 * (a lost one too: tired where it was fought, or looked after by a doctor
	 * who came, `knockOut`), a caught animal joining, animals healed at the
	 * doctor or gone home from there (sent at once, mid-visit). Always the
	 * whole party, in order.
	 */
	| { type: 'party-changed'; party: AnimalInstance[] }
	/**
	 * The player's tokens or items changed: the doctor gave tokens for animals
	 * helped home, or the shop sold an item (sent at once, mid-visit). Always
	 * both, whole.
	 */
	| { type: 'belongings-changed'; tokens: number; items: string[] }
	/**
	 * The player solved a puzzle: an answer was judged right (`countSolved`),
	 * in a battle, at the doctor or in a friendly match. `solved` is the whole
	 * count now. Sent right after the event that judged it; never for a wrong answer.
	 */
	| { type: 'solved-changed'; solved: number }
	/**
	 * The animal book grew (`animals/book.ts`): a wild battle started against
	 * a species never seen before, a leash throw caught one never caught
	 * before, or a hand-over at the witch doctor's set free one never set free
	 * before (a friendly match never changes it). Always all three lists,
	 * whole, each in the order first met. Sent right after the event that
	 * showed it; never when nothing is new.
	 */
	| { type: 'book-changed'; seen: string[]; caught: string[]; freed: string[] }
	/**
	 * Something to say on the message line, as a copy key and its values; the
	 * client words it in the language on screen. Never a finished sentence.
	 */
	| { type: 'message'; line: Line }
	/**
	 * `interact` found nothing to talk to: no tent in front of the player, as
	 * the authority saw them, and no tree or rock to clear. Nothing changed;
	 * the client may say how to find a doctor, in its own words.
	 */
	| { type: 'nothing-to-interact'; playerId: string }
	/**
	 * `interact` while facing a tent opened a visit. Walking waits until
	 * `doctor-visit-ended`. `visit` tells visits apart (a `DoctorState` starts
	 * its `step` at 0 every time): every event of one visit carries the same
	 * one, and a later visit a different one.
	 */
	| { type: 'doctor-visit-started'; visit: number; state: DoctorState }
	/**
	 * One doctor intent was applied. As with `battle-updated`: animate `events`
	 * in order, then show `state`. When the last event is `ended`, a
	 * `doctor-visit-ended` follows.
	 */
	| {
			type: 'doctor-visit-updated';
			visit: number;
			state: DoctorState;
			events: readonly DoctorEvent[];
	  }
	/** `state.party` is the party after the visit. */
	| { type: 'doctor-visit-ended'; visit: number; state: DoctorState }
	/**
	 * One party intent was applied. `events` says what happened (`reordered`,
	 * `renamed`, or `rejected`, when the party is unchanged) and `party` is the
	 * whole party after it, in order.
	 */
	| { type: 'party-edited'; party: AnimalInstance[]; events: readonly PartyEvent[] }
	/**
	 * `interact` cleared the tile the player faces (`clearTile`): the tree at
	 * `pos` chopped down with the axe, or the rock broken with the pickaxe.
	 * It is plain ground from now on. `regrown` are the chunks whose cleared
	 * tiles grew back to keep the save small (far away, and nearly always
	 * none). Apply both to the world on screen (`WorldEdits.with`, `without`).
	 */
	| {
			type: 'tile-cleared';
			playerId: string;
			pos: GridPos;
			was: ClearableKind;
			tool: ItemId;
			regrown: ChunkRef[];
	  }
	/**
	 * `interact` while facing a tree or a rock without the tool it takes.
	 * Nothing changed; the client may say that the doctor sells one.
	 */
	| { type: 'tool-needed'; playerId: string; kind: ClearableKind; tool: ItemId }
	/**
	 * `take-off`: the player is up in the air over `from`, gliding `dir` (the
	 * way they face), and will come down at most `reach` tiles out. Nothing
	 * but `glide` and `land` is taken until `landed`.
	 */
	| { type: 'took-off'; playerId: string; from: GridPos; dir: Direction; reach: number }
	/** `take-off` was refused, and nothing changed: why, as a code the client words kindly. */
	| { type: 'take-off-refused'; playerId: string; reason: TakeOffRejection }
	/**
	 * `glide`: the player is over `pos` now, `flown` tiles out, one tile on.
	 * Each tile flown is a step. Nothing on the ground notices a kid up in the
	 * air; a bird may (`bird-follows`).
	 */
	| { type: 'glided'; playerId: string; pos: GridPos; flown: number }
	/**
	 * Up in the air, a wild bird of `speciesId` noticed the glider over `pos`,
	 * `flown` tiles out, and follows it down: the battle in the air starts as
	 * the player lands (`battle-started`, right after `landed`). At most one
	 * bird follows a flight, and only a team with a bird standing is noticed.
	 * When the tile is the one the flight lands on, the bird swoops in there.
	 */
	| { type: 'bird-follows'; playerId: string; speciesId: string; pos: GridPos; flown: number }
	/**
	 * The flight came down on `pos`, `flown` tiles from where it took off (the
	 * kid let go, or it reached its reach): a tile they can stand on, the
	 * ground, or the water in the boat. A `tile-cleared` follows when they came
	 * down on a tree or a rock their tool clears, and a `battle-started` when a
	 * bird followed them down (`bird-follows`): the landing always comes
	 * first. The player walks on from here, facing the way they flew.
	 */
	| { type: 'landed'; playerId: string; pos: GridPos; dir: Direction; flown: number };

export interface Authority {
	dispatch(intent: Intent): void;
	subscribe(listener: (event: GameEvent) => void): () => void;
}
