import { describe, expect, it } from 'vitest';
import { ANIMALS, canFightIn, getAnimal, skiesOf } from '../src/animals/catalog.js';
import { BIOME_POLE } from '../src/animals/types.js';
import { ITEMS, itemsForSale } from '../src/items/catalog.js';
import { fly, type LandPlace, type LandStay } from '../src/lands/fly.js';
import {
	FIRST_LAND,
	LAND_IDS,
	SEEDS_PER_LAND,
	isLandId,
	landOfSeed,
	landSeed,
	type LandId
} from '../src/lands/ids.js';
import {
	FARE_DIFFICULTY,
	LANDS,
	availableLands,
	farePuzzle,
	flyRefusal,
	getLand,
	needsStarter,
	shopFor,
	unlockLands
} from '../src/lands/lands.js';
import { STARTERS, STARTER_TIER } from '../src/party/starters.js';
import { answerText, checkAnswer } from '../src/puzzles/registry.js';
import { ALL_PUZZLE_KINDS } from '../src/puzzles/types.js';
import { Rng, hashInts } from '../src/rng.js';
import { biomeLand } from '../src/world/biomes.js';
import { EDITS_BUDGET, WorldEdits } from '../src/world/edits.js';
import { TENT_LATTICE, onTentLattice, tileAtWorld } from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import { TENT_MAP_SPOTS, mappedTent, tentArrival } from '../src/world/tent-map.js';
import { canTalkToDoctor, nearestTent } from '../src/world/tents.js';
import { isWalkable, step, type GridPos } from '../src/world/types.js';
import {
	FIRST_WORLD,
	LAST_WORLD,
	MAX_WORLDS_KEPT,
	WORLD_ONE_SEED,
	travel,
	worldSeed,
	type WorldStay
} from '../src/world/worlds.js';

/**
 * Lands ([[PRODUCT]] §4 "Lands", #191): the registry of content packs, the
 * seeds of each land's worlds, the unlock chain, the rule for a flight, the
 * tent mapping and what a flight swaps.
 */

describe('the land registry', () => {
	it('lists every land once, in unlock order, Nordland first and The Arctic after it', () => {
		expect(LANDS.map((l) => l.id)).toEqual(LAND_IDS);
		expect(LAND_IDS).toEqual(['nordland', 'arctic']);
		expect(FIRST_LAND).toBe('nordland');
		LANDS.forEach((land, i) => expect(land.order, land.id).toBe(i));
		for (const id of LAND_IDS) expect(isLandId(id)).toBe(true);
		for (const junk of ['', 'Nordland', 'atlantis', 7, null, undefined]) {
			expect(isLandId(junk), String(junk)).toBe(false);
		}
		expect(() => getLand('atlantis' as LandId)).toThrow();
	});

	it("Nordland is today's game: its 50 species, its starters, its shop, tokens and its sums", () => {
		const nordland = getLand('nordland');
		expect(nordland.available).toBe(true);
		// Every species of Nordland, in catalog order: the 50 a kid sets free to fly on. A later
		// land's animals, further down the catalog, never join them.
		expect(nordland.species).toEqual(ANIMALS.slice(0, 50).map((a) => a.id));
		expect(nordland.species).toHaveLength(50);
		expect(nordland.starters).toEqual(STARTERS);
		expect(shopFor('nordland')).toEqual(itemsForSale());
		expect(nordland.currency).toBe('tokens');
		expect(nordland.look).toBe('bare');
	});

	it('The Arctic is registered and closed: its first animals, and no shop until #191 step 6', () => {
		const arctic = getLand('arctic');
		expect(arctic.available).toBe(false);
		expect(availableLands()).toEqual(['nordland']);
		// #192's first wave: its small land animals, the three starters first, in catalog order.
		expect(arctic.species).toEqual(ANIMALS.slice(50).map((a) => a.id));
		expect(arctic.species).toHaveLength(15);
		expect(arctic.starters).toEqual(['arctic-fox', 'arctic-hare', 'puffin']);
		expect(arctic.shop).toEqual([]);
		expect(arctic.currency).toBe('ice-dollars');
		expect(arctic.look).toBe('warm-hat');
	});

	it('every species is of one land, and lives and flies only there; in The Arctic on one pole, but the Arctic tern (#192)', () => {
		const lands = ANIMALS.map((a) =>
			LANDS.filter((l) => l.species.includes(a.id)).map((l) => l.id)
		);
		expect(lands.filter((of) => of.length !== 1)).toEqual([]);
		const twoPoles: string[] = [];
		for (const [i, a] of ANIMALS.entries()) {
			const homes = [...a.habitats, ...skiesOf(a)];
			for (const b of homes) expect(biomeLand(b), `${a.id} in ${b}`).toBe(lands[i]![0]);
			const poles = new Set(homes.map((b) => BIOME_POLE[b]));
			if (poles.size > 1) twoPoles.push(a.id);
		}
		// It nests in the Arctic and spends the southern summer on the Antarctic's sea ice.
		expect(twoPoles).toEqual(['arctic-tern']);
	});

	it("every land's species, starters, shop and fare are ones the catalogs have, and fit the rules", () => {
		const kinds = new Set<string>(ALL_PUZZLE_KINDS);
		const items = new Set<string>(ITEMS.map((i) => i.id));
		for (const land of LANDS) {
			expect(new Set(land.species).size, land.id).toBe(land.species.length);
			for (const id of land.species) expect(() => getAnimal(id), id).not.toThrow();
			for (const id of land.starters) {
				expect(land.species, `${land.id}'s starter ${id} lives there`).toContain(id);
				expect(getAnimal(id).tier, id).toBe(STARTER_TIER);
				expect(canFightIn(id, 'land'), id).toBe(true);
			}
			for (const id of land.shop) expect(items.has(id), id).toBe(true);
			expect(land.travelKinds.length, land.id).toBeGreaterThan(0);
			for (const kind of land.travelKinds) expect(kinds.has(kind), kind).toBe(true);
			// A land a kid can go to has someone to start with there.
			if (land.available) expect(land.starters.length, land.id).toBeGreaterThan(0);
		}
		// Every species of the catalog lives in some land.
		const placed = new Set(LANDS.flatMap((l) => l.species));
		for (const a of ANIMALS) expect(placed.has(a.id), a.id).toBe(true);
	});
});

