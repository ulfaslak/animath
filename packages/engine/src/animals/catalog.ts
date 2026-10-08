import { hasItem } from '../items/catalog.js';
import type { AnimalSpec, Biome, Realm } from './types.js';

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
		carries: true,
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
		carries: true,
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
		carries: true,
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
		realms: ['land', 'air'],
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
		realms: ['land', 'air'],
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
		realms: ['land', 'air'],
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
	{
		// The common buzzard (musvåge), Denmark's commonest bird of prey (#91): it
		// hunts over the open fields from a perch at the edge of the woods, so it
		// lives in the meadow and favours the trees; in #89's tier-2 band.
		id: 'buzzard',
		tier: 2,
		maxHp: 33,
		catchRate: 0.65,
		habitats: ['meadow'],
		realms: ['land', 'air'],
		favours: 'trees',
		attacks: [
			{ id: 'mew', kinds: ['add', 'sub'], power: 6 },
			{ id: 'sky-circles', kinds: ['sequence'], power: 9 },
			{ id: 'talon-drop', kinds: ['mul', 'missing'], power: 11 }
		]
	},
	// The big animals of the Nordic countryside (#89 wave 2), by tier and then as
	// the issue lists them, inside #89's bands (tier 3: 46–56 HP, catch 0.45–0.5,
	// two attacks of power 8–13; tier 4: 66–72, 0.3–0.35, three of 10–19; tier 5:
	// 105–110, 0.2, three or four of 12–27, which the bear stays outside of as it
	// was). The mute swan swims, as the toad and the beaver do.
	{
		id: 'wild-boar',
		tier: 3,
		maxHp: 56,
		catchRate: 0.45,
		habitats: ['forest'],
		realms: ['land'],
		favours: 'trees',
		carries: true,
		attacks: [
			{ id: 'snout-dig', kinds: ['mul'], power: 8 },
			{ id: 'tusk-charge', kinds: ['div', 'mul'], power: 13 }
		]
	},
	{
		id: 'mute-swan',
		tier: 3,
		maxHp: 48,
		catchRate: 0.5,
		habitats: ['river'],
		realms: ['land', 'water', 'air'],
		favours: 'water',
		attacks: [
			{ id: 'big-hiss', kinds: ['mul'], power: 8 },
			{ id: 'wing-beat', kinds: ['div', 'mul'], power: 12 }
		]
	},
	{
		id: 'eagle-owl',
		tier: 3,
		maxHp: 46,
		catchRate: 0.5,
		habitats: ['mountain', 'forest'],
		realms: ['land', 'air'],
		favours: 'rocks',
		attacks: [
			{ id: 'orange-eyes', kinds: ['sequence', 'mul'], power: 9 },
			{ id: 'night-strike', kinds: ['div', 'sqrt'], power: 13 }
		]
	},
	{
		id: 'lynx',
		tier: 4,
		maxHp: 66,
		catchRate: 0.35,
		habitats: ['forest', 'mountain'],
		realms: ['land'],
		favours: 'trees',
		attacks: [
			{ id: 'stalk', kinds: ['mul'], power: 11 },
			{ id: 'snow-paws', kinds: ['sequence'], power: 15 },
			{ id: 'great-pounce', kinds: ['div', 'sqrt'], power: 19 }
		]
	},
	{
		id: 'wolverine',
		tier: 4,
		maxHp: 72,
		catchRate: 0.3,
		habitats: ['mountain'],
		realms: ['land'],
		favours: 'rocks',
		attacks: [
			{ id: 'growl', kinds: ['mul'], power: 10 },
			{ id: 'snow-dig', kinds: ['sequence'], power: 14 },
			{ id: 'never-give-up', kinds: ['div', 'sqrt'], power: 18 }
		]
	},
	{
		id: 'golden-eagle',
		tier: 4,
		maxHp: 66,
		catchRate: 0.35,
		habitats: ['mountain'],
		realms: ['land', 'air'],
		favours: 'rocks',
		attacks: [
			{ id: 'soar', kinds: ['mul'], power: 10 },
			{ id: 'sky-dive', kinds: ['sequence', 'mul'], power: 15 },
			{ id: 'golden-talons', kinds: ['div', 'sqrt'], power: 19 }
		]
	},
	{
		// The sea eagle to a kid (havørn): its id is the species' full name. It hunts
		// fish over the deep water too, so it flies over the sea as well as the river.
		id: 'white-tailed-eagle',
		tier: 4,
		maxHp: 68,
		catchRate: 0.35,
		habitats: ['river'],
		realms: ['land', 'air'],
		skies: ['river', 'sea'],
		favours: 'water',
		attacks: [
			{ id: 'glide', kinds: ['mul'], power: 10 },
			{ id: 'fish-grab', kinds: ['sequence'], power: 14 },
			{ id: 'huge-wings', kinds: ['div', 'sqrt'], power: 18 }
		]
	},
	{
		id: 'moose',
		tier: 5,
		maxHp: 110,
		catchRate: 0.2,
		habitats: ['forest', 'river'],
		realms: ['land'],
		favours: 'water',
		carries: true,
		attacks: [
			{ id: 'munch', kinds: ['mul'], power: 12 },
			{ id: 'lake-dip', kinds: ['sequence'], power: 17 },
			{ id: 'antler-shove', kinds: ['div', 'sqrt'], power: 24 }
		]
	},
	{
		// In the forest, where it lives in nature (Białowieża), not the meadow: the
		// meadow has no tier-4 animal, so a tier-5 one there would be much of what a
		// tier-4 lead meets in it (#89).
		id: 'european-bison',
		tier: 5,
		maxHp: 105,
		catchRate: 0.2,
		habitats: ['forest'],
		realms: ['land'],
		favours: 'open',
		carries: true,
		attacks: [
			{ id: 'stamp', kinds: ['mul'], power: 12 },
			{ id: 'dust-bath', kinds: ['sequence'], power: 16 },
			{ id: 'head-butt', kinds: ['div', 'sqrt'], power: 22 },
			{ id: 'stampede', kinds: ['sqrt', 'sequence'], power: 27 }
		]
	},
	// The sea animals: they live out on the deep water, in the sea biome, and
	// only there (realm water), so a kid meets them only from the boat, with
	// an animal that swims. One or more of each tier from 1 to 5, as on land,
	// each the twin in numbers of a named land animal of its tier (HP, catch
	// rate, and its attacks' number and powers: the crab the rabbit's, the
	// starfish the frog's, the moon jellyfish the wood mouse's, the plaice the
	// mole's, the turtle the otter's, the lion's mane the adder's, the lobster
	// the badger's, the dolphin the red deer's, the harbour seal the wild
	// boar's, the porpoise the mute swan's, the octopus the wolf's, the grey
	// seal the wolverine's, the whale the bear's and the orca the European
	// bison's), so a battle at sea is exactly as hard as one on land of its
	// size; only what the puzzles ask is their own. The small ones ask sums
	// and number patterns, never a times-table sum (a pattern may double, as
	// the rabbit's and the frog's do).
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
	},
	// #89's third wave: the sea of the Nordic countryside, after the whale.
	{
		id: 'moon-jellyfish',
		tier: 1,
		maxHp: 19,
		catchRate: 0.9,
		habitats: ['sea'],
		realms: ['water'],
		favours: 'water',
		attacks: [
			{ id: 'drift', kinds: ['add'], power: 4 },
			{ id: 'pulse', kinds: ['sequence'], power: 6 },
			{ id: 'wobble', kinds: ['add', 'sub'], power: 8 }
		]
	},
	{
		id: 'plaice',
		tier: 1,
		maxHp: 22,
		catchRate: 0.85,
		habitats: ['sea'],
		realms: ['water'],
		favours: 'water',
		attacks: [
			{ id: 'sand-hide', kinds: ['add', 'sub'], power: 4 },
			{ id: 'flat-flip', kinds: ['add', 'sequence'], power: 8 }
		]
	},
	{
		// The lion's mane to a kid (brandmand): its id is the species' full name.
		id: 'lions-mane-jellyfish',
		tier: 2,
		maxHp: 30,
		catchRate: 0.65,
		habitats: ['sea'],
		realms: ['water'],
		favours: 'water',
		attacks: [
			{ id: 'long-strands', kinds: ['sub', 'missing'], power: 6 },
			{ id: 'sting', kinds: ['sequence'], power: 8 },
			{ id: 'fire-mane', kinds: ['mul'], power: 11 }
		]
	},
	{
		id: 'lobster',
		tier: 2,
		maxHp: 35,
		catchRate: 0.6,
		habitats: ['sea'],
		realms: ['water'],
		favours: 'water',
		attacks: [
			{ id: 'feeler-tap', kinds: ['add', 'sub'], power: 6 },
			{ id: 'crusher-claw', kinds: ['mul'], power: 9 },
			{ id: 'tail-flip', kinds: ['missing', 'sequence'], power: 11 }
		]
	},
	{
		// Water only, like every sea animal: seals haul out on sandbanks in nature, but an
		// amphibious animal living only in the sea is a kind the rules don't have (#89).
		id: 'harbour-seal',
		tier: 3,
		maxHp: 56,
		catchRate: 0.45,
		habitats: ['sea'],
		realms: ['water'],
		favours: 'water',
		attacks: [
			{ id: 'whiskers', kinds: ['mul'], power: 8 },
			{ id: 'belly-flop', kinds: ['div', 'mul'], power: 13 }
		]
	},
	{
		// The porpoise to a kid (marsvin).
		id: 'harbour-porpoise',
		tier: 3,
		maxHp: 48,
		catchRate: 0.5,
		habitats: ['sea'],
		realms: ['water'],
		favours: 'water',
		attacks: [
			{ id: 'echo', kinds: ['mul', 'sequence'], power: 8 },
			{ id: 'puff-and-dive', kinds: ['div', 'mul'], power: 12 }
		]
	},
	{
		id: 'grey-seal',
		tier: 4,
		maxHp: 72,
		catchRate: 0.3,
		habitats: ['sea'],
		realms: ['water'],
		favours: 'water',
		attacks: [
			{ id: 'seal-song', kinds: ['mul'], power: 10 },
			{ id: 'rock-flop', kinds: ['sequence'], power: 14 },
			{ id: 'big-bite', kinds: ['div', 'sqrt'], power: 18 }
		]
	},
	{
		id: 'orca',
		tier: 5,
		maxHp: 105,
		catchRate: 0.2,
		habitats: ['sea'],
		realms: ['water'],
		favours: 'water',
		attacks: [
			{ id: 'whistle', kinds: ['mul'], power: 12 },
			{ id: 'pod-hunt', kinds: ['sequence'], power: 16 },
			{ id: 'tail-slap', kinds: ['div', 'sqrt'], power: 22 },
			{ id: 'wave-wash', kinds: ['sqrt', 'sequence'], power: 27 }
		]
	},
	// The Arctic's animals (#192), arriving in waves as Nordland's did; wave 1 is
	// its small land animals, tiers 1 and 2, the three starters first. Each lives
	// on one pole only, the Arctic tern on both, and lists only its own pole's
	// biomes. HP and powers are about 2.3 times a Nordland animal's of its tier,
	// so a fight takes as many hits; the catch rates are Nordland's. The weakest
	// attack asks a sum, and the stronger ones the Arctic's picture kinds and the
	// balance, never a times table, a pattern, a missing number or a root.
	{
		id: 'arctic-fox',
		tier: 1,
		maxHp: 48,
		catchRate: 0.85,
		habitats: ['tundra', 'bird-cliffs', 'arctic-ice'],
		realms: ['land'],
		favours: 'open',
		attacks: [
			{ id: 'snow-sniff', kinds: ['add', 'sub'], power: 8 },
			{ id: 'fluffy-tail', kinds: ['thermometer'], power: 12 },
			{ id: 'snow-dive', kinds: ['clock'], power: 16 }
		]
	},
	{
		id: 'arctic-hare',
		tier: 1,
		maxHp: 50,
		catchRate: 0.85,
		habitats: ['tundra', 'fell'],
		realms: ['land'],
		favours: 'rocks',
		attacks: [
			{ id: 'hop', kinds: ['add'], power: 8 },
			{ id: 'big-feet', kinds: ['shape'], power: 11 },
			{ id: 'zigzag-dash', kinds: ['barchart'], power: 15 }
		]
	},
	{
		// The Atlantic puffin, which nests on Greenland's and Svalbard's bird cliffs and
		// fishes out at sea.
		id: 'puffin',
		tier: 1,
		maxHp: 46,
		catchRate: 0.9,
		habitats: ['bird-cliffs'],
		skies: ['bird-cliffs', 'arctic-ocean'],
		realms: ['land', 'water', 'air'],
		favours: 'water',
		attacks: [
			{ id: 'waddle', kinds: ['add', 'sub'], power: 7 },
			{ id: 'beakful', kinds: ['kroner'], power: 11 },
			{ id: 'wing-dive', kinds: ['fraction'], power: 15 }
		]
	},
	{
		// The northern collared lemming, the one that turns white in winter.
		id: 'arctic-lemming',
		tier: 1,
		maxHp: 44,
		catchRate: 0.9,
		habitats: ['tundra'],
		realms: ['land'],
		favours: 'open',
		attacks: [
			{ id: 'nibble', kinds: ['add'], power: 9 },
			{ id: 'tunnel-dash', kinds: ['balance'], power: 17 }
		]
	},
	{
		id: 'snow-bunting',
		tier: 1,
		maxHp: 45,
		catchRate: 0.9,
		habitats: ['tundra', 'fell', 'bird-cliffs'],
		realms: ['land', 'air'],
		favours: 'rocks',
		attacks: [
			{ id: 'chirp', kinds: ['add'], power: 7 },
			{ id: 'snow-flurry', kinds: ['clock'], power: 10 },
			{ id: 'wing-flash', kinds: ['barchart'], power: 14 }
		]
	},
	{
		id: 'rock-ptarmigan',
		tier: 1,
		maxHp: 52,
		catchRate: 0.85,
		habitats: ['tundra', 'fell'],
		realms: ['land', 'air'],
		favours: 'rocks',
		attacks: [
			{ id: 'peck', kinds: ['sub'], power: 7 },
			{ id: 'white-coat', kinds: ['thermometer'], power: 11 },
			{ id: 'snow-burrow', kinds: ['shape'], power: 14 }
		]
	},
	{
		// The Bohemian waxwing, of the northern forest's edge.
		id: 'waxwing',
		tier: 1,
		maxHp: 46,
		catchRate: 0.9,
		habitats: ['taiga'],
		realms: ['land', 'air'],
		favours: 'trees',
		attacks: [
			{ id: 'trill', kinds: ['add'], power: 7 },
			{ id: 'berry-feast', kinds: ['fraction'], power: 11 },
			{ id: 'crest-pop', kinds: ['kroner'], power: 15 }
		]
	},
	{
		id: 'adelie-penguin',
		tier: 1,
		maxHp: 54,
		catchRate: 0.8,
		habitats: ['rookery', 'antarctic-ice'],
		realms: ['land', 'water'],
		favours: 'rocks',
		attacks: [
			{ id: 'waddle', kinds: ['add', 'sub'], power: 7 },
			{ id: 'pebble-gift', kinds: ['kroner'], power: 11 },
			{ id: 'belly-slide', kinds: ['clock'], power: 15 }
		]
	},
	{
		// It nests in rock cracks on the mountains that stick up through the inland ice,
		// and flies out over the sea ice.
		id: 'snow-petrel',
		tier: 1,
		maxHp: 46,
		catchRate: 0.9,
		habitats: ['ice-sheet', 'rookery'],
		skies: ['ice-sheet', 'rookery', 'antarctic-ice'],
		realms: ['land', 'air'],
		favours: 'rocks',
		attacks: [
			{ id: 'glide', kinds: ['sub'], power: 8 },
			{ id: 'oil-spit', kinds: ['balance'], power: 12 },
			{ id: 'blizzard', kinds: ['fraction'], power: 15 }
		]
	},
	{
		// The one animal on both poles: it nests in the Arctic and spends the southern
		// summer on the Antarctic's sea ice, the longest trip of any animal.
		id: 'arctic-tern',
		tier: 2,
		maxHp: 70,
		catchRate: 0.7,
		habitats: ['bird-cliffs', 'tundra', 'antarctic-ice'],
		skies: ['bird-cliffs', 'tundra', 'antarctic-ice', 'arctic-ocean', 'southern-ocean'],
		realms: ['land', 'air'],
		favours: 'water',
		attacks: [
			{ id: 'plunge', kinds: ['add', 'sub'], power: 12 },
			{ id: 'head-peck', kinds: ['fraction'], power: 18 },
			{ id: 'long-trip', kinds: ['clock'], power: 25 }
		]
	},
	{
		id: 'king-eider',
		tier: 2,
		maxHp: 74,
		catchRate: 0.65,
		habitats: ['bird-cliffs', 'tundra'],
		skies: ['bird-cliffs', 'tundra', 'arctic-ocean'],
		realms: ['land', 'water', 'air'],
		favours: 'water',
		attacks: [
			{ id: 'paddle', kinds: ['add'], power: 11 },
			{ id: 'deep-dive', kinds: ['thermometer'], power: 18 },
			{ id: 'orange-crown', kinds: ['shape'], power: 24 }
		]
	},
	{
		// The common raven, which stays the whole winter and scavenges far out over
		// the lake ice and the sea ice too.
		id: 'raven',
		tier: 2,
		maxHp: 72,
		catchRate: 0.65,
		habitats: ['tundra', 'taiga', 'fell'],
		skies: ['tundra', 'taiga', 'fell', 'frozen-lake', 'arctic-ice'],
		realms: ['land', 'air'],
		favours: 'rocks',
		attacks: [
			{ id: 'croak', kinds: ['sub'], power: 12 },
			{ id: 'clever-trick', kinds: ['balance'], power: 18 },
			{ id: 'food-stash', kinds: ['kroner'], power: 25 }
		]
	},
	{
		id: 'barnacle-goose',
		tier: 2,
		maxHp: 76,
		catchRate: 0.65,
		habitats: ['bird-cliffs', 'tundra'],
		realms: ['land', 'water', 'air'],
		favours: 'open',
		attacks: [
			{ id: 'honk', kinds: ['add', 'sub'], power: 11 },
			{ id: 'cliff-jump', kinds: ['fraction'], power: 19 },
			{ id: 'flock-flight', kinds: ['barchart'], power: 24 }
		]
	},
	{
		id: 'gentoo-penguin',
		tier: 2,
		maxHp: 76,
		catchRate: 0.65,
		habitats: ['rookery'],
		realms: ['land', 'water'],
		favours: 'open',
		attacks: [
			{ id: 'peck', kinds: ['add', 'sub'], power: 12 },
			{ id: 'fast-swim', kinds: ['clock'], power: 20 },
			{ id: 'pebble-pile', kinds: ['barchart'], power: 24 }
		]
	},
	{
		// The chinstrap penguin, named for the thin black strap under its chin.
		id: 'chinstrap',
		tier: 2,
		maxHp: 72,
		catchRate: 0.7,
		habitats: ['rookery'],
		realms: ['land', 'water'],
		favours: 'rocks',
		attacks: [
			{ id: 'squawk', kinds: ['sub'], power: 13 },
			{ id: 'flipper-slap', kinds: ['kroner'], power: 19 },
			{ id: 'rock-hop', kinds: ['fraction'], power: 26 }
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
 * Whether an animal of this species can fight where a battle is, in
 * `realm`: its realms include it. On land every land and amphibious animal
 * can; out on the water, in the boat, only the ones that swim, the
 * amphibious and the sea animals. The human's rule: "you can't fight on
 * water unless you have an amphibious animal". Up in the air, after a bird
 * followed the glider down, only the ones that fly: the birds.
 */
export function canFightIn(speciesId: string, realm: Realm): boolean {
	return getAnimal(speciesId).realms.includes(realm);
}

/**
 * Whether an animal of this species carries this owner on land: they have
 * the harness, and it is big enough to carry a kid ([[PRODUCT]] §4 "World",
 * riding). Only on land: the caller asks it only there, never out on the
 * water, where the boat carries the kid, nor up in the air.
 */
export function canRide(owner: { readonly items: readonly string[] }, speciesId: string): boolean {
	return hasItem(owner, 'harness') && getAnimal(speciesId).carries === true;
}

/**
 * The biomes whose sky a species flies over, where it may notice a kid on
 * the glider: none for an animal that does not fly, and for a bird its
 * `skies`, or where it lives when it names none.
 */
export function skiesOf(spec: AnimalSpec): readonly Biome[] {
	if (!spec.realms.includes('air')) return [];
	return spec.skies ?? spec.habitats;
}
