import { ITEMS, type ItemId } from '../items/catalog.js';
import { STARTERS } from '../party/starters.js';
import { generatePuzzle } from '../puzzles/registry.js';
import { PICTURE_KINDS, type Puzzle, type PuzzleKind } from '../puzzles/types.js';
import type { Rng } from '../rng.js';
import { FIRST_LAND, LAND_IDS, isLandId, type LandId } from './ids.js';

/**
 * The lands ([[PRODUCT]] §4 "Lands", #191): each land is a content pack laid
 * over every world number, and this registry is what each pack holds. A new
 * land is a new `LandId` at the end of `LAND_IDS` and one entry here, its
 * species in the catalog, its items in the item catalog, and its generator
 * (`generate.ts`, chosen by the seed: `landOfSeed`).
 *
 * The rules that read it are here too: which lands a kid has unlocked
 * (`unlockLands`), where they may fly from a witch doctor's tent
 * (`flyRefusal`), and the puzzle a flight costs (`farePuzzle`).
 */

/** What a land pays in, by id: the words and the look are the client's (`currency.<id>.*`). */
export type CurrencyId = 'tokens' | 'ice-dollars';

/**
 * How the trainer looks in a land, by key, for the client's figure and for
 * other players (step 4 of #191 draws the warm hat): `bare` is today's trainer.
 */
export type TrainerLook = 'bare' | 'warm-hat';

export interface LandSpec {
	id: LandId;
	/**
	 * Its place in the unlock chain, from 0: land N + 1 unlocks once every
	 * species of land N is set free (`unlockLands`). The same as its place in
	 * `LAND_IDS`.
	 */
	order: number;
	/**
	 * Built and open to players. A land whose map, animals and shop are not
	 * built yet is in the registry, so saves, seeds and presence know it, but
	 * no flight goes there (`flyRefusal`: `land-unavailable`), except in a
	 * game the `?lands` switch opens, which is saved nowhere.
	 */
	available: boolean;
	/** Its species, by id: what the animal book's tab for the land lists, and what unlocks the next land. */
	species: readonly string[];
	/** The species a kid picks their first animal of the land from, by id: tier 1, fighting on land. */
	starters: readonly string[];
	/**
	 * What its witch doctor's shop can sell, and the price of each in the
	 * land's money; only the items `available` are on sale (`shopFor`).
	 */
	shop: Readonly<Partial<Record<ItemId, number>>>;
	/** What it pays in. A land's money is its own, like its party and items. */
	currency: CurrencyId;
	/** The puzzle kinds a flight to it asks (`farePuzzle`): a taste of what waits there. */
	travelKinds: readonly PuzzleKind[];
	/** How the trainer looks there. */
	look: TrainerLook;
}

/**
 * Nordland's 50 species, by id, in the catalog's order: every species there
 * was before lands (#89's three waves). Written out rather than read from the
 * catalog, so a later land's species joining the catalog never joins
 * Nordland, and the count a kid works towards (50) never moves under them.
 */
const NORDLAND_SPECIES: readonly string[] = [
	'squirrel',
	'rabbit',
	'frog',
	'fox',
	'otter',
	'deer',
	'wolf',
	'bear',
	'shrew',
	'wood-mouse',
	'brown-rat',
	'hedgehog',
	'mole',
	'common-lizard',
	'common-toad',
	'robin',
	'stag-beetle',
	'roe-deer',
	'badger',
	'pine-marten',
	'stoat',
	'adder',
	'grey-heron',
	'tawny-owl',
	'raccoon',
	'beaver',
	'buzzard',
	'wild-boar',
	'mute-swan',
	'eagle-owl',
	'lynx',
	'wolverine',
	'golden-eagle',
	'white-tailed-eagle',
	'moose',
	'european-bison',
	'crab',
	'starfish',
	'turtle',
	'dolphin',
	'octopus',
	'whale',
	'moon-jellyfish',
	'plaice',
	'lions-mane-jellyfish',
	'lobster',
	'harbour-seal',
	'harbour-porpoise',
	'grey-seal',
	'orca'
];

