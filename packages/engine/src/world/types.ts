import type { Biome, Realm } from '../animals/types.js';

export const CHUNK_SIZE = 16;

/**
 * What a tile is. `water` is the shallows along every shore; `deepwater` is
 * water with water all round it, `DEEP_WATER_MARGIN` tiles out (the middle
 * of a lake, the sea biome). Both are the player's only with a boat.
 */
export type TileKind =
	'grass' | 'tallgrass' | 'sand' | 'water' | 'deepwater' | 'rock' | 'tree' | 'tent';

/** The tiles a tool can clear: a tree (the axe) and a rock (the pickaxe). See `world/edits.ts`. */
export type ClearableKind = 'tree' | 'rock';

export interface Tile {
	kind: TileKind;
	biome: Biome;
	/** Ground height in tile units; water, shallow or deep, is 0, hills rise above. Purely visual for now. */
	height: number;
	/**
	 * What a tool took from this tile: a tree chopped down or a rock broken
	 * (`world/edits.ts`). The tile is plain ground (`grass`) from then on, and
	 * this says what the renderer draws on it: a stump, or gravel. Absent on
	 * every tile of the seeded world itself.
	 */
	cleared?: ClearableKind;
}

export interface Chunk {
	cx: number;
	cy: number;
	/** Row-major, `CHUNK_SIZE × CHUNK_SIZE`; index = y * CHUNK_SIZE + x. */
	tiles: Tile[];
}

/**
 * Ground a player can stand on, on foot. A doctor's tent is solid: the
 * player talks to the doctor from the tile beside it (see `world/tents.ts`),
 * never inside it. Water takes a boat (`isPassable`).
 */
export function isWalkable(kind: TileKind): boolean {
	return kind === 'grass' || kind === 'tallgrass' || kind === 'sand';
}

/** Water, shallow or deep. */
export function isWater(kind: TileKind): boolean {
	return kind === 'water' || kind === 'deepwater';
}

/** Where a player standing on a tile of this kind is: out on the water, or on land. */
export function tileRealm(kind: TileKind): Realm {
	return isWater(kind) ? 'water' : 'land';
}

/** What the player carries that changes where they can go: `gearOf` reads it off what they own. */
export interface Gear {
	/** The boat: water, shallow and deep, is theirs to sail. */
	readonly boat: boolean;
}

/** Gear of a player who owns nothing that changes where they go. */
export const NO_GEAR: Gear = { boat: false };

/**
 * Where a player with `gear` can go: walkable ground on foot, and with the
 * boat the water too. The one check behind every move, and behind where a
 * saved player may stand and the way to the nearest doctor.
 */
export function isPassable(kind: TileKind, gear: Gear = NO_GEAR): boolean {
	return isWalkable(kind) || (gear.boat && isWater(kind));
}

/**
 * Where an encounter on a tile of this kind happens, or null where none can:
 * tall grass (the river's reeds included) is land, and deep water, out in the
 * sea, is water, where only the species living in that realm come out. The
 * shallows along a shore are nobody's: crossing a river starts no battle.
 */
export function encounterRealm(kind: TileKind): Realm | null {
	if (kind === 'tallgrass') return 'land';
	return kind === 'deepwater' ? 'water' : null;
}

/** Tiles where wild animals may appear. */
export function isEncounterTile(kind: TileKind): boolean {
	return encounterRealm(kind) !== null;
}

export interface GridPos {
	x: number;
	y: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export function step(pos: GridPos, dir: Direction): GridPos {
	switch (dir) {
		case 'up':
			return { x: pos.x, y: pos.y - 1 };
		case 'down':
			return { x: pos.x, y: pos.y + 1 };
		case 'left':
			return { x: pos.x - 1, y: pos.y };
		case 'right':
			return { x: pos.x + 1, y: pos.y };
	}
}
