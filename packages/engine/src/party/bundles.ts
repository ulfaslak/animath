import type { AnimalInstance } from '../animals/types.js';

/**
 * The party in species bundles ([[PRODUCT]] §4 "Party"). All the animals of
 * one species stand together, a bundle, and the bundles stand in the order
 * the player chose, so the bundles top to bottom are the battle order: the
 * lead (`leadIndex`) is the first animal standing in the first bundle that
 * has one. Every rule that changes the party's order keeps it in bundles,
 * and a party from outside (an old save, `?party=`) is put in bundles on the
 * way in (`bundled`).
 */

/** Every animal of one species in the party, in party order. */
export interface Bundle {
	speciesId: string;
	/** The animals, in party order. */
	animals: readonly AnimalInstance[];
	/** Each animal's slot in the party, in the same order. */
	slots: readonly number[];
}

/**
 * The party's bundles, in the order each species first appears. In a party
 * kept in bundles, a bundle's slots run on from one another.
 */
export function bundles(party: readonly AnimalInstance[]): Bundle[] {
	const found = new Map<string, { animals: AnimalInstance[]; slots: number[] }>();
	party.forEach((animal, slot) => {
		let bundle = found.get(animal.speciesId);
		if (!bundle) {
			bundle = { animals: [], slots: [] };
			found.set(animal.speciesId, bundle);
		}
		bundle.animals.push(animal);
		bundle.slots.push(slot);
	});
	return [...found].map(([speciesId, b]) => ({ speciesId, animals: b.animals, slots: b.slots }));
}

/**
 * The party in bundles: each species' animals gathered behind its first one,
 * in their own order, and the bundles in the order their first animals
 * stood. A party already in bundles comes back in the same order. Always a
 * new array; the animals are the same objects.
 */
export function bundled(party: readonly AnimalInstance[]): AnimalInstance[] {
	return bundles(party).flatMap((b) => b.animals);
}

/** Whether every species' animals stand together. */
export function isBundled(party: readonly AnimalInstance[]): boolean {
	const done = new Set<string>();
	for (let i = 0; i < party.length; i++) {
		const species = party[i]!.speciesId;
		if (i > 0 && party[i - 1]!.speciesId !== species) {
			if (done.has(species)) return false;
			done.add(party[i - 1]!.speciesId);
		}
	}
	return true;
}

/**
 * A caught animal joins the party: at the end of its species' bundle, or as
 * a new bundle at the end of the party when it is the first of its species.
 * There is no limit to how many animals a party holds. The party comes back
 * in bundles (bundled first, if it was not), as copies.
 */
export function joinParty(
	party: readonly AnimalInstance[],
	animal: AnimalInstance
): AnimalInstance[] {
	const next = bundled(party).map((a) => ({ ...a }));
	let at = next.length;
	for (let i = next.length - 1; i >= 0; i--) {
		if (next[i]!.speciesId === animal.speciesId) {
			at = i + 1;
			break;
		}
	}
	next.splice(at, 0, { ...animal });
	return next;
}
