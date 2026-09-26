import type { Gear } from '../world/types.js';

/**
 * What the doctor's shop sells, for the tokens the doctor gives for animals
 * helped home ([[PRODUCT]] §4 "Tokens and the doctor's shop"). Ids only: an
 * item's name and what it does, in every language, are in the client's copy
 * files (`items.<id>.*`).
 *
 * A kid owns at most one of each item, for good: `SavedGame.items` lists the
 * ids owned, and `hasItem` is the one check an item's effect asks.
 */
export type ItemId = 'axe' | 'pickaxe' | 'boat';

export interface ItemSpec {
	id: ItemId;
	/** What it costs, in tokens. */
	price: number;
	/**
	 * On sale. The shop sells an item only once what it does is built, so no
	 * kid ever pays for a tool that does nothing; the change that builds an
	 * item's effect turns this on, and nothing else.
	 */
	available: boolean;
}

/**
 * The catalog, cheapest first. The prices put each within reach after about
 * 15, 25 and 40 minutes of ordinary play ([[PRODUCT]] §4 has the model).
 */
export const ITEMS: readonly ItemSpec[] = [
	/** Chops a tree down. */
	{ id: 'axe', price: 8, available: false },
	/** Breaks a rock. */
	{ id: 'pickaxe', price: 13, available: false },
	/** Sails on water. */
	{ id: 'boat', price: 21, available: false }
];

/** Every item id, in catalog order. */
export const ITEM_IDS: readonly ItemId[] = ITEMS.map((i) => i.id);

export function isItemId(value: unknown): value is ItemId {
	return typeof value === 'string' && (ITEM_IDS as readonly string[]).includes(value);
}

export function getItem(id: ItemId): ItemSpec {
	const item = ITEMS.find((i) => i.id === id);
	if (!item) throw new Error(`Unknown item: ${String(id)}`);
	return item;
}

/** What the doctor's shop sells: every item that is `available`, in catalog order. */
export function itemsForSale(): ItemId[] {
	return ITEMS.filter((i) => i.available).map((i) => i.id);
}

/**
 * Whether the player owns item `id`. Anything that holds the player's items
 * will do: a `SavedGame`, a `DoctorState`, the authority's own fields.
 */
export function hasItem(owner: { readonly items: readonly string[] }, id: ItemId): boolean {
	return owner.items.includes(id);
}

/** What the player's items let them do about where they go: the boat sails on water (`isPassable`). */
export function gearOf(owner: { readonly items: readonly string[] }): Gear {
	return { boat: hasItem(owner, 'boat') };
}

