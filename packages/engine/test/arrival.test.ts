import { describe, expect, it } from 'vitest';
import { Rng, hashString } from '../src/rng.js';
import * as arrival from '../src/world/arrival.js';
import { ARRIVAL_RADIUS, arrivalRings, arrivalSpot } from '../src/world/arrival.js';
import { WorldEdits, editedTileAt } from '../src/world/edits.js';
import { tileAtWorld } from '../src/world/generate.js';
import {
	isWalkable,
	isWater,
	step,
	type Direction,
	type Gear,
	type GridPos
} from '../src/world/types.js';

const PROTOTYPE = hashString('prototype');
const SEEDS = [PROTOTYPE, 1, 2];
const ON_FOOT: Gear = { boat: false };
const WITH_BOAT: Gear = { boat: true };

// --- an independent model of where a player arrives, written from the rule ---

/** Ground on foot, and with the boat the water too: from the tile kinds, not `isPassable`. */
function canStand(seed: number, edits: WorldEdits, p: GridPos, boat: boolean): boolean {
	const kind = editedTileAt(seed, edits, p.x, p.y).kind;
	return isWalkable(kind) || (boat && isWater(kind));
}

/**
 * Whether a spot opens onto the world, as the rule reads it: the tiles a
 * player can get to from it, the way they get about, lead `ESCAPE_REACH` or
 * more tiles away from the friend at `target`, across or down. A pocket that
 * stays nearer than that (an island without a boat, a nook in the trees) does
 * not. Searched depth first, so open country is left in a straight run.
 */
const ESCAPE_REACH = arrival.ESCAPE_REACH ?? 64;
function opensOut(
	seed: number,
	edits: WorldEdits,
	from: GridPos,
	boat: boolean,
	target: GridPos
): boolean {
	const seen = new Set<string>([`${from.x},${from.y}`]);
	const stack = [from];
	while (stack.length > 0) {
		const p = stack.pop()!;
		if (Math.max(Math.abs(p.x - target.x), Math.abs(p.y - target.y)) >= ESCAPE_REACH) return true;
		for (const [dx, dy] of [
			[0, 1],
			[0, -1],
			[-1, 0],
			[1, 0]
		] as const) {
			const n = { x: p.x + dx, y: p.y + dy };
			const key = `${n.x},${n.y}`;
			if (seen.has(key) || !canStand(seed, edits, n, boat)) continue;
			seen.add(key);
			stack.push(n);
		}
	}
	return false;
}

/**
 * The rule's answer, by brute force: every tile in the square the player
 * could stand on, best first by (steps apart, water, lower, left), and the
 * first of those that opens out.
 */
function expected(seed: number, target: GridPos, edits: WorldEdits, boat: boolean): GridPos | null {
	const standing: { p: GridPos; key: number[] }[] = [];
	for (let dx = -ARRIVAL_RADIUS; dx <= ARRIVAL_RADIUS; dx++) {
		for (let dy = -ARRIVAL_RADIUS; dy <= ARRIVAL_RADIUS; dy++) {
			if (dx === 0 && dy === 0) continue;
			const p = { x: target.x + dx, y: target.y + dy };
			if (!canStand(seed, edits, p, boat)) continue;
			const wet = isWater(editedTileAt(seed, edits, p.x, p.y).kind) ? 1 : 0;
			standing.push({ p, key: [Math.abs(dx) + Math.abs(dy), wet, -p.y, p.x] });
		}
	}
	standing.sort((a, b) => compare(a.key, b.key));
	return standing.find(({ p }) => opensOut(seed, edits, p, boat, target))?.p ?? null;
}

/** Compares two keys number by number, in order. */
function compare(a: readonly number[], b: readonly number[]): number {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
	return 0;
}

/** A spot somewhere in the world a few hundred tiles out, on any kind of tile. */
function randomTarget(rng: Rng): GridPos {
	return { x: rng.int(-400, 400), y: rng.int(-400, 400) };
}

