import type { AnimalSpec } from './types.js';

/**
 * The species catalog. Placeholder roster for the prototype — the real one
 * grows with art. Ordering of `attacks` matters: index 1 is weakest.
 */
export const ANIMALS: readonly AnimalSpec[] = [
	{
		id: 'squirrel',
		name: 'Squirrel',
		tier: 1,
		maxHp: 20,
		catchRate: 0.9,
		habitats: ['meadow', 'forest'],
		attacks: [
			{ id: 'nut-toss', name: 'Nut Toss', kinds: ['add', 'sub'], power: 4 },
			{ id: 'scurry-kick', name: 'Scurry Kick', kinds: ['add', 'sub', 'missing'], power: 6 }
		]
	},
	{
		id: 'rabbit',
		name: 'Rabbit',
		tier: 1,
		maxHp: 22,
		catchRate: 0.85,
		habitats: ['meadow'],
		attacks: [
			{ id: 'hop', name: 'Hop', kinds: ['add'], power: 4 },
			{ id: 'thump', name: 'Thump', kinds: ['sub', 'missing'], power: 6 },
			{ id: 'burrow-bite', name: 'Burrow Bite', kinds: ['sequence'], power: 8 }
		]
	},
	{
		id: 'fox',
		name: 'Fox',
		tier: 2,
		maxHp: 35,
		catchRate: 0.6,
		habitats: ['meadow', 'forest'],
		attacks: [
			{ id: 'nip', name: 'Nip', kinds: ['sub', 'missing'], power: 6 },
			{ id: 'pounce', name: 'Pounce', kinds: ['mul'], power: 9 },
			{ id: 'trick', name: 'Trick', kinds: ['sequence'], power: 12 }
		]
	},
	{
		id: 'otter',
		name: 'Otter',
		tier: 2,
		maxHp: 32,
		catchRate: 0.65,
		habitats: ['river'],
		attacks: [
			{ id: 'splash', name: 'Splash', kinds: ['add', 'sub'], power: 5 },
			{ id: 'tail-whip', name: 'Tail Whip', kinds: ['mul', 'missing'], power: 9 }
		]
	},
	{
		id: 'deer',
		name: 'Deer',
		tier: 3,
		maxHp: 50,
		catchRate: 0.5,
		habitats: ['forest', 'meadow'],
		attacks: [
			{ id: 'kick', name: 'Kick', kinds: ['mul'], power: 8 },
			{ id: 'antler-charge', name: 'Antler Charge', kinds: ['div', 'mul'], power: 12 }
		]
	},
	{
		id: 'wolf',
		name: 'Wolf',
		tier: 4,
		maxHp: 70,
		catchRate: 0.35,
		habitats: ['forest', 'mountain'],
		attacks: [
			{ id: 'bite', name: 'Bite', kinds: ['mul'], power: 10 },
			{ id: 'howl', name: 'Howl', kinds: ['sequence'], power: 14 },
			{ id: 'lunge', name: 'Lunge', kinds: ['div', 'sqrt'], power: 18 }
		]
	},
	{
		id: 'bear',
		name: 'Bear',
		tier: 5,
		maxHp: 100,
		catchRate: 0.2,
		habitats: ['mountain', 'forest'],
		attacks: [
			{ id: 'swipe', name: 'Swipe', kinds: ['mul'], power: 12 },
			{ id: 'roar', name: 'Roar', kinds: ['sequence'], power: 16 },
			{ id: 'maul', name: 'Maul', kinds: ['div', 'sqrt'], power: 22 },
			{ id: 'crush', name: 'Crush', kinds: ['sqrt', 'sequence'], power: 28 }
		]
	}
];

const BY_ID = new Map(ANIMALS.map((a) => [a.id, a]));

export function getAnimal(id: string): AnimalSpec {
	const spec = BY_ID.get(id);
	if (!spec) throw new Error(`Unknown animal: ${id}`);
	return spec;
}
