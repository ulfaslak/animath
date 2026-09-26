import { getAnimal } from '../animals/catalog.js';
import type { AnimalInstance } from '../animals/types.js';

/** An animal the doctor can help: anything below full HP, knocked out or only hurt. */
export function needsHealing(animal: AnimalInstance): boolean {
	return animal.hp < getAnimal(animal.speciesId).maxHp;
}

/**
 * Whether the animals `ids` may go home together: somebody who isn't tired
 * always stays. A team of only tired animals meets nothing in the grass, and
 * a reload rests a team with nobody standing, which would make it a free
 * heal. The one rule behind the reducer's `keep-one`, and the one the
 * card's picks ask, so a pick the card allows is a hand-over the reducer
 * takes.
 */
export function canGoHome(party: readonly AnimalInstance[], ids: Iterable<string>): boolean {
	const going = new Set(ids);
	return party.some((a) => a.hp > 0 && !going.has(a.id));
}

/**
 * A whole kind picked to go home at once: the animals of `speciesId` that
 * join the ones `picked`, in party order. Every one of the kind not picked
 * yet joins, except that when all of them going would leave nobody standing,
 * the first of them standing stays (of those not picked, the one who goes
 * first). Empty when none can join: every one of the kind is picked already,
 * or all but the one who stays, or nobody in the team is standing.
 */
export function kindGoingHome(
	party: readonly AnimalInstance[],
	picked: Iterable<string>,
	speciesId: string
): string[] {
	const already = new Set(picked);
	const joining = party.filter((a) => a.speciesId === speciesId && !already.has(a.id));
	const ids = joining.map((a) => a.id);
	if (canGoHome(party, [...already, ...ids])) return ids;
	const stays = joining.find((a) => a.hp > 0);
	return stays ? ids.filter((id) => id !== stays.id) : [];
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