describe("the lands' seeds", () => {
	it("Nordland's world n is exactly worldSeed(n): every save and World 1 stay where they were", () => {
		for (let n = FIRST_WORLD; n <= LAST_WORLD; n++) {
			if (landSeed('nordland', n) !== worldSeed(n)) expect.fail(`world ${n}`);
		}
		expect(landSeed('nordland', 1)).toBe(821322741);
		expect(landSeed('nordland', 1)).toBe(WORLD_ONE_SEED);
		// World 1's spawn tile, the one every save from before numbered worlds knows.
		expect(spawnPoint(landSeed('nordland', 1))).toEqual({ x: -2, y: 6 });
	});

	it("give every land's every world a seed of its own, and say back which land a seed is", () => {
		const seen = new Map<number, string>();
		for (const land of LAND_IDS) {
			for (let n = FIRST_WORLD; n <= LAST_WORLD; n++) {
				const seed = landSeed(land, n);
				const before = seen.get(seed);
				if (before) expect.fail(`${land} ${n} shares a seed with ${before}`);
				seen.set(seed, `${land} ${n}`);
				if (landOfSeed(seed) !== land)
					expect.fail(`${land} ${n}: landOfSeed says ${landOfSeed(seed)}`);
			}
		}
		expect(landSeed('arctic', 42)).toBe(WORLD_ONE_SEED + SEEDS_PER_LAND + 41);
		// A seed of no land's (a test's random seed) is Nordland's ground.
		for (const seed of [0, 1, WORLD_ONE_SEED - 1, WORLD_ONE_SEED + 9999, 2 ** 32 - 1]) {
			expect(landOfSeed(seed), String(seed)).toBe('nordland');
		}
		expect(() => landSeed('arctic', 0)).toThrow();
		expect(() => landSeed('arctic', 10_000)).toThrow();
		expect(() => landSeed('atlantis' as LandId, 1)).toThrow();
	});

	it('make Arktis n a world of its own, not Nordland n', () => {
		let same = 0;
		let all = 0;
		for (let y = -20; y < 20; y++) {
			for (let x = -20; x < 20; x++) {
				all++;
				const a = tileAtWorld(landSeed('nordland', 42), x, y).kind;
				const b = tileAtWorld(landSeed('arctic', 42), x, y).kind;
				if (a === b) same++;
			}
		}
		expect(same / all).toBeLessThan(0.8);
	});
});

