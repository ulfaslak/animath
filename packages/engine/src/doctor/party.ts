import { getAnimal } from '../animals/catalog.js';
import type { AnimalInstance } from '../animals/types.js';
import { leadIndex } from '../party/reducer.js';

/** An animal the doctor can help: anything below full HP, knocked out or only hurt. */
export function needsHealing(animal: AnimalInstance): boolean {
	return animal.hp < getAnimal(animal.speciesId).maxHp;
}

/**
 * Whether the animals that stay with the kid when others go home are a team
 * to walk on with: one of them isn't tired and can fight on land, where every
 * tent stands (a sea animal alone could battle nothing in the grass). The
 * rule behind `keep-one`, for a screen to show before it is asked. It keeps
 * a hand-over from leaving the kid without one; a battle at sea that a sea
 * animal ends standing (won, run from or caught), the land's animals tired,
 * can, and then the grass is quiet until a doctor heals one.
 */
export function keepsATeam(staying: readonly AnimalInstance[]): boolean {
	return leadIndex(staying, 'land') >= 0;
}

/**
 * Whether the animals `ids` may go home together: the ones who stay keep a
 * team (`keepsATeam`). A team of only tired animals, or of only sea animals
 * standing, meets nothing in the grass, and a reload rests a team with nobody
 * standing, which would make it a free heal. The one rule behind the
 * reducer's `keep-one`, and the one the card's picks ask, so a pick the card
 * allows is a hand-over the reducer takes.
 */
export function canGoHome(party: readonly AnimalInstance[], ids: Iterable<string>): boolean {
	const going = new Set(ids);
	return keepsATeam(party.filter((a) => !going.has(a.id)));
}

/**
 * The animals not `picked` that have to stay: picking any one of them too
 * would leave no team (`canGoHome`). Of those not picked, the one who could
 * walk on with the kid (`keepsATeam` of it alone) while it is the only one;
 * every one when none of them could; else nobody. The card marks them before
 * the kid tries.
 */
export function mustStay(party: readonly AnimalInstance[], picked: Iterable<string>): string[] {
	const going = new Set(picked);
	const staying = party.filter((a) => !going.has(a.id));
	const walkers = staying.filter((a) => keepsATeam([a]));
	if (walkers.length > 1) return [];
	return staying.filter((a) => walkers.length === 0 || a === walkers[0]).map((a) => a.id);
}

/**
 * A whole kind picked to go home at once: the animals of `speciesId` that
 * join the ones `picked`, in party order. Every one of the kind not picked
 * yet joins, except that when all of them going would leave no team, the
 * first of them who could walk on with the kid stays (of those not picked,
 * the one who would go first on land). Empty when none can join: every one
 * of the kind is picked already, or all but the one who stays, or none of
 * them could keep a team (a kind of the sea, or all of it tired, with no
 * other walker standing).
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
	const stays = joining.find((a) => keepsATeam([a]));
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
