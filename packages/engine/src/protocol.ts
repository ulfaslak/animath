import type { AnimalInstance } from './animals/types.js';
import type { BattleEvent, BattleIntent, BattleState } from './battle/types.js';
import type { Direction, GridPos } from './world/types.js';

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
	| { type: 'interact' }
	| { type: 'battle'; intent: BattleIntent };

export type GameEvent =
	| { type: 'welcome'; playerId: string; seed: number; pos: GridPos; party: AnimalInstance[] }
	| { type: 'player-moved'; playerId: string; pos: GridPos; dir: Direction }
	| { type: 'player-blocked'; playerId: string; dir: Direction }
	/**
	 * The player was put on a tile without walking there — resting after a
	 * lost battle today, a doctor's tent later. No direction: nothing to tween.
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
	 * The party changed outside a battle turn: HP written back after a battle,
	 * a caught animal joining, a heal. Always the whole party, in order.
	 */
	| { type: 'party-changed'; party: AnimalInstance[] }
	| { type: 'message'; text: string };

export interface Authority {
	dispatch(intent: Intent): void;
	subscribe(listener: (event: GameEvent) => void): () => void;
}
