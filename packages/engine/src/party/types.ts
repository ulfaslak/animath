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
 * The party is kept in species bundles (`bundles.ts`): every animal of a
 * species stands with the others of its kind, and the bundles stand in the
 * order the player chose. The lead — the animal that steps into the next
 * battle — is always the first animal in party order that is not tired and
 * can fight where the player stands (`leadIndex`): the first one standing in
 * the first bundle that has one, and out on the water the first one standing
 * that swims. There is no separate "selected" flag: choosing a lead moves it,
 * and its bundle, to the front. Every intent that moves an animal keeps the
 * party in bundles; a party that is not in bundles is put in them first, and
 * the slots an event names are the slots of that party in bundles.
 */
export type PartyIntent =
	/**
	 * Choose who goes first: this animal's bundle moves to the front of the
	 * party, and the animal to the front of its bundle. Only an animal that is
	 * not tired, can fight where the player stands (out on the water, one that
	 * swims), and is not already the lead there, can be chosen.
	 */
	| { type: 'select-lead'; animalId: string }
	/**
	 * Choose the bundle that goes first: its first animal standing leads, as
	 * `select-lead` of that animal would make it. Refused when the species
	 * can't fight where the player stands, every animal of it is tired, or one
	 * of them already leads there.
	 */
	| { type: 'lead-species'; speciesId: string }
	/**
	 * Move one animal to slot `to` (0-based) within its own bundle; the animals
	 * in between close up. Any animal can be moved, a tired one too: a tired
	 * animal at the front is skipped, and the first one standing leads.
	 */
	| { type: 'reorder'; animalId: string; to: number }
	/**
	 * Move the bundle of `speciesId`, every animal of that species, to place
	 * `to` (0-based) among the bundles; the bundles in between close up, and
	 * each bundle keeps its own order. A bundle of tired animals can move to
	 * the front too: the first animal standing after it leads.
	 */
	| { type: 'move-species'; speciesId: string; to: number }
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
	/** No animal of that species is in the party. */
	| 'unknown-species'
	/** `select-lead` on an animal with 0 HP; `lead-species` when every animal of the species is. */
	| 'tired'
	/**
	 * `select-lead` on an animal, or `lead-species` on a species, that can't
	 * fight where the player stands: one that can't swim, out on the water.
	 */
	| 'cannot-fight-here'
	/** `select-lead` on the animal that already leads; `lead-species` when one of its kind does. */
	| 'already-lead'
	/** `to` is not a whole number naming a slot of the animal's bundle, or a place among the bundles. */
	| 'no-such-slot'
	/** `to` is where the animal, or the bundle, already is. */
	| 'already-there'
	/** `nickname` is not a string. */
	| 'not-text';

/** What one party intent did. */
export type PartyEvent =
	/**
	 * The animal now leads: it moved from slot `from` to the front, its bundle
	 * with it (`select-lead`, or `lead-species`, which chose it).
	 */
	| { type: 'lead-selected'; animalId: string; from: number }
	/** The animal moved from slot `from` to slot `to`, within its bundle. */
	| { type: 'reordered'; animalId: string; from: number; to: number }
	/** The species' bundle moved from place `from` to place `to` among the bundles. */
	| { type: 'species-moved'; speciesId: string; from: number; to: number }
	/** `nickname` is the name as stored, after cleaning; absent when the animal goes by its species' name. */
	| { type: 'renamed'; animalId: string; nickname?: string }
	/**
	 * The intent did not fit, and the party is unchanged. `animalId` is the
	 * animal it was about, when that animal is in the party (so the client can
	 * say "Rabbit is tired"), and `speciesId` the species, for an intent about a
	 * bundle (so it can say that all of them are). `already-lead` names the
	 * animal that leads.
	 */
	| { type: 'rejected'; reason: PartyRejection; animalId?: string; speciesId?: string };

export interface PartyStep {
	party: readonly AnimalInstance[];
	events: readonly PartyEvent[];
}
