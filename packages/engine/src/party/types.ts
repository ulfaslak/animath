import type { AnimalInstance } from '../animals/types.js';

/**
 * What the player is doing when a party intent arrives. The party can be
 * changed only while exploring: a battle and a doctor visit each work on their
 * own copy of the party and write it back when they end, which would undo an
 * edit made in the meantime (or, mid-battle, put a different animal in front).
 */
export type PlayerActivity = 'explore' | 'battle' | 'doctor';

/**
 * What the player can do to their party, from the pause menu. Never an
 * outcome: the engine checks the intent and cleans up the name.
 */
export type PartyIntent =
	/**
	 * Move one animal to slot `to` (0-based); the animals in between close up.
	 * The first animal that is not tired leads in battle, so this is how the
	 * player picks who goes first.
	 */
	| { type: 'reorder'; animalId: string; to: number }
	/**
	 * Give an animal a name, exactly as typed. The engine cleans it up
	 * (`normalizeNickname`); when nothing usable is left, the nickname is
	 * cleared and the animal goes by its species' name again.
	 */
	| { type: 'rename'; animalId: string; nickname: string };

/** What one party intent did. */
export type PartyEvent =
	| { type: 'reordered'; animalId: string; from: number; to: number }
	/** `nickname` is the name as stored, after cleaning; null when the animal goes by its species' name. */
	| { type: 'renamed'; animalId: string; nickname: string | null }
	/** The intent did not fit. The party is unchanged. */
	| { type: 'rejected'; reason: string };

export interface PartyStep {
	party: readonly AnimalInstance[];
	events: readonly PartyEvent[];
}
