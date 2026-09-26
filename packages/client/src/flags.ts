import { ANIMALS, ITEM_IDS, type AnimalInstance, type ItemId } from '@mathgame/engine';

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
	 * `?party=bear:10,fox:0,rabbit*30`: start with this party instead of the
	 * one squirrel, in a throwaway game, like `?new`.
	 */
	party: AnimalInstance[] | null;
	/** `?new`: a throwaway game that loads and saves nothing; the saved game is left alone. */
	fresh: boolean;
	/**
	 * `?tokens=40`: start with this many tokens, in a throwaway game, like
	 * `?new`, to look at the doctor's shop. A whole number up to 9999; any
	 * other value ignores the switch.
	 */
	tokens: number | null;
	/**
	 * `?shop`: the doctor's shop sells every item of the catalog, on sale or
	 * not, in a throwaway game, to look at buying before any item is on sale.
	 * `null` without the switch.
	 */
	shop: ItemId[] | null;
	/**
	 * `?new`, `?party=`, `?zoo`, `?tokens=` or `?shop`: a throwaway game,
	 * straight into explore without the title. Nothing is loaded or saved, so
	 * a look at a screen never touches a kid's game.
	 */
	throwaway: boolean;
}

export function readFlags(search: string): Flags {
	const params = new URLSearchParams(search);
	const zoo = params.has('zoo') ? (params.get('zoo') === 'tired' ? 'tired' : 'standing') : null;
	const party = parseParty(params.get('party'));
	const fresh = params.has('new');
	const tokens = parseTokens(params.get('tokens'));
	const shop = params.has('shop') ? [...ITEM_IDS] : null;
	return {
		zoo,
		debug: params.has('debug'),
		party,
		fresh,
		tokens,
		shop,
		throwaway: fresh || party !== null || zoo !== null || tokens !== null || shop !== null
	};
}

/** The most animals `?party=` seeds: enough to look at any team a kid could catch. */
export const MAX_SEEDED_PARTY = 1000;

/** One `?party=` entry: a species id, an optional HP after `:`, an optional count after `*`. */
const PARTY_ENTRY = /^([^:*]+)(?::(-?\d+))?(?:\*(\d+))?$/;

/** `?tokens=`: a whole number of tokens from 0 to 9999, or null for anything else. */
export function parseTokens(text: string | null): number | null {
	if (text === null || !/^\d{1,4}$/.test(text)) return null;
	return Number(text);
}

/**
 * `species[:hp][*count]`, comma-separated (`bear:10,fox:0,rabbit*30`): the
 * species, its HP, and how many of it (`rabbit:0*5` is five tired rabbits).
 * HP defaults to full and is clamped to `0..maxHp`; the count defaults to
 * one. Anything else — an unknown species, an HP or a count that is not a
 * whole number, a count of 0, more than `MAX_SEEDED_PARTY` animals in all —
 * ignores the whole switch (`null`), so a typo starts an ordinary game. The
 * authority puts the party in species bundles (`bundled`), so
 * `rabbit,fox,rabbit` starts with the two rabbits together.
 */
export function parseParty(text: string | null): AnimalInstance[] | null {
	if (text === null) return null;
	const entries = text.split(',').filter((e) => e !== '');
	if (entries.length === 0) return null;
	const party: AnimalInstance[] = [];
	for (const entry of entries) {
		// Digits only (a minus allowed in the HP): `Number` would also take ' ', '1e1', '0x5' and '+3'.
		const match = PARTY_ENTRY.exec(entry);
		const spec = match && ANIMALS.find((a) => a.id === match[1]);
		if (!match || !spec) return null;
		const [, , hpText, countText] = match;
		const count = countText === undefined ? 1 : Number(countText);
		if (count < 1 || party.length + count > MAX_SEEDED_PARTY) return null;
		const hp = hpText === undefined ? spec.maxHp : Number(hpText);
		for (let k = 0; k < count; k++) {
			party.push({
				id: `party-${party.length + 1}`,
				speciesId: spec.id,
				hp: Math.max(0, Math.min(spec.maxHp, hp))
			});
		}
	}
	return party;
}

export const flags: Flags = readFlags(typeof location === 'undefined' ? '' : location.search);
