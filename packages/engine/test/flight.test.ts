import { describe, expect, it } from 'vitest';
import { gearOf } from '../src/items/catalog.js';
import { hashString, Rng } from '../src/rng.js';
import { CLEARING_TOOL } from '../src/world/clearing.js';
import { WorldEdits, editedTileAt } from '../src/world/edits.js';
import {
	GLIDE_TILES,
	flightPos,
	flightTile,
	glideOn,
	isLandable,
	landFlight,
	landingDistance,
	takeOff,
	type Flight
} from '../src/world/flight.js';
import { tileAtWorld } from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import {
	CHUNK_SIZE,
	isPassable,
	type Direction,
	type GridPos,
	type TileKind
} from '../src/world/types.js';
import { WORLD_ONE_SEED, worldSeed } from '../src/world/worlds.js';

/**
 * The glider's rules ([[PRODUCT]] §4 "World", [[INVARIANTS]] § World: "A
 * flight always ends on a tile the kid can stand on"), checked against the
 * issue's own table and a brute force of the rule, written here in its own
 * terms rather than read from the engine.
 */

const SEEDS = [WORLD_ONE_SEED, worldSeed(42), worldSeed(4077)];
const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];
const TOOLS = ['boat', 'axe', 'pickaxe'] as const;
/** Every set of the three tools the glider cares about, each with the glider. */
const GEAR_SETS: readonly string[][] = Array.from({ length: 8 }, (_, mask) => [
	'glider',
	...TOOLS.filter((_, i) => mask & (1 << i))
]);

/** The issue's table: whether a kid owning `items` can come down on a tile of this kind. */
function landableByTable(kind: TileKind, items: readonly string[]): boolean {
	switch (kind) {
		case 'grass':
		case 'tallgrass':
		case 'sand':
			return true;
		case 'water':
		case 'deepwater':
			return items.includes('boat');
		case 'tree':
			return items.includes('axe');
		case 'rock':
			return items.includes('pickaxe');
		case 'tent':
			return false;
	}
}

/** One step `n` tiles out, the long way round: `n` single steps. */
function ahead(from: GridPos, dir: Direction, n: number): GridPos {
	const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
	let at = { ...from };
	for (let i = 0; i < n; i++) at = { x: at.x + dx!, y: at.y + dy! };
	return at;
}

/** The rule, by brute force: the kinds of the 20 ahead, the reach, and where each let-go lands. */
function bruteFlight(
	seed: number,
	edits: WorldEdits,
	from: GridPos,
	dir: Direction,
	items: readonly string[]
): { kinds: TileKind[]; reach: number | null; landing: (flown: number) => number } {
	const kinds: TileKind[] = [];
	for (let n = 1; n <= GLIDE_TILES; n++) {
		const at = ahead(from, dir, n);
		kinds.push(editedTileAt(seed, edits, at.x, at.y).kind);
	}
	const ok = (n: number) => landableByTable(kinds[n - 1]!, items);
	let reach: number | null = null;
	for (let n = 1; n <= GLIDE_TILES; n++) if (ok(n)) reach = n;
	const landing = (flown: number) => {
		for (let n = Math.max(1, flown); n <= (reach ?? 0); n++) if (ok(n)) return n;
		return -1;
	};
	return { kinds, reach, landing };
}

/**
 * A random take-off: from a tile the kid could stand on with their gear, near
 * something a glider flies over half the time (water, a tree, a rock, a tent
 * in front), with some trees and rocks of the line already cleared.
 */