describe('unlocking a land', () => {
	const nordland = getLand('nordland').species;

	it('opens the next land once every species of the one before is set free, and never before', () => {
		expect(unlockLands([], [])).toEqual(['nordland']);
		expect(unlockLands([], nordland.slice(1))).toEqual(['nordland']);
		expect(unlockLands([], nordland.slice(0, -1))).toEqual(['nordland']);
		expect(unlockLands([], nordland)).toEqual(['nordland', 'arctic']);
		// In any order, with kinds of other lands among them.
		const shuffled = [...nordland].reverse();
		expect(unlockLands(['nordland'], shuffled)).toEqual(['nordland', 'arctic']);
	});

	it('keeps a land unlocked for good, and an id this build lacks as it was', () => {
		expect(unlockLands(['nordland', 'arctic'], [])).toEqual(['nordland', 'arctic']);
		expect(unlockLands(['arctic'], [])).toEqual(['nordland', 'arctic']);
		expect(unlockLands(['nordland', 'savannah'], [])).toEqual(['nordland', 'savannah']);
		expect(unlockLands(['savannah'], nordland)).toEqual(['nordland', 'arctic', 'savannah']);
	});

	it('reads a list with a land twice as the list once, and still unlocks what is new', () => {
		// A hand-edited save can hold one; the adversarial review of #196 found the unlock skipped.
		expect(unlockLands(['nordland', 'nordland'], nordland)).toEqual(['nordland', 'arctic']);
		expect(unlockLands(['nordland', 'nordland'], [])).toEqual(['nordland']);
		expect(unlockLands(['arctic', 'arctic', 'nordland'], [])).toEqual(['nordland', 'arctic']);
	});

	it('hands back the very same list when nothing is new', () => {
		const open = unlockLands([], []);
		expect(unlockLands(open, ['fox'])).toBe(open);
		const both = unlockLands(open, nordland);
		expect(both).not.toBe(open);
		expect(unlockLands(both, nordland)).toBe(both);
	});

	it("opens no land for another land's animals: The Arctic's own set free open nothing in Nordland", () => {
		// Every Arctic animal set free, and every Nordland one but the last: still Nordland alone.
		const arctic = getLand('arctic').species;
		expect(unlockLands([], [...arctic, ...nordland.slice(0, -1)])).toEqual(['nordland']);
		// Every animal there is: The Arctic, and nothing past it, the last land there is.
		expect(
			unlockLands(
				[],
				ANIMALS.map((a) => a.id)
			)
		).toEqual(['nordland', 'arctic']);
	});
});

describe('a flight from the witch doctor', () => {
	const trip = { here: 'nordland' as LandId, unlocked: ['nordland', 'arctic'], open: LAND_IDS };

	it('goes to an unlocked, built land other than this one, and says why not otherwise, in order', () => {
		expect(flyRefusal(trip, 'arctic')).toBeNull();
		expect(flyRefusal({ ...trip, here: 'arctic' }, 'nordland')).toBeNull();
		for (const junk of ['atlantis', '', 7, null, undefined, { land: 'arctic' }]) {
			expect(flyRefusal(trip, junk), String(junk)).toBe('no-such-land');
		}
		expect(flyRefusal(trip, 'nordland')).toBe('already-here');
		expect(flyRefusal({ ...trip, open: ['nordland'] }, 'arctic')).toBe('land-unavailable');
		expect(flyRefusal({ ...trip, unlocked: ['nordland'] }, 'arctic')).toBe('land-locked');
		// Not built comes before locked: a land not built yet is no goal to work towards.
		expect(flyRefusal({ ...trip, open: ['nordland'], unlocked: [] }, 'arctic')).toBe(
			'land-unavailable'
		);
		// Nordland, the first land, is always unlocked.
		expect(flyRefusal({ here: 'arctic', unlocked: [], open: LAND_IDS }, 'nordland')).toBeNull();
		// In this build The Arctic is not built: nobody flies there.
		expect(flyRefusal({ ...trip, open: availableLands() }, 'arctic')).toBe('land-unavailable');
	});

	it("asks a fare of the land's own kinds, at the fare's difficulty, a different one after a miss", () => {
		for (const land of LAND_IDS) {
			for (let s = 0; s < 200; s++) {
				const rng = new Rng(hashInts(51, s));
				const puzzle = farePuzzle(rng, land);
				expect(getLand(land).travelKinds).toContain(puzzle.kind);
				expect(puzzle.difficulty).toBe(FARE_DIFFICULTY);
				expect(checkAnswer(puzzle, answerText(puzzle))).toBe(true);
				const next = farePuzzle(new Rng(hashInts(52, s)), land, puzzle.prompt);
				expect(next.prompt).not.toBe(puzzle.prompt);
			}
		}
	});

	it('asks for a starter only in a land with none of the kid’s animals, and starters to pick from', () => {
		expect(needsStarter('nordland', [])).toBe(true);
		expect(needsStarter('nordland', [{}])).toBe(false);
		// The Arctic has its three (#192): a first arrival picks one.
		expect(needsStarter('arctic', [])).toBe(true);
		expect(needsStarter('arctic', [{}])).toBe(false);
	});
});

