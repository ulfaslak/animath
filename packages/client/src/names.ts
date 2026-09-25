import { getAnimal, normalizeNickname, type AnimalInstance } from '@mathgame/engine';

/**
 * What the screen calls an animal: its nickname, or else its species' name.
 * The nickname is read through the engine's cleaning, so a name from anywhere
 * (an old save, the `?party=` hook) shows as a typed one would, never blank.
 */
export function nameOf(animal: AnimalInstance): string {
	return normalizeNickname(animal.nickname) ?? speciesName(animal.speciesId);
}

export function speciesName(speciesId: string): string {
	return getAnimal(speciesId).name;
}
