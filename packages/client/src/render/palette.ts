import type { TileKind } from '@mathgame/engine';

/** Flat, saturated, cheerful. Hex values mirror AGENTS/DNA/DESIGN.md § Palette. */
export const TILE_COLORS: Record<TileKind, number> = {
	grass: 0x8bd66b,
	tallgrass: 0x63b94a,
	sand: 0xf3d9a4,
	water: 0x5ec8f2,
	rock: 0xa8a39e,
	tree: 0x8bd66b, // ground under the tree
	tent: 0x8bd66b
};

export const COLORS = {
	sky: 0x8fd3f4,
	trunk: 0x8b5a3c,
	canopy: 0x3e9e4f,
	canopyLight: 0x62bf5f,
	rock: 0x8e8a86,
	tentCloth: 0xf2a65a,
	tentDoor: 0xd47c2a,
	fire: 0xffb347,
	player: 0xff7e6b,
	playerHead: 0xffb3a7
} as const;
