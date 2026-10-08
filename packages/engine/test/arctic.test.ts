import { describe, expect, it } from 'vitest';
import { BIOME_POLE, type Biome } from '../src/animals/types.js';
import { landSeed } from '../src/lands/ids.js';
import { Rng } from '../src/rng.js';
import {
	ARCTIC_BAND,
	ICE_RUN,
	LEAD_FREE,
	TENT_CLEARING,
	poleAt,
	tentSpotDistance
} from '../src/world/arctic.js';
import { WorldEdits, clearedTile, editedTileAt } from '../src/world/edits.js';
import { encounterTable, rollEncounter } from '../src/world/encounters.js';
import { isLandable } from '../src/world/flight.js';
import { generateChunk, onTentLattice, tileAtWorld, travelKindAt } from '../src/world/generate.js';
import { worldSeed } from '../src/world/numbers.js';
import { MAX_SLIDE, moveFrom } from '../src/world/slide.js';
import { ARCTIC_ORIGIN, SPAWN_ROOM, spawnPoint } from '../src/world/spawn.js';
import { canTalkToDoctor, nearestTent } from '../src/world/tents.js';
import {
	CHUNK_SIZE,
	encounterRealm,
	isPassable,
	isWalkable,
	isWater,
	step,
	tileRealm,
	type Direction,
	type GridPos,
	type TileKind
} from '../src/world/types.js';
import { surroundings } from '../src/world/habitat.js';

const DIRS: readonly Direction[] = ['up', 'down', 'left', 'right'];
const WORLDS = [1, 2, 42, 777, 9999];
const arctic = (world: number) => landSeed('arctic', world);

/** Every tile of a window, `w` × `h` from (x0, y0). */
function* window(x0: number, y0: number, w: number, h: number): Generator<GridPos> {
	for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) yield { x, y };
}

/** The tents' lattice spots within `n` spots of the origin's. */
function* spots(n: number): Generator<GridPos> {
	for (let j = -n; j <= n; j++)
		for (let i = -n; i <= n; i++) yield { x: 5 + 23 * i, y: 7 + 19 * j };
}

describe("Nordland's worlds", () => {
	it('are exactly the worlds there were before The Arctic: chunks, tiles and spawns, pinned', () => {
		// Pinned from the generator before #191 step 4 touched it. A change here moves a kid's saved
		// Nordland: check what it does to saved games before updating a pin.
		const pins: Record<number, string> = {
			1: 'd9bf7ab8',
			2: 'fac3e7eb',
			42: 'ad93fe23',
			777: 'da8c9a26',
			9999: 'bdc92db5'
		};
		for (const world of WORLDS) {
			const seed = worldSeed(world);
			let h = 0x811c9dc5;
			const feed = (s: string) => {
				for (const ch of s) {
					h ^= ch.charCodeAt(0);
					h = Math.imul(h, 0x01000193) >>> 0;
				}
			};
			for (let cy = -3; cy <= 3; cy++)
				for (let cx = -3; cx <= 3; cx++)
					for (const t of generateChunk(seed, cx, cy).tiles)
						feed(`${t.kind}/${t.biome}/${t.height};`);
			for (let y = -40; y <= 40; y += 3)
				for (let x = -40; x <= 40; x += 3) feed(travelKindAt(seed, x, y));
			const s = spawnPoint(seed);
			feed(`${s.x},${s.y}`);
			expect(h.toString(16).padStart(8, '0'), `world ${world}`).toBe(pins[world]);
		}
	});

	it('have no Arctic tile and no slide: every move there is one step', () => {
		const seed = worldSeed(1);
		const arcticKinds = new Set<TileKind>(['snow', 'deepsnow', 'ice', 'iceblock', 'hole']);
		for (const p of window(-40, -40, 80, 80)) {
			const tile = tileAtWorld(seed, p.x, p.y);
			expect(arcticKinds.has(tile.kind)).toBe(false);
			expect(BIOME_POLE[tile.biome]).toBeNull();
			for (const dir of DIRS) {
				const moved = moveFrom(seed, WorldEdits.none, p, dir, { boat: true });
				if (moved) expect(moved.path).toEqual([step(p, dir)]);
			}
		}
	});
});

