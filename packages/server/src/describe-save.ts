import {
	FIRST_LAND,
	getLand,
	isLandId,
	readSave,
	saveSeq,
	type AnimalInstance
} from '@mathgame/engine';

/**
 * A save as the admin reads it, in one line (`admin import-save` prints it
 * for the account it made, [[DEVELOPMENT]] § Moving a kid's game to
 * production).
 */

/** A moment as the admin reads it: `2026-09-27 12:47:01 UTC`. */
export function stamp(at: Date): string {
	return `${at.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** The team by kind, in party order: `whale, frog ×2, rabbit "nini"`. */
function kinds(party: readonly AnimalInstance[]): string {
	const bySpecies = new Map<string, { count: number; nicknames: string[] }>();
	for (const animal of party) {
		const kind = bySpecies.get(animal.speciesId) ?? { count: 0, nicknames: [] };
		kind.count++;
		if (animal.nickname) kind.nicknames.push(`"${animal.nickname}"`);
		bySpecies.set(animal.speciesId, kind);
	}
	return [...bySpecies]
		.map(
			([species, { count, nicknames }]) =>
				`${species}${count > 1 ? ` ×${count}` : ''}${nicknames.length > 0 ? ` ${nicknames.join(' ')}` : ''}`
		)
		.join(', ');
}

/**
 * A save in one line: the name, the team (how many, and which), the tokens
 * and tools, where the player is, its `seq`, and when it was saved, when
 * that is known.
 */
export function describeSave(doc: unknown, savedAt?: Date): string {
	const saved = savedAt ? `, saved ${stamp(savedAt)}` : '';
	const read = readSave(doc);
	if (!read.ok) {
		return `a save this build cannot read (${read.reason}: ${read.error}), seq ${saveSeq(doc)}${saved}`;
	}
	const save = read.save;
	const items = save.items?.length ? save.items.join(', ') : 'no tools';
	const land = save.land ?? FIRST_LAND;
	const money =
		isLandId(land) && getLand(land).currency === 'ice-dollars' ? 'ice dollars' : 'tokens';
	// The lands left behind keep their own teams: an empty team here may be a first arrival.
	const left = (save.lands ?? [])
		.map((l) => `; in ${l.land} ${l.party.length} animals (${kinds(l.party)})`)
		.join('');
	return (
		`${save.name ?? '(no name)'}: in ${land} ${save.party.length} animals (${kinds(save.party)}), ` +
		`${save.tokens ?? 0} ${money}, ${items}, World ${save.world} at ${save.pos.x},${save.pos.y}` +
		`${left}, seq ${save.seq ?? 0}${saved}`
	);
}