/**
 * The Arctic's species, by id, in catalog order (#192): its 50 arrive in
 * three waves, as Nordland's did, and this list grows with each, the
 * starters first. Wave 1: the small land animals, tiers 1 and 2; wave 3: the
 * sea and fishing-hole animals.
 */
const ARCTIC_SPECIES: readonly string[] = [
	'arctic-fox',
	'arctic-hare',
	'puffin',
	'arctic-lemming',
	'snow-bunting',
	'rock-ptarmigan',
	'waxwing',
	'adelie-penguin',
	'snow-petrel',
	'arctic-tern',
	'king-eider',
	'raven',
	'barnacle-goose',
	'gentoo-penguin',
	'chinstrap',
	// Wave 3: the sea and fishing-hole animals.
	'sea-angel',
	'polar-cod',
	'antarctic-krill',
	'arctic-char',
	'lumpsucker',
	'ringed-seal',
	'icefish',
	'harp-seal',
	'wolffish',
	'snow-crab',
	'weddell-seal',
	'beluga',
	'hooded-seal',
	'minke-whale',
	'toothfish',
	'crabeater-seal',
	'walrus',
	'bowhead-whale',
	'greenland-shark',
	'narwhal',
	'elephant-seal',
	'blue-whale',
	'leopard-seal'
];

/**
 * The registry, in unlock order. The Arctic is here and not available: its
 * map, animals and shop come in steps 4 to 6 of #191, which fill in its
 * `species`, `starters` and `shop` and turn `available` on.
 */
export const LANDS: readonly LandSpec[] = [
	{
		id: 'nordland',
		order: 0,
		available: true,
		species: NORDLAND_SPECIES,
		starters: STARTERS,
		// The prices run on as Fibonacci numbers: 8, 13, 21, 34, and the harness costs what the
		// paraglider does, the human's call. How long each takes to reach in ordinary play is
		// [[PRODUCT]] §4's model ("Tokens and the witch doctor's shop").
		shop: { axe: 8, pickaxe: 13, boat: 21, glider: 34, harness: 34 },
		currency: 'tokens',
		travelKinds: ['add', 'sub'],
		look: 'bare'
	},
	{
		id: 'arctic',
		order: 1,
		available: false,
		species: ARCTIC_SPECIES,
		// One of each ground, as Nordland's three are (#192): open, rocks and water.
		starters: ['arctic-fox', 'arctic-hare', 'puffin'],
		// In ice dollars, the same Fibonacci ladder from the start, since a kid arrives with none
		// and a starter of tier 1 (#191 step 6; [[PRODUCT]] §4 "The Arctic's shop").
		shop: { 'arctic-axe': 8, 'ice-pick': 13, 'fishing-rod': 21, boat: 55, glider: 89 },
		currency: 'ice-dollars',
		// The Arctic's own kinds (#191 step 2): a taste of what waits there.
		travelKinds: [...PICTURE_KINDS, 'balance'],
		look: 'warm-hat'
	}
];

/** Land `id`'s pack. Throws for an id this build lacks: check with `isLandId` first. */
export function getLand(id: LandId): LandSpec {
	const land = LANDS.find((l) => l.id === id);
	if (!land) throw new Error(`Unknown land: ${String(id)}`);
	return land;
}

/** The lands a player may go to in this build: the `available` ones, in unlock order. */
export function availableLands(): LandId[] {
	return LANDS.filter((l) => l.available).map((l) => l.id);
}

/**
 * What land `id`'s witch doctor sells: its shop's items that are on sale,
 * cheapest first (the catalog's order between two of a price).
 */
export function shopFor(id: LandId): ItemId[] {
	const shop = getLand(id).shop;
	return ITEMS.filter((i) => i.available && shop[i.id] !== undefined)
		.map((i) => i.id)
		.sort((a, b) => shop[a]! - shop[b]!);
}

/**
 * What item `item` costs at land `land`'s witch doctor, in that land's money.
 * An item that land does not sell (only ever shown by the `?shop` switch, in a
 * game saved nowhere) costs what it does in the first land that sells it.
 */
export function priceIn(land: LandId, item: ItemId): number {
	const own = getLand(land).shop[item];
	if (own !== undefined) return own;
	for (const other of LANDS) {
		const price = other.shop[item];
		if (price !== undefined) return price;
	}
	throw new Error(`priceIn: no land sells ${String(item)}`);
}