// --- the tent mapping --------------------------------------------------------

/** The lattice spot (i, j). */
function spot(i: number, j: number): GridPos {
	return {
		x: TENT_LATTICE.atX + i * TENT_LATTICE.everyX,
		y: TENT_LATTICE.atY + j * TENT_LATTICE.everyY
	};
}

/** Nordland's tents of world `world` within `r` lattice spots of the origin, that a kid can stand beside. */
function nordlandTents(world: number, r: number): GridPos[] {
	const seed = landSeed('nordland', world);
	const tents: GridPos[] = [];
	for (let j = -r; j <= r; j++) {
		for (let i = -r; i <= r; i++) {
			const p = spot(i, j);
			if (tileAtWorld(seed, p.x, p.y).kind !== 'tent') continue;
			// One with a side a kid can stand on: a boxed-in tent is passed over (`mappedTent`).
			const arrival = tentArrival(seed, p);
			if (arrival?.tent.x !== p.x || arrival.tent.y !== p.y) continue;
			tents.push(p);
		}
	}
	return tents;
}

describe('the tent mapping', () => {
	it('flies to the tent on the same spot when the land has one there, else the nearest, by brute force', () => {
		for (let s = 0; s < 300; s++) {
			const rng = new Rng(hashInts(61, s));
			// A land of random tents (a third of the spots) and random ground.
			const salt = rng.int(0, 2 ** 30);
			const isTent = (p: GridPos) => onTentLattice(p.x, p.y) && hashInts(salt, p.x, p.y) % 3 === 0;
			const canStand = (p: GridPos) => hashInts(salt, p.x, p.y, 1) % 4 !== 0;
			const from = rng.chance(0.7)
				? spot(rng.int(-30, 30), rng.int(-30, 30))
				: { x: rng.int(-700, 700), y: rng.int(-700, 700) };
			const got = mappedTent(from, { isTent, canStand });
			// Brute force: every spot within the reach, the nearest with a side to stand on.
			let best: { tent: GridPos; d2: number } | null = null;
			const i0 = Math.round((from.x - TENT_LATTICE.atX) / TENT_LATTICE.everyX);
			const j0 = Math.round((from.y - TENT_LATTICE.atY) / TENT_LATTICE.everyY);
			for (let j = j0 - TENT_MAP_SPOTS; j <= j0 + TENT_MAP_SPOTS; j++) {
				for (let i = i0 - TENT_MAP_SPOTS; i <= i0 + TENT_MAP_SPOTS; i++) {
					const p = spot(i, j);
					if (!isTent(p)) continue;
					const sides = [step(p, 'down'), step(p, 'left'), step(p, 'right'), step(p, 'up')];
					if (!sides.some(canStand)) continue;
					const d2 = (p.x - from.x) ** 2 + (p.y - from.y) ** 2;
					if (
						!best ||
						d2 < best.d2 ||
						(d2 === best.d2 && (p.y < best.tent.y || (p.y === best.tent.y && p.x < best.tent.x)))
					) {
						best = { tent: p, d2 };
					}
				}
			}
			expect(got?.tent ?? null, `${s}`).toEqual(best?.tent ?? null);
			if (!got) continue;
			// Beside it, on ground, facing it: in front of the door when that side will do.
			expect(canStand(got.stand)).toBe(true);
			expect(step(got.stand, got.facing)).toEqual(got.tent);
			if (canStand(step(got.tent, 'down'))) expect(got.facing).toBe('up');
			if (
				isTent(from) &&
				[step(from, 'down'), step(from, 'left'), step(from, 'right'), step(from, 'up')].some(
					canStand
				)
			) {
				expect(got.tent, `${s}: the tent on the same spot`).toEqual(from);
			}
		}
	});

	it('Nordland → The Arctic, a tent on every spot → Nordland comes home to the tent it left', () => {
		// The Arctic of #191 step 4: a tent on every lattice spot, a clearing of snow all round.
		let tried = 0;
		for (const world of [1, 2, 42, 777, 9999]) {
			const seed = landSeed('nordland', world);
			const arctic = landSeed('arctic', world);
			for (const tent of nordlandTents(world, 6)) {
				tried++;
				const there = tentArrival(arctic, tent);
				expect(there?.tent, `world ${world}`).toEqual(tent);
				expect(canTalkToDoctor(arctic, there!.stand, there!.facing)).toBe(true);
				const back = tentArrival(seed, there!.tent);
				expect(back?.tent, `world ${world}`).toEqual(tent);
				// The kid can talk to the witch doctor from where they come down.
				expect(canTalkToDoctor(seed, back!.stand, back!.facing)).toBe(true);
				expect(isWalkable(tileAtWorld(seed, back!.stand.x, back!.stand.y).kind)).toBe(true);
			}
		}
		expect(tried).toBeGreaterThan(50);
	});

	it("into Nordland from a spot with no tent there: Nordland's nearest tent, one the kid can stand beside", () => {
		const seed = landSeed('nordland', 1);
		let moved = 0;
		for (let j = -8; j <= 8; j++) {
			for (let i = -8; i <= 8; i++) {
				const from = spot(i, j);
				const got = tentArrival(seed, from);
				expect(got, `${from.x},${from.y}`).not.toBeNull();
				expect(tileAtWorld(seed, got!.tent.x, got!.tent.y).kind).toBe('tent');
				expect(canTalkToDoctor(seed, got!.stand, got!.facing)).toBe(true);
				if (got!.tent.x !== from.x || got!.tent.y !== from.y) moved++;
				// Never further than a tent the kid could stand beside.
				const d2 = (got!.tent.x - from.x) ** 2 + (got!.tent.y - from.y) ** 2;
				for (const other of nordlandTents(1, 9)) {
					expect((other.x - from.x) ** 2 + (other.y - from.y) ** 2).toBeGreaterThanOrEqual(d2);
				}
			}
		}
		expect(moved).toBeGreaterThan(0);
	});

	it('reads the world as the player left it: a path cleared to a boxed-in tent is a side to stand on', () => {
		const seed = landSeed('nordland', 1);
		// A tent of World 1 whose door side is a tree or a rock (and so cleared, it is ground).
		const boxed = nordlandTents(1, 12).find((t) => {
			const kind = tileAtWorld(seed, t.x, t.y + 1).kind;
			return kind === 'tree' || kind === 'rock';
		});
		expect(boxed).toBeDefined();
		const below = step(boxed!, 'down');
		expect(tentArrival(seed, boxed!)?.facing).not.toBe('up');
		const cleared = WorldEdits.none.with(below);
		expect(tentArrival(seed, boxed!, cleared)).toEqual({ tent: boxed, stand: below, facing: 'up' });
	});

	it('has the same answer from anywhere in a tent’s cell as nearestTent has the same tent close by', () => {
		// Sanity against the walking search: the tent a flight comes down at is a real tent
		// that nearestTent, from where the kid stands, finds at once.
		const seed = landSeed('nordland', 3);
		for (const tent of nordlandTents(3, 4)) {
			const got = tentArrival(seed, tent)!;
			expect(nearestTent(seed, got.stand, 0)?.tent).toEqual(tent);
		}
	});
});

