import { ANIMALS, MAX_PARTY, type AnimalInstance } from '@mathgame/engine';

/**
 * The page's URL switches, read once at load. None is a setting a player
 * needs: each exists to look at something (CHEATSHEET § Hidden behaviour).
 */
export interface Flags {
	/**
	 * `?zoo`: one of every species stands by the spawn tile, to check the
	 * figures; `?zoo=tired` lays every one of them down to rest, as a tired
	 * animal lies in a battle. A throwaway game. `null` without the switch.
	 */
	zoo: 'standing' | 'tired' | null;
	/** `?debug`: the player's grid position and facing in the top-right corner. */
	debug: boolean;
	/**
	 * `?party=bear:10,fox:0,rabbit`: start with this party instead of the one
	 * squirrel, in a throwaway game, like `?new`.
	 */
	party: AnimalInstance[] | null;
	/** `?new`: a throwaway game that loads and saves nothing; the saved game is left alone. */
	fresh: boolean;
	/**
	 * `?new`, `?party=` or `?zoo`: a throwaway game, straight into explore
	 * without the title. Nothing is loaded or saved, so a look at a screen
	 * never touches a kid's game.
	 */
	throwaway: boolean;
}

export function readFlags(search: string): Flags {
	const params = new URLSearchParams(search);
	const zoo = params.has('zoo') ? (params.get('zoo') === 'tired' ? 'tired' : 'standing') : null;
	const party = parseParty(params.get('party'));
	const fresh = params.has('new');
	return {
		zoo,
		debug: params.has('debug'),
		party,
		fresh,
		throwaway: fresh || party !== null || zoo !== null
	};
}

/**
 * `species[:hp]`, comma-separated, one to six of them (`bear:10,fox:0,rabbit`).
 * HP defaults to full and is clamped to `0..maxHp`. Anything else — an unknown
 * species, an HP that is not a whole number, more than six — ignores the
 * whole switch (`null`), so a typo starts an ordinary game.
 */
export function parseParty(text: string | null): AnimalInstance[] | null {
	if (text === null) return null;
	const entries = text.split(',').filter((e) => e !== '');
	if (entries.length === 0 || entries.length > MAX_PARTY) return null;
	const party: AnimalInstance[] = [];
	for (const [i, entry] of entries.entries()) {
		const [speciesId, hpText, ...rest] = entry.split(':');
		const spec = ANIMALS.find((a) => a.id === speciesId);
		if (!spec || rest.length > 0) return null;
		// Digits only (a minus allowed): `Number` would also take ' ', '1e1', '0x5' and '+3'.
		if (hpText !== undefined && !/^-?\d+$/.test(hpText)) return null;
		const hp = hpText === undefined ? spec.maxHp : Number(hpText);
		party.push({
			id: `party-${i + 1}`,
			speciesId: spec.id,
			hp: Math.max(0, Math.min(spec.maxHp, hp))
		});
	}
	return party;
}

export const flags: Flags = readFlags(typeof location === 'undefined' ? '' : location.search);
