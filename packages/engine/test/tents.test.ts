import { describe, expect, it } from 'vitest';
import { Rng, hashString } from '../src/rng.js';
import { WorldEdits } from '../src/world/edits.js';
import { tileAtWorld, travelKindAt } from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import {
	TENT_SEARCH_STEPS,
	canTalkToDoctor,
	nearestTent,
	type TentSpot
} from '../src/world/tents.js';
import {
	CHUNK_SIZE,
	isWalkable,
	isWater,
	step,
	type Direction,
	type GridPos
} from '../src/world/types.js';
import { turn } from './turn.js';

const PROTOTYPE = hashString('prototype');
const SEEDS = [PROTOTYPE, 1, 2];
const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

// --- an independent model of tents and walking, written without the engine's search ---

function mod(x: number, m: number): number {
	return ((x % m) + m) % m;
}

/** Tents sit on a lattice every 23 columns and 19 rows through (5, 7); the generator decides which lattice points get one. */
function tentsInBox(seed: number, x0: number, y0: number, x1: number, y1: number): GridPos[] {
	const tents: GridPos[] = [];
	for (let x = x0 + mod(5 - x0, 23); x <= x1; x += 23)
		for (let y = y0 + mod(7 - y0, 19); y <= y1; y += 19)
			if (tileAtWorld(seed, x, y).kind === 'tent') tents.push({ x, y });
	return tents;
}

/** Sides of a tent as [facing from the stand toward the tent, stand offset], door side first. */
const SIDES: readonly [Direction, number, number][] = [
	['up', 0, 1], // in front of the door, below the tent
	['right', -1, 0], // left of the tent
	['left', 1, 0], // right of the tent
	['down', 0, -1] // behind it
];

/**
 * Whether a tile is ground to walk on, with the tiles in `cleared` cleared:
 * written from the rule (a cleared tree or rock is ground), not with the
 * engine's overlay; with a boat, water is open too.
 */
function open(
	seed: number,
	x: number,
	y: number,
	cleared: ReadonlySet<string>,
	boat = false
): boolean {
	// Over water, the kind that tells deep from shallow costs 24 more tiles of
	// elevation, and getting about treats both alike (world.test.ts checks it).
	const kind = boat ? travelKindAt(seed, x, y) : tileAtWorld(seed, x, y).kind;
	if (cleared.has(`${x},${y}`) && (kind === 'tree' || kind === 'rock')) return true;
	return isWalkable(kind) || (boat && isWater(kind));
}

const NOTHING_CLEARED: ReadonlySet<string> = new Set();

/** Steps on foot from `from` to every tile within `limit`: a plain flood fill, no early exit. */
function walkingField(
	seed: number,
	from: GridPos,
	limit: number,
	cleared = NOTHING_CLEARED,
	boat = false
): Map<string, number> {
	const dist = new Map<string, number>([[`${from.x},${from.y}`, 0]]);
	let ring = [from];
	for (let d = 1; d <= limit && ring.length > 0; d++) {
		const next: GridPos[] = [];
		for (const p of ring)
			for (const dir of DIRECTIONS) {
				const n = step(p, dir);
				const k = `${n.x},${n.y}`;
				if (dist.has(k) || !open(seed, n.x, n.y, cleared, boat)) continue;
				dist.set(k, d);
				next.push(n);
			}
		ring = next;
	}
	return dist;
}

function rank(s: TentSpot): number[] {
	return [s.steps, s.tent.y, s.tent.x, SIDES.findIndex(([f]) => f === s.facing)];
}

function before(a: TentSpot, b: TentSpot): boolean {
	const ra = rank(a);
	const rb = rank(b);
	for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! < rb[i]!;
	return false;
}

/** Every walkable side of every lattice tent in reach, ranked by steps, then tent y, x, then side. */
function bruteForceNearest(
	seed: number,
	from: GridPos,
	limit: number,
	cleared = NOTHING_CLEARED,
	boat = false
): TentSpot | null {
	const field = walkingField(seed, from, limit, cleared, boat);
	const r = limit + 1;
	let best: TentSpot | null = null;
	for (const tent of tentsInBox(seed, from.x - r, from.y - r, from.x + r, from.y + r)) {
		for (const [facing, dx, dy] of SIDES) {
			const stand = { x: tent.x + dx, y: tent.y + dy };
			const steps = field.get(`${stand.x},${stand.y}`);
			if (steps === undefined || !open(seed, stand.x, stand.y, cleared)) continue;
			const spot = { tent, stand, facing, steps };
			if (!best || before(spot, best)) best = spot;
		}
	}
	return best;
}

