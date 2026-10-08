import type { Biome, Realm } from '../animals/types.js';

export const CHUNK_SIZE = 16;

/**
 * Deep water is water whose every tile within this many tiles, diagonals
 * included, is water too: the 5×5 square round it. So the shallows along
 * every shore are at least two tiles wide, a river narrower than five tiles
 * has no deep water, and deep water is at least three steps from any land.
 */
export const DEEP_WATER_MARGIN = 2;

/**
 * What a tile is. `water` is the shallows along every shore; `deepwater` is
 * water with water all round it, `DEEP_WATER_MARGIN` tiles out (the middle
 * of a lake, the sea biome). Both are the player's only with a boat.
 *
 * The Arctic's own (#191; `world/arctic.ts`): `snow`, its plain ground;
 * `deepsnow`, its tall grass, where animals hide; `ice`, a frozen lake or
 * the sea ice over the water, where a step slides on (`world/slide.ts`);
 * `iceblock`, a block of ice that stops a walk, a boat and a slide alike,
 * standing on snow, on the ice or out in the water (`Tile.under`); and
 * `hole`, a fishing hole in the ice, which a kid faces and never steps into.
 */
export type TileKind =
	| 'grass'
	| 'tallgrass'
	| 'sand'
	| 'water'
	| 'deepwater'
	| 'rock'
	| 'tree'
	| 'tent'
	| 'snow'
	| 'deepsnow'
	| 'ice'
	| 'iceblock'
	| 'hole';

/** What an ice block stands on: snow on land, the ice of a lake or the sea, or open water. */
export type IceBlockGround = 'snow' | 'ice' | 'water';

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
	/**
	 * What an ice block (`iceblock`) stands on, so the renderer draws it there
	 * and the ice pick (#191 step 6) knows what it leaves: snow, a fishing hole
	 * in the ice, or water. Absent on every other tile.
	 */
	under?: IceBlockGround;
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
	return (
		kind === 'grass' ||
		kind === 'tallgrass' ||
		kind === 'sand' ||
		kind === 'snow' ||
		kind === 'deepsnow' ||
		kind === 'ice'
	);
}

/**
 * A land's plain ground, nothing growing on it: Nordland's grass and The
 * Arctic's snow. What a spawn stands on, and what a tool leaves where it
 * cleared a tile (`clearedTile`).
 */
export function isPlainGround(kind: TileKind): boolean {
	return kind === 'grass' || kind === 'snow';
}

/** Ice a step slides on: a frozen lake or the sea ice (`world/slide.ts`). */
export function isIce(kind: TileKind): boolean {
	return kind === 'ice';
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
	// The Arctic's deep snow is its tall grass; the ice, sliding by, starts nothing.
	if (kind === 'tallgrass' || kind === 'deepsnow') return 'land';
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