function randomTakeOff(
	rng: Rng,
	seed: number
): { from: GridPos; dir: Direction; items: string[]; edits: WorldEdits } | null {
	const home = spawnPoint(seed);
	const items = [...rng.pick(GEAR_SETS)];
	const dir = rng.pick(DIRECTIONS);
	let from = { x: home.x + rng.int(-150, 150), y: home.y + rng.int(-150, 150) };
	const aim = rng.int(0, 2);
	if (aim > 0) {
		// Walk back from the first thing in the way (a third of the time, the first
		// water: a lake is what most often leaves nowhere to land), so the flight
		// starts facing it.
		const blocks = (kind: TileKind) =>
			kind === 'water' ||
			kind === 'deepwater' ||
			(aim === 1 && (kind === 'tree' || kind === 'rock' || kind === 'tent'));
		for (let n = 1; n <= 60; n++) {
			const at = ahead(from, dir, n);
			if (blocks(tileAtWorld(seed, at.x, at.y).kind)) {
				from = ahead(from, dir, n - rng.int(1, 3));
				break;
			}
		}
	}
	let edits = WorldEdits.none;
	for (let n = 1; n <= GLIDE_TILES; n++) {
		const at = ahead(from, dir, n);
		const kind = tileAtWorld(seed, at.x, at.y).kind;
		if ((kind === 'tree' || kind === 'rock') && rng.chance(0.2)) edits = edits.with(at);
	}
	const standing = editedTileAt(seed, edits, from.x, from.y).kind;
	if (!isPassable(standing, gearOf({ items }))) return null;
	return { from, dir, items, edits };
}

describe('isLandable', () => {
	it("is the issue's table, for every kind and every set of tools", () => {
		const kinds: TileKind[] = [
			'grass',
			'tallgrass',
			'sand',
			'water',
			'deepwater',
			'rock',
			'tree',
			'tent'
		];
		for (const items of [[], ...GEAR_SETS, ['lantern', 'axe']]) {
			for (const kind of kinds) {
				expect(isLandable(kind, { items }), `${kind} with ${items}`).toBe(
					landableByTable(kind, items)
				);
			}
		}
		// The axe never makes a rock landable, nor the pickaxe a tree, and a tent is never landable.
		expect(isLandable('rock', { items: ['axe', 'boat'] })).toBe(false);
		expect(isLandable('tree', { items: ['pickaxe', 'boat'] })).toBe(false);
		expect(isLandable('tent', { items: ['glider', ...TOOLS] })).toBe(false);
	});
});

