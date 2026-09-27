import { TENT_LATTICE, onTentLattice, tileAtWorld, travelKindAt } from './generate.js';
import { nearestTent } from './tents.js';
import { isWalkable, step, type Direction, type GridPos } from './types.js';

/**
 * Where a world begins ([[PRODUCT]] §4 "World"): the spawn, where a new game
 * starts and a first visit to a world arrives. Every world is playable from
 * it: it is ground, the player is not boxed in there, and a doctor is a
 * short walk away on foot, without a tool or the boat.
 *
 * The spawn is the grass tile nearest the origin that is all of that, nearest
 * by square rings round (0, 0), then row by row within a ring. In World 1 that
 * is (−2, 6), the nearest grass tile of all, where every game began before
 * worlds had numbers; a world whose nearest grass tile is boxed in or far
 * from a doctor starts a little further out, beside one.
 */

/** A doctor's tent is at most this many steps from the spawn, on foot. */
export const SPAWN_DOCTOR_STEPS = 12;
/** At least this many tiles can be reached on foot from the spawn: the player is not boxed in. */
export const SPAWN_ROOM = 1000;

/** How far out from the origin a spawn is looked for: tents this far out, in square rings. */
const SEARCH_RADIUS = 256;
/** Spawns worked out lately, by seed. A cache, not state: a spawn is a pure function of the seed. */
const CACHE_LIMIT = 64;
const cache = new Map<number, GridPos>();
/** The tiles of the tents' lattice within `SEARCH_RADIUS`, nearest the origin first, once worked out. */
let lattice: GridPos[] | null = null;

const DIRECTIONS: readonly Direction[] = ['up', 'right', 'left', 'down'];

/**
 * The spawn of the world of `seed`: the grass tile nearest the origin from
 * which a doctor's tent is at most `SPAWN_DOCTOR_STEPS` steps away on foot
 * and at least `SPAWN_ROOM` tiles can be reached on foot. Deterministic per
 * seed. Should no tile within `SEARCH_RADIUS` be all of that (no world tested
 * reaches this), the nearest grass tile, and past that (0, 0) unchecked.
 */
export function spawnPoint(seed: number): GridPos {
	const known = cache.get(seed);
	if (known) return { x: known.x, y: known.y };
	const spawn = findSpawn(seed);
	if (cache.size >= CACHE_LIMIT) cache.clear();
	cache.set(seed, spawn);
	return { x: spawn.x, y: spawn.y };
}

function findSpawn(seed: number): GridPos {
	const nearest = nearestGrass(seed);
	// The nearest grass tile of all, when it will do: World 1's (−2, 6).
	if (nearest && suits(seed, nearest)) return nearest;
	// Otherwise the grass tiles a few steps from each tent, nearest tents first, until no
	// tent further out could have one nearer the origin than the best found.
	const candidates = new Map<string, GridPos>();
	const room = new Map<string, boolean>();
	let best: GridPos | null = null;
	for (const tent of latticeByRing()) {
		if (best && ring(best) < ring(tent) - SPAWN_DOCTOR_STEPS - 1) break;
		if (tileAtWorld(seed, tent.x, tent.y).kind !== 'tent') continue;
		for (const pos of grassNear(seed, tent)) candidates.set(`${pos.x},${pos.y}`, pos);
		best = null;
		for (const pos of [...candidates.values()].sort(ringOrder)) {
			const key = `${pos.x},${pos.y}`;
			let roomy = room.get(key);
			if (roomy === undefined) room.set(key, (roomy = hasRoom(seed, pos)));
			if (roomy) {
				best = pos;
				break;
			}
		}
	}
	return best ?? nearest ?? { x: 0, y: 0 };
}

/** The first grass tile in square rings round the origin, within 64 tiles: the spawn rule before numbered worlds. */
function nearestGrass(seed: number): GridPos | null {
	for (let r = 0; r < 64; r++) {
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
				if (tileAtWorld(seed, dx, dy).kind === 'grass') return { x: dx, y: dy };
			}
		}
	}
	return null;
}

/** Whether `pos` is a spawn: a doctor near enough on foot, and room enough round it. */
function suits(seed: number, pos: GridPos): boolean {
	return nearestTent(seed, pos, SPAWN_DOCTOR_STEPS) !== null && hasRoom(seed, pos);
}

/**
 * The grass tiles from which the tent at `tent` is at most
 * `SPAWN_DOCTOR_STEPS` steps away on foot: a walk out from the walkable
 * tiles beside it, the way `nearestTent` walks in.
 */
function grassNear(seed: number, tent: GridPos): GridPos[] {
	const seen = new Set<string>();
	let edge: GridPos[] = [];
	for (const dir of DIRECTIONS) {
		const stand = step(tent, dir);
		if (!isWalkable(travelKindAt(seed, stand.x, stand.y))) continue;
		seen.add(`${stand.x},${stand.y}`);
		edge.push(stand);
	}
	const grass: GridPos[] = [];
	for (let steps = 0; edge.length > 0; steps++) {
		for (const pos of edge) if (tileAtWorld(seed, pos.x, pos.y).kind === 'grass') grass.push(pos);
		if (steps === SPAWN_DOCTOR_STEPS) break;
		const next: GridPos[] = [];
		for (const pos of edge) {
			for (const dir of DIRECTIONS) {
				const n = step(pos, dir);
				const key = `${n.x},${n.y}`;
				if (seen.has(key)) continue;
				seen.add(key);
				if (isWalkable(travelKindAt(seed, n.x, n.y))) next.push(n);
			}
		}
		edge = next;
	}
	return grass;
}

/** Whether at least `SPAWN_ROOM` tiles, `pos` among them, can be reached from `pos` on foot. */
function hasRoom(seed: number, pos: GridPos): boolean {
	const seen = new Set<string>([`${pos.x},${pos.y}`]);
	let edge: GridPos[] = [pos];
	let reached = 1;
	while (edge.length > 0) {
		const next: GridPos[] = [];
		for (const p of edge) {
			for (const dir of DIRECTIONS) {
				const n = step(p, dir);
				const key = `${n.x},${n.y}`;
				if (seen.has(key)) continue;
				seen.add(key);
				if (!isWalkable(travelKindAt(seed, n.x, n.y))) continue;
				if (++reached >= SPAWN_ROOM) return true;
				next.push(n);
			}
		}
		edge = next;
	}
	return false;
}

/** The square ring round the origin a tile is on. */
function ring(pos: GridPos): number {
	return Math.max(Math.abs(pos.x), Math.abs(pos.y));
}

/** Nearest the origin first: by ring, then row by row (`y`, then `x`), as `nearestGrass` scans. */
function ringOrder(a: GridPos, b: GridPos): number {
	return ring(a) - ring(b) || a.y - b.y || a.x - b.x;
}

/** Every tile of the tents' lattice within `SEARCH_RADIUS`, nearest the origin first. */
function latticeByRing(): GridPos[] {
	if (lattice) return lattice;
	const out: GridPos[] = [];
	for (let y = -SEARCH_RADIUS; y <= SEARCH_RADIUS; y++) {
		// Every row of the lattice, then every tile of the row on it.
		if (!onTentLattice(TENT_LATTICE.atX, y)) continue;
		for (let x = -SEARCH_RADIUS; x <= SEARCH_RADIUS; x++) {
			if (onTentLattice(x, y)) out.push({ x, y });
		}
	}
	lattice = out.sort(ringOrder);
	return lattice;
}
