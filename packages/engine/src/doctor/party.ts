import { getAnimal } from '../animals/catalog.js';
import type { AnimalInstance } from '../animals/types.js';

/** An animal the doctor can help: anything below full HP, knocked out or only hurt. */
export function needsHealing(animal: AnimalInstance): boolean {
	return animal.hp < getAnimal(animal.speciesId).maxHp;
}

/**
 * The checks `startBattle` makes on a party, for the doctor's entry points:
 * every animal is an object of a known species with a whole HP in `0..maxHp`,
 * and no two share an id (a duplicate would make writing HP back ambiguous).
 */
export function validateParty(party: readonly AnimalInstance[], where: string): void {
	if (!Array.isArray(party)) throw new Error(`${where}: the party must be a list`);
	const ids = new Set<string>();
	for (const animal of party) {
		if (!animal || typeof animal !== 'object') {
			throw new Error(`${where}: a party member is not an animal`);
		}
		const spec = getAnimal(animal.speciesId);
		if (!Number.isInteger(animal.hp) || animal.hp < 0 || animal.hp > spec.maxHp) {
			throw new Error(
				`${where}: ${animal.id} (${spec.id}) has hp ${animal.hp}, expected 0..${spec.maxHp}`
			);
		}
		if (ids.has(animal.id)) throw new Error(`${where}: two animals share the id ${animal.id}`);
		ids.add(animal.id);
	}
}
