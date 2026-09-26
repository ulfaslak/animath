import type { Biome, TileKind } from '@mathgame/engine';

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
	// The little cloud a tired animal lies down in: a warm near-white, never grey smoke.
	dust: 0xf6efe2
} as const;

/**
 * How each biome looks, so a kid can tell where they are at a glance: its
 * ground, and its encounter tiles. Tall grass is always a patch darker and
 * greener than the ground round it, with blades standing up in it; the
 * river's is a reed bed on the sand, yellower, with tall reeds.
 */
export interface BiomeLook {
	/** Plain ground: grass, and the ground under a tree or a tent. */
	ground: number;
	/** The ground of an encounter tile. */
	tallgrass: number;
	/** The blades (or reeds) standing in it. */
	blade: number;
}

export const BIOME_LOOK: Record<Biome, BiomeLook> = {
	meadow: { ground: TILE_COLORS.grass, tallgrass: TILE_COLORS.tallgrass, blade: 0x4fa83d },
	// A darker floor under the trees.
	forest: { ground: 0x68b258, tallgrass: 0x4b9a44, blade: 0x357d33 },
	// Sand, and reed beds yellower and lighter than the meadow's tall grass, so reeds never read as it.
	river: { ground: TILE_COLORS.sand, tallgrass: 0x9fc45c, blade: 0x5e9233 },
	// Grey-green turf, paler and greyer than any meadow.
	mountain: { ground: 0xa6b88f, tallgrass: 0x7b9b5a, blade: 0x587d3c }
};

/** Trees grow only in the forest: three dark greens, mixed at random, so it reads as deep woods. */
export const CANOPY: readonly number[] = [0x2c7a43, 0x3a8f4c, 0x2f8a55];

/** What else grows or lies about: rocks, snow on the peaks, reeds' heads, bushes, flowers. */
export const PROP_COLORS = {
	/** A mountain boulder's second grey (the first is `COLORS.rock`), and the pebbles on its turf. */
	boulderLight: 0xa39e98,
	pebble: 0x97928c,
	/** The snow cap on the highest boulders: a cool white, never the figures' warm one. */
	snow: 0xf3f6f4,
	/** Rock tiles high on a mountain, paler round the snow. */
	rockHigh: 0xbdb9b4,
	/** Where a rock was broken: gravel, warmer and lighter than the rock, so it reads as a path. */
	gravel: 0xc9c0ad,
	/** The same high on a mountain, paler like the peaks' rock. */
	gravelHigh: 0xd8d3ca,
	/** Fresh wood: the cut face of a stump, and the chips an axe sends flying. */
	wood: 0xe8c48f,
	/** A reed's head: the trunks' brown. */
	cattail: COLORS.trunk,
	/** Round bushes at the foot of the forest's trees. */
	bush: [0x2f7d44, 0x3b8a47] as readonly number[],
	/** Flowers in the meadow: off-white, the trainer's coral, the fire's amber. */
	flower: [COLORS.white, COLORS.playerShirt, COLORS.fire] as readonly number[]
} as const;

/**
 * The caught celebration's confetti: colours already in the game — the UI
 * accent, good green, warn amber, water blue, the trainer's shirt, off-white
 * and the rabbit's pink ear.
 */
export const CONFETTI_COLORS: readonly number[] = [
	0xff9f43, 0x56c271, 0xf5b83d, 0x5ec8f2, 0xff7e6b, 0xfff4e6, 0xf5b8c4
];

/** The butterflies' wings: the rabbit's pink, amber, off-white, the trainer's coral, the sky's blue. */
export const BUTTERFLY_COLORS: readonly number[] = [
	0xf5b8c4, 0xf5b83d, 0xfff4e6, 0xff7e6b, 0x8fd3f4
];

/** The stars that twinkle round a caught animal or a winner: the doctor's gold, green and white. */
export const SPARKLE_COLORS: readonly number[] = [0xf5b83d, 0x56c271, 0xfff4e6];

/**
 * One fur colour per species, plus an accent used for the part that makes
 * the silhouette read (a fox's white tail tip, a rabbit's pink ear). Keyed by
 * the engine's species id.
 */
export const ANIMAL_COLORS: Record<string, { fur: number; accent: number }> = {
	squirrel: { fur: 0xc9733a, accent: 0xf2d9b8 },
	rabbit: { fur: 0xd9cbb8, accent: 0xf5b8c4 },
	frog: { fur: 0x3aa66a, accent: 0xe3eea4 },
	fox: { fur: 0xe8762b, accent: 0xfff4e6 },
	otter: { fur: 0x8a5a3a, accent: 0xdbb98f },
	deer: { fur: 0xc48a52, accent: 0x6b4a2f },
	wolf: { fur: 0x7f858f, accent: 0xc5cad2 },
	bear: { fur: 0x5a3a28, accent: 0xb08560 }
};
