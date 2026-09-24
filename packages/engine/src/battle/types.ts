import type { AnimalInstance, AttackLevel } from '../animals/types.js';
import type { Puzzle } from '../puzzles/types.js';

/**
 * Battle state machine — the shape only, for now. The reducer that advances it
 * (`applyBattleIntent`) is the next piece of engine work; the type is here so
 * client and server code can be written against it.
 *
 * Phases follow the Game Boy rhythm: the player picks an attack and a level,
 * gets a puzzle, answers, damage lands, the opponent takes its turn, repeat.
 */
export type BattlePhase =
	| { kind: 'choose-action' }
	| { kind: 'solving'; attackIndex: number; level: AttackLevel; puzzle: Puzzle }
	| { kind: 'opponent-turn' }
	| { kind: 'ended'; outcome: 'won' | 'lost' | 'caught' | 'fled' };

export interface BattleState {
	/** Seed for the battle's own Rng; combined with the intent log it replays exactly. */
	seed: number;
	turn: number;
	player: AnimalInstance;
	opponent: AnimalInstance;
	phase: BattlePhase;
	/** Messages to show in the battle log, newest last. */
	log: string[];
}

export type BattleIntent =
	| { type: 'attack'; attackIndex: number; level: AttackLevel }
	| { type: 'answer'; input: string }
	| { type: 'throw-leash'; leashQuality?: number }
	| { type: 'flee' };
