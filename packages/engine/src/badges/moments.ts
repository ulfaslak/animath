import { canRide, getAnimal } from '../animals/catalog.js';
import type { AnimalInstance, Realm } from '../animals/types.js';
import { leadIndex } from '../party/bundles.js';
import type { BadgeMoment } from './catalog.js';

/**
 * The rules for the firsts the authority catches as they happen
 * (`BadgeMoment`): each says whether a moment it is told about earns one.
 * The authority calls them where the moment is decided, and hands what they
 * give to `earnBadges`.
 */

/** A battle that starts in `realm`: the first out on the water and the first up in the air are badges. */
export function battleMoment(realm: Realm): BadgeMoment | null {
	if (realm === 'water') return 'firsts.webbed-feet';
	if (realm === 'air') return 'firsts.hollow-bones';
	return null;
}

/**
 * A kid on land with `party`, owning `items`: riding their lead, on its back
 * with the harness (`canRide`), is Symbiosis. Pulled on the sled is not a ride
 * on an animal's back.
 */
export function rideMoment(
	owner: { readonly items: readonly string[] },
	party: readonly AnimalInstance[]
): BadgeMoment | null {
	const lead = party[leadIndex(party, 'land')];
	return lead && canRide(owner, lead.speciesId) ? 'firsts.symbiosis' : null;
}

/**
 * A leash throw by `front` that caught `caught`: an animal two sizes or more
 * bigger than the one that threw is Ant strength; one hooked at a fishing hole
 * (`fished`) is Kingfisher.
 */
export function catchMoments(
	front: AnimalInstance | undefined,
	caught: AnimalInstance,
	fished: boolean
): BadgeMoment[] {
	const moments: BadgeMoment[] = [];
	if (front && getAnimal(caught.speciesId).tier - getAnimal(front.speciesId).tier >= 2) {
		moments.push('firsts.ant-strength');
	}
	if (fished) moments.push('firsts.kingfisher');
	return moments;
}

/** A trip from world `from` to world `to` of a game begun in `home`: back home from another world is Homing instinct. */
export function tripMoment(from: number, to: number, home: number): BadgeMoment | null {
	return from !== home && to === home ? 'firsts.homing-instinct' : null;
}
