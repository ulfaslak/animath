import type { AnimalInstance } from '../animals/types.js';

/**
 * What the player is doing when a party intent arrives. The party can be
 * changed only while exploring: a battle and a doctor visit each work on their
 * own copy of the party and write it back when they end, which would undo an
 * edit made in the meantime (or, mid-battle, put a different animal in front).
 */
export type PlayerActivity = 'explore' | 'battle' | 'doctor';

/**
 * What the player can do to their party while exploring. Never an outcome:
 * the engine checks the intent and cleans up the name.
 *
 * The lead — the animal that steps into the next battle — is always the first
 * animal in party order that is not tired and can fight where the player
 * stands (`leadIndex`). There is no separate "selected" flag: choosing a lead
 * moves it to the front.
 */
export type PartyIntent =
	/**
	 * Choose who goes first: move this animal to the front of the party. Only an
	 * animal that is not tired, can fight where the player stands (out on the
	 * water, one that swims), and is not already the lead, can be chosen.
	 */
	| { type: 'select-lead'; animalId: string }
	/**
	 * Move one animal to slot `to` (0-based); the animals in between close up.
	 * Any animal can be moved, a tired one too: a tired animal at the front is
	 * skipped, and the first one standing leads.
	 */
	| { type: 'reorder'; animalId: string; to: number }
	/**
	 * Give an animal a name, exactly as typed. The engine cleans it up
	 * (`normalizeNickname`); when nothing usable is left, the nickname is
	 * cleared and the client shows the species' name again.
	 */
	| { type: 'rename'; animalId: string; nickname: string };

/**
 * Why a party intent was refused, as a code the client turns into words (the
 * engine holds no player-facing text).
 */
export type PartyRejection =
	/** Only while exploring: not in a battle or a doctor visit. */
	| 'not-exploring'
	| 'not-an-intent'
	| 'unknown-animal'
	/** `select-lead` on an animal with 0 HP. */
	| 'tired'
	/** `select-lead` on an animal that can't fight where the player stands: one that can't swim, out on the water. */
	| 'cannot-fight-here'

	/** `select-lead` on the animal that already leads. */
	| 'already-lead'
	/** `to` is not a whole number in `0..party.length - 1`. */
	| 'no-such-slot'
	/** `to` is where the animal already is. */
	| 'already-there'
	/** `nickname` is not a string. */
	| 'not-text';

/** What one party intent did. */
export type PartyEvent =
	/** The animal now leads: it moved from slot `from` to the front. */
	| { type: 'lead-selected'; animalId: string; from: number }
	| { type: 'reordered'; animalId: string; from: number; to: number }
	/** `nickname` is the name as stored, after cleaning; absent when the animal goes by its species' name. */
	| { type: 'renamed'; animalId: string; nickname?: string }
	/**
	 * The intent did not fit, and the party is unchanged. `animalId` is the
	 * animal it was about, when that animal is in the party (so the client can
	 * say "Rabbit is tired").
	 */
	| { type: 'rejected'; reason: PartyRejection; animalId?: string };

export interface PartyStep {
	party: readonly AnimalInstance[];
	events: readonly PartyEvent[];
}
