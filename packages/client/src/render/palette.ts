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
	// The trainer: a kid in a coral shirt, blue shorts and a blue cap.
	playerShirt: 0xff7e6b,
	playerSkin: 0xffcfb0,
	playerShorts: 0x2f4fa8,
	playerCap: 0x3d7be8,
	// Shared animal details.
	white: 0xfff4e6,
	dark: 0x2f2a28,
	// The little cloud a tired animal lies down in: sandy, never grey smoke.
	dust: 0xe9dcc4
} as const;

/**
 * The caught celebration's confetti: colours already in the game — the UI
 * accent, good green, warn amber, water blue, the trainer's shirt, off-white
 * and the rabbit's pink ear.
 */
export const CONFETTI_COLORS: readonly number[] = [
	0xff9f43, 0x56c271, 0xf5b83d, 0x5ec8f2, 0xff7e6b, 0xfff4e6, 0xf5b8c4
];

/**
 * One fur colour per species, plus an accent used for the part that makes
 * the silhouette read (a fox's white tail tip, a rabbit's pink ear). Keyed by
 * the engine's species id.
 */
export const ANIMAL_COLORS: Record<string, { fur: number; accent: number }> = {
	squirrel: { fur: 0xc9733a, accent: 0xf2d9b8 },
	rabbit: { fur: 0xd9cbb8, accent: 0xf5b8c4 },
	fox: { fur: 0xe8762b, accent: 0xfff4e6 },
	otter: { fur: 0x8a5a3a, accent: 0xdbb98f },
	deer: { fur: 0xc48a52, accent: 0x6b4a2f },
	wolf: { fur: 0x7f858f, accent: 0xc5cad2 },
	bear: { fur: 0x5a3a28, accent: 0xb08560 }
};
