import type { AnimalInstance } from './animals/types.js';
import type { BattleEvent, BattleIntent, BattleState } from './battle/types.js';
import type { DoctorEvent, DoctorIntent, DoctorState } from './doctor/types.js';
import type { Line } from './lines.js';
import type { NewGameRejection } from './party/starters.js';
import type { ItemId } from './items/catalog.js';
import type { PartyEvent, PartyIntent } from './party/types.js';
import type { ChunkRef } from './world/edits.js';
import type { ClearableKind, Direction, GridPos } from './world/types.js';

/**
 * The client ↔ authority protocol.
 *
 * The client never mutates game state. It sends *intents* ("I want to walk
 * left", "I answer 42") to an `Authority`, which validates them against the
 * rules and emits *events* describing what actually happened. In single player
 * the authority is `LocalAuthority` in the client process; in multiplayer it is
 * the server, and these same types travel over a WebSocket. Nothing about the
 * UI or renderer changes between the two — that is the whole point.
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
	 * Start a new game with the starter the player picked, and the name they
	 * gave it, as typed (the title's starter screen). The engine's
	 * `chooseStarter` checks it: a tier-1 species, a nickname that is text,
	 * cleaned like a rename. Only while no game is under way, which is at the
	 * title. Answered with `welcome` (`newGame: true`), or `new-game-refused`.
	 */
	| { type: 'new-game'; speciesId: string; nickname?: string }
	/**
	 * Leave the game for the title (the pause menu's Quit to title). Only
	 * while exploring: in a battle or at the doctor it does nothing, so no
	 * way out of either opens through the title. The game stops where it
	 * stands, and a later start picks it up there. Answered with
	 * `game-left`; after it nothing walks, rolls or saves until a game starts.
	 */
	| { type: 'leave-game' };

export type GameEvent =
	/**
	 * The game starts, or starts over: a new game, or one picked up from a
	 * save. Carries the facing too, so a restored player looks the way they
	 * did, and the tokens and items. A `battle-started` follows when the save
	 * was taken mid-battle. `newGame` tells the two apart: true for a game
	 * that begins here (a starter just picked, or a throwaway game), false for
	 * one picked up. `edits` are the tiles the player has cleared, in
	 * `WorldEdits`' text form: the world is the seed's, as they left it.
	 */
	| {
			type: 'welcome';
			playerId: string;
			seed: number;
			pos: GridPos;
			facing: Direction;
			party: AnimalInstance[];
			tokens: number;
			items: string[];
			newGame: boolean;
			edits: string[];
	  }
	/** `new-game` was refused, and nothing started: why, as a code. */
	| { type: 'new-game-refused'; reason: NewGameRejection }
	/** The player left the game for the title (`leave-game`). No game is under way now. */
	| { type: 'game-left' }
	| { type: 'player-moved'; playerId: string; pos: GridPos; dir: Direction }
	| { type: 'player-blocked'; playerId: string; dir: Direction }
	/**
	 * The player was put on a tile without walking there. No direction: the
	 * figure keeps facing the way it did, and there is nothing to tween.
	 * `LocalAuthority` sends none today (a lost battle sends `taken-to-doctor`).
	 */
	| { type: 'player-placed'; playerId: string; pos: GridPos }
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
	 * that was not lost, a caught animal joining, animals healed at the
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
	 * After a lost battle: `takeToDoctor`'s result. Put the player on `pos`
	 * without a tween (it can be a hundred tiles away), turn them to `dir`
	 * (toward `tent`, or down when `tent` is null and a doctor came to them),
	 * and replace the party. No `message` follows: the client words the
	 * doctor's line itself, from whether `tent` is null.
	 */
	| {
			type: 'taken-to-doctor';
			playerId: string;
			pos: GridPos;
			dir: Direction;
			tent: GridPos | null;
			party: AnimalInstance[];
	  }
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
	| { type: 'tool-needed'; playerId: string; kind: ClearableKind; tool: ItemId };

export interface Authority {
	dispatch(intent: Intent): void;
	subscribe(listener: (event: GameEvent) => void): () => void;
}
