import { describe, expect, it } from 'vitest';
import { hashInts, hashString, Rng } from '../src/rng.js';
import { EDITS_BUDGET, WorldEdits } from '../src/world/edits.js';
import { tileAtWorld } from '../src/world/generate.js';
import { SPAWN_DOCTOR_STEPS, SPAWN_ROOM, spawnPoint } from '../src/world/spawn.js';
import { nearestTent } from '../src/world/tents.js';
import { isWalkable, isWater, step, type Direction, type GridPos } from '../src/world/types.js';
import {
	FIRST_WORLD,
	LAST_WORLD,
	MAX_WORLDS_KEPT,
	WORLD_ONE_SEED,
	fitWorlds,
	isWorldNumber,
	keepWorlds,
	parseWorldNumber,
	remember,
	travel,
	worldSeed,
	type Whereabouts,
	type WorldStay
} from '../src/world/worlds.js';

/**
 * Numbered worlds ([[PRODUCT]] §4 "World"): a number is a world, World 1 is
 * the world every game was played in before, every world can be played from
 * its spawn, and travelling keeps each world as the player left it.
 */

const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

describe('world numbers', () => {
	it(`are the whole numbers from ${FIRST_WORLD} to ${LAST_WORLD}`, () => {
		for (const n of [1, 2, 42, 9998, 9999]) expect(isWorldNumber(n), String(n)).toBe(true);
		for (const n of [0, -1, 10_000, 1.5, NaN, Infinity, '5', null, undefined]) {
			expect(isWorldNumber(n), String(n)).toBe(false);
		}
		expect(() => worldSeed(0)).toThrow();
		expect(() => worldSeed(10_000)).toThrow();
	});

	it('World 1 is exactly the world every game was played in: the seed of "prototype", 821322741', () => {
		expect(WORLD_ONE_SEED).toBe(821322741);
		expect(WORLD_ONE_SEED).toBe(hashString('prototype'));
		expect(worldSeed(1)).toBe(821322741);
	});

	it('give every world a seed of its own', () => {
		const seeds = new Set<number>();
		for (let n = FIRST_WORLD; n <= LAST_WORLD; n++) {
			const seed = worldSeed(n);
			expect(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32).toBe(true);
			seeds.add(seed);
		}
		expect(seeds.size).toBe(LAST_WORLD);
	});

	it('are read from what a kid types: digits only, leading zeros too', () => {
		expect(parseWorldNumber('1')).toBe(1);
		expect(parseWorldNumber('42')).toBe(42);
		expect(parseWorldNumber('007')).toBe(7);
		expect(parseWorldNumber('9999')).toBe(9999);
		for (const text of ['', '0', '000', '10000', '12a', ' 5', '5 ', '-3', '1.5', '1e3', '٣']) {
			expect(parseWorldNumber(text), text).toBeNull();
		}
	});

	it('make neighbouring numbers unrelated worlds: no more alike than any two worlds', () => {
		function agreement(a: number, b: number): number {
			let same = 0;
			for (let y = -24; y < 24; y++)
				for (let x = -24; x < 24; x++) {
					if (tileAtWorld(a, x, y).kind === tileAtWorld(b, x, y).kind) same++;
				}
			return same / (48 * 48);
		}
		const neighbours: number[] = [];
		const strangers: number[] = [];
		for (let n = 1; n <= 30; n++) {
			neighbours.push(agreement(worldSeed(n), worldSeed(n + 1)));
			strangers.push(agreement(worldSeed(n), worldSeed(((n * 3779) % LAST_WORLD) + 1)));
		}
		const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
		// About 0.28 each (the chance two tiles of unrelated worlds share a kind); identical is 1.
		expect(Math.abs(mean(neighbours) - mean(strangers))).toBeLessThan(0.05);
		expect(Math.max(...neighbours)).toBeLessThan(0.6);
	});
});

/** How many tiles can be reached on foot from `from`, counting up to `cap`: this test's own walk. */
function reachable(seed: number, from: GridPos, cap: number): number {
	const seen = new Set([`${from.x},${from.y}`]);
	let edge = [from];
	while (edge.length > 0 && seen.size < cap) {
		const next: GridPos[] = [];
		for (const p of edge) {
			for (const dir of DIRECTIONS) {
				const q = step(p, dir);
				const key = `${q.x},${q.y}`;
				if (seen.has(key) || !isWalkable(tileAtWorld(seed, q.x, q.y).kind)) continue;
				seen.add(key);
				next.push(q);
			}
		}
		edge = next;
	}
	return Math.min(seen.size, cap);
}