describe('a flight', () => {
	it('takes off only with the glider and somewhere to land, and its reach is the last landable tile of the 20 ahead', () => {
		const rng = new Rng(hashString('take-offs'));
		const bad: string[] = [];
		let flights = 0;
		let refused = 0;
		for (let i = 0; i < 1500; i++) {
			const seed = SEEDS[i % SEEDS.length]!;
			const start = randomTakeOff(rng, seed);
			if (!start) continue;
			const { from, dir, items, edits } = start;
			const brute = bruteFlight(seed, edits, from, dir, items);
			const result = takeOff(seed, edits, { pos: from, facing: dir, items });
			const at = `${seed} (${from.x}, ${from.y}) ${dir} [${items}]`;
			if (brute.reach === null) {
				refused++;
				if (result.ok || result.reason !== 'nowhere-to-land') bad.push(`${at}: took off`);
				continue;
			}
			flights++;
			if (!result.ok) {
				bad.push(`${at}: refused (${result.reason}), reach ${brute.reach}`);
				continue;
			}
			const { flight } = result;
			if (flight.reach !== brute.reach)
				bad.push(`${at}: reach ${flight.reach}, not ${brute.reach}`);
			if (
				flight.flown !== 0 ||
				flight.dir !== dir ||
				flight.from.x !== from.x ||
				flight.from.y !== from.y
			) {
				bad.push(`${at}: ${JSON.stringify(flight)}`);
			}
			// Without the glider, never.
			const without = takeOff(seed, edits, { pos: from, facing: dir, items: items.slice(1) });
			if (without.ok || without.reason !== 'no-glider') bad.push(`${at}: flew without the glider`);
		}
		expect(bad.slice(0, 20)).toEqual([]);
		// The sweep sees both: flights and refusals.
		expect(flights).toBeGreaterThan(300);
		expect(refused).toBeGreaterThan(10);
	});

	it('always comes down on a tile the kid can stand on, at most 20 tiles out, wherever they let go', () => {
		const rng = new Rng(hashString('landings'));
		const bad: string[] = [];
		let cleared = 0;
		let carried = 0;
		for (let i = 0; i < 700; i++) {
			const seed = SEEDS[i % SEEDS.length]!;
			const start = randomTakeOff(rng, seed);
			if (!start) continue;
			const { from, dir, items, edits } = start;
			const result = takeOff(seed, edits, { pos: from, facing: dir, items });
			if (!result.ok) continue;
			const brute = bruteFlight(seed, edits, from, dir, items);
			const at = `${seed} (${from.x}, ${from.y}) ${dir} [${items}]`;
			let flight: Flight = result.flight;
			// Every point to let go at: over the take-off tile (still rising), then each tile flown.
			for (;;) {
				const want = brute.landing(flight.flown);
				const distance = landingDistance(seed, edits, flight, { items });
				const landing = landFlight(seed, edits, flight, { items });
				const where = `${at} let go at ${flight.flown}`;
				if (distance !== want) bad.push(`${where}: lands at ${distance}, not ${want}`);
				if (landing.flown !== distance) bad.push(`${where}: flew ${landing.flown} for ${distance}`);
				if (distance < 1 || distance > GLIDE_TILES || distance > flight.reach) {
					bad.push(`${where}: lands ${distance} out`);
				}
				if (distance < flight.flown) bad.push(`${where}: put back to ${distance}`);
				if (distance > Math.max(1, flight.flown)) carried++;
				const pos = ahead(from, dir, distance);
				if (landing.pos.x !== pos.x || landing.pos.y !== pos.y)
					bad.push(`${where}: at ${JSON.stringify(landing.pos)}`);
				// Standing there, in the world as the landing left it, with what they own.
				const under = editedTileAt(seed, landing.edits, pos.x, pos.y).kind;
				if (!isPassable(under, gearOf({ items }))) bad.push(`${where}: stands on ${under}`);
				// A tree or a rock there is cleared with its tool; nothing else is ever cleared.
				const was = brute.kinds[distance - 1]!;
				if (was === 'tree' || was === 'rock') {
					cleared++;
					if (!items.includes(CLEARING_TOOL[was]))
						bad.push(`${where}: on a ${was} without its tool`);
					if (landing.cleared?.was !== was || !landing.edits.has(pos.x, pos.y)) {
						bad.push(`${where}: the ${was} is not cleared`);
					}
					if (landing.cleared && landing.cleared.tool !== CLEARING_TOOL[was])
						bad.push(`${where}: wrong tool`);
				} else if (landing.cleared !== null || landing.edits !== edits) {
					bad.push(`${where}: cleared ${was}`);
				}
				const flightAt = flightPos(flight);
				const want2 = ahead(from, dir, flight.flown);
				if (flightAt.x !== want2.x || flightAt.y !== want2.y)
					bad.push(`${where}: over the wrong tile`);
				const next = glideOn(flight);
				if (flight.flown === flight.reach) {
					// At the reach it goes no further.
					if (next !== flight) bad.push(`${where}: glided past the reach`);
					break;
				}
				if (next.flown !== flight.flown + 1 || next.reach !== flight.reach)
					bad.push(`${where}: glided oddly`);
				flight = next;
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
		// The sweep carries kids on past water and trees, and lands some on trees and rocks.
		expect(carried).toBeGreaterThan(200);
		expect(cleared).toBeGreaterThan(50);
	});

	it('is pure: the flight and the world it was given are left as they were', () => {
		const from = { x: 143, y: -152 };
		const edits = WorldEdits.none.with({ x: 150, y: -150 });
		const before = edits.encode();
		const flight = Object.freeze({
			from: Object.freeze(from),
			dir: 'down' as const,
			reach: 20,
			flown: 3
		});
		const items = Object.freeze(['glider', 'axe']);
		const a = landFlight(WORLD_ONE_SEED, edits, flight, { items });
		const b = landFlight(WORLD_ONE_SEED, edits, flight, { items });
		expect(a).toEqual(b);
		expect(edits.encode()).toEqual(before);
		expect(glideOn(flight)).not.toBe(flight);
		expect(flight.flown).toBe(3);
	});

	it('crosses chunk borders and zero the same in every direction, negative coordinates included', () => {
		// Take-offs just either side of a chunk border and of zero, each way, against the brute force.
		const bad: string[] = [];
		const edges = [-CHUNK_SIZE - 1, -CHUNK_SIZE, -1, 0, CHUNK_SIZE - 1, CHUNK_SIZE];
		for (const seed of SEEDS) {
			for (const x of edges) {
				for (const y of edges) {
					for (const dir of DIRECTIONS) {
						for (const items of [['glider'], ['glider', 'boat', 'axe', 'pickaxe']]) {
							const from = { x, y };
							const gear = { items };
							const brute = bruteFlight(seed, WorldEdits.none, from, dir, items);
							const result = takeOff(seed, WorldEdits.none, { pos: from, facing: dir, items });
							const at = `${seed} (${x}, ${y}) ${dir} [${items}]`;
							if ((brute.reach === null) !== !result.ok) bad.push(`${at}: took off or not`);
							if (!result.ok) continue;
							if (result.flight.reach !== brute.reach) bad.push(`${at}: reach`);
							for (let flown = 0; flown <= result.flight.reach; flown++) {
								const flight = { ...result.flight, flown };
								if (landingDistance(seed, WorldEdits.none, flight, gear) !== brute.landing(flown)) {
									bad.push(`${at} at ${flown}`);
								}
								const tile = flightTile(from, dir, flown);
								const walked = ahead(from, dir, flown);
								if (tile.x !== walked.x || tile.y !== walked.y) bad.push(`${at}: tile ${flown}`);
							}
						}
					}
				}
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});
});

/**
 * The issue's worked examples, on lines found in World 1 (whose tiles
 * `world.test.ts` pins): each first checks the line is what it says, so a
 * change to the world fails here with the reason, not with a wrong number.
 */
describe('in World 1', () => {
	const seed = WORLD_ONE_SEED;
	const kindsOf = (from: GridPos, dir: Direction, n: number) =>
		Array.from({ length: n }, (_, i) => {
			const at = ahead(from, dir, i + 1);
			return tileAtWorld(seed, at.x, at.y).kind;
		});
	const isWaterKind = (k: TileKind) => k === 'water' || k === 'deepwater';
	const ground = (k: TileKind) => k === 'grass' || k === 'tallgrass' || k === 'sand';
	const lands = (
		from: GridPos,
		dir: Direction,
		items: string[],
		letGo: number,
		edits = WorldEdits.none
	) => {
		const up = takeOff(seed, edits, { pos: from, facing: dir, items });
		if (!up.ok) return up.reason;
		const flight = { ...up.flight, flown: letGo };
		return landFlight(seed, edits, flight, { items });
	};

	it('crosses the lake north of the start without the boat, landing on its far shore however early the kid lets go', () => {
		const start = spawnPoint(seed);
		expect(start).toEqual({ x: -2, y: 6 });
		const line = kindsOf(start, 'up', 14);
		expect(line.slice(0, 13).every(isWaterKind)).toBe(true);
		expect(line[13]).toBe('sand');
		for (let letGo = 0; letGo <= 14; letGo++) {
			const landing = lands(start, 'up', ['glider'], letGo);
			expect(typeof landing === 'object' && landing.pos).toEqual({ x: -2, y: -8 });
		}
		// With the boat, letting go over the lake lands in it, where the kid let go.
		const inBoat = lands(start, 'up', ['glider', 'boat'], 7);
		expect(typeof inBoat === 'object' && inBoat.pos).toEqual({ x: -2, y: -1 });
	});

	it('flies to land exactly 20 tiles out, and not at all when the only land is 21 out', () => {
		// 19 water tiles, then ground on the 20th.
		const twenty = { x: 143, y: -152 };
		const line20 = kindsOf(twenty, 'down', 20);
		expect(line20.slice(0, 19).every(isWaterKind) && ground(line20[19]!)).toBe(true);
		const up = takeOff(seed, WorldEdits.none, { pos: twenty, facing: 'down', items: ['glider'] });
		expect(up.ok && up.flight.reach).toBe(20);
		for (const letGo of [0, 1, 3, 19, 20]) {
			const landing = lands(twenty, 'down', ['glider'], letGo);
			expect(typeof landing === 'object' && landing.flown).toBe(20);
		}
		// 20 water tiles, then ground on the 21st: nowhere to land, no take-off. With the boat, yes.
		const twentyOne = { x: 144, y: -152 };
		const line21 = kindsOf(twentyOne, 'down', 21);
		expect(line21.slice(0, 20).every(isWaterKind) && ground(line21[20]!)).toBe(true);
		expect(
			takeOff(seed, WorldEdits.none, { pos: twentyOne, facing: 'down', items: ['glider'] })
		).toEqual({
			ok: false,
			reason: 'nowhere-to-land'
		});
		const boat = lands(twentyOne, 'down', ['glider', 'boat'], 7);
		expect(typeof boat === 'object' && boat.flown).toBe(7);
	});

	it('lands in the boat on a wide lake, and without the boat never takes off over it', () => {
		const shore = { x: 112, y: -151 };
		expect(kindsOf(shore, 'right', 30).every(isWaterKind)).toBe(true);
		expect(lands(shore, 'right', ['glider', 'axe', 'pickaxe'], 7)).toBe('nowhere-to-land');
		const landing = lands(shore, 'right', ['glider', 'boat'], 7);
		expect(typeof landing === 'object' && landing).toMatchObject({
			pos: { x: 119, y: -151 },
			flown: 7,
			cleared: null
		});
		// Held on, it stops at the reach: the 20th tile, in the boat.
		const held = lands(shore, 'right', ['glider', 'boat'], 20);
		expect(typeof held === 'object' && held.flown).toBe(20);
	});

	it('flies over a row of trees to the ground after it, and with the axe lands on a tree and chops it', () => {
		const from = { x: 96, y: -102 };
		const line = kindsOf(from, 'down', 11);
		expect(line.slice(0, 10).every((k) => k === 'tree') && ground(line[10]!)).toBe(true);
		for (const items of [['glider'], ['glider', 'pickaxe', 'boat']]) {
			const landing = lands(from, 'down', items, 3);
			expect(typeof landing === 'object' && landing).toMatchObject({ flown: 11, cleared: null });
		}
		const chopped = lands(from, 'down', ['glider', 'axe'], 3);
		expect(typeof chopped === 'object' && chopped).toMatchObject({
			pos: { x: 96, y: -99 },
			flown: 3,
			cleared: { pos: { x: 96, y: -99 }, was: 'tree', tool: 'axe' }
		});
		if (typeof chopped !== 'object') throw new Error('no landing');
		// A stump, saved in the cleared tiles like any chop, which a later flight reads as ground.
		expect(editedTileAt(seed, chopped.edits, 96, -99)).toMatchObject({
			kind: 'grass',
			cleared: 'tree'
		});
		const again = lands(from, 'down', ['glider'], 3, chopped.edits);
		expect(typeof again === 'object' && again.flown).toBe(3);
	});

	it('flies over a rock field to its far side, and with the pickaxe lands on a rock and breaks it', () => {
		const from = { x: 59, y: -28 };
		const line = kindsOf(from, 'right', 20);
		expect(line.slice(0, 19).every((k) => k === 'rock') && ground(line[19]!)).toBe(true);
		for (const items of [['glider'], ['glider', 'axe']]) {
			const landing = lands(from, 'right', items, 1);
			expect(typeof landing === 'object' && landing.flown).toBe(20);
		}
		const broken = lands(from, 'right', ['glider', 'pickaxe'], 5);
		expect(typeof broken === 'object' && broken).toMatchObject({
			pos: { x: 64, y: -28 },
			cleared: { was: 'rock', tool: 'pickaxe' }
		});
	});

	it('flies over a tent, and never comes down on one, whatever the kid owns', () => {
		const from = { x: -111, y: -145 };
		const line = kindsOf(from, 'right', 2);
		expect(line[0]).toBe('tent');
		expect(ground(line[1]!)).toBe(true);
		for (const items of GEAR_SETS) {
			for (const letGo of [0, 1]) {
				const landing = lands(from, 'right', items, letGo);
				expect(typeof landing === 'object' && landing.pos).toEqual({ x: -109, y: -145 });
			}
		}
	});

	it('comes down before a lake and a forest that run past its reach, however long Space is held', () => {
		const from = { x: 110, y: -154 };
		const line = kindsOf(from, 'right', 21);
		expect(line.slice(0, 3).every(ground)).toBe(true);
		expect(line.slice(3).every((k) => isWaterKind(k) || k === 'tree' || k === 'rock')).toBe(true);
		const up = takeOff(seed, WorldEdits.none, { pos: from, facing: 'right', items: ['glider'] });
		expect(up.ok && up.flight.reach).toBe(3);
		expect(lands(from, 'right', ['glider'], 3)).toMatchObject({ flown: 3 });
		expect(lands(from, 'right', ['glider'], 1)).toMatchObject({ flown: 1 });
	});
});
