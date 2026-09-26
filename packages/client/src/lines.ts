import type { Line as MessageLine } from '@mathgame/engine';
import { t, type ParamValue } from './copy';
import { animalWords, attackName, type AnimalRef } from './names';

/**
 * Something to say, kept as data until it is shown: a copy key and the values
 * that fill it. The words are found by `words(line)` when the line is drawn,
 * in the language on screen, so a line said in English reads in Danish the
 * moment the language changes ([[DECISIONS]] § Copy and languages). An
 * authority's `message` line has the same shape, with species by id only;
 * `messageWords` words it.
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
export function words(said: Line): string {
	const params: Record<string, ParamValue> = {};
	for (const [name, value] of Object.entries(said.params ?? {})) {
		const filled = wordsFor(value);
		if (filled !== undefined) params[name] = filled;
	}
	return t(said.key, params);
}

/**
 * The words for a line an authority sent. It came over the seam, so it is
 * taken for no more than the engine's `LINES` allow: numbers, and species by
 * id alone — a nickname or any other string riding along is dropped, and so
 * is a value of any other shape, which then shows as a gap.
 */
export function messageWords(said: MessageLine): string {
	const params: Record<string, ParamValue> = {};
	for (const [name, value] of Object.entries(said.params ?? {}) as [string, unknown][]) {
		if (typeof value === 'number' && Number.isFinite(value)) params[name] = value;
		else if (isRecord(value) && typeof value.speciesId === 'string') {
			params[name] = animalWords({ speciesId: value.speciesId });
		}
	}
	return t(said.key, params);
}

/** A value's words, or undefined for one of no known shape (a gap on screen, not a crash). */
function wordsFor(value: unknown): ParamValue | undefined {
	if (typeof value === 'number') return value;
	if (!isRecord(value) || typeof value.speciesId !== 'string') return undefined;
	if (typeof value.attackIndex === 'number') return attackName(value.speciesId, value.attackIndex);
	const nickname = typeof value.nickname === 'string' ? value.nickname : undefined;
	return animalWords(
		nickname === undefined
			? { speciesId: value.speciesId }
			: { speciesId: value.speciesId, nickname }
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
