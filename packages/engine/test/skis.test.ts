import { describe, expect, it } from 'vitest';
import { landSeed } from '../src/lands/ids.js';
import { WorldEdits, editedTileAt } from '../src/world/edits.js';
import { tileAtWorld } from '../src/world/generate.js';
import {
	DEEP_CARRY,
	LEVEL_RUNS,
	SKIM_TILES,
	TOP,
	coast,
	runUpBack,
	skiLevel,
	walksBack,
	skiMove,
	type Ski,
	type SkiMoved
} from '../src/world/skis.js';
import { moveFrom } from '../src/world/slide.js';
import {
	isEncounterTile,
	isIce,
	isPassable,
	isWater,
	step,
	type Direction,
	type Gear,
	type GridPos,
	type TileKind
} from '../src/world/types.js';

/**
 * Skis ([[PRODUCT]] §4 "Skis", #191 step 6): the speed a held way builds, the
 * coast after it, turns and walls, deep snow and water at top speed, and the
 * ice that slides the same with skis or without.
 */

const NONE = WorldEdits.none;
const FOOT: Gear = { boat: false };
const BOAT: Gear = { boat: true };
const DIRS: readonly Direction[] = ['up', 'down', 'left', 'right'];
const BACK: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const kindAt = (seed: number, p: GridPos): TileKind => tileAtWorld(seed, p.x, p.y).kind;
const ahead = (p: GridPos, dir: Direction, n: number): GridPos => {
	let at = p;
	for (let i = 0; i < n; i++) at = step(at, dir);
	return at;
};

/** Hold `dir` for `n` steps from `from` (or until blocked): every move, and the ski after. */
function hold(
	seed: number,
	from: GridPos,
	dir: Direction,
	n: number,
	gear: Gear = FOOT,
	start: Ski | null = null
): { moves: SkiMoved[]; at: GridPos; ski: Ski | null } {
	const moves: SkiMoved[] = [];
	let at = from;
	let ski = start;
	for (let i = 0; i < n; i++) {
		const moved = skiMove(seed, NONE, at, dir, ski, gear);
		if (!moved) {
			ski = null;
			break;
		}
		moves.push(moved);
		at = moved.path.at(-1)!;
		ski = moved.ski;
	}
	return { moves, at, ski };
}

/**
 * Spots in the Arctic worlds `worlds` near spawn where `run` tiles going
 * `dir` from a start all satisfy `ok(k, kind)` (k from 1): what a test needs.
 */
function find(
	worlds: readonly number[],
	run: number,
	ok: (k: number, kind: TileKind) => boolean,
	limit = 40
): { seed: number; from: GridPos; dir: Direction }[] {
	const out: { seed: number; from: GridPos; dir: Direction }[] = [];
	for (const world of worlds) {
		const seed = landSeed('arctic', world);
		for (let y = -120; y < 120 && out.length < limit; y += 1) {
			for (let x = -120; x < 120 && out.length < limit; x += 1) {
				const from = { x, y };
				if (kindAt(seed, from) !== 'snow') continue;
				for (const dir of DIRS) {
					let good = true;
					for (let k = 1; k <= run && good; k++) good = ok(k, kindAt(seed, ahead(from, dir, k)));
					if (good) {
						out.push({ seed, from, dir });
						break;
					}
				}
			}
		}
	}
	return out;
}

/** A straight run of plain snow `n` long ahead. */
const snowRun = (n: number) => find([1, 2, 42], n, (_, kind) => kind === 'snow', 30);

