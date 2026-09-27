import { getAnimal } from '../animals/catalog.js';
import type { AnimalInstance } from '../animals/types.js';
import { facePrompt } from '../puzzles/face.js';
import { ADD_BAND } from '../puzzles/generators/arithmetic.js';
import type { Puzzle } from '../puzzles/types.js';

/**
 * Tokens: what the doctor gives for animals helped home, and what the shop
 * takes ([[PRODUCT]] §4 "Tokens and the doctor's shop").
 *
 * Every token that changes hands is a sum the kid works out: the balance
 * before, and what comes in or goes out. The engine makes it from the real
 * numbers and judges the answer; the client words the story round it
 * ("You have 23 tokens. The axe costs 8. How many will you have left?").
 */

/**
 * What one animal of tier `tier` brings when it goes home: `tier · (tier + 1)`,
 * so 2, 6, 12, 20 and 30 for tiers 1 to 5. A bigger animal is harder to
 * catch and needs a bigger lead to meet, so it earns more, and catching the
 * smallest animals over and over is the slow way to the shop.
 */
export function tokensForTier(tier: number): number {
	if (!Number.isInteger(tier) || tier < 1 || tier > 5) {
		throw new Error(`tokensForTier: tier must be 1..5, got ${tier}`);
	}
	return tier * (tier + 1);
}

/** What these animals bring together when they go home. */
export function homeTokens(animals: readonly AnimalInstance[]): number {
	return animals.reduce((sum, a) => sum + tokensForTier(getAnimal(a.speciesId).tier), 0);
}

/**
 * The sum a token transaction asks: `balance + change` when tokens come in,
 * `balance − |change|` when they go out, from the real numbers. `change` is
 * never 0, and never takes the balance below 0. Its difficulty is the
 * addition band of its bigger number (the scale the kid meets in battle), for
 * the record: the numbers are what they are.
 */
export function tokenPuzzle(balance: number, change: number): Puzzle {
	if (!Number.isSafeInteger(balance) || balance < 0) {
		throw new Error(`tokenPuzzle: the balance must be a whole number, got ${balance}`);
	}
	if (!Number.isSafeInteger(change) || change === 0 || balance + change < 0) {
		throw new Error(`tokenPuzzle: cannot change ${balance} tokens by ${change}`);
	}
	const answer = balance + change;
	const biggest = Math.max(balance, Math.abs(change));
	const band = ADD_BAND.findIndex(([, hi]) => biggest <= hi);
	const difficulty = band === -1 ? ADD_BAND.length : band + 1;
	return change > 0
		? { kind: 'add', difficulty, prompt: facePrompt({ kind: 'add', numbers: [balance, change] }), answer }
		: {
				kind: 'sub',
				difficulty,
				prompt: facePrompt({ kind: 'sub', numbers: [balance, -change] }),
				answer
			};
}
