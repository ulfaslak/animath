import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import type { AnimalInstance, Biome } from '../src/animals/types.js';
import { knockOut } from '../src/doctor/knockout.js';
import { getItem } from '../src/items/catalog.js';
import { landSeed } from '../src/lands/ids.js';
import { Rng, hashInts } from '../src/rng.js';
import { readBattle } from '../src/save.js';
import { startBattle } from '../src/battle/reducer.js';
import { startDoctorVisit } from '../src/doctor/reducer.js';
import { shopFor } from '../src/lands/lands.js';
import { clearTile, clearableAhead, clearingTool } from '../src/world/clearing.js';
import { WorldEdits, editedTileAt } from '../src/world/edits.js';
import { BITE_CHANCE, castLine, holeAhead, holeTable, rollCast } from '../src/world/fishing.js';
import { tileAtWorld } from '../src/world/generate.js';
import { worldSeed } from '../src/world/numbers.js';
import { moveFrom } from '../src/world/slide.js';
import { spawnPoint } from '../src/world/spawn.js';
import { nearestTent } from '../src/world/tents.js';
import {
	isPassable,
	isWalkable,
	step,
	type Direction,
	type GridPos,
	type TileKind
} from '../src/world/types.js';

/**
 * The Arctic's shop (#191 step 6): what its tools do to its world. The ice
 * pick breaks ice blocks, leaving what they stood on; the arctic axe cuts its
 * spruces, never Nordland's axe; the fishing rod fishes at a fishing hole;
 * and the searches on foot read the slides.
 */

const DIRS: readonly Direction[] = ['up', 'down', 'left', 'right'];
const BACK: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const arctic = (world: number) => landSeed('arctic', world);
const key = (p: GridPos) => `${p.x},${p.y}`;

/** Every tile within `r` of `centre` (the square round it). */
function* around(centre: GridPos, r: number): Generator<GridPos> {
	for (let y = centre.y - r; y <= centre.y + r; y++)
		for (let x = centre.x - r; x <= centre.x + r; x++) yield { x, y };
}

/** Tiles of `kind` within `r` of the world's spawn. */
function tilesOf(seed: number, kind: TileKind, r: number): GridPos[] {
	return [...around(spawnPoint(seed), r)].filter((p) => tileAtWorld(seed, p.x, p.y).kind === kind);
}

/** The world with every tile in `tiles` cleared. */
function cleared(tiles: readonly GridPos[]): WorldEdits {
	return tiles.reduce((e, p) => e.with(p), WorldEdits.none);
}

const animal = (speciesId: string, hp?: number, id = speciesId): AnimalInstance => ({
	id,
	speciesId,
	hp: hp ?? getAnimal(speciesId).maxHp
});

