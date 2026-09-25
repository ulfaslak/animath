import type { AnimalRef, Line as MessageLine } from '@mathgame/engine';
import { t, type ParamValue } from './copy';
import { animalWords, attackName } from './names';

/**
 * Something to say, kept as data until it is shown: a copy key and the values
 * that fill it. The words are found by `words(line)` when the line is drawn,
 * in the language on screen, so a line said in English reads in Danish the
 * moment the language changes ([[DECISIONS]] § Copy and languages). The
 * engine's `message` lines have the same shape.
 */

/** An attack as a line names it: whose, and which (1-based, as the engine counts). */
export interface AttackRef {
	speciesId: string;
	attackIndex: number;
}

/**
 * A value in a line: a number, an animal or an attack. Never text: a string
 * would be words fixed in the language they were made in.
 */
export type LineValue = number | AnimalRef | AttackRef;

export interface Line {
	key: string;
	params?: Readonly<Record<string, LineValue>>;
}

/** A line: `line('battle.go', { animal })`. */
export function line(key: string, params?: Readonly<Record<string, LineValue>>): Line {
	return params ? { key, params } : { key };
}

/** The words for a line, now. In Svelte markup it updates with the language, like `t()`. */
export function words(said: Line | MessageLine): string {
	const params: Record<string, ParamValue> = {};
	for (const [name, value] of Object.entries(said.params ?? {})) {
		params[name] = wordsFor(value as LineValue);
	}
	return t(said.key, params);
}

function wordsFor(value: LineValue): ParamValue {
	if (typeof value === 'number') return value;
	if ('attackIndex' in value) return attackName(value.speciesId, value.attackIndex);
	return animalWords(value);
}