describe("The Arctic's world", () => {
	it('is a pure function of (seed, cx, cy), seamless with tileAtWorld at chunk edges and below zero', () => {
		const seed = arctic(3);
		for (const [cx, cy] of [
			[0, 0],
			[-1, 0],
			[0, -1],
			[-3, 2],
			[2, -25],
			[1, 1]
		] as const) {
			const chunk = generateChunk(seed, cx, cy);
			expect(generateChunk(seed, cx, cy)).toEqual(chunk);
			chunk.tiles.forEach((tile, i) => {
				const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE);
				const y = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
				expect(tile).toEqual(tileAtWorld(seed, x, y));
				const travel = travelKindAt(seed, x, y);
				expect(travel).toBe(tile.kind === 'deepwater' ? 'water' : tile.kind);
			});
		}
		// Another world number is another world.
		expect(generateChunk(arctic(4), 0, 0)).not.toEqual(generateChunk(seed, 0, 0));
	});

	it('keeps the poles apart: every tile north of the band is the Arctic, every tile south of it the Antarctic', () => {
		for (const world of [1, 42]) {
			const seed = arctic(world);
			for (const p of window(-60, -120, 120, 260)) {
				const tile = tileAtWorld(seed, p.x, p.y);
				expect(BIOME_POLE[tile.biome], `${p.x},${p.y}`).toBe(poleAt(p.y));
			}
		}
	});

	it('lays a band of open sea between them, never walked across, deep water in its middle', () => {
		for (const world of WORLDS) {
			const seed = arctic(world);
			for (let x = -300; x <= 300; x++) {
				// Rows 12 to 21 are always the band's water (half-width at least 5 round 16.5).
				for (let y = 12; y <= 21; y++) {
					const kind = tileAtWorld(seed, x, y).kind;
					expect(['water', 'deepwater', 'iceblock'], `${world}: ${x},${y}`).toContain(kind);
				}
				const ocean = tileAtWorld(seed, x, 16).biome;
				expect(ocean).toBe('arctic-ocean');
				expect(tileAtWorld(seed, x, 17).biome).toBe('southern-ocean');
				expect(
					[14, 15, 16, 17, 18, 19].some((y) => tileAtWorld(seed, x, y).kind === 'deepwater')
				).toBe(true);
			}
		}
		expect(ARCTIC_BAND.middle - ARCTIC_BAND.halfWidth - ARCTIC_BAND.wobble).toBeGreaterThan(
			7 + TENT_CLEARING
		);
		expect(ARCTIC_BAND.middle + ARCTIC_BAND.halfWidth + ARCTIC_BAND.wobble).toBeLessThan(
			26 - TENT_CLEARING
		);
	});

	it('grows every biome of both poles, and the encounter tile of each, within 8 chunks of spawn', () => {
		// Deep snow is the land's tall grass and deep water the oceans'; a frozen lake's animals
		// come from its fishing holes (#191 step 6).
		const want: Partial<Record<Biome, TileKind>> = {
			tundra: 'deepsnow',
			taiga: 'deepsnow',
			fell: 'deepsnow',
			'bird-cliffs': 'deepsnow',
			'frozen-lake': 'hole',
			'arctic-ice': 'deepsnow',
			'arctic-ocean': 'deepwater',
			'ice-sheet': 'deepsnow',
			rookery: 'deepsnow',
			'antarctic-ice': 'deepsnow',
			'southern-ocean': 'deepwater'
		};
		for (const world of [1, 2, 42]) {
			const seed = arctic(world);
			const spawn = spawnPoint(seed);
			const found = new Set<string>();
			const r = 8 * CHUNK_SIZE;
			for (let y = spawn.y - r; y <= spawn.y + r; y += 1) {
				for (let x = spawn.x - r; x <= spawn.x + r; x += 2) {
					const tile = tileAtWorld(seed, x, y);
					if (want[tile.biome] === tile.kind) found.add(tile.biome);
				}
			}
			expect([...found].sort(), `world ${world}`).toEqual(Object.keys(want).sort());
		}
	});

	it('puts a tent on every spot of the lattice, a clearing of snow round it, and no open water near', () => {
		let tents = 0;
		for (const world of WORLDS) {
			const seed = arctic(world);
			for (const spot of [
				...spots(6),
				{ x: 5 + 23 * 40, y: 7 - 19 * 30 },
				{ x: 5 - 23 * 50, y: 7 + 19 * 44 }
			]) {
				expect(tileAtWorld(seed, spot.x, spot.y).kind, `${world}: ${spot.x},${spot.y}`).toBe(
					'tent'
				);
				tents++;
				for (let dy = -LEAD_FREE; dy <= LEAD_FREE; dy++) {
					for (let dx = -LEAD_FREE; dx <= LEAD_FREE; dx++) {
						const tile = tileAtWorld(seed, spot.x + dx, spot.y + dy);
						if (dx === 0 && dy === 0) continue;
						if (Math.max(Math.abs(dx), Math.abs(dy)) <= TENT_CLEARING)
							expect(tile.kind).toBe('snow');
						// The band's shore may be near; a lead in the sea ice never is.
						else if (tile.biome !== 'arctic-ocean' && tile.biome !== 'southern-ocean') {
							expect(isWater(tile.kind), `${world}: ${spot.x + dx},${spot.y + dy}`).toBe(false);
						}
					}
				}
			}
			// And nowhere off the lattice.
			for (const p of window(-50, -50, 100, 100)) {
				expect(tileAtWorld(seed, p.x, p.y).kind === 'tent').toBe(onTentLattice(p.x, p.y));
				expect(tentSpotDistance(p.x, p.y) === 0).toBe(onTentLattice(p.x, p.y));
			}
		}
		expect(tents).toBeGreaterThan(800);
	});

	it('lets a kid walk (and slide) away from every tent, and back to it: no tent stands on an island', () => {
		// Every place a kid can come to a stop from beside the tent, the way they move (`moveFrom`,
		// a slide is one move), on foot: at least 300 of them, and the tent's side among them.
		const ENOUGH = 300;
		for (const world of [1, 42, 9999]) {
			const seed = arctic(world);
			for (const tent of [
				...spots(4),
				{ x: 5 + 23 * 9, y: 7 - 19 * 20 },
				{ x: 5 - 23 * 7, y: 7 + 19 * 12 }
			]) {
				const start = step(tent, 'down');
				const key = (p: GridPos) => `${p.x},${p.y}`;
				const seen = new Set([key(start)]);
				let edge = [start];
				while (edge.length > 0 && seen.size < ENOUGH) {
					const next: GridPos[] = [];
					for (const p of edge) {
						for (const dir of DIRS) {
							const moved = moveFrom(seed, WorldEdits.none, p, dir);
							if (!moved) continue;
							const to = moved.path[moved.path.length - 1]!;
							if (seen.has(key(to))) continue;
							seen.add(key(to));
							next.push(to);
						}
					}
					edge = next;
				}
				expect(seen.size, `${world}: tent ${tent.x},${tent.y}`).toBeGreaterThanOrEqual(ENOUGH);
				expect(canTalkToDoctor(seed, step(tent, 'up'), 'down')).toBe(true);
			}
		}
	});

	it('starts every world on the north shore by the tent at (5, 7): snow, room to roam, the witch doctor 2 steps off', () => {
		for (let world = 1; world <= 9999; world += 197) {
			const seed = arctic(world);
			const spawn = spawnPoint(seed);
			expect(spawn, `world ${world}`).toEqual(ARCTIC_ORIGIN);
			const tile = tileAtWorld(seed, spawn.x, spawn.y);
			expect(tile.kind).toBe('snow');
			expect(['tundra', 'bird-cliffs']).toContain(tile.biome);
			expect(nearestTent(seed, spawn, 12)?.tent).toEqual({ x: 5, y: 7 });
			// The band's water is a few steps south.
			let water = spawn.y;
			while (!isWater(travelKindAt(seed, spawn.x, water))) water++;
			expect(water - spawn.y).toBeLessThanOrEqual(4);
		}
		// Room to roam, counted on foot as the spawn rule counts it.
		const seed = arctic(1);
		const seen = new Set<string>([`5,9`]);
		let edge: GridPos[] = [ARCTIC_ORIGIN];
		while (edge.length && seen.size < SPAWN_ROOM) {
			const next: GridPos[] = [];
			for (const p of edge)
				for (const dir of DIRS) {
					const n = step(p, dir);
					if (seen.has(`${n.x},${n.y}`) || !isWalkable(travelKindAt(seed, n.x, n.y))) continue;
					seen.add(`${n.x},${n.y}`);
					next.push(n);
				}
			edge = next;
		}
		expect(seen.size).toBeGreaterThanOrEqual(SPAWN_ROOM);
	});
});

