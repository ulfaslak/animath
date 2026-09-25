import { getAnimal, type AnimalInstance } from '@mathgame/engine';

/**
 * What the screen calls an animal: its nickname, or else its species' name.
 * Every way a nickname enters the authority's party goes through the engine's
 * `normalizeNickname` (a rename, and the party the authority starts with), so
 * the name is shown as stored, the same on every screen.
 */
export function nameOf(animal: AnimalInstance): string {
	return animal.nickname ?? speciesName(animal.speciesId);
}

export function speciesName(speciesId: string): string {
	return getAnimal(speciesId).name;
}
