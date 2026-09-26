import { canFightIn } from '../animals/catalog.js';
import type { AnimalInstance, Realm } from '../animals/types.js';
import { normalizeNickname } from './names.js';
import type {
	PartyEvent,
	PartyIntent,
	PartyRejection,
	PartyStep,
	PlayerActivity
} from './types.js';

/**
 * The lead where the player stands in `realm` (land unless said otherwise):
 * the animal that steps into the next battle there, the first one in party
 * order that is not tired and can fight there (`canFightIn`). Out on the
 * water that is the first one that swims. -1 when there is none: every
 * animal is tired, or none of the standing ones can go there. The battle
 * reducer uses the same function for who starts and who steps in after a
 * knock-out, so the animal the HUD marks as the lead is the one that fights.
 */
export function leadIndex(party: readonly AnimalInstance[], realm: Realm = 'land'): number {
	return party.findIndex((a) => a.hp > 0 && canFightIn(a.speciesId, realm));
}

/**
 * Apply one party intent: choose the lead, move an animal to another slot,
 * or name it.
 *
 * Pure: the input party is never changed, and an accepted intent returns a
 * new party (fresh animal objects, same ids, HP and species). An intent that
 * does not fit — anything outside explore, an animal not in the party, a
 * tired animal chosen to lead, a slot off the end, a move to where the animal
 * already is — returns the same party reference with a single `rejected`
 * event.
 */
export function applyPartyIntent(
	party: readonly AnimalInstance[],
	intent: PartyIntent,
	activity: PlayerActivity,
	realm: Realm = 'land'
): PartyStep {
	if (activity !== 'explore') return reject(party, 'not-exploring');
	if (!intent || typeof intent !== 'object') return reject(party, 'not-an-intent');
	switch (intent.type) {
		case 'select-lead':
			return selectLead(party, intent.animalId, realm);
		case 'reorder':
			return reorder(party, intent.animalId, intent.to);
		case 'rename':
			return rename(party, intent.animalId, intent.nickname);
		default:
			return reject(party, 'not-an-intent');
	}
}

/**
 * Choose who goes first where the player stands: an animal that can fight
 * there (out on the water, one that swims) and isn't tired moves to the front.
 */
function selectLead(party: readonly AnimalInstance[], animalId: unknown, realm: Realm): PartyStep {
	const from = indexOf(party, animalId);
	if (from < 0) return reject(party, 'unknown-animal');
	const animal = party[from]!;
	if (!canFightIn(animal.speciesId, realm)) return reject(party, 'cannot-fight-here', animal.id);
	if (animal.hp <= 0) return reject(party, 'tired', animal.id);
	if (leadIndex(party, realm) === from) return reject(party, 'already-lead', animal.id);

	return {
		party: moved(party, from, 0),
		events: [{ type: 'lead-selected', animalId: animal.id, from }]
	};
}

function reorder(party: readonly AnimalInstance[], animalId: unknown, to: unknown): PartyStep {
	const from = indexOf(party, animalId);
	if (from < 0) return reject(party, 'unknown-animal');
	const id = party[from]!.id;
	if (typeof to !== 'number' || !Number.isInteger(to) || to < 0 || to >= party.length) {
		return reject(party, 'no-such-slot', id);
	}
	if (to === from) return reject(party, 'already-there', id);
	return {
		party: moved(party, from, to),
		events: [{ type: 'reordered', animalId: id, from, to }]
	};
}

function rename(party: readonly AnimalInstance[], animalId: unknown, raw: unknown): PartyStep {
	const index = indexOf(party, animalId);
	if (index < 0) return reject(party, 'unknown-animal');
	if (typeof raw !== 'string') return reject(party, 'not-text', party[index]!.id);
	const nickname = normalizeNickname(raw);
	const next = party.map((a) => ({ ...a }));
	const animal = next[index]!;
	// No nickname is no key at all, as in a save, rather than `nickname: undefined`.
	delete animal.nickname;
	if (nickname !== undefined) animal.nickname = nickname;
	return {
		party: next,
		events: [
			nickname === undefined
				? { type: 'renamed', animalId: animal.id }
				: { type: 'renamed', animalId: animal.id, nickname }
		]
	};
}

/** A copy of the party with the animal in slot `from` moved to slot `to`. */
function moved(party: readonly AnimalInstance[], from: number, to: number): AnimalInstance[] {
	const next = party.map((a) => ({ ...a }));
	const [animal] = next.splice(from, 1);
	next.splice(to, 0, animal!);
	return next;
}

function indexOf(party: readonly AnimalInstance[], animalId: unknown): number {
	return typeof animalId === 'string' ? party.findIndex((a) => a.id === animalId) : -1;
}

function reject(
	party: readonly AnimalInstance[],
	reason: PartyRejection,
	animalId?: string
): PartyStep {
	const event: PartyEvent =
		animalId === undefined ? { type: 'rejected', reason } : { type: 'rejected', reason, animalId };
	return { party, events: [event] };
}
