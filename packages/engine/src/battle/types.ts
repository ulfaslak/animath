import type { AnimalInstance, AttackLevel, Realm } from '../animals/types.js';
import type { TopicBonus } from '../puzzles/record.js';
import type { Puzzle, PuzzleTopic } from '../puzzles/types.js';

/**
 * Battle state machine. `startBattle` builds a state, `applyBattleIntent`
 * (reducer.ts) advances it: intents in, a new state plus a list of events out.
 *
 * Phases follow the Game Boy rhythm: the player picks an attack and a level,
 * gets a puzzle, answers, damage lands, the wild animal takes its turn, repeat.
 * The wild animal's turn is resolved inside the same reducer call as the
 * player's action, so the state never rests in an "opponent's turn" phase —
 * the client animates the events in order and only then shows the new state.
 *
 * `choose-animal` follows a knock-out while someone else in the party is
 * still standing: the animal in front (`active`) is the tired one, and the
 * only intent that fits is a `switch` naming who steps in.
 */
export type BattlePhase =
	| { kind: 'choose-action' }
	| { kind: 'choose-animal' }
	| { kind: 'solving'; attackIndex: number; level: AttackLevel; puzzle: Puzzle }
	| { kind: 'ended'; outcome: BattleOutcome };

export type BattleOutcome = 'won' | 'lost' | 'caught' | 'fled';

export type BattleSide = 'player' | 'opponent';

export interface BattleState {
	/**
	 * Intents accepted so far. With the authority's seed (passed to
	 * `applyBattleIntent`, never stored here where a client could read it)
	 * this keys the Rng for the next intent.
	 */
	step: number;
	/** Round counter, 1-based. Advances after the wild animal has taken its turn. */
	turn: number;
	/** The player's party as it stands in this battle; HP here is the truth after the battle. */
	party: readonly AnimalInstance[];
	/** Index into `party` of the animal currently in front. */
	active: number;
	opponent: AnimalInstance;
	/** Multiplier for leash throws; 1 is the starter leash. Set at `startBattle`. */
	leashQuality: number;
	/**
	 * Where it is fought: on land, out on the water from the boat, or up in
	 * the air, after a bird followed the glider down (whatever tile the
	 * player landed on). Only an animal that can go there (`canFightIn`) steps
	 * in, so on the water only the ones that swim and in the air only the
	 * birds; the battle is lost once every one of those is tired.
	 */
	realm: Realm;
	/**
	 * How hard the player's hit lands per topic of its puzzle (`topicBonus`),
	 * fixed for the battle as it started. Missing in a battle saved before
	 * the bonus, and on a topic it lacks: the hit lands as it is.
	 */
	bonus?: TopicBonus;
	phase: BattlePhase;
}

/**
 * What the player can choose. Never an outcome: the reducer computes damage,
 * catches and switches; the client only says what it wants.
 */
export type BattleIntent =
	| { type: 'attack'; attackIndex: number; level: AttackLevel }
	| { type: 'answer'; input: string }
	| { type: 'throw-leash' }
	| { type: 'flee' }
	/**
	 * Send in the party member at `partyIndex`. On the player's turn it is the
	 * turn (the wild animal replies against the newcomer); in `choose-animal`
	 * it picks who replaces the tired animal, and costs nothing.
	 */
	| { type: 'switch'; partyIndex: number };

/**
 * Why an intent was refused. A code, never words: the client never shows it
 * to the player (it greys out what would be refused), and logs it for
 * developers.
 */
export type BattleRejection =
	/** Not an object with a `type`, or a `type` the reducer does not know. */
	| 'not-an-intent'
	| 'battle-over'
	/** An attack, the leash or running, outside `choose-action`. */
	| 'not-choosing-an-action'
	/** An answer with no puzzle open. */
	| 'no-puzzle'
	| 'no-such-attack'
	| 'no-such-level'
	/** A switch outside `choose-action` and `choose-animal`. */
	| 'not-choosing'
	| 'no-such-animal'
	| 'already-in-front'
	| 'tired'
	/** An animal that can't go where the battle is fought: one that can't swim, out on the water. */
	| 'cannot-fight-here';

/**
 * What happened, in order, as a result of one intent. Detailed enough to
 * animate without re-running the rules: every hit carries the damage and the
 * target's remaining HP, every judgement carries the correct answer. No
 * event carries words: the client words each one (`battle/controller.ts`).
 */
export type BattleEvent =
	| { type: 'puzzle-shown'; attackIndex: number; level: AttackLevel; puzzle: Puzzle }
	| {
			type: 'answer-judged';
			input: string;
			correct: boolean;
			answer: number;
			/** The puzzle's topic (`puzzleTopic`), which the kid's record counts it under. */
			topic: PuzzleTopic;
	  }
	| {
			type: 'hit';
			attacker: BattleSide;
			attackIndex: number;
			level: AttackLevel;
			damage: number;
			/** The target's HP after the hit. */
			targetHp: number;
	  }
	| { type: 'missed'; attacker: BattleSide; attackIndex: number; level: AttackLevel }
	| { type: 'fainted'; side: BattleSide; animal: AnimalInstance }
	/** A `switch` was accepted: `animal` (party member `partyIndex`) is in front now. */
	| { type: 'switched'; animal: AnimalInstance; partyIndex: number }
	| { type: 'leash-thrown'; chance: number; success: boolean }
	| { type: 'fled' }
	| { type: 'ended'; outcome: BattleOutcome; caught?: AnimalInstance }
	/** The intent was not valid in the current phase. The state is unchanged. */
	| { type: 'rejected'; reason: BattleRejection };

export interface BattleStep {
	state: BattleState;
	events: readonly BattleEvent[];
}