describe('sliding on the ice', () => {
	/** The test's own slide: on over ice while the tile ahead can be stepped onto. */
	function slide(seed: number, from: GridPos, dir: Direction, boat: boolean): GridPos[] | null {
		const gear = { boat };
		let at = step(from, dir);
		if (!isPassable(tileAtWorld(seed, at.x, at.y).kind, gear)) return null;
		const path = [at];
		for (;;) {
			if (tileAtWorld(seed, at.x, at.y).kind !== 'ice') return path;
			const next = step(at, dir);
			if (!isPassable(tileAtWorld(seed, next.x, next.y).kind, gear)) return path;
			at = next;
			path.push(at);
		}
	}

	/** Windows with lakes and sea ice: by spawn, far north (the Arctic Ocean's ice), far south. */
	const AREAS: readonly [number, number, number, number, number][] = [
		[1, -60, -420, 110, 60],
		[7, -60, 150, 110, 45],
		[42, -40, -60, 100, 60],
		[9999, -200, -300, 80, 80]
	];

	it('goes on over every tile of ice until something stops it, never past the longest run of ice', () => {
		let slides = 0;
		let long = 0;
		let holes = 0;
		for (const [world, x0, y0, w, h] of AREAS) {
			const seed = arctic(world);
			for (const p of window(x0, y0, w, h)) {
				if (!isWalkable(tileAtWorld(seed, p.x, p.y).kind)) continue;
				for (const dir of DIRS) {
					for (const boat of [false, true]) {
						const moved = moveFrom(seed, WorldEdits.none, p, dir, { boat });
						const own = slide(seed, p, dir, boat);
						expect(moved?.path ?? null, `${world}: ${p.x},${p.y} ${dir}`).toEqual(own);
						if (!moved) continue;
						const end = moved.path[moved.path.length - 1]!;
						expect(moved.tile).toEqual(tileAtWorld(seed, end.x, end.y));
						expect(moved.path.length).toBeLessThanOrEqual(ICE_RUN + 1);
						if (moved.path.length > 1) slides++;
						if (moved.path.length > 8) long++;
						// Slid dead into a fishing hole: stopped on the ice in front of it, facing it.
						const ahead = step(end, dir);
						if (moved.tile.kind === 'ice' && tileAtWorld(seed, ahead.x, ahead.y).kind === 'hole') {
							holes++;
						}
					}
				}
			}
		}
		expect(slides).toBeGreaterThan(5000);
		expect(long).toBeGreaterThan(100);
		expect(holes).toBeGreaterThan(50);
		expect(MAX_SLIDE).toBe(ICE_RUN + 1);
	});

	it('never meets a straight run of ice longer than ICE_RUN, in a row or a column', () => {
		for (const [world, x0, y0, w, h] of AREAS) {
			const seed = arctic(world);
			const ice = (x: number, y: number) => tileAtWorld(seed, x, y).kind === 'ice';
			// Read a run's whole length, from the window's edge out as far as it goes.
			for (let y = y0; y < y0 + h; y++) {
				let run = 0;
				for (let x = x0 - ICE_RUN; x < x0 + w + ICE_RUN; x++) {
					run = ice(x, y) ? run + 1 : 0;
					expect(run, `${world}: row ${y} at ${x}`).toBeLessThanOrEqual(ICE_RUN);
				}
			}
			for (let x = x0; x < x0 + w; x += 3) {
				let run = 0;
				for (let y = y0 - ICE_RUN; y < y0 + h + ICE_RUN; y++) {
					run = ice(x, y) ? run + 1 : 0;
					expect(run, `${world}: column ${x} at ${y}`).toBeLessThanOrEqual(ICE_RUN);
				}
			}
		}
	});

	it('stops a slide at MAX_SLIDE tiles whatever the ground: a slide always ends', () => {
		// No world The Arctic makes has so long a run, so the cap is read off a slide's own rule:
		// a moved path never holds more than MAX_SLIDE tiles, from any tile, any way, with the boat.
		const seed = arctic(1);
		for (const p of window(-60, -420, 60, 40)) {
			for (const dir of DIRS) {
				const moved = moveFrom(seed, WorldEdits.none, p, dir, { boat: true });
				if (moved) expect(moved.path.length).toBeLessThanOrEqual(MAX_SLIDE);
			}
		}
	});
});

