/**
 * The tally: what the game counts for the badges alone ([[PRODUCT]] §4
 * "Badges"), beside the counts it keeps for its own rules (steps, visits,
 * puzzles solved). Each number only grows, one at a time, at the moment the
 * authority decides it: a leash throw that catches (`catches`), a wild battle
 * the kid's team wins (`wins`), a friendly match the kid plays (`matches`), a
 * tree, rock or ice block cleared (`cleared`), and a day on which the kid
 * solves a puzzle (`days`, with `lastDay`, the latest such day). Nothing in a
 * kid's game reads it but the badges.
 */
export interface Tally {
	readonly catches: number;
	readonly wins: number;
	readonly matches: number;
	readonly cleared: number;
	readonly days: number;
	/** The day of the last puzzle solved, `YYYY-MM-DD` on the kid's own calendar; absent before the first. */
	readonly lastDay?: string;
}

export type TallyCount = 'catches' | 'wins' | 'matches' | 'cleared';

export const EMPTY_TALLY: Tally = { catches: 0, wins: 0, matches: 0, cleared: 0, days: 0 };

/** The most any number of the tally reaches, the most a save holds. */
const MOST = Number.MAX_SAFE_INTEGER;

/** `tally` with one more of `count`. */
export function addToTally(tally: Tally, count: TallyCount, by = 1): Tally {
	if (by <= 0) return tally;
	return { ...tally, [count]: Math.min(MOST, tally[count] + by) };
}

/** A day as the tally keeps it: `YYYY-MM-DD`. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isTallyDay(value: unknown): value is string {
	return typeof value === 'string' && DAY.test(value);
}

/**
 * `tally` after a puzzle solved on `day`: a day not the last one counted is
 * one more day played. Days need not follow each other, so a kid who plays
 * on two days a week apart has played on two days: nothing here is a streak.
 */
export function tallyDay(tally: Tally, day: string): Tally {
	if (!isTallyDay(day) || day === tally.lastDay) return tally;
	return { ...tally, days: Math.min(MOST, tally.days + 1), lastDay: day };
}
