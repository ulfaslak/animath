import type { AnimalInstance } from '../animals/types.js';
import { normalizeNickname } from './names.js';
import type { PartyIntent, PartyStep, PlayerActivity } from './types.js';

/**
 * The animal that steps into the next battle: the first one in party order
 * that is not tired. -1 when every animal is tired. The battle reducer uses
 * the same function for who starts and who steps in after a knock-out, so the
 * party card marked as the lead is always the one that fights.
 */
export function leadIndex(party: readonly AnimalInstance[]): number {
	return party.findIndex((a) => a.hp > 0);
}

/**
 * Apply one party intent: move an animal to another slot, or name it.
 *
 * Pure: the input party is never changed, and an accepted intent returns a
 * new party (fresh animal objects, same ids, HP and species). An intent that
 * does not fit — anything outside explore, an animal not in the party, a slot
 * off the end, a move to where the animal already is — returns the same
 * party reference with a single `rejected` event.
 */
export function applyPartyIntent(
	party: readonly AnimalInstance[],
	intent: PartyIntent,
	activity: PlayerActivity
): PartyStep {
	if (activity !== 'explore') {
		return reject(party, activity === 'battle' ? 'Not during a battle.' : 'Only while exploring.');
	}
	if (!intent || typeof intent !== 'object') return reject(party, 'That is not an intent.');
	switch (intent.type) {
		case 'reorder':
			return reorder(party, intent.animalId, intent.to);
		case 'rename':
			return rename(party, intent.animalId, intent.nickname);
		default:
			return reject(party, `Unknown intent ${String((intent as { type: unknown }).type)}.`);
	}
}

function reorder(party: readonly AnimalInstance[], animalId: unknown, to: unknown): PartyStep {
	const from = indexOf(party, animalId);
	if (from < 0) return reject(party, 'That animal is not in your team.');
	if (typeof to !== 'number' || !Number.isInteger(to) || to < 0 || to >= party.length) {
		return reject(party, `Your team has no place ${String(to)}.`);
	}
	if (to === from) return reject(party, 'It is already there.');
	const next = party.map((a) => ({ ...a }));
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved!);
	return { party: next, events: [{ type: 'reordered', animalId: moved!.id, from, to }] };
}

function rename(party: readonly AnimalInstance[], animalId: unknown, raw: unknown): PartyStep {
	const index = indexOf(party, animalId);
	if (index < 0) return reject(party, 'That animal is not in your team.');
	if (typeof raw !== 'string') return reject(party, 'A name is made of letters.');
	const nickname = normalizeNickname(raw);
	const next = party.map((a) => ({ ...a }));
	const animal = next[index]!;
	delete animal.nickname;
	if (nickname !== null) animal.nickname = nickname;
	return { party: next, events: [{ type: 'renamed', animalId: animal.id, nickname }] };
}

function indexOf(party: readonly AnimalInstance[], animalId: unknown): number {
	return typeof animalId === 'string' ? party.findIndex((a) => a.id === animalId) : -1;
}

function reject(party: readonly AnimalInstance[], reason: string): PartyStep {
	return { party, events: [{ type: 'rejected', reason }] };
}