describe('speed', () => {
	it('builds while one way is held: two walking steps, then a level every few, to the top', () => {
		const runs = snowRun(LEVEL_RUNS[TOP]! + 4);
		expect(runs.length).toBeGreaterThan(10);
		for (const { seed, from, dir } of runs) {
			const { moves } = hold(seed, from, dir, LEVEL_RUNS[TOP]! + 3);
			const speeds = moves.map((m) => m.speeds[0]);
			expect(speeds).toEqual([0, 0, 1, 1, 2, 2, 2, 3, 3, 3]);
			// One tile each, a step of the count each, no encounter rolled on snow.
			for (const m of moves) {
				expect(m.path).toHaveLength(1);
				expect(m.roll).toBe(false);
			}
		}
		expect(skiLevel(null)).toBe(0);
	});

	it('a tap, or two, walks one tile and coasts nowhere: a kid still walks precisely', () => {
		for (const { seed, from, dir } of snowRun(4)) {
			const once = hold(seed, from, dir, 1);
			expect(skiLevel(once.ski)).toBe(0);
			expect(coast(seed, NONE, once.at, once.ski)).toBeNull();
			const twice = hold(seed, from, dir, 2);
			expect(skiLevel(twice.ski)).toBe(1);
			expect(coast(seed, NONE, twice.at, twice.ski)?.path).toHaveLength(1);
		}
	});

	it('coasts as many tiles as its level on letting go, each a level slower, and stands still after', () => {
		for (const { seed, from, dir } of snowRun(LEVEL_RUNS[TOP]! + 4)) {
			const { at, ski } = hold(seed, from, dir, LEVEL_RUNS[TOP]!);
			expect(skiLevel(ski)).toBe(TOP);
			const glided = coast(seed, NONE, at, ski)!;
			expect(glided.speeds).toEqual([3, 2, 1]);
			expect(glided.path).toEqual([1, 2, 3].map((k) => ahead(at, dir, k)));
			expect(glided.ski).toBeNull();
		}
	});

	it('drops a level on a quarter turn, stops on a turn right round, and stops dead at anything in the way', () => {
		const spots = find([1, 2], LEVEL_RUNS[TOP]!, (_, kind) => kind === 'snow', 20);
		let turns = 0;
		for (const { seed, from, dir } of spots) {
			const { at, ski } = hold(seed, from, dir, LEVEL_RUNS[TOP]!);
			expect(skiLevel(ski)).toBe(TOP);
			for (const side of DIRS) {
				if (side === dir) continue;
				const moved = skiMove(seed, NONE, at, side, ski, FOOT);
				if (!moved || kindAt(seed, moved.path[0]!) !== 'snow') continue;
				turns++;
				expect(moved.speeds[0]).toBe(side === BACK[dir] ? 0 : TOP - 1);
			}
		}
		expect(turns).toBeGreaterThan(10);
		// A wall: refused, as a step into it is.
		const walls = find([1, 2], 1, (_, kind) => kind === 'rock' || kind === 'iceblock', 10);
		for (const { seed, from, dir } of walls) {
			expect(skiMove(seed, NONE, from, dir, { dir, run: 20, deep: 0 }, FOOT)).toBeNull();
		}
	});

	it('slides on the ice exactly as a step does, and the slide stops the speed', () => {
		const lakes = find([1, 2, 3], 1, (_, kind) => kind === 'ice', 30);
		expect(lakes.length).toBeGreaterThan(5);
		for (const { seed, from, dir } of lakes) {
			const fast = skiMove(seed, NONE, from, dir, { dir, run: 20, deep: 0 }, FOOT)!;
			const slow = moveFrom(seed, NONE, from, dir, FOOT)!;
			expect(fast.path).toEqual(slow.path);
			expect(fast.ski).toBeNull();
			expect(fast.roll).toBe(isEncounterTile(slow.tile.kind));
		}
	});
});

describe('deep snow at top speed', () => {
	it(`flies over ${DEEP_CARRY} tiles of it in a row with no encounter, and slows to a walk on the next, rolling`, () => {
		const spots = find(
			[1, 2, 3, 4, 42],
			LEVEL_RUNS[TOP]! + DEEP_CARRY + 1,
			(k, kind) => (k <= LEVEL_RUNS[TOP]! ? kind === 'snow' : kind === 'deepsnow'),
			20
		);
		expect(spots.length).toBeGreaterThan(3);
		for (const { seed, from, dir } of spots) {
			const { moves } = hold(seed, from, dir, LEVEL_RUNS[TOP]! + DEEP_CARRY + 1);
			const deep = moves.slice(LEVEL_RUNS[TOP]!);
			expect(deep.map((m) => [m.speeds[0], m.roll])).toEqual([
				[TOP, false],
				[TOP, false],
				[0, true]
			]);
			expect(skiLevel(deep.at(-1)!.ski)).toBe(0);
		}
	});

	it('below top speed rolls on every deep-snow tile, as on foot', () => {
		const spots = find(
			[1, 2],
			2,
			(k, kind) => (k === 1 ? kind === 'snow' : kind === 'deepsnow'),
			20
		);
		for (const { seed, from, dir } of spots) {
			const { moves } = hold(seed, from, dir, 2);
			expect(moves.at(-1)!.roll).toBe(true);
		}
	});
});