/** Whether a kid can start a game on `pos`: grass, a doctor a short walk away on foot, room round it. */
function playableFrom(seed: number, pos: GridPos): boolean {
	return (
		tileAtWorld(seed, pos.x, pos.y).kind === 'grass' &&
		nearestTent(seed, pos, SPAWN_DOCTOR_STEPS) !== null &&
		reachable(seed, pos, SPAWN_ROOM) >= SPAWN_ROOM
	);
}

/** A large sample of world numbers: the edges, and a seeded spread over the rest. */
function sample(count: number): number[] {
	const rng = new Rng(hashInts(hashString('worlds'), count));
	const out = new Set([FIRST_WORLD, 2, 3, LAST_WORLD - 1, LAST_WORLD]);
	while (out.size < count) out.add(rng.int(FIRST_WORLD, LAST_WORLD));
	return [...out];
}

describe('every world is playable from its spawn', () => {
	it(`World 1's spawn is where every game began: (-2, 6), the doctor 7 steps away, the nearest grass of all`, () => {
		expect(spawnPoint(worldSeed(1))).toEqual({ x: -2, y: 6 });
		expect(nearestTent(worldSeed(1), { x: -2, y: 6 })?.steps).toBe(7);
		// The rule before numbered worlds: the first grass tile in square rings round the origin.
		let first: GridPos | null = null;
		for (let r = 0; r < 64 && !first; r++)
			for (let y = -r; y <= r && !first; y++)
				for (let x = -r; x <= r && !first; x++)
					if (
						Math.max(Math.abs(x), Math.abs(y)) === r &&
						tileAtWorld(WORLD_ONE_SEED, x, y).kind === 'grass'
					)
						first = { x, y };
		expect(first).toEqual({ x: -2, y: 6 });
	});

	it(`over a large sample of worlds: grass, a doctor at most ${SPAWN_DOCTOR_STEPS} steps away on foot, and never boxed in`, () => {
		const bad: string[] = [];
		const worlds = sample(250);
		for (const n of worlds) {
			const seed = worldSeed(n);
			const spawn = spawnPoint(seed);
			if (!playableFrom(seed, spawn)) bad.push(`World ${n} at ${spawn.x},${spawn.y}`);
			// Tall grass is in reach too: the first battles are a walk away.
			let grass = false;
			for (let dy = -12; dy <= 12 && !grass; dy++)
				for (let dx = -12; dx <= 12 && !grass; dx++)
					grass = tileAtWorld(seed, spawn.x + dx, spawn.y + dy).kind === 'tallgrass';
			if (!grass) bad.push(`World ${n}: no tall grass near the spawn`);
		}
		expect(bad).toEqual([]);
		// Seconds alone; more under load.
	}, 180_000);

	it('the spawn is the nearest such tile to the origin: no grass tile in an earlier ring, or earlier in its ring, will do', () => {
		const bad: string[] = [];
		for (const n of sample(12).slice(0, 12)) {
			const seed = worldSeed(n);
			const spawn = spawnPoint(seed);
			const ring = (p: GridPos) => Math.max(Math.abs(p.x), Math.abs(p.y));
			for (let r = 0; r <= ring(spawn); r++) {
				for (let y = -r; y <= r; y++) {
					for (let x = -r; x <= r; x++) {
						if (ring({ x, y }) !== r) continue;
						const earlier = r < ring(spawn) || y < spawn.y || (y === spawn.y && x < spawn.x);
						if (earlier && playableFrom(seed, { x, y }))
							bad.push(`World ${n}: ${x},${y} before ${spawn.x},${spawn.y}`);
					}
				}
			}
		}
		expect(bad).toEqual([]);
	}, 180_000);

	it('is the same spawn however it is asked, and one that cannot be changed from outside', () => {
		const a = spawnPoint(worldSeed(77));
		a.x += 100;
		expect(spawnPoint(worldSeed(77))).not.toEqual(a);
		expect(spawnPoint(worldSeed(77))).toEqual(spawnPoint(worldSeed(77)));
	});
});

/** A player standing somewhere in world `world`, having cleared `edits` there. */
function at(world: number, extra: Partial<Whereabouts> = {}): Whereabouts {
	return {
		world,
		pos: spawnPoint(worldSeed(world)),
		facing: 'down',
		edits: WorldEdits.none,
		worlds: [],
		...extra
	};
}

