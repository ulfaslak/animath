import type { Gear } from '../world/types.js';

/**
 * What the witch doctors' shops sell, for the money each land's witch doctor
 * gives for animals set free ([[PRODUCT]] §4 "Tokens and the witch doctor's
 * shop", "The Arctic's shop"). Ids only: an item's name and what it does, in
 * every language, are in the client's copy files (`items.<id>.*`). Which land
 * sells an item, and for how much of its money, is the land's (`LandSpec.shop`,
 * `priceIn`).
 *
 * A kid owns at most one of each item, for good, in the land they bought it
 * in: `SavedGame.items` lists the ids owned, and `hasItem` is the one check an
 * item's effect asks.
 */
export type ItemId =
	'axe' | 'pickaxe' | 'boat' | 'glider' | 'harness' | 'arctic-axe' | 'ice-pick' | 'fishing-rod';

export interface ItemSpec {
	id: ItemId;
	/**
	 * On sale. The shop sells an item only once what it does is built, so no
	 * kid ever pays for a tool that does nothing; the change that builds an
	 * item's effect turns this on, and nothing else.
	 */
	available: boolean;
}

/**
 * The catalog: Nordland's tools, then The Arctic's own. What each costs is
 * the land's that sells it (`LandSpec.shop`).
 */
export const ITEMS: readonly ItemSpec[] = [
	/** Chops a tree down in Nordland (`world/clearing.ts`). */
	{ id: 'axe', available: true },
	/** Breaks a rock (`world/clearing.ts`). */
	{ id: 'pickaxe', available: true },
	/** Sails on water: water is `isPassable` with it (`gearOf`). */
	{ id: 'boat', available: true },
	/** Glides up to 20 tiles over anything, and comes down where the kid can stand (`world/flight.ts`). */
	{ id: 'glider', available: true },
	/** Rides on the lead's back on land, when it is big enough to carry a kid (`canRide`). */
	{ id: 'harness', available: true },
	/** Chops a tree down in The Arctic: its own axe, never Nordland's (`world/clearing.ts`). */
	{ id: 'arctic-axe', available: true },
	/** Breaks an ice block, on land or afloat; on the ice it leaves a fishing hole (`world/clearing.ts`). */
	{ id: 'ice-pick', available: true },
	/**
	 * Fishes at a fishing hole (`world/fishing.ts`). On sale since #192's third
	 * wave brought the animals that live under the ice to hook.
	 */
	{ id: 'fishing-rod', available: true }
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
