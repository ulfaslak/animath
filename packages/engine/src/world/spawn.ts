import { landOfSeed } from '../lands/ids.js';
import { TENT_LATTICE, onTentLattice, tileAtWorld, travelKindAt } from './generate.js';
import { nearestTent } from './tents.js';
import { isPlainGround, isWalkable, step, type Direction, type GridPos } from './types.js';

/**
 * Where a world begins ([[PRODUCT]] §4 "World"): the spawn, where a new game
 * starts and a first visit to a world arrives. Every world is playable from
 * it: it is ground, the player is not boxed in there, and a doctor is a
 * short walk away on foot, without a tool or the boat.
 *
 * The spawn is the plain ground (grass; The Arctic's snow: `isPlainGround`)
 * nearest the land's origin that is all of that, nearest by square rings
 * round it, then row by row within a ring. Nordland's origin is (0, 0): in
 * World 1 its spawn is (−2, 6), the nearest grass tile of all, where every
 * game began before worlds had numbers; a world whose nearest grass tile is
 * boxed in or far from a doctor starts a little further out, beside one. The
 * Arctic's origin is `ARCTIC_ORIGIN`, on the north shore of the open-sea band
 * (`arctic.ts`) in the clearing of the tent at (5, 7), where the tundra meets
 * the bird cliffs.
 */

/** Where The Arctic's spawn is looked for from: the clearing's edge south of the tent at (5, 7), on the shore. */
export const ARCTIC_ORIGIN: GridPos = { x: 5, y: 9 };

/** Where the spawn of the world of `seed` is looked for from: its land's origin. */
function originOf(seed: number): GridPos {
	return landOfSeed(seed) === 'arctic' ? ARCTIC_ORIGIN : { x: 0, y: 0 };
}

/** A doctor's tent is at most this many steps from the spawn, on foot. */
export const SPAWN_DOCTOR_STEPS = 12;
/** At least this many tiles can be reached on foot from the spawn: the player is not boxed in. */
export const SPAWN_ROOM = 1000;

/** How far out from the origin a spawn is looked for: tents this far out, in square rings. */
const SEARCH_RADIUS = 256;
/** Spawns worked out lately, by seed. A cache, not state: a spawn is a pure function of the seed. */
const CACHE_LIMIT = 64;
const cache = new Map<number, GridPos>();
/** The tiles of the tents' lattice within `SEARCH_RADIUS` of each origin, nearest it first, once worked out. */
const lattices = new Map<string, GridPos[]>();

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
	const o = originOf(seed);
	const nearest = nearestGrass(seed, o);
	// The nearest grass tile of all, when it will do: World 1's (−2, 6).
	if (nearest && suits(seed, nearest)) return nearest;
	// Otherwise the grass tiles a few steps from each tent, nearest tents first, until no
	// tent further out could have one nearer the origin than the best found.
	const candidates = new Map<string, GridPos>();
	const room = new Map<string, boolean>();
	let best: GridPos | null = null;
	const ring = (pos: GridPos) => ringAround(o, pos);
	const order = (a: GridPos, b: GridPos) => ring(a) - ring(b) || a.y - b.y || a.x - b.x;
	for (const tent of latticeByRing(o)) {
		if (best && ring(best) < ring(tent) - SPAWN_DOCTOR_STEPS - 1) break;
		if (tileAtWorld(seed, tent.x, tent.y).kind !== 'tent') continue;
		for (const pos of grassNear(seed, tent)) candidates.set(`${pos.x},${pos.y}`, pos);
		best = null;
		for (const pos of [...candidates.values()].sort(order)) {
			const key = `${pos.x},${pos.y}`;
			let roomy = room.get(key);
			if (roomy === undefined) room.set(key, (roomy = hasRoom(seed, pos)));
			if (roomy) {
				best = pos;
				break;
			}
		}
	}
	return best ?? nearest ?? { x: o.x, y: o.y };
}

/** The first plain ground in square rings round the origin `o`, within 64 tiles: the spawn rule before numbered worlds. */
function nearestGrass(seed: number, o: GridPos): GridPos | null {
	for (let r = 0; r < 64; r++) {
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
				const [x, y] = [o.x + dx, o.y + dy];
				if (isPlainGround(tileAtWorld(seed, x, y).kind)) return { x, y };
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
		for (const pos of edge)
			if (isPlainGround(tileAtWorld(seed, pos.x, pos.y).kind)) grass.push(pos);
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

/** The square ring round the origin `o` a tile is on. */
function ringAround(o: GridPos, pos: GridPos): number {
	return Math.max(Math.abs(pos.x - o.x), Math.abs(pos.y - o.y));
}

/** Every tile of the tents' lattice within `SEARCH_RADIUS` of the origin `o`, nearest it first. */
function latticeByRing(o: GridPos): GridPos[] {
	const key = `${o.x},${o.y}`;
	const known = lattices.get(key);
	if (known) return known;
	const out: GridPos[] = [];
	for (let y = o.y - SEARCH_RADIUS; y <= o.y + SEARCH_RADIUS; y++) {
		// Every row of the lattice, then every tile of the row on it.
		if (!onTentLattice(TENT_LATTICE.atX, y)) continue;
		for (let x = o.x - SEARCH_RADIUS; x <= o.x + SEARCH_RADIUS; x++) {
			if (onTentLattice(x, y)) out.push({ x, y });
		}
	}
	const ring = (pos: GridPos) => ringAround(o, pos);
	out.sort((a, b) => ring(a) - ring(b) || a.y - b.y || a.x - b.x);
	lattices.set(key, out);
	return out;
}