describe("The Arctic's tiles", () => {
	const KINDS: readonly TileKind[] = ['snow', 'deepsnow', 'ice', 'iceblock', 'hole'];

	it('snow, deep snow and ice are walked on; an ice block and a fishing hole stop a walk and a boat alike', () => {
		for (const kind of KINDS) {
			const walk = kind === 'snow' || kind === 'deepsnow' || kind === 'ice';
			expect(isWalkable(kind), kind).toBe(walk);
			expect(isPassable(kind, { boat: true }), kind).toBe(walk);
			expect(isWater(kind), kind).toBe(false);
			expect(tileRealm(kind), kind).toBe('land');
		}
	});

	it('deep snow is the encounter ground on land; the ice, a hole and a block start nothing', () => {
		expect(encounterRealm('deepsnow')).toBe('land');
		for (const kind of ['snow', 'ice', 'iceblock', 'hole'] as const)
			expect(encounterRealm(kind)).toBeNull();
	});

	it('the glider comes down on snow, deep snow and the ice, never on an ice block or into a fishing hole', () => {
		for (const items of [[], ['boat', 'axe', 'pickaxe']]) {
			expect(isLandable('snow', { items })).toBe(true);
			expect(isLandable('deepsnow', { items })).toBe(true);
			expect(isLandable('ice', { items })).toBe(true);
			expect(isLandable('iceblock', { items })).toBe(false);
			expect(isLandable('hole', { items })).toBe(false);
		}
	});

	it('a tree cut down in The Arctic leaves snow, in Nordland grass', () => {
		expect(clearedTile({ kind: 'tree', biome: 'taiga', height: 1 })).toEqual({
			kind: 'snow',
			biome: 'taiga',
			height: 1,
			cleared: 'tree'
		});
		expect(clearedTile({ kind: 'rock', biome: 'fell', height: 2 }).kind).toBe('snow');
		expect(clearedTile({ kind: 'tree', biome: 'forest', height: 1 }).kind).toBe('grass');
		// Nothing else of The Arctic's is ever cleared.
		for (const kind of KINDS) {
			const tile = { kind, biome: 'tundra' as const, height: 0 };
			expect(clearedTile(tile)).toBe(tile);
		}
		const seed = arctic(1);
		let tree: GridPos | null = null;
		for (const p of window(-60, -60, 120, 60)) {
			if (tileAtWorld(seed, p.x, p.y).kind === 'tree') {
				tree = p;
				break;
			}
		}
		expect(editedTileAt(seed, WorldEdits.none.with(tree!), tree!.x, tree!.y).kind).toBe('snow');
	});

	it('counts the ice and the holes as water round an encounter tile, the ice blocks as rocks', () => {
		const seed = arctic(1);
		let checked = 0;
		for (const p of window(-60, -420, 110, 60)) {
			if (tileAtWorld(seed, p.x, p.y).kind !== 'deepsnow') continue;
			const around = surroundings(seed, p);
			let water = 0;
			let rocks = 0;
			for (let dy = -3; dy <= 3; dy++)
				for (let dx = -3; dx <= 3; dx++) {
					if ((dx === 0 && dy === 0) || dx * dx + dy * dy > 9) continue;
					const kind = tileAtWorld(seed, p.x + dx, p.y + dy).kind;
					if (kind === 'ice' || kind === 'hole' || kind === 'water' || kind === 'deepwater')
						water++;
					if (kind === 'iceblock' || kind === 'rock') rocks++;
				}
			expect(around.water).toBe(water);
			expect(around.rocks).toBe(rocks);
			checked++;
		}
		expect(checked).toBeGreaterThan(100);
	});

	it('rolls nothing, and draws nothing, on an encounter tile whose biome has no animal yet', () => {
		// The Arctic's animals come in waves (#191 step 5): until a biome has some, its deep snow
		// and deep water are quiet, and a step there leaves the stream as it was.
		const seed = arctic(1);
		const spawn = spawnPoint(seed);
		for (const p of window(-60, -60, 120, 120)) {
			const tile = tileAtWorld(seed, p.x, p.y);
			const realm = encounterRealm(tile.kind);
			if (!realm || BIOME_POLE[tile.biome] === null) continue;
			for (const lead of [1, 3, 5] as const) {
				if (encounterTable(tile.biome, 0, lead, realm).length > 0) continue;
				const rng = new Rng(7);
				const site = { tile, pos: p, spawn, around: surroundings(seed, p) };
				expect(rollEncounter(rng, site, lead)).toBeNull();
				expect(rng.next()).toBe(new Rng(7).next());
			}
		}
	});
});
