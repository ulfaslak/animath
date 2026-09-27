import { MAX_NAME_LENGTH, MIN_NAME_LENGTH, getAnimal, type NameRejection } from '@mathgame/engine';
import { t, type ParamValue } from './copy';

/** An animal as the screen names it: its species, and its nickname when it has one. */
export interface AnimalRef {
	speciesId: string;
	nickname?: string;
}

/**
 * What the screen calls animals and attacks, in the language on screen. The
 * engine knows them by id only; the words are the copy files'
 * (`species.<id>.*`, `species.<id>.attacks.<attack id>`). Every way a
 * nickname enters the authority's party goes through the engine's
 * `normalizeNickname`, so a nickname is shown as stored, the same everywhere.
 */

/**
 * The forms every species has in the copy files, for sentences to pick from
 * with `{animal.form}`: its name as a name or a label, and with "a", "the",
 * "wild", "a wild" and "the wild" — Danish articles and "vild" follow the
 * noun's gender (en ræv, et egern), so each form is written out, never built.
 */
export const ANIMAL_FORMS = ['name', 'a', 'the', 'wild', 'aWild', 'theWild'] as const;
export type AnimalForm = (typeof ANIMAL_FORMS)[number];

/** A species' name, as a name or a label: "Fox", "Ræv". */
export function speciesName(speciesId: string): string {
	return t(`species.${speciesId}.name`);
}

/** What the screen calls an animal: its nickname, or else its species' name. */
export function nameOf(animal: AnimalRef): string {
	return animal.nickname ?? speciesName(animal.speciesId);
}

/**
 * An animal as a line's `{animal.form}` param: its nickname, which stands for
 * every form of itself, or else its species' forms.
 */
export function animalWords(animal: AnimalRef): ParamValue {
	if (animal.nickname !== undefined) return animal.nickname;
	const forms: Record<string, string> = {};
	for (const form of ANIMAL_FORMS) forms[form] = t(`species.${animal.speciesId}.${form}`);
	return forms;
}

/**
 * An attack's name, by the engine's 1-based index into the species' attacks.
 * An index the species doesn't have shows as a copy gap, like a missing key.
 */
export function attackName(speciesId: string, attackIndex: number): string {
	const attack = getAnimal(speciesId).attacks[attackIndex - 1];
	return t(`species.${speciesId}.attacks.${attack?.id ?? attackIndex}`);
}

/** What a player's name may be, under a name box: "2 to 16 letters or numbers." */
export function nameRule(): string {
	return t('playerName.rule', { min: MIN_NAME_LENGTH, max: MAX_NAME_LENGTH });
}

/**
 * Why a player's name did not go (the engine's `checkName`), kindly, and
 * what to do instead: type it first, a longer one, a shorter one, only
 * letters and numbers, or another name.
 */
export function nameRefusal(reason: NameRejection): string {
	switch (reason) {
		case 'empty':
			return t('playerName.refused.empty');
		case 'short':
			return t('playerName.refused.short', { min: MIN_NAME_LENGTH });
		case 'long':
			return t('playerName.refused.long', { max: MAX_NAME_LENGTH });
		case 'chars':
			return t('playerName.refused.chars');
		case 'rude':
			return t('playerName.refused.rude');
	}
}