// --- what a flight swaps -------------------------------------------------------

const squirrel = { id: 's1', speciesId: 'squirrel', hp: 20 };
const fox = { id: 'f1', speciesId: 'fox', hp: 30 };

function nordlandAt(world: number): LandPlace {
	const seed = landSeed('nordland', world);
	const tent = nordlandTents(world, 3)[0]!;
	const arrival = tentArrival(seed, tent)!;
	return {
		land: 'nordland',
		world,
		pos: arrival.stand,
		facing: arrival.facing,
		edits: WorldEdits.none.with({ x: 400, y: 400 }),
		worlds: [{ world: 5, pos: { x: 1, y: 2 }, facing: 'left', edits: [] }],
		party: [squirrel, fox],
		tokens: 17,
		items: ['axe', 'boat'],
		lands: []
	};
}

describe('fly', () => {
	it('refuses a land that is not one, and the land the player is in', () => {
		const here = nordlandAt(1);
		const tent = step(here.pos, here.facing);
		expect(fly(here, tent, 'atlantis', 1)).toEqual({ ok: false, reason: 'no-such-land' });
		expect(fly(here, tent, 'nordland', 1)).toEqual({ ok: false, reason: 'already-here' });
	});

	it('a first flight arrives with nothing of the land, beside a tent, in the same world number', () => {
		const here = nordlandAt(42);
		const tent = step(here.pos, here.facing);
		const out = fly(here, tent, 'arctic', 42);
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.firstVisit).toBe(true);
		const place = out.place;
		expect(place).toMatchObject({
			land: 'arctic',
			world: 42,
			party: [],
			tokens: 0,
			items: [],
			worlds: []
		});
		expect(place.edits.size).toBe(0);
		// Beside a tent of Arktis 42, facing it.
		expect(canTalkToDoctor(landSeed('arctic', 42), place.pos, place.facing)).toBe(true);
		// Nordland, as it was left: its party, tokens, items, and the world flown out of first.
		expect(place.lands).toEqual([
			{
				land: 'nordland',
				party: [squirrel, fox],
				tokens: 17,
				items: ['axe', 'boat'],
				worlds: [
					{ world: 42, pos: here.pos, facing: here.facing, edits: [...here.edits.encode()] },
					...here.worlds
				]
			}
		]);
	});

	it('a flight back picks the land up as it was, and comes home to the tent it left when the land has a tent there', () => {
		const here = nordlandAt(7);
		const tent = step(here.pos, here.facing);
		const out = fly(here, tent, 'arctic', 7);
		if (!out.ok) throw new Error('flies');
		// In the Arctic: a starter, some ice dollars. Then home from the tent they came down at.
		const arctic: LandPlace = {
			...out.place,
			party: [{ id: 'a1', speciesId: 'rabbit', hp: 22 }],
			tokens: 3
		};
		const arcticTent = step(arctic.pos, arctic.facing);
		const back = fly(arctic, arcticTent, 'nordland', 7);
		if (!back.ok) throw new Error('flies back');
		expect(back.firstVisit).toBe(false);
		expect(back.place).toMatchObject({
			land: 'nordland',
			world: 7,
			party: [squirrel, fox],
			tokens: 17,
			items: ['axe', 'boat'],
			worlds: here.worlds
		});
		expect(back.place.edits.encode()).toEqual(here.edits.encode());
		expect(back.place.lands).toEqual([
			{
				land: 'arctic',
				party: arctic.party,
				tokens: 3,
				items: [],
				worlds: [{ world: 7, pos: arctic.pos, facing: arctic.facing, edits: [] }]
			}
		]);
		// The Arctic's tent at Nordland's tent's spot (when its ground put one there) brings the kid home.
		if (arcticTent.x === tent.x && arcticTent.y === tent.y) {
			expect(step(back.place.pos, back.place.facing)).toEqual(tent);
		}
		expect(canTalkToDoctor(landSeed('nordland', 7), back.place.pos, back.place.facing)).toBe(true);
	});

	it('keeps lands and world numbers apart: a trip to another number in The Arctic leaves Nordland as it was', () => {
		const here = nordlandAt(7);
		const out = fly(here, step(here.pos, here.facing), 'arctic', 7);
		if (!out.ok) throw new Error('flies');
		const a = out.place;
		const trip = travel(
			{ world: a.world, pos: a.pos, facing: a.facing, edits: a.edits, worlds: a.worlds },
			9,
			{ home: 7, items: a.items, land: 'arctic' }
		);
		if (!trip.ok) throw new Error('travels');
		// Arktis 9's spawn, and Arktis 7 remembered among the Arctic's worlds.
		expect(trip.whereabouts.pos).toEqual(spawnPoint(landSeed('arctic', 9)));
		expect(trip.whereabouts.worlds.map((w) => w.world)).toEqual([7]);
		// Flying home from Arktis 9 lands in Nordland 9, a world Nordland never saw: no clearings.
		const there: LandPlace = { ...a, ...trip.whereabouts };
		const home = fly(there, step(there.pos, there.facing), 'nordland', 7);
		if (!home.ok) throw new Error('flies home');
		expect(home.place.world).toBe(9);
		expect(home.place.edits.size).toBe(0);
		expect(home.place.party).toEqual([squirrel, fox]);
		// Nordland 7, where the cleared tile is, is among Nordland's worlds left behind.
		expect(home.place.worlds.find((w) => w.world === 7)?.edits).toEqual([...here.edits.encode()]);
	});

	it('over random flights and trips: each land once, never the one the player is in, things never lost or mixed, the budget kept', () => {
		for (let run = 0; run < 40; run++) {
			const rng = new Rng(hashInts(71, run));
			let place: LandPlace = { ...nordlandAt(1), edits: WorldEdits.none };
			// What each land holds, by the test's own book: its party, money and items, never mixed.
			const owned = new Map<LandId, { party: string; tokens: number; items: string }>();
			const record = (p: LandPlace) =>
				owned.set(p.land, {
					party: JSON.stringify(p.party),
					tokens: p.tokens,
					items: JSON.stringify(p.items)
				});
			record(place);
			for (let op = 0; op < 30; op++) {
				if (rng.chance(0.5)) {
					const to = LAND_IDS.find((l) => l !== place.land)!;
					const out = fly(place, step(place.pos, place.facing), to, 1);
					if (!out.ok) throw new Error('flies');
					const kept = owned.get(to);
					expect(out.firstVisit).toBe(kept === undefined);
					if (kept) {
						expect(JSON.stringify(out.place.party)).toBe(kept.party);
						expect(out.place.tokens).toBe(kept.tokens);
						expect(JSON.stringify(out.place.items)).toBe(kept.items);
					}
					place = out.place;
				} else if (rng.chance(0.5)) {
					// Earn something in this land.
					place = {
						...place,
						tokens: place.tokens + rng.int(1, 9),
						party: [...place.party, { id: `${place.land}-${op}`, speciesId: 'rabbit', hp: 22 }]
					};
				} else {
					const to = rng.int(1, 4);
					if (to === place.world) continue;
					const trip = travel(
						{
							world: place.world,
							pos: place.pos,
							facing: place.facing,
							edits: place.edits,
							worlds: place.worlds
						},
						to,
						{ home: 1, items: place.items, land: place.land }
					);
					if (!trip.ok) throw new Error('travels');
					place = { ...place, ...trip.whereabouts };
				}
				record(place);
				// The rules of the lands left behind.
				const lands = place.lands.map((l) => l.land);
				expect(new Set(lands).size).toBe(lands.length);
				expect(lands).not.toContain(place.land);
				for (const l of place.lands) {
					const worlds = l.worlds.map((w) => w.world);
					expect(new Set(worlds).size).toBe(worlds.length);
					expect(worlds.length).toBeLessThanOrEqual(MAX_WORLDS_KEPT);
				}
				expect(place.worlds.map((w) => w.world)).not.toContain(place.world);
			}
		}
	});

	it('keeps every land’s cleared tiles within the one budget, the world reached whole', () => {
		// Nordland 1 holds a big clearing, the world flown out of; Arktis 1 holds a bigger one.
		const big = (x0: number) => {
			let e = WorldEdits.none;
			for (let cx = 0; cx < 40; cx++)
				for (let i = 0; i < 200; i++)
					e = e.with({ x: x0 + cx * 16 + (i % 16), y: Math.floor(i / 16) });
			return e;
		};
		const nordland = big(0);
		const arcticWorld: WorldStay = {
			world: 1,
			pos: { x: 0, y: 0 },
			facing: 'down',
			edits: [...big(5000).encode()]
		};
		const arcticStay: LandStay = {
			land: 'arctic',
			party: [],
			tokens: 0,
			items: [],
			worlds: [arcticWorld]
		};
		const length = (e: readonly string[]) => (e.length === 0 ? 0 : JSON.stringify(e).length);
		expect(length(nordland.encode()) + length(arcticWorld.edits)).toBeGreaterThan(EDITS_BUDGET);
		const here: LandPlace = { ...nordlandAt(1), edits: nordland, worlds: [], lands: [arcticStay] };
		const out = fly(here, step(here.pos, here.facing), 'arctic', 1);
		if (!out.ok) throw new Error('flies');
		// The Arctic's world, reached, is whole; Nordland's, left, is cut to what fits.
		expect(out.place.edits.encode()).toEqual(arcticWorld.edits);
		const left = out.place.lands[0]!.worlds[0]!.edits;
		expect(length(out.place.edits.encode()) + length(left)).toBeLessThanOrEqual(EDITS_BUDGET);
		expect(left.length).toBeGreaterThan(0);
	});
});