/**
 * The lands unlocked, for a kid who has set free the species in `freed` and
 * had unlocked `unlocked` before: everything in `unlocked` (an unlocked land
 * stays unlocked, even when a land before it grows a species, and an id this
 * build lacks is kept as it is), the first land, and every land whose land
 * before it has every one of its species in `freed`. In unlock order, then
 * the ids this build lacks as they were. The very same array when nothing is
 * new, so a caller can tell a land just unlocked by identity.
 *
 * A land before another with no species yet (one still being built) unlocks
 * nothing: a kid sets free one of every animal there is, never of none.
 */
export function unlockLands(
	unlocked: readonly string[],
	freed: Iterable<string>
): readonly string[] {
	const set = new Set(freed);
	const open = new Set<string>(unlocked);
	open.add(FIRST_LAND);
	for (let i = 1; i < LANDS.length; i++) {
		const before = LANDS[i - 1]!.species;
		if (before.length > 0 && before.every((id) => set.has(id))) open.add(LANDS[i]!.id);
	}
	// The very same list when nothing is new and it names each land once (a hand-edited save
	// can name one twice: it comes back named once).
	const once = new Set(unlocked).size === unlocked.length;
	if (once && open.size === unlocked.length && unlocked.includes(FIRST_LAND)) return unlocked;
	const known = LAND_IDS.filter((id) => open.has(id));
	const unknown = [...open].filter((id) => !isLandId(id));
	return [...known, ...unknown];
}

/**
 * Why a flight from land `here` to `to` is refused, or null when it may go:
 * `no-such-land` (not a land this build has), `already-here`,
 * `land-unavailable` (not built yet: not in `open`, the lands this build
 * flies to, `availableLands()` unless a switch opens more) and `land-locked`
 * (not in `unlocked`: `unlockLands`'), in that order. The one rule the witch
 * doctor's reducer asks, and the card greys a destination with.
 */
export type FlyRefusal = 'no-such-land' | 'already-here' | 'land-unavailable' | 'land-locked';

export function flyRefusal(
	trip: { here: LandId; unlocked: readonly string[]; open: readonly LandId[] },
	to: unknown
): FlyRefusal | null {
	if (!isLandId(to)) return 'no-such-land';
	if (to === trip.here) return 'already-here';
	if (!trip.open.includes(to)) return 'land-unavailable';
	if (to !== FIRST_LAND && !trip.unlocked.includes(to)) return 'land-locked';
	return null;
}

/**
 * How hard the puzzle a flight costs is (`farePuzzle`): a taste of the land,
 * not a test: a sum in the teens with Nordland's kinds, and the easy end of
 * The Arctic's. Every trip costs one, both ways.
 */
export const FARE_DIFFICULTY = 3;

/** How often a missed fare's replacement is redrawn to avoid asking the same prompt again. */
const FARE_REDRAWS = 8;

/**
 * The puzzle a flight to `to` costs: one of its `travelKinds`, at
 * `FARE_DIFFICULTY`. A different prompt from `avoid` (the one just missed)
 * when a few redraws find one.
 */
export function farePuzzle(rng: Rng, to: LandId, avoid?: string): Puzzle {
	const kinds = getLand(to).travelKinds;
	let puzzle = generatePuzzle(rng, FARE_DIFFICULTY, kinds);
	for (let i = 0; i < FARE_REDRAWS && puzzle.prompt === avoid; i++) {
		puzzle = generatePuzzle(rng, FARE_DIFFICULTY, kinds);
	}
	return puzzle;
}

/**
 * Whether `land` asks a kid to pick a first animal: they stand there with no
 * animal of that land (their first arrival), and the land has starters to
 * pick from. Nordland's party is never empty (a game starts with a starter,
 * and the witch doctor always leaves one), so only a later land asks.
 */
export function needsStarter(land: LandId, party: readonly unknown[]): boolean {
	return party.length === 0 && getLand(land).starters.length > 0;
}

/** Whether `speciesId` is one of land `land`'s starters. */
export function isLandStarter(land: LandId, speciesId: unknown): boolean {
	return typeof speciesId === 'string' && getLand(land).starters.includes(speciesId);
}
