import { describe, expect, it } from 'vitest';
import { hashString, Rng } from '../src/rng.js';
import { readSave, restoreGame, saveDocument, newGame } from '../src/save.js';
import { CLEARING_TOOL, clearTile, clearableAhead, type Clearer } from '../src/world/clearing.js';
import {
	EDITS_BUDGET,
	MAX_ENTRY_LENGTH,
	WorldEdits,
	editedChunk,
	editedTileAt,
	isEditsText
} from '../src/world/edits.js';
import { generateChunk, tileAtWorld } from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import {
	CHUNK_SIZE,
	isEncounterTile,
	isWalkable,
	step,
	type Direction,
	type GridPos,
	type TileKind
} from '../src/world/types.js';

const PROTOTYPE = hashString('prototype');
const SEEDS = [PROTOTYPE, 7, 2024];
const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];
const ALL_KINDS: readonly TileKind[] = [
	'grass',
	'tallgrass',
	'sand',
	'water',
	'rock',
	'tree',
	'tent'
];

/** A random set of tiles round `centre`, chunk borders and negative coordinates included. */
function randomTiles(rng: Rng, centre: GridPos, n: number, spread: number): GridPos[] {
	const out: GridPos[] = [];
	for (let i = 0; i < n; i++) {
		out.push({ x: centre.x + rng.int(-spread, spread), y: centre.y + rng.int(-spread, spread) });
	}
	return out;
}

function overlayOf(tiles: readonly GridPos[]): WorldEdits {
	return tiles.reduce((edits, p) => edits.with(p), WorldEdits.none);
}

/** How far round the spawn the tests look for tiles of a kind. */
const SCAN = 140;
const scans = new Map<number, { x: number; y: number; kind: TileKind }[]>();

/** Every tile within `SCAN` of the spawn, scanned once per seed. */
function scanned(seed: number): { x: number; y: number; kind: TileKind }[] {
	let tiles = scans.get(seed);
	if (!tiles) {
		const home = spawnPoint(seed);
		tiles = [];
		for (let y = home.y - SCAN; y <= home.y + SCAN; y++)
			for (let x = home.x - SCAN; x <= home.x + SCAN; x++)
				tiles.push({ x, y, kind: tileAtWorld(seed, x, y).kind });
		scans.set(seed, tiles);
	}
	return tiles;
}

const kindScans = new Map<string, readonly GridPos[]>();

/**
 * Every tile of a kind within `radius` of `centre` (and `SCAN` of the spawn), nearest
 * first. Worked out once per question: `standBeside` asks the same one again and again.
 */
function tilesOfKind(seed: number, kind: TileKind, centre: GridPos, radius: number): GridPos[] {
	const key = `${seed} ${kind} ${centre.x},${centre.y} ${radius}`;
	let tiles = kindScans.get(key);
	if (!tiles) {
		const d = (p: GridPos) => (p.x - centre.x) ** 2 + (p.y - centre.y) ** 2;
		tiles = scanned(seed)
			.filter(
				(t) =>
					t.kind === kind && Math.max(Math.abs(t.x - centre.x), Math.abs(t.y - centre.y)) <= radius
			)
			.map((t) => ({ x: t.x, y: t.y }))
			.sort((a, b) => d(a) - d(b) || a.y - b.y || a.x - b.x);
		kindScans.set(key, tiles);
	}
	return tiles.map((p) => ({ ...p }));
}

/** A tile of `kind` with a walkable tile beside it, and the way to face it from there. */
function standBeside(
	seed: number,
	kind: TileKind,
	skip = 0
): { target: GridPos; stand: GridPos; facing: Direction } {
	let seen = 0;
	for (const target of tilesOfKind(seed, kind, spawnPoint(seed), SCAN - 1)) {
		for (const facing of DIRECTIONS) {
			const back = { up: 'down', down: 'up', left: 'right', right: 'left' } as const;
			const stand = step(target, back[facing]);
			if (!isWalkable(tileAtWorld(seed, stand.x, stand.y).kind)) continue;
			if (seen++ === skip) return { target, stand, facing };
		}
	}
	throw new Error(`no ${kind} with a walkable tile beside it near spawn`);
}