describe('the ice pick and the arctic axe', () => {
	it('break every ice block from beside it, facing it, leaving snow, a fishing hole or water', () => {
		const seen = new Set<string>();
		for (const world of [1, 2, 42]) {
			const seed = arctic(world);
			for (const block of tilesOf(seed, 'iceblock', 90)) {
				const under = tileAtWorld(seed, block.x, block.y).under!;
				for (const dir of DIRS) {
					const pos = step(block, BACK[dir]);
					const result = clearTile(
						seed,
						WorldEdits.none,
						{ pos, facing: dir, items: ['ice-pick'] },
						block
					);
					expect(result.ok, `${key(block)} from ${dir}`).toBe(true);
					if (!result.ok) continue;
					expect(result.cleared).toMatchObject({ was: 'iceblock', tool: 'ice-pick' });
					const after = editedTileAt(seed, result.edits, block.x, block.y);
					expect(after.kind).toBe(under === 'ice' ? 'hole' : under);
					expect(after.cleared).toBe('iceblock');
					seen.add(under);
				}
				// Without the ice pick, it says the ice pick is what it takes; Nordland's tools never do.
				const pos = step(block, 'up');
				for (const items of [[], ['axe', 'pickaxe', 'arctic-axe']]) {
					expect(clearTile(seed, WorldEdits.none, { pos, facing: 'down', items }, block)).toEqual({
						ok: false,
						reason: 'needs-tool',
						kind: 'iceblock',
						tool: 'ice-pick'
					});
				}
			}
		}
		// Blocks on snow, on the ice and afloat, all met.
		expect([...seen].sort()).toEqual(['ice', 'snow', 'water']);
	});

	it('cut a spruce with the arctic axe only, and leave snow; a rock in The Arctic takes the pickaxe, which is not sold there', () => {
		const seed = arctic(1);
		const trees = tilesOf(seed, 'tree', 120);
		expect(trees.length).toBeGreaterThan(10);
		for (const tree of trees.slice(0, 40)) {
			const pos = step(tree, 'left');
			const player = (items: string[]) => ({ pos, facing: 'right' as const, items });
			expect(clearTile(seed, WorldEdits.none, player(['axe']), tree)).toMatchObject({
				ok: false,
				reason: 'needs-tool',
				tool: 'arctic-axe'
			});
			const done = clearTile(seed, WorldEdits.none, player(['arctic-axe']), tree);
			expect(done.ok).toBe(true);
			if (done.ok) expect(editedTileAt(seed, done.edits, tree.x, tree.y).kind).toBe('snow');
		}
		expect(clearingTool(seed, 'tree')).toBe('arctic-axe');
		expect(clearingTool(seed, 'rock')).toBe('pickaxe');
		expect(clearingTool(seed, 'iceblock')).toBe('ice-pick');
		// Nordland's trees take Nordland's axe, as ever.
		expect(clearingTool(worldSeed(1), 'tree')).toBe('axe');
		expect(clearableAhead(seed, WorldEdits.none, step(trees[0]!, 'up'), 'down')).toEqual({
			pos: trees[0],
			kind: 'tree',
			tool: 'arctic-axe'
		});
	});

	it('leave a world that still leads nowhere a kid cannot come back from, every block and spruce broken', () => {
		// #199's guarantee, with the ice pick and the axe at work: every ice block and spruce within
		// reach of the spawn broken (a block on the ice leaves a hole, never the ice, so no slide
		// stops on it), every move from where a kid can stand is undone by the move back.
		for (const world of [2, 5, 42]) {
			const seed = arctic(world);
			const edits = cleared([...tilesOf(seed, 'iceblock', 70), ...tilesOf(seed, 'tree', 70)]);
			expect(edits.size).toBeGreaterThan(30);
			for (const boat of [false, true]) {
				const gear = { boat };
				const start = spawnPoint(seed);
				const seen = new Set([key(start)]);
				const queue = [start];
				let moves = 0;
				while (queue.length > 0 && seen.size < 5000) {
					const p = queue.shift()!;
					for (const dir of DIRS) {
						const moved = moveFrom(seed, edits, p, dir, gear);
						if (!moved) continue;
						const to = moved.path.at(-1)!;
						const home = moveFrom(seed, edits, to, BACK[dir], gear);
						expect(home?.path.at(-1), `${world}: ${key(p)} ${dir} to ${key(to)}`).toEqual(p);
						moves++;
						if (seen.has(key(to))) continue;
						seen.add(key(to));
						queue.push(to);
					}
				}
				expect(moves).toBeGreaterThan(8000);
			}
		}
	}, 60_000);
});

describe("The Arctic's druid", () => {
	it('lists his shop cheapest first, in ice dollars, as every visit shows it', () => {
		const visit = startDoctorVisit([animal('fox')], { land: 'arctic' });
		expect(visit.shop).toEqual(shopFor('arctic'));
		expect(visit.shop).toEqual([
			'arctic-axe',
			'ice-pick',
			'fishing-rod',
			'skis',
			'boat',
			'glider',
			'sled'
		]);
		// The whole catalog (`?shop`) too: by the land's prices, the others' after their own.
		const all = startDoctorVisit([animal('fox')], {
			land: 'arctic',
			shop: ['glider', 'axe', 'ice-pick']
		});
		expect(all.shop).toEqual(['axe', 'ice-pick', 'glider']);
	});
});

