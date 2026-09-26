import type { Biome } from '../animals/types.js';

export const CHUNK_SIZE = 16;

export type TileKind = 'grass' | 'tallgrass' | 'sand' | 'water' | 'rock' | 'tree' | 'tent';

/** The tiles a tool can clear: a tree (the axe) and a rock (the pickaxe). See `world/edits.ts`. */
export type ClearableKind = 'tree' | 'rock';

export interface Tile {
	kind: TileKind;
	biome: Biome;
	/** Ground height in tile units; water is 0, hills rise above. Purely visual for now. */
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
 * Ground a player can stand on. A doctor's tent is solid: the player talks to
 * the doctor from the tile beside it (see `world/tents.ts`), never inside it.
 */
export function isWalkable(kind: TileKind): boolean {
	return kind === 'grass' || kind === 'tallgrass' || kind === 'sand';
}

/** Tiles where wild animals may appear. */
export function isEncounterTile(kind: TileKind): boolean {
	return kind === 'tallgrass';
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