describe('arrivalSpot', () => {
	it('lands exactly where the rule says: the nearest open tile, ground before water', () => {
		const rng = new Rng(20260927);
		let landed = 0;
		let afloat = 0;
		let nowhere = 0;
		for (const seed of SEEDS) {
			for (let i = 0; i < 70; i++) {
				const target = randomTarget(rng);
				for (const gear of [ON_FOOT, WITH_BOAT]) {
					const got = arrivalSpot(seed, target, WorldEdits.none, gear);
					const want = expected(seed, target, WorldEdits.none, gear.boat);
					expect(got?.pos ?? null, `seed ${seed} target ${target.x},${target.y}`).toEqual(want);
					if (!got) nowhere++;
					else if (isWater(tileAtWorld(seed, got.pos.x, got.pos.y).kind)) afloat++;
					else landed++;
				}
			}
		}
		// The sample reaches every case: on land, in a boat, and nowhere to go.
		expect(landed).toBeGreaterThan(100);
		expect(afloat).toBeGreaterThan(0);
		expect(nowhere).toBeGreaterThan(0);
	});

	it('never lands on the friend, never on foot on the water, and faces the friend', () => {
		const rng = new Rng(7);
		for (const seed of SEEDS) {
			for (let i = 0; i < 150; i++) {
				const target = randomTarget(rng);
				for (const gear of [ON_FOOT, WITH_BOAT]) {
					const got = arrivalSpot(seed, target, WorldEdits.none, gear);
					if (!got) continue;
					expect(got.pos).not.toEqual(target);
					const kind = tileAtWorld(seed, got.pos.x, got.pos.y).kind;
					expect(isWalkable(kind) || (gear.boat && isWater(kind))).toBe(true);
					// Facing the friend: a step that way comes closer, along the longer way across.
					const ahead = step(got.pos, got.facing);
					const before = Math.abs(target.x - got.pos.x) + Math.abs(target.y - got.pos.y);
					const after = Math.abs(target.x - ahead.x) + Math.abs(target.y - ahead.y);
					expect(after).toBe(before - 1);
				}
			}
		}
	});

	it('beside a friend on open ground, lands on a tile touching theirs', () => {
		const rng = new Rng(99);
		let checked = 0;
		for (let i = 0; i < 400 && checked < 60; i++) {
			const target = randomTarget(rng);
			const kind = tileAtWorld(PROTOTYPE, target.x, target.y).kind;
			if (!isWalkable(kind) || !opensOut(PROTOTYPE, WorldEdits.none, target, false, target))
				continue;
			const got = arrivalSpot(PROTOTYPE, target);
			// A walkable friend in open country always has an open ground tile beside them, unless
			// every tile touching theirs is blocked; then the next ring out.
			const touching = (['up', 'down', 'left', 'right'] as Direction[])
				.map((d) => step(target, d))
				.some((p) => canStand(PROTOTYPE, WorldEdits.none, p, false));
			if (touching) {
				expect(Math.abs(got!.pos.x - target.x) + Math.abs(got!.pos.y - target.y)).toBe(1);
			}
			checked++;
		}
		expect(checked).toBe(60);
	});

	it('reads the world as this player left it: a tree they cleared is ground to land on', () => {
		// Find a friend standing on open ground with a tree touching them, below.
		const rng = new Rng(3);
		for (let i = 0; i < 20000; i++) {
			const target = randomTarget(rng);
			const below = step(target, 'down');
			if (!isWalkable(tileAtWorld(PROTOTYPE, target.x, target.y).kind)) continue;
			if (tileAtWorld(PROTOTYPE, below.x, below.y).kind !== 'tree') continue;
			const edits = WorldEdits.none.with(below);
			const got = arrivalSpot(PROTOTYPE, target, edits);
			const want = expected(PROTOTYPE, target, edits, false);
			expect(got?.pos ?? null).toEqual(want);
			// The chopped tree is the tile below: the first one tried, if it opens out.
			if (want && opensOut(PROTOTYPE, edits, below, false, target)) {
				expect(got!.pos).toEqual(below);
			}
			return;
		}
		throw new Error('no friend beside a tree found');
	});

	it('never strands a player on an island or in a pocket, however big, without a way out', () => {
		// Closed land pockets near spawn that a first rule (40 tiles reachable) let a go-to land on:
		// water all round, or water and trees. On foot there is no way off them.
		const pockets: [number, GridPos][] = [
			[PROTOTYPE, { x: 100, y: -48 }],
			[PROTOTYPE, { x: 79, y: 96 }],
			[(PROTOTYPE + 1) >>> 0, { x: -56, y: -67 }],
			[(PROTOTYPE + 2) >>> 0, { x: 104, y: -28 }],
			[(PROTOTYPE + 6) >>> 0, { x: 101, y: -61 }],
			[(PROTOTYPE + 41) >>> 0, { x: 25, y: 63 }]
		];
		for (const [seed, friend] of pockets) {
			// The friend really is in a pocket a walker can't leave.
			expect(opensOut(seed, WorldEdits.none, friend, false, friend)).toBe(false);
			const onFoot = arrivalSpot(seed, friend);
			if (onFoot) expect(opensOut(seed, WorldEdits.none, onFoot.pos, false, friend)).toBe(true);
			// With the boat the water is a way out: they can land by the friend.
			const sailing = arrivalSpot(seed, friend, WorldEdits.none, { boat: true });
			expect(sailing).not.toBeNull();
			expect(opensOut(seed, WorldEdits.none, sailing!.pos, true, friend)).toBe(true);
		}
	});

	it('is the same answer every time, and throws on a position that is not whole', () => {
		const target = { x: 12, y: -40 };
		expect(arrivalSpot(PROTOTYPE, target)).toEqual(arrivalSpot(PROTOTYPE, target));
		expect(() => arrivalSpot(PROTOTYPE, { x: 1.5, y: 0 })).toThrow();
		expect(() => arrivalSpot(PROTOTYPE, { x: Number.NaN, y: 0 })).toThrow();
	});
});

describe('arrivalRings', () => {
	it('lists every tile in the square but the middle once, nearest first, lower then left within a ring', () => {
		const target = { x: -3, y: 5 };
		const rings = arrivalRings(target);
		const all = rings.flat();
		expect(all).toHaveLength((2 * ARRIVAL_RADIUS + 1) ** 2 - 1);
		expect(new Set(all.map((p) => `${p.x},${p.y}`)).size).toBe(all.length);
		rings.forEach((ring, i) => {
			for (const p of ring) expect(Math.abs(p.x - target.x) + Math.abs(p.y - target.y)).toBe(i + 1);
			for (let j = 1; j < ring.length; j++) {
				const [a, b] = [ring[j - 1]!, ring[j]!];
				expect(a.y > b.y || (a.y === b.y && a.x < b.x)).toBe(true);
			}
		});
		// The first tried is the one just below the friend.
		expect(rings[0]![0]).toEqual({ x: -3, y: 6 });
	});
});
