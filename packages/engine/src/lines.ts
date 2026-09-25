/**
 * Lines the authority says without words. The engine is language-free
 * ([[DECISIONS]] § Copy and languages): a line is a copy key and the values
 * that fill it — numbers and animals by id — and the client finds the words
 * in its copy files, in the language on screen. A string param would let a
 * finished sentence cross the seam, so there is none.
 */

/** An animal as a line names it: its species, and its nickname when it has one. */
export interface AnimalRef {
	speciesId: string;
	nickname?: string;
}

export type LineParam = number | AnimalRef;

/**
 * Every line an authority can send in a `message` event, with the params it
 * fills. Each key is a key of the client's copy files, reading exactly these
 * params (`copy-files.test.ts` checks both). `animal` is always the wild one.
 */
export const LINES = {
	/** A battle won: the wild animal goes home. */
	'battle.closing.won': ['animal'],
	/** The player ran: the wild animal stays. */
	'battle.closing.fled': ['animal'],
	/** A caught animal joined the party. */
	'battle.closing.joined': ['animal'],
	/** A caught animal went back, because the party was full. */
	'battle.closing.teamFull': ['animal']
} as const satisfies Record<string, readonly string[]>;

export type LineKey = keyof typeof LINES;

/** One line: a key from `LINES` with exactly the params it lists. */
export type Line = {
	[K in LineKey]: { key: K; params: { [P in (typeof LINES)[K][number]]: LineParam } };
}[LineKey];