/** A walkable tile a few steps from the spawn of `world`, and a tree near it. */
function somewhere(world: number): { walk: GridPos; tree: GridPos } {
	const seed = worldSeed(world);
	const spawn = spawnPoint(seed);
	let walk: GridPos | null = null;
	let tree: GridPos | null = null;
	for (let r = 3; r < 60 && !(walk && tree); r++)
		for (let dy = -r; dy <= r; dy++)
			for (let dx = -r; dx <= r; dx++) {
				const p = { x: spawn.x + dx, y: spawn.y + dy };
				const kind = tileAtWorld(seed, p.x, p.y).kind;
				if (!walk && isWalkable(kind)) walk = p;
				if (!tree && kind === 'tree') tree = p;
			}
	if (!walk || !tree) throw new Error(`nothing found in World ${world}`);
	return { walk, tree };
}

describe('travel', () => {
	const player = { home: 1, items: [] as string[] };

	it('refuses a number that is not a world, and the world the player is in', () => {
		for (const to of [0, 10_000, 2.5, '2', NaN, null, undefined, {}]) {
			expect(travel(at(1), to, player), String(to)).toEqual({ ok: false, reason: 'not-a-world' });
		}
		expect(travel(at(5), 5, player)).toEqual({ ok: false, reason: 'already-there' });
	});

	it('a first visit starts at the spawn, facing down, nothing cleared; the world left is remembered as it was left', () => {
		const { walk, tree } = somewhere(1);
		const edits = WorldEdits.none.with(tree);
		const from = at(1, { pos: walk, facing: 'left', edits });
		const step = travel(from, 42, player);
		expect(step).toEqual({
			ok: true,
			firstVisit: true,
			whereabouts: {
				world: 42,
				pos: spawnPoint(worldSeed(42)),
				facing: 'down',
				edits: WorldEdits.none,
				worlds: [{ world: 1, pos: walk, facing: 'left', edits: [...edits.encode()] }]
			}
		});
	});

	it('going back picks a world up exactly where it was left, and remembers the other one', () => {
		const { walk, tree } = somewhere(1);
		const there = somewhere(42);
		const edits = WorldEdits.none.with(tree);
		const out = travel(at(1, { pos: walk, facing: 'left', edits }), 42, player);
		if (!out.ok) throw new Error(out.reason);
		const moved: Whereabouts = {
			...out.whereabouts,
			pos: there.walk,
			facing: 'up',
			edits: WorldEdits.none.with(there.tree)
		};
		const back = travel(moved, 1, player);
		if (!back.ok) throw new Error(back.reason);
		expect(back.firstVisit).toBe(false);
		expect(back.whereabouts.world).toBe(1);
		expect(back.whereabouts.pos).toEqual(walk);
		expect(back.whereabouts.facing).toBe('left');
		expect(back.whereabouts.edits.encode()).toEqual(edits.encode());
		expect(back.whereabouts.worlds).toEqual([
			{
				world: 42,
				pos: there.walk,
				facing: 'up',
				edits: [...WorldEdits.none.with(there.tree).encode()]
			}
		]);
	});

	it('never strands the player: a spot they can no longer stand on starts them at the spawn, their clearings kept', () => {
		// Left out on the water in the boat; back without it (a hand-edited save).
		const seed = worldSeed(1);
		let water: GridPos | null = null;
		for (let x = -10; x < 10 && !water; x++)
			for (let y = -10; y < 10 && !water; y++)
				if (isWater(tileAtWorld(seed, x, y).kind)) water = { x, y };
		const edits = ['0,0:11'];
		const from = at(2, { worlds: [{ world: 1, pos: water!, facing: 'left', edits }] });
		const withBoat = travel(from, 1, { home: 1, items: ['boat'] });
		expect(withBoat.ok && withBoat.whereabouts.pos).toEqual(water);
		const without = travel(from, 1, { home: 1, items: [] });
		if (!without.ok) throw new Error(without.reason);
		expect(without.whereabouts.pos).toEqual(spawnPoint(seed));
		expect(without.whereabouts.facing).toBe('down');
		expect(without.whereabouts.edits.encode()).toEqual(edits);
		expect(without.firstVisit).toBe(false);
	});

	it('over random journeys: each world once, never the one the player is in, at most the cap, home kept, and clearings only ever moved', () => {
		const pool = [1, 2, 3, 5, 8, 13, 21, 34];
		const rng = new Rng(hashInts(41, 1));
		const home = 3;
		let here = at(home);
		let everLeftHome = false;
		const cleared = new Map<number, string[]>();
		for (let i = 0; i < 300; i++) {
			// Clear a made-up tile now and then, then go somewhere.
			if (rng.chance(0.4)) {
				const edits = here.edits.with({ x: rng.int(-50, 50), y: rng.int(-50, 50) });
				here = { ...here, edits };
			}
			cleared.set(here.world, [...here.edits.encode()]);
			const to = rng.pick(pool);
			const out = travel(here, to, { home, items: [] });
			if (to === here.world) {
				expect(out).toEqual({ ok: false, reason: 'already-there' });
				continue;
			}
			if (!out.ok) throw new Error(out.reason);
			if (here.world === home) everLeftHome = true;
			here = out.whereabouts;
			const worlds = here.worlds.map((w) => w.world);
			expect(new Set(worlds).size).toBe(worlds.length);
			expect(worlds).not.toContain(here.world);
			if (everLeftHome && here.world !== home) expect(worlds).toContain(home);
			// Every world keeps exactly what was cleared there.
			expect(here.edits.encode()).toEqual(cleared.get(here.world) ?? []);
			for (const stay of here.worlds) expect(stay.edits).toEqual(cleared.get(stay.world) ?? []);
		}
	});
});

