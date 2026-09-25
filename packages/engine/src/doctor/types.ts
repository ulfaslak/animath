import type { AnimalInstance } from '../animals/types.js';
import type { Puzzle } from '../puzzles/types.js';

/**
 * A visit to the doctor. `startDoctorVisit` builds a state, `applyDoctorIntent`
 * (reducer.ts) advances it: intents in, a new state plus a list of events out,
 * the same shape as a battle.
 *
 * The player picks a hurt animal and the doctor asks one puzzle. A right answer
 * heals that animal to full HP. A wrong answer changes nothing but the puzzle.
 * The player can pick another animal or leave at any time.
 */
export type DoctorPhase =
	| { kind: 'choose-patient' }
	| { kind: 'solving'; partyIndex: number; puzzle: Puzzle }
	| { kind: 'ended' };

export interface DoctorState {
	/**
	 * Intents accepted so far. With the authority's seed (passed to
	 * `applyDoctorIntent`, never stored here where a client could read it)
	 * this keys the Rng for the next intent.
	 */
	step: number;
	/** The party at the doctor; HP here is the truth after the visit. */
	party: readonly AnimalInstance[];
	phase: DoctorPhase;
	/** What the doctor has said, newest last. */
	log: readonly string[];
}

/** What the player can choose. Never an outcome: the reducer judges and heals. */
export type DoctorIntent =
	/** Ask the doctor to look at this animal. Allowed while a puzzle is open too: it swaps the puzzle. */
	| { type: 'pick-patient'; partyIndex: number }
	| { type: 'answer'; input: string }
	| { type: 'leave' };

/**
 * What happened, in order, as a result of one intent. `answer-judged` carries
 * the correct answer, as in battle.
 */
export type DoctorEvent =
	| { type: 'puzzle-shown'; partyIndex: number; puzzle: Puzzle }
	| { type: 'answer-judged'; input: string; correct: boolean; answer: number }
	/** `animal` as it is now, at full HP. */
	| { type: 'healed'; partyIndex: number; animal: AnimalInstance }
	| { type: 'ended' }
	/** The intent was not valid in the current phase. The state is unchanged. */
	| { type: 'rejected'; reason: string };

export interface DoctorStep {
	state: DoctorState;
	events: readonly DoctorEvent[];
}