describe('the way to a tent on the ice', () => {
	/**
	 * The fewest tiles from `from` to every place a kid can stop, moving as a kid
	 * moves (`moveFrom`: a slide is one move, its tiles each a step): Dijkstra
	 * the slow way, for what `nearestTent` must agree with.
	 */
	function stops(
		seed: number,
		edits: WorldEdits,
		from: GridPos,
		limit: number
	): Map<string, number> {
		const best = new Map<string, number>([[key(from), 0]]);
		const open: { p: GridPos; d: number }[] = [{ p: from, d: 0 }];
		while (open.length > 0) {
			open.sort((a, b) => a.d - b.d);
			const { p, d } = open.shift()!;
			if (best.get(key(p))! < d) continue;
			for (const dir of DIRS) {
				const moved = moveFrom(seed, edits, p, dir);
				if (!moved) continue;
				const to = moved.path.at(-1)!;
				const far = d + moved.path.length;
				if (far > limit) continue;
				const known = best.get(key(to));
				if (known !== undefined && known <= far) continue;
				best.set(key(to), far);
				open.push({ p: to, d: far });
			}
		}
		return best;
	}

	it('finds a stand a kid can stop on, the fewest tiles away by the moves a kid makes, slides and all', () => {
		let onIce = 0;
		for (const world of [1, 3, 42]) {
			const seed = arctic(world);
			const rng = new Rng(hashInts(seed, 0x7e47));
			const lakes = [...around(spawnPoint(seed), 120)].filter(
				(p) => tileAtWorld(seed, p.x, p.y).kind === 'ice'
			);
			for (let n = 0; n < 12; n++) {
				// A place by the ice a kid can stand on: the bank a slide ends on.
				const lake = rng.pick(lakes);
				const from = DIRS.map((d) => step(lake, d)).find(
					(p) =>
						isWalkable(tileAtWorld(seed, p.x, p.y).kind) &&
						tileAtWorld(seed, p.x, p.y).kind !== 'ice'
				);
				if (!from) continue;
				onIce++;
				const spot = nearestTent(seed, from, 60);
				const reach = stops(seed, WorldEdits.none, from, 60);
				if (!spot) {
					// No tent within reach by the moves a kid makes: none beside any place they stop on.
					for (const [p] of reach) {
						const [x, y] = p.split(',').map(Number) as [number, number];
						for (const d of DIRS)
							expect(tileAtWorld(seed, step({ x, y }, d).x, step({ x, y }, d).y).kind).not.toBe(
								'tent'
							);
					}
					continue;
				}
				expect(reach.get(key(spot.stand)), `${world} ${key(from)}`).toBe(spot.steps);
				// And no tent is beside a place nearer.
				for (const [p, d] of reach) {
					if (d >= spot.steps) continue;
					const [x, y] = p.split(',').map(Number) as [number, number];
					for (const dir of DIRS) {
						const t = step({ x, y }, dir);
						expect(tileAtWorld(seed, t.x, t.y).kind, `${p} at ${d}`).not.toBe('tent');
					}
				}
			}
		}
		expect(onIce).toBeGreaterThan(20);
	}, 60_000);

	it('reads the ground right past the edge of its search, where a slide starts there (the review of #201)', () => {
		// A slide from near the search's edge reads a run of ice beyond it: those tiles once
		// shared their keys with tiles inside, so a tent was missed, or found on the ice.
		const seed = arctic(1);
		expect(nearestTent(seed, { x: 27, y: 192 }, 5)).toMatchObject({
			tent: { x: 28, y: 197 },
			steps: 5
		});
		expect(nearestTent(seed, { x: -295, y: -81 }, 4)).toBeNull();
		// Every answer near its limit is the slow search's, a tent beside a stand at its steps.
		for (const from of [
			{ x: 27, y: 192 },
			{ x: 118, y: 241 },
			{ x: -295, y: -81 }
		]) {
			for (let max = 2; max <= 9; max++) {
				const spot = nearestTent(seed, from, max);
				const reach = stops(seed, WorldEdits.none, from, max);
				const best = [...reach.entries()]
					.filter(([p]) => {
						const [x, y] = p.split(',').map(Number) as [number, number];
						return (
							isWalkable(tileAtWorld(seed, x, y).kind) &&
							DIRS.some(
								(d) => tileAtWorld(seed, step({ x, y }, d).x, step({ x, y }, d).y).kind === 'tent'
							)
						);
					})
					.map(([, d]) => d);
				const want = best.length > 0 ? Math.min(...best) : null;
				expect(spot?.steps ?? null, `${key(from)} within ${max}`).toBe(want);
				if (spot) expect(tileAtWorld(seed, spot.tent.x, spot.tent.y).kind).toBe('tent');
			}
		}
	});

	it('never stands a kid on the ice to talk to a druid', () => {
		for (const world of [1, 2]) {
			const seed = arctic(world);
			for (const p of [...around(spawnPoint(seed), 60)].filter((_, i) => i % 37 === 0)) {
				if (!isPassable(tileAtWorld(seed, p.x, p.y).kind)) continue;
				const spot = nearestTent(seed, p, 80);
				if (spot) expect(tileAtWorld(seed, spot.stand.x, spot.stand.y).kind).not.toBe('ice');
			}
		}
	});
});

