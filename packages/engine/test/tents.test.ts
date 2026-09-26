import { describe, expect, it } from 'vitest';
import { Rng, hashString } from '../src/rng.js';
import { WorldEdits } from '../src/world/edits.js';
import { spawnPoint, tileAtWorld } from '../src/world/generate.js';
import {
	TENT_SEARCH_STEPS,
	canTalkToDoctor,
	nearestTent,
	type TentSpot
} from '../src/world/tents.js';
import { CHUNK_SIZE, isWalkable, step, type Direction, type GridPos } from '../src/world/types.js';

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
 * engine's overlay.
 */
function open(seed: number, x: number, y: number, cleared: ReadonlySet<string>): boolean {
	const kind = tileAtWorld(seed, x, y).kind;
	if (cleared.has(`${x},${y}`) && (kind === 'tree' || kind === 'rock')) return true;
	return isWalkable(kind);
}

const NOTHING_CLEARED: ReadonlySet<string> = new Set();

/** Steps on foot from `from` to every tile within `limit`: a plain flood fill, no early exit. */
function walkingField(
	seed: number,
	from: GridPos,
	limit: number,
	cleared = NOTHING_CLEARED
): Map<string, number> {
	const dist = new Map<string, number>([[`${from.x},${from.y}`, 0]]);
	let ring = [from];
	for (let d = 1; d <= limit && ring.length > 0; d++) {
		const next: GridPos[] = [];
		for (const p of ring)
			for (const dir of DIRECTIONS) {
				const n = step(p, dir);
				const k = `${n.x},${n.y}`;
				if (dist.has(k) || !open(seed, n.x, n.y, cleared)) continue;
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
	cleared = NOTHING_CLEARED
): TentSpot | null {
	const field = walkingField(seed, from, limit, cleared);
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
		it(`is the nearest tent on foot, checked by brute force over the lattice (seed ${seed})`, () => {
			let found = 0;
			for (const from of samplePositions(seed, 40)) {
				const spot = nearestTent(seed, from);
				const expected = bruteForceNearest(seed, from, spot ? spot.steps : TENT_SEARCH_STEPS);
				expect(spot, `from ${from.x},${from.y}`).toEqual(expected);
				if (spot) found++;
			}
			// Some random starts are in a lake or walled in by trees; most find a tent.
			expect(found).toBeGreaterThan(20);
			// Up to 2 s alone (40 searches, each checked by a flood fill of its own);
			// over vitest's 5 s default when other agents' browsers load the machine.
		}, 30_000);
	}

	it('walks the paths a player chopped and broke: the nearest tent on foot in the world as they left it', () => {
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
			}
		}
		// Not vacuous: the cleared paths make some tents nearer, or reachable at all.
		expect(shorter).toBeGreaterThan(3);
		expect(searched).toBe(48);
		// About 1.5 s alone (48 searches with their flood fills, each over a world with its
		// trees cleared one by one); over vitest's 5 s default when other agents' browsers
		// load the machine.
	}, 30_000);

	it('stands the player on walkable ground next to the tent, facing it', () => {
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
			}
		}
		// Over 1 s alone (180 searches); over 3 s with two browsers drawing beside it.
	}, 30_000);

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
	});

	it('never picks a tent that is boxed in, and prefers the door side when two sides tie', () => {
		let boxed = 0;
		for (const seed of SEEDS) {
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
		// Up to 2 s alone (every tent in a 1600-tile box, searched around); over 3 s under load.
	}, 30_000);

	it('is deterministic and does not depend on what was asked before', () => {
		const positions = samplePositions(PROTOTYPE, 25);
		const forward = positions.map((p) => nearestTent(PROTOTYPE, p));
		const backward = positions
			.slice()
			.reverse()
			.map((p) => nearestTent(PROTOTYPE, p))
			.reverse();
		expect(backward).toEqual(forward);
	});

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
