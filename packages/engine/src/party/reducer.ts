import { canFightIn } from '../animals/catalog.js';
import type { AnimalInstance, Realm } from '../animals/types.js';
import { bundled, bundles } from './bundles.js';
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
 * Apply one party intent: choose the lead (an animal, or a bundle's first
 * animal standing), move an animal within its bundle, move a bundle, or name
 * an animal.
 *
 * Pure: the input party is never changed, and an accepted intent returns a
 * new party (fresh animal objects, same ids, HP and species), in bundles. An
 * intent that does not fit — anything outside explore, an animal or a
 * species not in the party, a tired animal chosen to lead, a slot off its
 * bundle, a move to where it already is — returns the same party reference
 * with a single `rejected` event.
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
		case 'lead-species':
			return leadSpecies(party, intent.speciesId, realm);
		case 'reorder':
			return reorder(party, intent.animalId, intent.to);
		case 'move-species':
			return moveSpecies(party, intent.speciesId, intent.to);
		case 'rename':
			return rename(party, intent.animalId, intent.nickname);
		default:
			return reject(party, 'not-an-intent');
	}
}

/**
 * Choose who goes first where the player stands: an animal that can fight
 * there (out on the water, one that swims) and isn't tired goes to the front.
 */
function selectLead(party: readonly AnimalInstance[], animalId: unknown, realm: Realm): PartyStep {
	const base = bundled(party);
	const from = indexOf(base, animalId);
	if (from < 0) return reject(party, 'unknown-animal');
	const animal = base[from]!;
	if (!canFightIn(animal.speciesId, realm)) {
		return reject(party, 'cannot-fight-here', { animalId: animal.id });
	}
	if (animal.hp <= 0) return reject(party, 'tired', { animalId: animal.id });
	if (leadIndex(base, realm) === from) return reject(party, 'already-lead', { animalId: animal.id });
	return leadFrom(base, from);
}

function leadSpecies(party: readonly AnimalInstance[], speciesId: unknown, realm: Realm): PartyStep {
	const base = bundled(party);
	if (typeof speciesId !== 'string' || !base.some((a) => a.speciesId === speciesId)) {
		return reject(party, 'unknown-species');
	}
	if (!canFightIn(speciesId, realm)) return reject(party, 'cannot-fight-here', { speciesId });
	const lead = base[leadIndex(base, realm)];
	if (lead?.speciesId === speciesId) {
		return reject(party, 'already-lead', { animalId: lead.id, speciesId });
	}
	const from = base.findIndex((a) => a.speciesId === speciesId && a.hp > 0);
	if (from < 0) return reject(party, 'tired', { speciesId });
	return leadFrom(base, from);
}

/**
 * `base[from]` goes first: its bundle moves to the front, and it to the
 * front of its bundle; every other animal keeps its order.
 */
function leadFrom(base: readonly AnimalInstance[], from: number): PartyStep {
	const animal = base[from]!;
	const kin = base.filter((a) => a.speciesId === animal.speciesId && a !== animal);
	const rest = base.filter((a) => a.speciesId !== animal.speciesId);
	return {
		party: [animal, ...kin, ...rest].map((a) => ({ ...a })),
		events: [{ type: 'lead-selected', animalId: animal.id, from }]
	};
}

function reorder(party: readonly AnimalInstance[], animalId: unknown, to: unknown): PartyStep {
	const base = bundled(party);
	const from = indexOf(base, animalId);
	if (from < 0) return reject(party, 'unknown-animal');
	const { id, speciesId } = base[from]!;
	// The animal's bundle: the slots of its species, one after another in a party in bundles.
	const first = base.findIndex((a) => a.speciesId === speciesId);
	let last = first;
	while (base[last + 1]?.speciesId === speciesId) last++;
	if (typeof to !== 'number' || !Number.isInteger(to) || to < first || to > last) {
		return reject(party, 'no-such-slot', { animalId: id });
	}
	if (to === from) return reject(party, 'already-there', { animalId: id });
	return {
		party: moved(base, from, to),
		events: [{ type: 'reordered', animalId: id, from, to }]
	};
}

function moveSpecies(party: readonly AnimalInstance[], speciesId: unknown, to: unknown): PartyStep {
	// The bundles of the party in bundles, as every other move sees it.
	const list = bundles(bundled(party));
	const from = list.findIndex((b) => b.speciesId === speciesId);
	if (typeof speciesId !== 'string' || from < 0) return reject(party, 'unknown-species');
	if (typeof to !== 'number' || !Number.isInteger(to) || to < 0 || to >= list.length) {
		return reject(party, 'no-such-slot', { speciesId });
	}
	if (to === from) return reject(party, 'already-there', { speciesId });
	const [bundle] = list.splice(from, 1);
	list.splice(to, 0, bundle!);
	return {
		party: list.flatMap((b) => b.animals).map((a) => ({ ...a })),
		events: [{ type: 'species-moved', speciesId, from, to }]
	};
}

function rename(party: readonly AnimalInstance[], animalId: unknown, raw: unknown): PartyStep {
	const index = indexOf(party, animalId);
	if (index < 0) return reject(party, 'unknown-animal');
	if (typeof raw !== 'string') return reject(party, 'not-text', { animalId: party[index]!.id });
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
	about: { animalId?: string; speciesId?: string } = {}
): PartyStep {
	const event: PartyEvent = { type: 'rejected', reason, ...about };
	return { party, events: [event] };
}