describe('fishing', () => {
	/** Every biome with fishing holes, and what lives in each (#192 § Fishing holes). */
	const HOLES: readonly Biome[] = ['frozen-lake', 'arctic-ice', 'antarctic-ice'];

	it('hooks only the animals of the water whose home is the ice the hole is in, at shares that sum to 1', () => {
		for (const biome of [...HOLES, 'sea' as const]) {
			for (const tier of [1, 2, 3, 4, 5] as const) {
				const table = holeTable(biome, 50, tier);
				for (const e of table) {
					expect(e.species.realms).not.toContain('land');
					expect(e.species.habitats).toContain(biome);
				}
				if (table.length > 0) {
					expect(table.reduce((s, e) => s + e.weight, 0)).toBeCloseTo(1, 9);
				}
			}
		}
		// Nordland's sea, where the sea animals live: every one of them, none that walks.
		const sea = holeTable('sea', 50, 3).map((e) => e.species.id);
		const swimmers = ANIMALS.filter(
			(a) => a.habitats.includes('sea') && !a.realms.includes('land')
		);
		expect(sea).toEqual(swimmers.map((a) => a.id));
		expect(sea.length).toBeGreaterThan(5);
	});

	it('bites about BITE_CHANCE of the casts where something lives, never where nothing does, by the shares', () => {
		const table = holeTable('sea', 50, 3);
		const counts = new Map<string, number>();
		let bites = 0;
		const N = 20_000;
		for (let i = 0; i < N; i++) {
			const wild = rollCast(new Rng(hashInts(7, i)), table);
			if (!wild) continue;
			bites++;
			expect(wild.hp).toBe(getAnimal(wild.speciesId).maxHp);
			counts.set(wild.speciesId, (counts.get(wild.speciesId) ?? 0) + 1);
		}
		expect(bites / N).toBeGreaterThan(BITE_CHANCE - 0.02);
		expect(bites / N).toBeLessThan(BITE_CHANCE + 0.02);
		for (const e of table) {
			expect((counts.get(e.species.id) ?? 0) / bites, e.species.id).toBeCloseTo(e.weight, 1);
		}
		// Nothing living there: nothing bites, and nothing is drawn.
		const rng = new Rng(1);
		const before = new Rng(1).next();
		expect(rollCast(rng, [])).toBeNull();
		expect(rng.next()).toBe(before);
	});

	it('casts into the hole ahead only: nobody to swim, and nothing bites; a swimmer, and the hole is rolled', () => {
		const seed = arctic(1);
		const holes = tilesOf(seed, 'hole', 200);
		expect(holes.length).toBeGreaterThan(0);
		const hole = holes[0]!;
		const spawn = spawnPoint(seed);
		const site = { hole, spawn };
		const rod = { items: ['fishing-rod'] };
		const walkers = [animal('fox')];
		const swimmers = [animal('fox'), animal('otter')];
		// No swimmer standing: nothing bites, and nothing is drawn.
		const rng = new Rng(3);
		expect(castLine(rng, seed, WorldEdits.none, site, rod, walkers)).toEqual({
			outcome: 'no-swimmer'
		});
		expect(rng.next()).toBe(new Rng(3).next());
		const tired = [animal('fox'), animal('otter', 0)];
		expect(castLine(new Rng(3), seed, WorldEdits.none, site, rod, tired)).toEqual({
			outcome: 'no-swimmer'
		});
		// A swimmer: every ice has animals under it now (#192 wave 3), so 2 casts in 5 bite, and
		// what bites is one of that ice's, at full HP. 50 casts with no bite: 1 in 100 billion.
		const table = holeTable(tileAtWorld(seed, hole.x, hole.y).biome, 0, 2);
		expect(table.length).toBeGreaterThan(0);
		const ids = table.map((e) => e.species.id);
		let bites = 0;
		for (let i = 0; i < 50; i++) {
			const got = castLine(new Rng(i), seed, WorldEdits.none, site, rod, swimmers);
			if (got.outcome === 'nothing') continue;
			expect(got.outcome).toBe('bite');
			if (got.outcome !== 'bite') continue;
			bites++;
			expect(ids).toContain(got.wild.speciesId);
			expect(got.wild.hp).toBe(getAnimal(got.wild.speciesId).maxHp);
		}
		expect(bites).toBeGreaterThan(0);
		expect(bites).toBeLessThan(50);
		// Without the rod, or with no hole there, it is never cast.
		expect(() =>
			castLine(new Rng(1), seed, WorldEdits.none, site, { items: [] }, swimmers)
		).toThrow();
		expect(() =>
			castLine(new Rng(1), seed, WorldEdits.none, { hole: spawn, spawn }, rod, swimmers)
		).toThrow();
		// The hole ahead, from its bank.
		const bank = DIRS.map((d) => ({ pos: step(hole, BACK[d]), facing: d })).find((b) =>
			isWalkable(tileAtWorld(seed, b.pos.x, b.pos.y).kind)
		)!;
		expect(holeAhead(seed, WorldEdits.none, bank.pos, bank.facing)).toEqual(hole);
		expect(holeAhead(seed, WorldEdits.none, bank.pos, BACK[bank.facing])).toBeNull();
	});

	it('casts into a hole the ice pick made, in the ice the block stood on', () => {
		const seed = arctic(2);
		const block = tilesOf(seed, 'iceblock', 150).find(
			(p) => tileAtWorld(seed, p.x, p.y).under === 'ice'
		)!;
		expect(block).toBeDefined();
		const edits = WorldEdits.none.with(block);
		const bank = step(block, 'up');
		expect(holeAhead(seed, edits, bank, 'down')).toEqual(block);
		const got = castLine(
			new Rng(5),
			seed,
			edits,
			{ hole: block, spawn: spawnPoint(seed) },
			{ items: ['fishing-rod'] },
			[animal('otter')]
		);
		expect(['bite', 'nothing']).toContain(got.outcome);
	});

	it('sells the rod once, and only once, a fishing hole has an animal to hook', () => {
		// A tripwire for #192's third wave: the change that brings a hole's animals turns the rod
		// on, and nothing earlier does (an item is on sale only once what it does is built).
		const somethingBites = HOLES.some((biome) =>
			([1, 2, 3, 4, 5] as const).some((tier) => holeTable(biome, 50, tier).length > 0)
		);
		expect(getItem('fishing-rod').available).toBe(somethingBites);
	});

	it('looks at a team that lost a fish battle where the kid stands, on the ice’s edge, not in the water', () => {
		const seed = arctic(1);
		const hole = tilesOf(seed, 'hole', 200)[0]!;
		const bank = DIRS.map((d) => step(hole, BACK[d])).find((p) =>
			isWalkable(tileAtWorld(seed, p.x, p.y).kind)
		)!;
		// The otter swam and lost; the fox still stands on land, so the team walks on, unhealed.
		const party = [animal('otter', 0), animal('fox', 5)];
		const out = knockOut(seed, bank, party, WorldEdits.none, { realm: 'water' });
		expect(out.doctorCame).toBe(false);
		expect(out.party).toEqual(party);
	});

	it('picks a fish battle up again after a reload while the kid faces the hole, and never elsewhere', () => {
		const party = [animal('fox'), animal('otter')];
		const battle = startBattle(party, animal('crab', undefined, 'wild-1'), { realm: 'water' });
		expect(readBattle(battle, battle.party, 'land', true)).not.toBeNull();
		expect(readBattle(battle, battle.party, 'land', false)).toBeNull();
	});
});