describe('the worlds left behind', () => {
	const stay = (world: number, edits: readonly string[] = []): WorldStay => ({
		world,
		pos: { x: 0, y: world },
		facing: 'up',
		edits
	});

	it('the world just left goes first, each world once', () => {
		expect(remember([stay(2), stay(3), stay(4)], stay(3, ['0,0:11']), 1)).toEqual([
			stay(3, ['0,0:11']),
			stay(2),
			stay(4)
		]);
	});

	it(`keep at most ${MAX_WORLDS_KEPT}: past it, the ones left longest ago are forgotten, never home`, () => {
		const many = Array.from({ length: MAX_WORLDS_KEPT + 5 }, (_, i) => stay(i + 2));
		const home = many.at(-1)!.world;
		const kept = keepWorlds(many, home);
		expect(kept).toHaveLength(MAX_WORLDS_KEPT);
		expect(kept.slice(0, -1)).toEqual(many.slice(0, MAX_WORLDS_KEPT - 1));
		expect(kept.at(-1)).toEqual(many.at(-1));
		// Without home among them, simply the first ones.
		expect(keepWorlds(many, 1)).toEqual(many.slice(0, MAX_WORLDS_KEPT));
		expect(keepWorlds(many.slice(0, 3), 1)).toEqual(many.slice(0, 3));
	});

	it('share the one budget for cleared tiles with the world the player is in: that first, then home, then the latest left', () => {
		// Twenty chunks cleared bare in a row: about 10,400 characters a world.
		const bare = (cy: number) => {
			let e = WorldEdits.none;
			for (let cx = 0; cx < 20; cx++) {
				for (let i = 0; i < 256; i++) e = e.with({ x: cx * 16 + (i % 16), y: cy * 16 + (i >> 4) });
			}
			return e;
		};
		const length = (e: readonly string[]) => (e.length ? JSON.stringify(e).length : 0);
		const current = bare(0);
		const worlds = [stay(2, [...bare(1).encode()]), stay(3, [...bare(2).encode()])];
		// Unchanged, the very same list, when everything fits.
		expect(fitWorlds(WorldEdits.none, worlds, 3)).toBe(worlds);
		const fitted = fitWorlds(current, worlds, 3);
		const total = length(current.encode()) + fitted.reduce((n, w) => n + length(w.edits), 0);
		expect(total).toBeLessThanOrEqual(EDITS_BUDGET);
		expect(fitted.map((w) => [w.world, w.pos, w.facing])).toEqual(
			worlds.map((w) => [w.world, w.pos, w.facing])
		);
		// Home (World 3) is kept whole before the world left more recently (World 2)...
		expect(fitted[1]!.edits).toEqual(worlds[1]!.edits);
		// ...which keeps what is left of the budget: its chunks nearest where the player stood.
		const kept = WorldEdits.decode(fitted[0]!.edits);
		const all = WorldEdits.decode(worlds[0]!.edits);
		expect(kept.size).toBeGreaterThan(0);
		expect(kept.size).toBeLessThan(all.size);
		const chunks = (e: WorldEdits) => [...e.chunks.keys()].map((k) => Number(k.split(',')[0]));
		expect(Math.max(...chunks(kept))).toBeLessThan(
			Math.min(...chunks(all).filter((c) => !chunks(kept).includes(c)))
		);
	});
});