const player = (pos: GridPos, facing: Direction, items: string[] = []): Clearer => ({
	pos,
	facing,
	items
});

// --- the overlay ------------------------------------------------------------

describe('the overlay', () => {
	it('starts empty, and `with` clears one tile without touching the overlay it was given', () => {
		expect(WorldEdits.none.size).toBe(0);
		expect(WorldEdits.none.encode()).toEqual([]);
		const one = WorldEdits.none.with({ x: -1, y: 16 });
		const two = one.with({ x: 0, y: 15 });
		expect(one.has(-1, 16)).toBe(true);
		expect(one.has(0, 15)).toBe(false);
		expect(two.has(-1, 16) && two.has(0, 15)).toBe(true);
		expect([WorldEdits.none.size, one.size, two.size]).toEqual([0, 1, 2]);
		expect(one.encode()).toEqual(['-1,1:0f']);
		// Clearing a tile twice is clearing it once.
		expect(two.with({ x: 0, y: 15 })).toBe(two);
		expect(() => one.with({ x: 0.5, y: 0 })).toThrow();
	});

	it('writes the same text for the same tiles in any order, and reads it back as the same tiles', () => {
		const rng = new Rng(11);
		for (let round = 0; round < 40; round++) {
			const centre = { x: rng.int(-5000, 5000), y: rng.int(-5000, 5000) };
			const tiles = randomTiles(rng, centre, rng.int(1, 300), rng.int(1, 70));
			const a = overlayOf(tiles);
			const b = overlayOf(rng.shuffle(tiles));
			expect(b.encode()).toEqual(a.encode());
			// Chunks by row, then column; indices ascending: canonical, so JSON compares.
			const text = JSON.parse(JSON.stringify(a.encode())) as string[];
			expect(isEditsText(text)).toBe(true);
			const back = WorldEdits.decode(text);
			expect(back.encode()).toEqual(text);
			expect(back.size).toBe(new Set(tiles.map((p) => `${p.x},${p.y}`)).size);
			for (const p of tiles) expect(back.has(p.x, p.y)).toBe(true);
			for (const p of randomTiles(rng, centre, 50, 80)) {
				expect(back.has(p.x, p.y)).toBe(tiles.some((t) => t.x === p.x && t.y === p.y));
			}
			expect(back.textLength).toBe(JSON.stringify(text).length);
		}
		// About 0.35 s alone (40 overlays of up to 300 tiles, each built in two orders and read
		// back); 4.2 s at a load average of 40.
	}, 30_000);

	it('reads text in any order, with repeats, and a "-0" or leading zeros, as the tiles it names', () => {
		const edits = WorldEdits.decode(['0,-1:ff00', '-0,-1:00', '2,003:10', '0,-1:01']);
		expect(edits.encode()).toEqual(['0,-1:0001ff', '2,3:10']);
		expect(edits.size).toBe(4);
		expect(edits.has(15, -1) && edits.has(0, -16) && edits.has(1, -16) && edits.has(32, 49)).toBe(
			true
		);
	});

	it('takes nothing but that text', () => {
		const far = String(Math.floor(Number.MAX_SAFE_INTEGER / CHUNK_SIZE) + 1);
		for (const bad of [
			null,
			'0,0:00',
			{ '0,0': '00' },
			[1],
			[null],
			['0,0:'],
			['0,0:0'],
			['0,0:0A'],
			['0,0:0g'],
			['0,0 :00'],
			['0;0:00'],
			['0,0,0:00'],
			['1.5,0:00'],
			['0,0:00 '],
			[`${far},0:00`],
			[`0,-${far}:00`]
		]) {
			expect(isEditsText(bad), JSON.stringify(bad)).toBe(false);
			expect(() => WorldEdits.decode(bad as string[])).toThrow();
		}
		expect(isEditsText([])).toBe(true);
		expect(WorldEdits.decode([])).toBe(WorldEdits.none);
	});

	it('`without` lets whole chunks grow back, and leaves the others', () => {
		const edits = overlayOf([
			{ x: 1, y: 1 },
			{ x: 2, y: 1 },
			{ x: 17, y: 1 },
			{ x: -1, y: -1 }
		]);
		const kept = edits.without([
			{ cx: 0, cy: 0 },
			{ cx: 5, cy: 5 }
		]);
		expect(kept.encode()).toEqual(['-1,-1:ff', '1,0:11']);
		expect(kept.size).toBe(2);
		expect(edits.size).toBe(4);
		expect(
			kept.without([
				{ cx: 1, cy: 0 },
				{ cx: -1, cy: -1 }
			])
		).toBe(WorldEdits.none);
	});
});