describe('water at top speed', () => {
	/** A shore with a run-up of snow, then `water` tiles of water, then what `beyond` asks. */
	function shores(water: number, beyond: (kind: TileKind) => boolean) {
		return find(
			[1, 2, 3, 4, 5, 6, 7, 8],
			LEVEL_RUNS[TOP]! + water + 1,
			(k, kind) =>
				k <= LEVEL_RUNS[TOP]!
					? kind === 'snow'
					: k <= LEVEL_RUNS[TOP]! + water
						? isWater(kind)
						: beyond(kind),
			10
		);
	}

	it(`skims up to ${SKIM_TILES} tiles of it onto ground at top speed, only where the kid can get back`, () => {
		// Every shore with a run-up and 1 to 5 tiles of water before ground, along the sea ice's
		// open leads far north, in three worlds.
		let skims = 0;
		let refused = 0;
		for (const world of [1, 2, 3]) {
			const seed = landSeed('arctic', world);
			for (let y = -400; y < -360; y++) {
				for (let x = -200; x < 200; x++) {
					for (const dir of DIRS) {
						const from = { x, y };
						let plain = kindAt(seed, from) === 'snow';
						for (let k = 1; k <= LEVEL_RUNS[TOP]! && plain; k++)
							plain = kindAt(seed, ahead(from, dir, k)) === 'snow';
						if (!plain) continue;
						const at = ahead(from, dir, LEVEL_RUNS[TOP]!);
						let water = 0;
						while (water <= SKIM_TILES && isWater(kindAt(seed, ahead(at, dir, water + 1)))) water++;
						const landing = ahead(at, dir, water + 1);
						if (water < 1 || water > SKIM_TILES) continue;
						if (!['snow', 'deepsnow'].includes(kindAt(seed, landing))) continue;
						const { ski } = hold(seed, from, dir, LEVEL_RUNS[TOP]!);
						expect(skiLevel(ski)).toBe(TOP);
						const moved = skiMove(seed, NONE, at, dir, ski, FOOT);
						const back = runUpBack(seed, NONE, landing, dir) || walksBack(seed, NONE, landing, at);
						if (!back) {
							// A floe with no way back: no skim, the shore stops them.
							expect(moved).toBeNull();
							refused++;
							continue;
						}
						skims++;
						expect(moved!.path).toEqual(
							Array.from({ length: water + 1 }, (_, k) => ahead(at, dir, k + 1))
						);
						expect(moved!.speeds.every((v) => v === TOP)).toBe(true);
						expect(moved!.roll).toBe(false);
						expect(skiLevel(moved!.ski)).toBe(TOP);
					}
				}
			}
		}
		expect(skims).toBeGreaterThan(10);
		void refused;
	}, 120_000);

	it('takes a kid who skimmed onto a floe back the way they came, by the run-up or on foot', () => {
		// world 1, (55, −393) down: a run-up, 5 tiles of an open lead, and the far side.
		const seed = landSeed('arctic', 1);
		const from = { x: 55, y: -393 };
		const { at, ski } = hold(seed, from, 'down', LEVEL_RUNS[TOP]!);
		const there = skiMove(seed, NONE, at, 'down', ski, FOOT)!;
		expect(there.path).toHaveLength(SKIM_TILES + 1);
		const landing = there.path.at(-1)!;
		expect(runUpBack(seed, NONE, landing, 'down') || walksBack(seed, NONE, landing, at)).toBe(true);
	});

	it('without the boat and no ground in reach, the shore stops them; with it, they skim into the boat', () => {
		let checked = 0;
		for (const { seed, from, dir } of shores(SKIM_TILES + 1, isWater)) {
			const { at, ski } = hold(seed, from, dir, LEVEL_RUNS[TOP]!);
			expect(skiMove(seed, NONE, at, dir, ski, FOOT)).toBeNull();
			const boat = skiMove(seed, NONE, at, dir, ski, BOAT)!;
			expect(boat.path).toHaveLength(SKIM_TILES);
			expect(isWater(boat.tile.kind)).toBe(true);
			expect(boat.ski).toBeNull();
			checked++;
		}
		expect(checked).toBeGreaterThan(3);
	});

	it('below top speed, water is water: a step into the boat, or a wall without it', () => {
		for (const { seed, from, dir } of find([1, 2, 3], 1, (_, kind) => isWater(kind), 10)) {
			const slow = { dir, run: LEVEL_RUNS[TOP]! - 1, deep: 0 };
			expect(skiMove(seed, NONE, from, dir, slow, FOOT)).toBeNull();
			expect(skiMove(seed, NONE, from, dir, slow, BOAT)!.path).toHaveLength(1);
		}
	});
});

describe('every ski move', () => {
	it('ends where a kid can stand, only rolls on an encounter tile, and every skim on foot can be skied back', () => {
		// Random held ways from random places near spawn in four worlds, on foot and with the boat.
		let moves = 0;
		for (const world of [1, 2, 3, 42]) {
			const seed = landSeed('arctic', world);
			let state = 7;
			const rand = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
			for (let n = 0; n < 300; n++) {
				const from = { x: Math.floor(rand() * 200) - 100, y: Math.floor(rand() * 200) - 100 };
				if (!isPassable(kindAt(seed, from)) || isIce(kindAt(seed, from))) continue;
				const gear = rand() < 0.5 ? FOOT : BOAT;
				const dir = DIRS[Math.floor(rand() * 4)]!;
				let at = from;
				let ski: Ski | null = null;
				for (let i = 0; i < 14; i++) {
					const moved: SkiMoved | null =
						i % 7 === 6
							? coast(seed, NONE, at, ski, gear)
							: skiMove(seed, NONE, at, dir, ski, gear);
					if (!moved) break;
					moves++;
					const end = moved.path.at(-1)!;
					const tile = editedTileAt(seed, NONE, end.x, end.y);
					expect(isPassable(tile.kind, gear), `${world} ${end.x},${end.y}`).toBe(true);
					if (moved.roll) expect(isEncounterTile(tile.kind)).toBe(true);
					expect(moved.speeds).toHaveLength(moved.path.length);
					// A straight line, every tile one on from the last.
					moved.path.forEach((p, k) => expect(p).toEqual(ahead(at, dir, k + 1)));
					at = end;
					ski = moved.ski;
					if (isWater(tile.kind)) break;
				}
			}
		}
		expect(moves).toBeGreaterThan(500);
	});
});
