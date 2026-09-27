import { getAnimal } from '../animals/catalog.js';
import type { AnimalInstance } from '../animals/types.js';
import { normalizeNickname } from './names.js';

/**
 * Starting out ([[PRODUCT]] §4 "Starting out"): a new game begins with one
 * animal the player picks from the starters, the squirrel, the rabbit and the
 * frog, named here by id. They are tier-1 animals that can fight on land,
 * where a new game starts; the other small animals are caught, which is where
 * finding them belongs (#89: twelve small figures to choose from would make a
 * worse first minute). The rule is the engine's, so a server authority would
 * refuse exactly what the local one refuses. The engine mints no ids: the
 * starter comes back without one, and the authority gives it its own.
 */

/** The tier of every starter: the smallest animals, where the puzzle ladder begins. */
export const STARTER_TIER = 1;

/**
 * The species a new game can start with, by id, in catalog order: each a
 * tier-1 animal that can fight on land (`starters.test.ts`).
 */
export const STARTERS: readonly string[] = ['squirrel', 'rabbit', 'frog'];

/** Whether a new game may start with `speciesId`. */
export function isStarter(speciesId: unknown): boolean {
	return typeof speciesId === 'string' && STARTERS.includes(speciesId);
}

/**
 * Why a new game was refused, as a code the client may word (the engine
 * holds no player-facing text).
 */
export type NewGameRejection =
	/** Not a starter: not one of `STARTERS` (another species, or not an id at all). */
	| 'not-a-starter'
	/** A nickname came that is not text. */
	| 'not-text'
	/** A player's name came that `checkName` refuses. The authority's check. */
	| 'not-a-name'
	/** A game is under way: a new one starts only from the title. The authority's rule. */
	| 'game-in-progress';

/** A starter as the engine makes it: the animal without its id. */
export type Starter = Omit<AnimalInstance, 'id'>;

export type StarterPick = { ok: true; starter: Starter } | { ok: false; reason: NewGameRejection };

/**
 * The starter a choice from the starter screen gives: that species at full
 * HP, its nickname cleaned the way a rename cleans one (none when nothing
 * usable is left, so it goes by its species' name). Anything else in the
 * choice is ignored.
 */
export function chooseStarter(choice: unknown): StarterPick {
	if (typeof choice !== 'object' || choice === null) return { ok: false, reason: 'not-a-starter' };
	const { speciesId, nickname } = choice as Record<string, unknown>;
	if (!isStarter(speciesId)) return { ok: false, reason: 'not-a-starter' };
	if (nickname !== undefined && typeof nickname !== 'string') {
		return { ok: false, reason: 'not-text' };
	}
	const spec = getAnimal(speciesId as string);
	const clean = normalizeNickname(nickname);
	const starter: Starter = { speciesId: spec.id, hp: spec.maxHp };
	return { ok: true, starter: clean === undefined ? starter : { ...starter, nickname: clean } };
}