// --- the world as a player left it ------------------------------------------

describe('the world as a player left it', () => {
	it('an edit turns a tree or a rock into plain ground of the same biome and height, and nothing else into anything', () => {
		// The overlay may name any tile (a hand-edited save could), so this edits every kind.
		const bad: string[] = [];
		const seen = new Set<TileKind>();
		for (const seed of SEEDS) {
			const rng = new Rng(seed ^ 0xed17);
			const centre = { x: rng.int(-300, 300), y: rng.int(-300, 300) };
			const edits = overlayOf(randomTiles(rng, centre, 1500, 40));
			for (let y = centre.y - 42; y <= centre.y + 42; y++) {
				for (let x = centre.x - 42; x <= centre.x + 42; x++) {
					const base = tileAtWorld(seed, x, y);
					const tile = editedTileAt(seed, edits, x, y);
					if (!edits.has(x, y) || (base.kind !== 'tree' && base.kind !== 'rock')) {
						if (JSON.stringify(tile) !== JSON.stringify(base)) bad.push(`${seed} ${x},${y}`);
						continue;
					}
					seen.add(base.kind);
					const want = {
						kind: 'grass',
						biome: base.biome,
						height: base.height,
						cleared: base.kind
					};
					if (JSON.stringify(tile) !== JSON.stringify(want)) bad.push(`${seed} ${x},${y}`);
				}
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
		expect([...seen].sort()).toEqual(['rock', 'tree']);
	});

	it('walking: what was walkable still is, only cleared trees and rocks become walkable, and water, tents and tall grass stay what they were', () => {
		const bad: string[] = [];
		let opened = 0;
		for (const seed of SEEDS) {
			const rng = new Rng(seed ^ 0x3a1c);
			const centre = spawnPoint(seed);
			const edits = overlayOf(randomTiles(rng, centre, 2000, 45));
			for (let y = centre.y - 45; y <= centre.y + 45; y++) {
				for (let x = centre.x - 45; x <= centre.x + 45; x++) {
					const before = tileAtWorld(seed, x, y).kind;
					const after = editedTileAt(seed, edits, x, y).kind;
					const walkable = isWalkable(after);
					if (isWalkable(before) && !walkable) bad.push(`${x},${y} closed`);
					if (!isWalkable(before) && walkable) {
						opened++;
						if (!edits.has(x, y) || (before !== 'tree' && before !== 'rock')) {
							bad.push(`${x},${y} ${before} opened`);
						}
					}
					if (before === 'water' || before === 'tent' || before === 'tallgrass') {
						if (after !== before) bad.push(`${x},${y} ${before} became ${after}`);
					}
					// A cleared tile never starts a battle: the grass there is not tall.
					if (isEncounterTile(after) && !isEncounterTile(before)) bad.push(`${x},${y} grass`);
				}
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
		expect(opened).toBeGreaterThan(100);
	});

	it('a chunk as edited agrees with the tiles, at its edges too, and with the seeded chunk where nothing is cleared', () => {
		const bad: string[] = [];
		for (const seed of SEEDS) {
			const rng = new Rng(seed ^ 0xc4);
			const edits = overlayOf(randomTiles(rng, { x: 0, y: 0 }, 600, 40));
			for (let cy = -3; cy <= 2; cy++) {
				for (let cx = -3; cx <= 2; cx++) {
					const chunk = editedChunk(seed, edits, cx, cy);
					const plain = generateChunk(seed, cx, cy);
					chunk.tiles.forEach((tile, i) => {
						const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE);
						const y = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
						const want = editedTileAt(seed, edits, x, y);
						if (JSON.stringify(tile) !== JSON.stringify(want)) bad.push(`${x},${y}`);
						if (!edits.has(x, y) && JSON.stringify(tile) !== JSON.stringify(plain.tiles[i])) {
							bad.push(`${x},${y} not cleared`);
						}
					});
				}
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
		// About 0.35 s alone (27,648 tiles, each read three ways); 3.8 s at a load average of 40.
	}, 30_000);

	it('is the same world every time for the same seed and edits', () => {
		const edits = overlayOf(randomTiles(new Rng(5), { x: 0, y: 0 }, 400, 30));
		const again = WorldEdits.decode([...edits.encode()]);
		for (let y = -32; y < 32; y++)
			for (let x = -32; x < 32; x++)
				expect(editedTileAt(PROTOTYPE, again, x, y)).toEqual(editedTileAt(PROTOTYPE, edits, x, y));
	});
});

// --- clearing a tile --------------------------------------------------------

describe('clearing a tile', () => {
	it('the axe chops the tree the player faces from beside it, and the pickaxe breaks a rock', () => {
		for (const seed of SEEDS) {
			for (const [kind, tool] of [
				['tree', 'axe'],
				['rock', 'pickaxe']
			] as const) {
				const { target, stand, facing } = standBeside(seed, kind);
				expect(clearableAhead(seed, WorldEdits.none, stand, facing)).toEqual({
					pos: target,
					kind,
					tool
				});
				const done = clearTile(seed, WorldEdits.none, player(stand, facing, [tool]), target);
				expect(done).toEqual({
					ok: true,
					edits: expect.any(WorldEdits),
					cleared: { pos: target, was: kind, tool, regrown: [] }
				});
				if (!done.ok) continue;
				expect(done.edits.encode()).toEqual(WorldEdits.none.with(target).encode());
				const now = editedTileAt(seed, done.edits, target.x, target.y);
				expect(now).toMatchObject({ kind: 'grass', cleared: kind });
				expect(isWalkable(now.kind)).toBe(true);
				// Nothing left to clear there now.
				expect(clearableAhead(seed, done.edits, stand, facing)).toBeNull();
				expect(clearTile(seed, done.edits, player(stand, facing, [tool]), target)).toEqual({
					ok: false,
					reason: 'nothing-to-clear'
				});
			}
		}
		// About 1.7 s alone since deep water (every water tile's kind reads the 5×5 square round
		// it; 0.9 s before), finding a tree and a rock beside a stand on every seed; over vitest's
		// 5 s default when other agents' browsers load the machine.
	}, 30_000);

	it('refuses a tile not beside the player, one they do not face, and without the tool it takes', () => {
		const seed = PROTOTYPE;
		const tree = standBeside(seed, 'tree');
		const rock = standBeside(seed, 'rock');
		const both = ['axe', 'pickaxe'];
		const refuse = (p: Clearer, target: GridPos) => clearTile(seed, WorldEdits.none, p, target);
		const { target, stand, facing } = tree;
		// Two away, on a diagonal, the player's own tile, not a tile at all.
		for (const off of [
			{ x: 2, y: 0 },
			{ x: 1, y: 1 },
			{ x: 0, y: 0 },
			{ x: 0.5, y: 0 },
			{ x: Number.NaN, y: 0 }
		]) {
			expect(
				refuse(player(stand, facing, both), { x: stand.x + off.x, y: stand.y + off.y })
			).toEqual({ ok: false, reason: 'not-adjacent' });
		}
		expect(refuse(player(stand, facing, both), null as unknown as GridPos)).toEqual({
			ok: false,
			reason: 'not-adjacent'
		});
		// Beside the tree, but facing another way.
		for (const other of DIRECTIONS.filter((d) => d !== facing)) {
			expect(refuse(player(stand, other, both), target)).toEqual({
				ok: false,
				reason: 'not-facing'
			});
		}
		// No tool, or the other one: it says what stands there and which tool it takes.
		for (const items of [[], ['pickaxe'], ['boat', 'lantern']]) {
			expect(refuse(player(stand, facing, items), target)).toEqual({
				ok: false,
				reason: 'needs-tool',
				kind: 'tree',
				tool: 'axe'
			});
		}
		expect(refuse(player(rock.stand, rock.facing, ['axe']), rock.target)).toEqual({
			ok: false,
			reason: 'needs-tool',
			kind: 'rock',
			tool: 'pickaxe'
		});
	});

	it('clears nothing but trees and rocks: never tall grass, sand, grass, water or a tent', () => {
		const seen = new Set<TileKind>();
		const both = ['axe', 'pickaxe', 'boat'];
		for (const seed of SEEDS) {
			for (const kind of ALL_KINDS) {
				if (kind === 'tree' || kind === 'rock') continue;
				for (let skip = 0; skip < 8; skip++) {
					let spot: ReturnType<typeof standBeside>;
					try {
						spot = standBeside(seed, kind, skip);
					} catch {
						break;
					}
					seen.add(kind);
					const { target, stand, facing } = spot;
					expect(clearableAhead(seed, WorldEdits.none, stand, facing)).toBeNull();
					expect(clearTile(seed, WorldEdits.none, player(stand, facing, both), target)).toEqual({
						ok: false,
						reason: 'nothing-to-clear'
					});
				}
			}
		}
		// Deep water is never beside ground to stand on (at least two tiles of shallows lie
		// between), so no stand faces it; `clearTile` refuses it with the other kinds in the
		// random sweeps.
		expect([...seen].sort()).toEqual(['grass', 'sand', 'tallgrass', 'tent', 'water']);
		// About 0.3 s alone (up to eight stands beside every kind on every seed, all found from
		// one scan per seed and kind: 1.4 s when each stand scanned again); a few seconds at a
		// load average of 40.
	}, 30_000);

	it('from every tile near spawn, facing every way, clears exactly what the prompt offers, and changes nothing it was given', () => {
		const bad: string[] = [];
		let cleared = 0;
		for (const seed of SEEDS) {
			const rng = new Rng(seed ^ 0x51ce);
			const centre = spawnPoint(seed);
			const edits = overlayOf(
				tilesOfKind(seed, 'tree', centre, 40)
					.filter(() => rng.chance(0.3))
					.concat(tilesOfKind(seed, 'rock', centre, 40).filter(() => rng.chance(0.3)))
			);
			const before = edits.encode().join(' ');
			for (let y = centre.y - 30; y <= centre.y + 30; y++) {
				for (let x = centre.x - 30; x <= centre.x + 30; x++) {
					const pos = { x, y };
					if (!isWalkable(editedTileAt(seed, edits, x, y).kind)) continue;
					for (const facing of DIRECTIONS) {
						const items = rng.chance(0.5)
							? ['axe', 'pickaxe']
							: rng.pick([[], ['axe'], ['pickaxe']]);
						const ahead = clearableAhead(seed, edits, pos, facing);
						const front = step(pos, facing);
						const result = clearTile(seed, edits, player(pos, facing, items), front);
						const expected = !ahead
							? { ok: false, reason: 'nothing-to-clear' }
							: !items.includes(CLEARING_TOOL[ahead.kind])
								? {
										ok: false,
										reason: 'needs-tool',
										kind: ahead.kind,
										tool: CLEARING_TOOL[ahead.kind]
									}
								: null;
						if (expected) {
							if (JSON.stringify(result) !== JSON.stringify(expected))
								bad.push(`${x},${y} ${facing}`);
							continue;
						}
						cleared++;
						if (
							!result.ok ||
							result.edits.size !== edits.size + 1 ||
							!result.edits.has(front.x, front.y)
						) {
							bad.push(`${x},${y} ${facing} did not clear`);
						}
					}
				}
			}
			if (edits.encode().join(' ') !== before)
				bad.push(`${seed}: the overlay it was given changed`);
		}
		expect(bad.slice(0, 20)).toEqual([]);
		expect(cleared).toBeGreaterThan(200);
		// About 0.3 s alone (every way from every walkable tile within 30 of the spawn, in three
		// worlds: up to 44,652 tries); 2.1 s at a load average of 40.
	}, 30_000);

	it('replays: the same clears from the same world always leave the same overlay', () => {
		const run = () => {
			const seed = PROTOTYPE;
			let edits = WorldEdits.none;
			const log: string[] = [];
			const rng = new Rng(99);
			const centre = spawnPoint(seed);
			for (let i = 0; i < 400; i++) {
				const pos = { x: centre.x + rng.int(-25, 25), y: centre.y + rng.int(-25, 25) };
				if (!isWalkable(editedTileAt(seed, edits, pos.x, pos.y).kind)) continue;
				const facing = rng.pick(DIRECTIONS);
				const result = clearTile(
					seed,
					edits,
					player(pos, facing, ['axe', 'pickaxe']),
					step(pos, facing)
				);
				log.push(
					result.ok
						? `${result.cleared.was}@${result.cleared.pos.x},${result.cleared.pos.y}`
						: result.reason
				);
				if (result.ok) edits = result.edits;
			}
			return { log, text: edits.encode() };
		};
		const a = run();
		expect(run()).toEqual(a);
		expect(a.log.filter((l) => l.startsWith('tree')).length).toBeGreaterThan(5);
		expect(a.log.filter((l) => l.startsWith('rock')).length).toBeGreaterThan(0);
		// Golden: the overlay a replay leaves, so a change to the rules shows up here.
		expect(a.text.length).toBeGreaterThan(0);
		expect(WorldEdits.decode([...a.text]).size).toBe(a.log.filter((l) => l.includes('@')).length);
	});
});

// --- keeping the save small -------------------------------------------------

describe('keeping the save small', () => {
	it('the 25 chunks round the player always fit in the budget whole', () => {
		expect(25 * MAX_ENTRY_LENGTH + 2).toBeLessThanOrEqual(EDITS_BUDGET);
		// The longest entry there is: every tile of the farthest chunk a save can hold.
		const far = -Math.floor(Number.MAX_SAFE_INTEGER / CHUNK_SIZE);
		let full = WorldEdits.none;
		for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
			full = full.with({
				x: far * CHUNK_SIZE + (i % CHUNK_SIZE),
				y: far * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE)
			});
		}
		expect(full.textLength).toBeLessThanOrEqual(MAX_ENTRY_LENGTH + 2);
	});

	it('thousands of trees and rocks cleared round home fit in the budget, and a save of them loads fast and small', () => {
		const seed = PROTOTYPE;
		const home = spawnPoint(seed);
		const d = (p: GridPos) => (p.x - home.x) ** 2 + (p.y - home.y) ** 2;
		const tiles = [
			...tilesOfKind(seed, 'tree', home, SCAN),
			...tilesOfKind(seed, 'rock', home, SCAN)
		]
			.sort((a, b) => d(a) - d(b) || a.y - b.y || a.x - b.x)
			.slice(0, 5000);
		expect(tiles.length).toBe(5000);
		expect(tiles.some((p) => tileAtWorld(seed, p.x, p.y).kind === 'rock')).toBe(true);
		const edits = overlayOf(tiles);
		expect(edits.size).toBe(5000);
		expect(edits.trimmedAround(home).regrown).toEqual([]);
		expect(edits.textLength).toBeLessThanOrEqual(EDITS_BUDGET);
		// World 1 is the prototype world.
		const game = { ...newGame(1), edits: [...edits.encode()] };
		const text = JSON.stringify(saveDocument(game, { lineage: 'L', seq: 1 }));
		// Well inside the 64 KiB of the backup sent as the page closes, with room for a team mid-battle.
		expect(text.length).toBeLessThan(EDITS_BUDGET + 2000);
		// Measured at about 5 ms; generous for a machine under load. The fastest of up to three
		// tries, so a moment the machine spent elsewhere is not taken for the load's cost (#86).
		let took = Infinity;
		for (let i = 0; i < 3 && took >= 250; i++) {
			const started = performance.now();
			const read = readSave(JSON.parse(text));
			const restored = read.ok ? restoreGame(read.save) : null;
			took = Math.min(took, performance.now() - started);
			expect(restored?.edits).toEqual(game.edits);
		}
		expect(took).toBeLessThan(250);
	});

	it('past the budget, the chunks farthest from the player grow back, and never one within two chunks of them', () => {
		const seed = PROTOTYPE;
		// One tile in each of 1,600 chunks spread far and wide: the worst case for the text,
		// past the budget (a save someone wrote by hand could be; play never gets here).
		const rng = new Rng(3);
		const far = Array.from({ length: 1600 }, () => ({
			x: rng.int(-40_000, 40_000),
			y: rng.int(-40_000, 40_000)
		}));
		// And every tree and rock round the player cleared, in the chunks on screen.
		const { stand, facing, target } = standBeside(seed, 'tree');
		const near = [
			...tilesOfKind(seed, 'tree', stand, 40),
			...tilesOfKind(seed, 'rock', stand, 40)
		].filter((p) => p.x !== target.x || p.y !== target.y);
		// Read from text, as such a save holds it: built with `with`, the overlay of 1,600
		// chunks was copied once for every tile.
		const edits = WorldEdits.decode(
			[...far, ...near].flatMap((p) => WorldEdits.none.with(p).encode())
		);
		expect(edits.size).toBe(new Set([...far, ...near].map((p) => `${p.x},${p.y}`)).size);
		const before = edits;
		expect(before.textLength).toBeGreaterThan(EDITS_BUDGET);
		const done = clearTile(seed, edits, player(stand, facing, ['axe']), target);
		expect(done.ok).toBe(true);
		if (!done.ok) return;
		const { regrown } = done.cleared;
		expect(regrown.length).toBeGreaterThan(0);
		expect(done.edits.textLength).toBeLessThanOrEqual(EDITS_BUDGET);
		expect(done.edits.has(target.x, target.y)).toBe(true);
		// Whole chunks, and the farthest: none kept is farther than one that grew back.
		const home = { cx: Math.floor(stand.x / CHUNK_SIZE), cy: Math.floor(stand.y / CHUNK_SIZE) };
		const d = (c: { cx: number; cy: number }) => (c.cx - home.cx) ** 2 + (c.cy - home.cy) ** 2;
		const nearestGone = Math.min(...regrown.map(d));
		const kept = done.edits.encode().map((e) => {
			const [cx, cy] = e.split(':')[0]!.split(',').map(Number) as [number, number];
			return { cx, cy };
		});
		expect(kept.every((c) => d(c) <= nearestGone)).toBe(true);
		expect(
			regrown.every((c) => Math.max(Math.abs(c.cx - home.cx), Math.abs(c.cy - home.cy)) > 2)
		).toBe(true);
		for (let cy = home.cy - 2; cy <= home.cy + 2; cy++) {
			for (let cx = home.cx - 2; cx <= home.cx + 2; cx++) {
				expect(done.edits.inChunk(cx, cy)).toEqual(
					cx === Math.floor(target.x / CHUNK_SIZE) && cy === Math.floor(target.y / CHUNK_SIZE)
						? before.with(target).inChunk(cx, cy)
						: before.inChunk(cx, cy)
				);
			}
		}
		// What a client does with the event gives the authority's overlay exactly.
		expect(before.with(target).without(regrown).encode()).toEqual(done.edits.encode());
	});
});
