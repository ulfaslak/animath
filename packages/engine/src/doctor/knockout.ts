import { getAnimal } from '../animals/catalog.js';
import type { AnimalInstance } from '../animals/types.js';
import { nearestTent } from '../world/tents.js';
import type { Direction, GridPos } from '../world/types.js';
import { validateParty } from './party.js';

/**
 * The knock-out rule: what happens after a battle ends `lost`.
 *
 * The player is taken to the nearest doctor's tent on foot (see
 * `nearestTent`) and stands beside it, facing it, and the doctor heals the
 * whole party to full for free. There is no other penalty. A kid is never left
 * with a party that cannot battle, and never put somewhere they could not have
 * walked to.
 *
 * If no tent is within reach (`nearestTent` gives up), a doctor comes to the
 * player instead: they stay where they are, facing down, and the party is
 * healed all the same.
 */
export interface Rescue {
	/** Where the player now stands. */
	pos: GridPos;
	/** The way the player now faces: toward the tent, or down when none was in reach. */
	facing: Direction;
	/** The tent the player was taken to, or null when the doctor came to them. */
	tent: GridPos | null;
	/**
	 * The whole party, every animal at full HP, in the same order. What the
	 * doctor says about it is the client's to word, from whether `tent` is null.
	 */
	party: AnimalInstance[];
}

/**
 * Call on `ended { outcome: 'lost' }` with the world seed, the tile the battle
 * was fought on and the battle's final party (every animal knocked out).
 */
export function takeToDoctor(seed: number, pos: GridPos, party: readonly AnimalInstance[]): Rescue {
	validateParty(party, 'takeToDoctor');
	if (party.length === 0) throw new Error('takeToDoctor: the party is empty');
	if (party.some((a) => a.hp > 0)) {
		throw new Error('takeToDoctor: only a party that is all knocked out is taken to the doctor');
	}

	const healed = party.map((a) => ({ ...a, hp: getAnimal(a.speciesId).maxHp }));
	const spot = nearestTent(seed, pos);
	if (!spot) {
		return { pos: { x: pos.x, y: pos.y }, facing: 'down', tent: null, party: healed };
	}
	return { pos: spot.stand, facing: spot.facing, tent: spot.tent, party: healed };
}
