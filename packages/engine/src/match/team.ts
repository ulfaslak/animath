import { ANIMALS, canFightIn, getAnimal } from '../animals/catalog.js';
import type { AnimalInstance } from '../animals/types.js';
import { isRude } from '../names.js';
import { normalizeNickname } from '../party/names.js';
import { MAX_SAVE_ID_LENGTH } from '../save.js';
import type { TeamPick } from './types.js';

/** How many animals a side brings to a match, at most. */
export const MATCH_TEAM_SIZE = 3;

const SPECIES_IDS: ReadonlySet<string> = new Set(ANIMALS.map((a) => a.id));

/**
 * The team a party brings to a friendly match ([[PRODUCT]] §4 "Friendly
 * matches"): its first `MATCH_TEAM_SIZE` animals in party order that can
 * fight on land, tired ones too, each a fresh copy at full HP with its
 * nickname cleaned (`normalizeNickname`). Fewer when the party has fewer.
 * The other player sees these nicknames, the one piece of text a kid types
 * that crosses to another kid, so one holding a rude word (`isRude`, the
 * name rules' list) is dropped: that animal goes by its species' name.
 *
 * Takes anything, because the authority calls it on the party a client sent:
 * each entry it looks at, in order until the team is full, must be an animal
 * (an object with an id of 1–64 characters and a known species, no id
 * repeated), or the whole party is refused (`not-a-party`). It checks shape,
 * not history: the server trusts the party a client sends, as it trusts where
 * the player stands, because a match changes nothing and a forged team wins
 * nothing that lasts. HP is not read: everyone comes at full HP. A party with
 * no animal that can fight on land brings no team (`no-team`). Only the team's
 * own nicknames are cleaned, so what it costs grows with the number of entries
 * and not with the text in the ones it passes over.
 *
 * Pure and idempotent: the input is never changed, and a team given back to
 * it comes back the same, so an authority can take either a party or a team.
 */
export function matchTeam(party: unknown): TeamPick {
	if (!Array.isArray(party)) return { ok: false, reason: 'not-a-party' };
	const team: AnimalInstance[] = [];
	const ids = new Set<string>();
	for (const entry of party as readonly unknown[]) {
		if (team.length === MATCH_TEAM_SIZE) break;
		const animal = readAnimal(entry);
		if (animal === null || ids.has(animal.id)) return { ok: false, reason: 'not-a-party' };
		ids.add(animal.id);
		if (canFightIn(animal.speciesId, 'land')) team.push(teamMember(animal));
	}
	return team.length > 0 ? { ok: true, team } : { ok: false, reason: 'no-team' };
}

interface Entry {
	id: string;
	speciesId: string;
	/** As sent: cleaned only if the animal joins the team. */
	nickname: unknown;
}

/** One entry of a party, if it is an animal: an id of 1–64 characters and a known species. */
function readAnimal(entry: unknown): Entry | null {
	if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
	const { id, speciesId, nickname } = entry as Record<string, unknown>;
	if (typeof id !== 'string' || id.length === 0 || id.length > MAX_SAVE_ID_LENGTH) return null;
	if (typeof speciesId !== 'string' || !SPECIES_IDS.has(speciesId)) return null;
	return { id, speciesId, nickname };
}

/**
 * A fresh team member: full HP, the nickname cleaned, none when nothing is
 * left of it or it holds a rude word.
 */
function teamMember({ id, speciesId, nickname }: Entry): AnimalInstance {
	const hp = getAnimal(speciesId).maxHp;
	const clean = normalizeNickname(nickname);
	return clean === undefined || isRude(clean)
		? { id, speciesId, hp }
		: { id, speciesId, nickname: clean, hp };
}