/** Positions to search from: random ones of any kind and sign, the spawn, and both sides of chunk corners. */
function samplePositions(seed: number, n: number): GridPos[] {
	const rng = new Rng(seed ^ 0x7e57);
	const out: GridPos[] = [spawnPoint(seed), { x: 0, y: 0 }];
	for (const c of [-CHUNK_SIZE, 0, CHUNK_SIZE])
		for (const [dx, dy] of [
			[-1, -1],
			[0, 0],
			[-1, 0],
			[0, -1]
		] as const)
			out.push({ x: c + dx, y: -c + dy });
	while (out.length < n) out.push({ x: rng.int(-2500, 2500), y: rng.int(-2500, 2500) });
	return out;
}

/** Every lattice tent in a box straddling 0, so negative coordinates and chunk edges are included. */
function tentsNearOrigin(seed: number): GridPos[] {
	return tentsInBox(seed, -300, -300, 300, 300);
}

describe('tents', () => {
	it('are solid: the doctor is talked to from beside the tent, never inside it', () => {
		expect(isWalkable('tent')).toBe(false);
		for (const kind of ['grass', 'tallgrass', 'sand'] as const) expect(isWalkable(kind)).toBe(true);
	});
});

describe('nearestTent', () => {
	for (const seed of SEEDS) {
		it(`is the nearest tent on foot, checked by brute force over the lattice (seed ${seed})`, async () => {
			let found = 0;
			for (const from of samplePositions(seed, 40)) {
				const spot = nearestTent(seed, from);
				const expected = bruteForceNearest(seed, from, spot ? spot.steps : TENT_SEARCH_STEPS);
				expect(spot, `from ${from.x},${from.y}`).toEqual(expected);
				if (spot) found++;
				await turn();
			}
			// Some random starts are in a lake or walled in by trees; most find a tent.
			expect(found).toBeGreaterThan(20);
			// 40 searches, each checked by a flood fill of its own: up to 1.7 s alone at a load
			// average of 10, up to 7.9 s in the whole suite at 31, which scales to 38 s at 150; its
			// loop turns after each search.
		}, 120_000);
	}

	it('with the boat, is the nearest tent over ground and water, stood beside on ground: checked by brute force', async () => {
		// Starts out on the water of the prototype world, and on land beside it.
		const rng = new Rng(0xb0a7);
		const spawn = spawnPoint(PROTOTYPE);
		const starts: GridPos[] = [];
		let onWater = 0;
		while (starts.length < 30) {
			const p = { x: spawn.x + rng.int(-150, 150), y: spawn.y + rng.int(-150, 150) };
			const kind = tileAtWorld(PROTOTYPE, p.x, p.y).kind;
			if (starts.length < 20 ? !isWater(kind) : !isWalkable(kind)) continue;
			if (isWater(kind)) onWater++;
			starts.push(p);
		}
		let shorter = 0;
		for (const from of starts) {
			const spot = nearestTent(PROTOTYPE, from, TENT_SEARCH_STEPS, WorldEdits.none, {
				boat: true
			});
			const expected = bruteForceNearest(
				PROTOTYPE,
				from,
				spot ? spot.steps : TENT_SEARCH_STEPS,
				NOTHING_CLEARED,
				true
			);
			expect(spot, `from ${from.x},${from.y}`).toEqual(expected);
			expect(spot, `from ${from.x},${from.y}`).not.toBeNull();
			expect(isWalkable(tileAtWorld(PROTOTYPE, spot!.stand.x, spot!.stand.y).kind)).toBe(true);
			expect(canTalkToDoctor(PROTOTYPE, spot!.stand, spot!.facing)).toBe(true);
			const onFoot = nearestTent(PROTOTYPE, from);
			if (onFoot && spot!.steps < onFoot.steps) shorter++;
			if (onFoot) expect(spot!.steps).toBeLessThanOrEqual(onFoot.steps);
			await turn();
		}
		expect(onWater).toBe(20);
		// From the land, across a lake is sometimes the shorter way.
		expect(shorter).toBeGreaterThan(0);
		// 30 searches, each checked by a flood fill over land and water, most of them out on a
		// lake: 2.2 s alone at a load average of 10, 6.6 s in the whole suite at 34, and up to ten
		// times its run alone at 150; its loop turns after each search.
	}, 90_000);

	it('without the boat, searches exactly as on foot', () => {
		for (const from of samplePositions(PROTOTYPE, 15))
			expect(
				nearestTent(PROTOTYPE, from, TENT_SEARCH_STEPS, WorldEdits.none, { boat: false })
			).toEqual(nearestTent(PROTOTYPE, from));
	});

	it('walks the paths a player chopped and broke: the nearest tent on foot in the world as they left it', async () => {
		let shorter = 0;
		let searched = 0;
		for (const seed of SEEDS) {
			const rng = new Rng(seed ^ 0xa4e);
			for (const from of samplePositions(seed, 16)) {
				// Clear about half the trees and rocks round the start (and a few other tiles,
				// which an overlay may name and which must stay as they are).
				const cleared = new Set<string>();
				let edits = WorldEdits.none;
				for (let y = from.y - 30; y <= from.y + 30; y++) {
					for (let x = from.x - 30; x <= from.x + 30; x++) {
						const kind = tileAtWorld(seed, x, y).kind;
						const clear = kind === 'tree' || kind === 'rock' ? rng.chance(0.5) : rng.chance(0.02);
						if (!clear) continue;
						cleared.add(`${x},${y}`);
						edits = edits.with({ x, y });
					}
				}
				const spot = nearestTent(seed, from, 60, edits);
				expect(spot, `from ${from.x},${from.y}`).toEqual(
					bruteForceNearest(seed, from, 60, cleared)
				);
				const before = nearestTent(seed, from, 60);
				searched++;
				if (spot && (!before || spot.steps < before.steps)) shorter++;
				await turn();
			}
		}
		// Not vacuous: the cleared paths make some tents nearer, or reachable at all.
		expect(shorter).toBeGreaterThan(3);
		expect(searched).toBe(48);
		// 48 searches with their flood fills, each over a world with its trees cleared one by
		// one: 2.6 s alone at a load average of 10, 9.1 s in the whole suite at 35, which scales
		// to 39 s at 150; its loop turns after each search.
	}, 120_000);

	it('stands the player on walkable ground next to the tent, facing it', async () => {
		for (const seed of SEEDS) {
			for (const from of samplePositions(seed, 60)) {
				const spot = nearestTent(seed, from);
				if (!spot) continue;
				expect(tileAtWorld(seed, spot.tent.x, spot.tent.y).kind).toBe('tent');
				expect(isWalkable(tileAtWorld(seed, spot.stand.x, spot.stand.y).kind)).toBe(true);
				expect(step(spot.stand, spot.facing)).toEqual(spot.tent);
				expect(canTalkToDoctor(seed, spot.stand, spot.facing)).toBe(true);
				// Walking is never shorter than the grid distance.
				const manhattan = Math.abs(spot.stand.x - from.x) + Math.abs(spot.stand.y - from.y);
				expect(spot.steps).toBeGreaterThanOrEqual(manhattan);
				await turn();
			}
		}
		// 180 searches: 2.1 s alone at a load average of 10, 4.1 s in the whole suite at 37, and up
		// to ten times its run alone at 150; its loop turns after each search.
	}, 90_000);

	it('beside a tent, that tent is nearest: zero steps, facing it — at any sign and across chunk edges', () => {
		let onChunkEdge = 0;
		let negative = 0;
		for (const seed of SEEDS) {
			for (const tent of tentsNearOrigin(seed)) {
				if (tent.x < 0 && tent.y < 0) negative++;
				for (const [facing, dx, dy] of SIDES) {
					const stand = { x: tent.x + dx, y: tent.y + dy };
					if (!isWalkable(tileAtWorld(seed, stand.x, stand.y).kind)) continue;
					if (Math.floor(stand.x / CHUNK_SIZE) !== Math.floor(tent.x / CHUNK_SIZE)) onChunkEdge++;
					if (Math.floor(stand.y / CHUNK_SIZE) !== Math.floor(tent.y / CHUNK_SIZE)) onChunkEdge++;
					expect(nearestTent(seed, stand)).toEqual({ tent, stand, facing, steps: 0 });
				}
			}
		}
		expect(onChunkEdge).toBeGreaterThan(0);
		expect(negative).toBeGreaterThan(0);
	});

	it('from a blocked tile beside a tent (water, tree, rock), still stands the player on walkable ground', () => {
		let blocked = 0;
		for (const seed of SEEDS) {
			for (const tent of tentsNearOrigin(seed)) {
				for (const [, dx, dy] of SIDES) {
					const from = { x: tent.x + dx, y: tent.y + dy };
					if (isWalkable(tileAtWorld(seed, from.x, from.y).kind)) continue;
					blocked++;
					const spot = nearestTent(seed, from);
					if (!spot) continue;
					expect(spot.stand).not.toEqual(from);
					expect(spot.steps).toBeGreaterThan(0);
					expect(isWalkable(tileAtWorld(seed, spot.stand.x, spot.stand.y).kind)).toBe(true);
				}
			}
		}
		expect(blocked).toBeGreaterThan(0);
		// About 0.3 s alone (a search from every blocked side of every tent within 300 tiles, in
		// three worlds); 2.4 s at a load average of 40.
	}, 30_000);

	it('never picks a tent that is boxed in, and prefers the door side when two sides tie', async () => {
		let boxed = 0;
		for (const seed of SEEDS) {
			await turn();
			for (const tent of tentsInBox(seed, -800, -800, 800, 800)) {
				const open = SIDES.filter(([, dx, dy]) =>
					isWalkable(tileAtWorld(seed, tent.x + dx, tent.y + dy).kind)
				);
				if (open.length > 0) continue;
				boxed++;
				for (const [dx, dy] of [
					[0, 0],
					[-1, -1],
					[1, -1],
					[-1, 1],
					[1, 1],
					[0, 2],
					[2, 0]
				] as const) {
					const spot = nearestTent(seed, { x: tent.x + dx, y: tent.y + dy });
					expect(spot?.tent).not.toEqual(tent);
				}
			}
		}
		expect(boxed).toBeGreaterThan(0);

		// Standing diagonally below-left of an open tent, the door side and the left side are
		// both one step away; the door side wins.
		let tied = 0;
		for (const seed of SEEDS) {
			await turn();
			for (const tent of tentsNearOrigin(seed)) {
				const corner = { x: tent.x - 1, y: tent.y + 1 };
				const below = { x: tent.x, y: tent.y + 1 };
				const left = { x: tent.x - 1, y: tent.y };
				if (![corner, below, left].every((p) => isWalkable(tileAtWorld(seed, p.x, p.y).kind)))
					continue;
				tied++;
				expect(nearestTent(seed, corner)).toEqual({ tent, stand: below, facing: 'up', steps: 1 });
			}
		}
		expect(tied).toBeGreaterThan(0);
		// Every tent in a 1,600-tile box, searched around: 3.1 s alone at a load average of 10,
		// 5.6 s in the whole suite at 38, and up to ten times its run alone at 150; its loop turns
		// after each world.
	}, 120_000);

	it('is deterministic and does not depend on what was asked before', () => {
		const positions = samplePositions(PROTOTYPE, 25);
		const forward = positions.map((p) => nearestTent(PROTOTYPE, p));
		const backward = positions
			.slice()
			.reverse()
			.map((p) => nearestTent(PROTOTYPE, p))
			.reverse();
		expect(backward).toEqual(forward);
		// About 0.35 s alone (50 searches, most far from any tent searched before); 2.3 s at a
		// load average of 40.
	}, 30_000);

	it('reads each world as it is, whatever was searched before: three worlds in turn, near and far, agree with brute force', () => {
		// The ground a search reads is kept a chunk at a time, one world's at a time, and the
		// oldest goes: worlds taken in turn and places far apart make each search start on
		// chunks another search left in another world, or on none, or on its own again.
		const rng = new Rng(0xcac4e);
		const starts: { seed: number; from: GridPos }[] = [];
		for (const seed of SEEDS) {
			const spawn = spawnPoint(seed);
			starts.push({ seed, from: spawn });
			for (let i = 0; i < 3; i++) {
				starts.push({
					seed,
					from: { x: spawn.x + rng.int(-400, 400), y: spawn.y + rng.int(-400, 400) }
				});
			}
		}
		const bad: string[] = [];
		for (const round of [0, 1, 2]) {
			for (const { seed, from } of rng.shuffle(starts)) {
				const spot = nearestTent(seed, from);
				const expected = bruteForceNearest(seed, from, spot ? spot.steps : TENT_SEARCH_STEPS);
				if (JSON.stringify(spot) !== JSON.stringify(expected)) {
					bad.push(`round ${round}, seed ${seed}, from ${from.x},${from.y}`);
				}
			}
		}
		expect(bad).toEqual([]);
		// Up to a few seconds alone (36 searches, each checked by a flood fill of its own).
	}, 60_000);

	it('gives up past maxSteps, and when walled in', () => {
		const from = spawnPoint(PROTOTYPE);
		const spot = nearestTent(PROTOTYPE, from)!;
		expect(spot.steps).toBeGreaterThan(1);
		expect(nearestTent(PROTOTYPE, from, spot.steps - 1)).toBeNull();
		expect(nearestTent(PROTOTYPE, from, spot.steps)).toEqual(spot);

		// Walled in: a walkable tile with no walkable neighbour and no tent beside it.
		let walled = 0;
		for (let y = -200; y < 200 && walled < 5; y++)
			for (let x = -200; x < 200 && walled < 5; x++) {
				if (!isWalkable(tileAtWorld(PROTOTYPE, x, y).kind)) continue;
				const around = DIRECTIONS.map((d) => step({ x, y }, d)).map(
					(n) => tileAtWorld(PROTOTYPE, n.x, n.y).kind
				);
				if (around.some((k) => isWalkable(k) || k === 'tent')) continue;
				walled++;
				expect(nearestTent(PROTOTYPE, { x, y })).toBeNull();
			}
		expect(walled).toBeGreaterThan(0);
	});

	it('refuses a position that is not whole numbers, and a bad maxSteps', () => {
		for (const from of [
			{ x: NaN, y: 0 },
			{ x: 0.5, y: 0 },
			{ x: 0, y: Infinity },
			undefined,
			null
		]) {
			expect(() => nearestTent(PROTOTYPE, from as unknown as GridPos)).toThrow(/whole-number/);
		}
		for (const maxSteps of [-1, 1.5, NaN, 2e6]) {
			expect(() => nearestTent(PROTOTYPE, { x: 0, y: 0 }, maxSteps)).toThrow(/maxSteps/);
		}
	});
});

