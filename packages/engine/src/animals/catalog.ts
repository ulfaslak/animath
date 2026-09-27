import type { AnimalSpec, Realm } from './types.js';

/**
 * The species catalog. Placeholder roster for the prototype — the real one
 * grows with art. Ordering of `attacks` matters: index 1 is weakest.
 * Species and attacks have ids, never names: what a player calls them is in
 * the client's copy files (`species.<id>.name`, `species.<id>.attacks.<id>`).
 * Where each one lives — its biomes, its realms and the ground it favours —
 * is [[PRODUCT]] §4 "Wild encounters", with a reason for each.
 */
export const ANIMALS: readonly AnimalSpec[] = [
	{
		id: 'squirrel',
		tier: 1,
		maxHp: 20,
		catchRate: 0.9,
		habitats: ['meadow', 'forest'],
		realms: ['land'],
		favours: 'trees',
		attacks: [
			{ id: 'nut-toss', kinds: ['add', 'sub'], power: 4 },
			{ id: 'scurry-kick', kinds: ['add', 'sub', 'missing'], power: 6 }
		]
	},
	{
		id: 'rabbit',
		tier: 1,
		maxHp: 22,
		catchRate: 0.85,
		habitats: ['meadow'],
		realms: ['land'],
		favours: 'open',
		attacks: [
			{ id: 'hop', kinds: ['add'], power: 4 },
			{ id: 'thump', kinds: ['sub', 'missing'], power: 6 },
			{ id: 'burrow-bite', kinds: ['sequence'], power: 8 }
		]
	},
	{
		// A tier-1 animal of the river (with the brown rat and the toad since #89).
		// It counts in hops: sequences and times tables, where the squirrel and the
		// rabbit ask sums.
		id: 'frog',
		tier: 1,
		maxHp: 21,
		catchRate: 0.8,
		habitats: ['river'],
		realms: ['land', 'water'],
		favours: 'water',
		attacks: [
			{ id: 'croak', kinds: ['sequence'], power: 4 },
			{ id: 'tongue-flick', kinds: ['mul'], power: 5 },
			{ id: 'big-splash', kinds: ['mul', 'sequence'], power: 7 }
		]
	},
	{
		id: 'fox',
		tier: 2,
		maxHp: 35,
		catchRate: 0.6,
		habitats: ['meadow', 'forest'],
		realms: ['land'],
		favours: 'trees',
		attacks: [
			{ id: 'nip', kinds: ['sub', 'missing'], power: 6 },
			{ id: 'pounce', kinds: ['mul'], power: 9 },
			{ id: 'trick', kinds: ['sequence'], power: 12 }
		]
	},
	{
		id: 'otter',
		tier: 2,
		maxHp: 32,
		catchRate: 0.65,
		habitats: ['river'],
		realms: ['land', 'water'],
		favours: 'water',
		attacks: [
			{ id: 'splash', kinds: ['add', 'sub'], power: 5 },
			{ id: 'tail-whip', kinds: ['mul', 'missing'], power: 9 }
		]
	},
	{
		id: 'deer',
		tier: 3,
		maxHp: 50,
		catchRate: 0.5,
		habitats: ['forest', 'meadow'],
		realms: ['land'],
		favours: 'trees',
		attacks: [
			{ id: 'kick', kinds: ['mul'], power: 8 },
			{ id: 'antler-charge', kinds: ['div', 'mul'], power: 12 }
		]
	},
	{
		id: 'wolf',
		tier: 4,
		maxHp: 70,
		catchRate: 0.35,
		habitats: ['forest', 'mountain'],
		realms: ['land'],
		favours: 'rocks',
		attacks: [
			{ id: 'bite', kinds: ['mul'], power: 10 },
			{ id: 'howl', kinds: ['sequence'], power: 14 },
			{ id: 'lunge', kinds: ['div', 'sqrt'], power: 18 }
		]
	},
	{
		id: 'bear',
		tier: 5,
		maxHp: 100,
		catchRate: 0.2,
		habitats: ['mountain', 'forest'],
		realms: ['land'],
		favours: 'rocks',
		attacks: [
			{ id: 'swipe', kinds: ['mul'], power: 12 },
			{ id: 'roar', kinds: ['sequence'], power: 16 },
			{ id: 'maul', kinds: ['div', 'sqrt'], power: 22 },
			{ id: 'crush', kinds: ['sqrt', 'sequence'], power: 28 }
		]
	},
	// The small animals of the Nordic countryside (#89 wave 1), by tier and then
	// as the issue lists them. Their numbers sit inside the bands #89 sets for
	// each tier round the prototype animals' (tier 1: 18–26 HP, catch 0.8–0.9,
	// powers 3–8; tier 2: 30–36, 0.6–0.7, 5–12), and their shape gives each its
	// character: the hedgehog a tank with a weak first attack, the shrew a glass
	// cannon. A tier-1 animal asks times tables only on a later attack, and
	// nothing below tier 3 asks division or square roots. Only the squirrel, the
	// rabbit and the frog are starters (`party/starters.ts`): the rest are caught.
	{
		id: 'shrew',
		tier: 1,
		maxHp: 18,
		catchRate: 0.9,
		habitats: ['meadow', 'forest'],
		realms: ['land'],
		favours: 'open',
		attacks: [
			{ id: 'squeak', kinds: ['sequence'], power: 5 },
			{ id: 'hungry-bite', kinds: ['add', 'sub'], power: 8 }
		]
	},
	{
		id: 'wood-mouse',
		tier: 1,
		maxHp: 19,
		catchRate: 0.9,
		habitats: ['forest', 'meadow'],
		realms: ['land'],
		favours: 'trees',
		attacks: [
			{ id: 'scamper', kinds: ['add'], power: 4 },
			{ id: 'seed-stash', kinds: ['add', 'missing'], power: 6 },
			{ id: 'long-jump', kinds: ['sequence'], power: 8 }
		]
	},
	{
		id: 'brown-rat',
		tier: 1,
		maxHp: 22,
		catchRate: 0.85,
		habitats: ['river', 'meadow'],
		realms: ['land'],
		favours: 'water',
		attacks: [
			{ id: 'gnaw', kinds: ['sub'], power: 4 },
			{ id: 'rat-race', kinds: ['add', 'sub'], power: 6 },
			{ id: 'tail-swish', kinds: ['sequence', 'missing'], power: 8 }
		]
	},
	{
		id: 'hedgehog',
		tier: 1,
		maxHp: 26,
		catchRate: 0.85,
		habitats: ['meadow', 'forest'],
		realms: ['land'],
		favours: 'open',
		attacks: [
			{ id: 'sniff', kinds: ['add'], power: 3 },
			{ id: 'curl-up', kinds: ['sequence'], power: 5 },
			{ id: 'spike-roll', kinds: ['add', 'sub'], power: 7 }
		]
	},
	{
		id: 'mole',
		tier: 1,
		maxHp: 22,
		catchRate: 0.85,
		habitats: ['meadow'],
		realms: ['land'],
		favours: 'open',
		attacks: [
			{ id: 'dig', kinds: ['add', 'sub'], power: 4 },
			{ id: 'molehill', kinds: ['missing', 'mul'], power: 8 }
		]
	},
	{
		id: 'common-lizard',
		tier: 1,
		maxHp: 19,
		catchRate: 0.9,
		habitats: ['meadow', 'mountain'],
		realms: ['land'],
		favours: 'rocks',
		attacks: [
			{ id: 'sun-dash', kinds: ['add'], power: 4 },
			{ id: 'tail-trick', kinds: ['sequence'], power: 6 },
			{ id: 'quick-snap', kinds: ['add', 'sub'], power: 8 }
		]
	},
	{
		id: 'common-toad',
		tier: 1,
		maxHp: 23,
		catchRate: 0.8,
		habitats: ['river', 'forest'],
		realms: ['land', 'water'],
		favours: 'water',
		attacks: [
			{ id: 'puff-up', kinds: ['sequence'], power: 4 },
			{ id: 'sticky-tongue', kinds: ['add', 'mul'], power: 5 },
			{ id: 'big-hop', kinds: ['mul', 'sequence'], power: 7 }
		]
	},
	{
		id: 'robin',
		tier: 1,
		maxHp: 19,
		catchRate: 0.9,
		habitats: ['forest', 'meadow'],
		realms: ['land'],
		favours: 'trees',
		attacks: [
			{ id: 'song', kinds: ['sequence'], power: 5 },
			{ id: 'peck', kinds: ['add', 'sub'], power: 6 },
			{ id: 'red-chest', kinds: ['add', 'missing'], power: 8 }
		]
	},
	{
		id: 'stag-beetle',
		tier: 1,
		maxHp: 24,
		catchRate: 0.8,
		habitats: ['forest'],
		realms: ['land'],
		favours: 'trees',
		attacks: [
			{ id: 'jaw-snap', kinds: ['add', 'sub'], power: 4 },
			{ id: 'wrestle', kinds: ['missing', 'sequence'], power: 7 }
		]
	},
	{
		id: 'roe-deer',
		tier: 2,
		maxHp: 31,
		catchRate: 0.65,
		habitats: ['meadow', 'forest'],
		realms: ['land'],
		favours: 'trees',
		attacks: [
			{ id: 'bark', kinds: ['add', 'sub'], power: 6 },
			{ id: 'spring', kinds: ['mul'], power: 9 },
			{ id: 'white-flash', kinds: ['sequence', 'missing'], power: 11 }
		]
	},
	{
		id: 'badger',
		tier: 2,
		maxHp: 35,
		catchRate: 0.6,
		habitats: ['forest', 'meadow'],
		realms: ['land'],
		favours: 'trees',
		attacks: [
			{ id: 'snuffle', kinds: ['add', 'sub'], power: 6 },
			{ id: 'dig-in', kinds: ['mul'], power: 9 },
			{ id: 'badger-charge', kinds: ['missing', 'sequence'], power: 11 }
		]
	},
	{
		id: 'pine-marten',
		tier: 2,
		maxHp: 32,
		catchRate: 0.65,
		habitats: ['forest'],
		realms: ['land'],
		favours: 'trees',
		attacks: [
			{ id: 'tree-leap', kinds: ['add', 'sub'], power: 6 },
			{ id: 'quick-paws', kinds: ['mul'], power: 9 },
			{ id: 'marten-bite', kinds: ['sequence'], power: 12 }
		]
	},
	{
		id: 'stoat',
		tier: 2,
		maxHp: 30,
		catchRate: 0.7,
		habitats: ['meadow', 'mountain'],
		realms: ['land'],
		favours: 'rocks',
		attacks: [
			{ id: 'stoat-dance', kinds: ['sequence'], power: 7 },
			{ id: 'quick-bite', kinds: ['mul', 'missing'], power: 10 }
		]
	},
	{
		id: 'adder',
		tier: 2,
		maxHp: 30,
		catchRate: 0.65,
		habitats: ['meadow', 'mountain'],
		realms: ['land'],
		favours: 'rocks',
		attacks: [
			{ id: 'hiss', kinds: ['sub', 'missing'], power: 6 },
			{ id: 'zigzag', kinds: ['sequence'], power: 8 },
			{ id: 'strike', kinds: ['mul'], power: 11 }
		]
	},
	{
		id: 'grey-heron',
		tier: 2,
		maxHp: 33,
		catchRate: 0.65,
		habitats: ['river'],
		realms: ['land'],
		favours: 'water',
		attacks: [
			{ id: 'wade', kinds: ['add', 'sub'], power: 6 },
			{ id: 'spear-beak', kinds: ['mul', 'missing'], power: 10 }
		]
	},
	{
		// Talon Grab asks times tables and missing numbers, not the division #89
		// wrote for it: nothing below tier 3 asks division ([[DECISIONS]] § Gameplay).
		id: 'tawny-owl',
		tier: 2,
		maxHp: 32,
		catchRate: 0.65,
		habitats: ['forest'],
		realms: ['land'],
		favours: 'trees',
		attacks: [
			{ id: 'hoot', kinds: ['sequence'], power: 5 },
			{ id: 'silent-swoop', kinds: ['mul'], power: 8 },
			{ id: 'talon-grab', kinds: ['mul', 'missing'], power: 11 }
		]
	},
	{
		id: 'raccoon',
		tier: 2,
		maxHp: 34,
		catchRate: 0.65,
		habitats: ['forest', 'river'],
		realms: ['land'],
		favours: 'water',
		attacks: [
			{ id: 'wash-up', kinds: ['add', 'sub'], power: 5 },
			{ id: 'clever-paws', kinds: ['missing', 'mul'], power: 8 },
			{ id: 'bandit-mask', kinds: ['sequence'], power: 11 }
		]
	},
	{
		id: 'beaver',
		tier: 2,
		maxHp: 36,
		catchRate: 0.6,
		habitats: ['river'],
		realms: ['land', 'water'],
		favours: 'water',
		attacks: [
			{ id: 'tail-slap', kinds: ['add', 'sub'], power: 5 },
			{ id: 'tree-gnaw', kinds: ['mul', 'missing'], power: 9 }
		]
	},
	// The sea animals: they live out on the deep water, in the sea biome, and
	// only there (realm water), so a kid meets them only from the boat, with
	// an animal that swims. One tier each from 1 to 5, as on land, each the
	// twin in numbers of the land animal of its tier (HP, catch rate, and its
	// attacks' number and powers: the crab the rabbit's, the starfish the
	// frog's, the turtle the otter's, the dolphin the deer's, the octopus the
	// wolf's, the whale the bear's), so a battle at sea is exactly as hard as
	// one on land of its size; only what the puzzles ask is their own. The two
	// small ones ask sums and number patterns, never a times-table sum (a
	// pattern may double, as the rabbit's and the frog's do).
	{
		id: 'crab',
		tier: 1,
		maxHp: 22,
		catchRate: 0.85,
		habitats: ['sea'],
		realms: ['water'],
		favours: 'water',
		attacks: [
			{ id: 'pinch', kinds: ['add'], power: 4 },
			{ id: 'claw-clap', kinds: ['add', 'sub'], power: 6 },
			{ id: 'crab-walk', kinds: ['sequence'], power: 8 }
		]
	},
	{
		id: 'starfish',
		tier: 1,
		maxHp: 21,
		catchRate: 0.8,
		habitats: ['sea'],
		realms: ['water'],
		favours: 'water',
		attacks: [
			{ id: 'spin', kinds: ['sequence'], power: 4 },
			{ id: 'arm-slap', kinds: ['add', 'sub'], power: 5 },
			{ id: 'star-slam', kinds: ['add', 'sub'], power: 7 }
		]
	},
	{
		id: 'turtle',
		tier: 2,
		maxHp: 32,
		catchRate: 0.65,
		habitats: ['sea'],
		realms: ['water'],
		favours: 'water',
		attacks: [
			{ id: 'flipper-flap', kinds: ['add', 'sub'], power: 5 },
			{ id: 'shell-bump', kinds: ['sequence', 'missing'], power: 9 }
		]
	},
	{
		id: 'dolphin',
		tier: 3,
		maxHp: 50,
		catchRate: 0.5,
		habitats: ['sea'],
		realms: ['water'],
		favours: 'water',
		attacks: [
			{ id: 'click', kinds: ['sequence', 'add'], power: 8 },
			{ id: 'leap', kinds: ['div', 'mul'], power: 12 }
		]
	},
	{
		id: 'octopus',
		tier: 4,
		maxHp: 70,
		catchRate: 0.35,
		habitats: ['sea'],
		realms: ['water'],
		favours: 'water',
		attacks: [
			{ id: 'wiggle', kinds: ['mul'], power: 10 },
			{ id: 'ink-puff', kinds: ['sequence'], power: 14 },
			{ id: 'octo-hug', kinds: ['div', 'sqrt'], power: 18 }
		]
	},
	{
		id: 'whale',
		tier: 5,
		maxHp: 100,
		catchRate: 0.2,
		habitats: ['sea'],
		realms: ['water'],
		favours: 'water',
		attacks: [
			{ id: 'bubbles', kinds: ['mul'], power: 12 },
			{ id: 'whale-song', kinds: ['sequence'], power: 16 },
			{ id: 'spout', kinds: ['div', 'sqrt'], power: 22 },
			{ id: 'big-wave', kinds: ['sqrt', 'sequence'], power: 28 }
		]
	}
];

const BY_ID = new Map(ANIMALS.map((a) => [a.id, a]));

export function getAnimal(id: string): AnimalSpec {
	const spec = BY_ID.get(id);
	if (!spec) throw new Error(`Unknown animal: ${id}`);
	return spec;
}

/**
 * Whether an animal of this species can fight where the player stands in
 * `realm`: its realms include it. On land every land and amphibious animal
 * can; out on the water, in the boat, only the ones that swim, the
 * amphibious and the sea animals. The human's rule: "you can't fight on
 * water unless you have an amphibious animal".
 */
export function canFightIn(speciesId: string, realm: Realm): boolean {
	return getAnimal(speciesId).realms.includes(realm);
}
