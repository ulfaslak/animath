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
		// The river's own tier-1 animal. It counts in hops: sequences and times
		// tables, where the squirrel and the rabbit ask sums.
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