describe('canTalkToDoctor', () => {
	it('holds exactly when the tile in front of the player is a tent', () => {
		// Thousands of checks: collected and asserted once, since an `expect` each
		// cost more than the rule (1.5 s alone, over 5 s under load).
		const wrong: string[] = [];
		for (const seed of SEEDS) {
			for (const tent of tentsNearOrigin(seed)) {
				for (const [facing, dx, dy] of SIDES) {
					const stand = { x: tent.x + dx, y: tent.y + dy };
					for (const dir of DIRECTIONS) {
						if (canTalkToDoctor(seed, stand, dir) !== (dir === facing))
							wrong.push(`seed ${seed}: ${stand.x},${stand.y} facing ${dir}`);
					}
				}
				// Diagonal to the tent, or two tiles away, is not beside it.
				for (const [dx, dy] of [
					[1, 1],
					[-1, -1],
					[0, 2],
					[-2, 0]
				] as const) {
					const at = { x: tent.x + dx, y: tent.y + dy };
					for (const dir of DIRECTIONS)
						if (canTalkToDoctor(seed, at, dir) !== false)
							wrong.push(`seed ${seed}: ${at.x},${at.y} facing ${dir}`);
				}
			}
		}
		expect(wrong).toEqual([]);
	}, 30_000);
});
