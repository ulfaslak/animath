/**
 * Lines the authority says without words. The engine is language-free
 * ([[DECISIONS]] § Copy and languages): a line is a copy key and the values
 * that fill it — numbers, and species by id — and the client finds the words
 * in its copy files, in the language on screen. No param is a string, not
 * even a nickname: a string would let a finished sentence cross the seam.
 */

/** A species, by id. What the client calls it is in its copy files. */
export interface SpeciesRef {
	speciesId: string;
}

/** What one param of a line holds. */
export type LineParamKind = 'species' | 'number';

/**
 * Every line an authority can send in a `message` event, with the params it
 * fills and what each holds. Each key is a key of the client's copy files,
 * reading exactly these params (`copy-files.test.ts` checks both). `animal`
 * is always the wild one, which has no nickname.
 */
export const LINES = {
	/** A battle won: the wild animal goes home. */
	'battle.closing.won': { animal: 'species' },
	/** The player ran: the wild animal stays. */
	'battle.closing.fled': { animal: 'species' },
	/** A caught animal joined the party. */
	'battle.closing.joined': { animal: 'species' }
} as const satisfies Record<string, Record<string, LineParamKind>>;

export type LineKey = keyof typeof LINES;

type ParamOf<K> = K extends 'species' ? SpeciesRef : K extends 'number' ? number : never;

/** A value in a line: a species or a number. */
export type LineParam = SpeciesRef | number;

/** One line: a key from `LINES`, with exactly its params, each of its kind. */
export type Line = {
	[K in LineKey]: {
		key: K;
		params: { [P in keyof (typeof LINES)[K]]: ParamOf<(typeof LINES)[K][P]> };
	};
}[LineKey];
