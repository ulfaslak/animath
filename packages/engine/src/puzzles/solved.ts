import type { BattleEvent } from '../battle/types.js';
import type { DoctorEvent } from '../doctor/types.js';
import type { MatchEvent, MatchSide } from '../match/types.js';

/**
 * The count of puzzles a kid has solved ([[PRODUCT]] §4 "Puzzles"): every
 * right answer adds one, wherever it was judged (an attack in a wild battle,
 * a heal or a token sum at the doctor, an attack in a friendly match), and a
 * wrong one adds none, so the count never goes down. Every reducer that
 * judges an answer, with `checkAnswer`, says so in one `answer-judged` event,
 * and the count is read from those events: it follows the judgement itself,
 * never a screen.
 */

/** What any reducer's event holds that the count reads: an `answer-judged` says whether the answer was right, and in a match whose. */
interface Judged {
	readonly type: string;
	readonly correct?: boolean;
	readonly side?: string;
}

/**
 * `solved` after `events`, the events of one step of a wild battle or a
 * doctor visit: one more for every answer they judged right.
 */
export function countSolved(solved: number, events: readonly (BattleEvent | DoctorEvent)[]): number;
/**
 * `solved` after `events`, a friendly match's, which both players are sent:
 * one more for every answer of `side`'s judged right. Only the kid's own
 * answers count, never the other player's.
 */
export function countSolved(solved: number, events: readonly MatchEvent[], side: MatchSide): number;
export function countSolved(solved: number, events: readonly Judged[], side?: MatchSide): number {
	let count = solved;
	for (const e of events) {
		if (e.type !== 'answer-judged' || e.correct !== true) continue;
		if (side !== undefined && e.side !== side) continue;
		count += 1;
	}
	// No further than a save can hold (a whole number, `Number.isSafeInteger`): a count
	// past it would be a save the game refuses to write.
	return Math.min(count, Number.MAX_SAFE_INTEGER);
}
