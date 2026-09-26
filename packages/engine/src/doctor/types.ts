import type { AnimalInstance } from '../animals/types.js';
import type { ItemId } from '../items/catalog.js';
import type { Puzzle } from '../puzzles/types.js';

/**
 * A visit to the doctor. `startDoctorVisit` builds a state, `applyDoctorIntent`
 * (reducer.ts) advances it: intents in, a new state plus a list of events out,
 * the same shape as a battle.
 *
 * Three things happen at the doctor, each behind a puzzle:
 * - **Healing.** The player picks a hurt animal and the doctor asks one
 *   puzzle. A right answer heals every hurt animal of that species to full
 *   HP; a wrong one changes nothing but the puzzle.
 * - **Helping animals home.** The player hands animals over; the doctor
 *   makes them better, lets them go back to the wild and gives tokens for
 *   each. The player always keeps one.
 * - **The shop.** The player buys an item with tokens.
 * A hand-over and a purchase each complete only when the player works out
 * the tokens they will have afterwards; a wrong answer asks the same sum
 * again. Nothing is lost by backing out, picking something else or leaving.
 */
export type DoctorPhase =
	/** Nothing open: the player is choosing what to do. */
	| { kind: 'choose-patient' }
	/** A healing puzzle for the animal at `partyIndex`, and so for every hurt one of its species. */
	| { kind: 'solving'; partyIndex: number; puzzle: Puzzle }
	/** Helping the animals `ids` home, for `reward` tokens, once `puzzle` (tokens + reward) is solved. */
	| { kind: 'handing-over'; ids: readonly string[]; reward: number; puzzle: Puzzle }
	/** Buying `itemId` for `price` tokens, once `puzzle` (tokens − price) is solved. */
	| { kind: 'buying'; itemId: ItemId; price: number; puzzle: Puzzle }
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
	/** The player's tokens, as they stand now. */
	tokens: number;
	/** The ids of the items the player owns, in the order bought. */
	items: readonly string[];
	/** What the shop sells in this visit, in catalog order. */
	shop: readonly ItemId[];
	phase: DoctorPhase;
}

/**
 * What the player can choose. Never an outcome: the reducer judges, heals and
 * pays. A `pick-patient`, `hand-over` or `buy` is taken with a puzzle open
 * too: it puts its own puzzle in the open one's place.
 */
export type DoctorIntent =
	/** Ask the doctor to look at this animal (and so at every hurt one of its species). */
	| { type: 'pick-patient'; partyIndex: number }
	/** Hand these animals over to go home to the wild, by id. Asks the sum of the tokens they bring. */
	| { type: 'hand-over'; ids: readonly string[] }
	/** Buy this item. Asks the sum of the tokens left after it. */
	| { type: 'buy'; itemId: string }
	/** Answer the puzzle that is open: a healing puzzle or a token sum. */
	| { type: 'answer'; input: string }
	/** Close the open puzzle without answering it. Nothing changes. */
	| { type: 'back' }
	| { type: 'leave' };

/** Why an intent was refused: a code for developers, never words (as in battle). */
export type DoctorRejection =
	/** Not an object with a `type`, or a `type` the reducer does not know. */
	| 'not-an-intent'
	| 'visit-over'
	/** A party index or an id that names no animal of the party, or the same one twice, or none. */
	| 'no-such-animal'
	/** A pick of an animal at full HP. */
	| 'not-hurt'
	/** A hand-over that would leave the player without an animal. */
	| 'keep-one'
	/** An item this shop doesn't sell. */
	| 'not-for-sale'
	/** An item the player owns already: one of each is all anyone needs. */
	| 'already-owned'
	| 'not-enough-tokens'
	/** An answer, or `back`, with no puzzle open. */
	| 'no-puzzle';

/**
 * What happened, in order, as a result of one intent. `answer-judged` carries
 * the correct answer, as in battle. No event carries words: the client
 * chooses what the doctor says from them (`doctor/lines.ts`).
 */
export type DoctorEvent =
	| { type: 'puzzle-shown'; partyIndex: number; puzzle: Puzzle }
	/** The sum for a hand-over: the tokens now, plus `reward`. */
	| { type: 'hand-over-shown'; ids: readonly string[]; reward: number; puzzle: Puzzle }
	/** The sum for a purchase: the tokens now, less `price`. */
	| { type: 'purchase-shown'; itemId: ItemId; price: number; puzzle: Puzzle }
	| { type: 'answer-judged'; input: string; correct: boolean; answer: number }
	/** `animal` as it is now, at full HP. */
	| { type: 'healed'; partyIndex: number; animal: AnimalInstance }
	/** These animals left the party for the wild, made better first (at full HP), in party order. */
	| { type: 'went-home'; animals: readonly AnimalInstance[] }
	/** The doctor gave `amount` tokens for them; `tokens` is the player's tokens now. */
	| { type: 'tokens-given'; amount: number; tokens: number }
	/** The player bought `itemId` for `price`; `tokens` is what they have left. */
	| { type: 'bought'; itemId: ItemId; price: number; tokens: number }
	/** The open puzzle was put away (`back`). */
	| { type: 'closed' }
	| { type: 'ended' }
	/** The intent was not valid in the current phase. The state is unchanged. */
	| { type: 'rejected'; reason: DoctorRejection };

export interface DoctorStep {
	state: DoctorState;
	events: readonly DoctorEvent[];
}
