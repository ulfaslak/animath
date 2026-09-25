import type { AnimalInstance } from './animals/types.js';
import type { BattleEvent, BattleIntent, BattleState } from './battle/types.js';
import type { DoctorEvent, DoctorIntent, DoctorState } from './doctor/types.js';
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
	| { type: 'battle'; intent: BattleIntent }
	/** Only during a doctor visit. A visit starts with `interact` while `canTalkToDoctor` holds. */
	| { type: 'doctor'; intent: DoctorIntent };

export type GameEvent =
	| { type: 'welcome'; playerId: string; seed: number; pos: GridPos; party: AnimalInstance[] }
	| { type: 'player-moved'; playerId: string; pos: GridPos; dir: Direction }
	| { type: 'player-blocked'; playerId: string; dir: Direction }
	| { type: 'battle-started'; state: BattleState }
	/**
	 * One battle intent was applied. `events` is what happened, in order, and
	 * `state` is the battle after all of them; animate the events, then show
	 * the state. When the last event is `ended`, a `battle-ended` follows.
	 */
	| { type: 'battle-updated'; state: BattleState; events: readonly BattleEvent[] }
	| { type: 'battle-ended'; state: BattleState }
	| { type: 'message'; text: string }
	/** `interact` while facing a tent opened a visit. Walking waits until `doctor-visit-ended`. */
	| { type: 'doctor-visit-started'; state: DoctorState }
	/**
	 * One doctor intent was applied. As with `battle-updated`: animate `events`
	 * in order, then show `state`. When the last event is `ended`, a
	 * `doctor-visit-ended` follows.
	 */
	| { type: 'doctor-visit-updated'; state: DoctorState; events: readonly DoctorEvent[] }
	/** `state.party` is the party after the visit. */
	| { type: 'doctor-visit-ended'; state: DoctorState };

export interface Authority {
	dispatch(intent: Intent): void;
	subscribe(listener: (event: GameEvent) => void): () => void;
}
