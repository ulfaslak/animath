import { gearOf } from '../items/catalog.js';
import { hashString } from '../rng.js';
import { EDITS_BUDGET, WorldEdits, editedTileAt } from './edits.js';
import { spawnPoint } from './spawn.js';
import { isPassable, type Direction, type GridPos } from './types.js';

/**
 * Numbered worlds ([[PRODUCT]] §4 "World"): every world is a number from
 * `FIRST_WORLD` to `LAST_WORLD`, and its number is all it takes to make it
 * (`worldSeed`), so two kids who pick the same number play in the same
 * world. World 1 is the world every game was played in before worlds had
 * numbers, tile for tile.
 *
 * A player carries their party, tokens, items and name from world to world;
 * where they stand, the way they face and the tiles they cleared belong to
 * each world (`WorldStay`). `travel` is the rule for going to another world:
 * the world left behind is remembered as the player left it, and the one
 * reached is picked up where they left it, or at its spawn on a first visit.
 */

/** The lowest world number. */
export const FIRST_WORLD = 1;
/** The highest world number: four digits, so a kid can read it out and type it. */
export const LAST_WORLD = 9999;

/**
 * World 1's generator seed: the seed of the one world every game was played
 * in before worlds had numbers (`hashString('prototype')`, 821322741). Every
 * save from then is in World 1.
 */
export const WORLD_ONE_SEED = hashString('prototype');

/** Whether `n` is a world number: a whole number from `FIRST_WORLD` to `LAST_WORLD`. */
export function isWorldNumber(n: unknown): n is number {
	return Number.isSafeInteger(n) && (n as number) >= FIRST_WORLD && (n as number) <= LAST_WORLD;
}

/**
 * The generator seed of world `n`: World 1's seed, counted on by one for each
 * world after it. Neighbouring seeds make unrelated worlds (every seed goes
 * through `hashInts`' avalanche before it shapes a tile), and no two numbers
 * share a seed.
 */
export function worldSeed(n: number): number {
	if (!isWorldNumber(n)) throw new Error(`worldSeed: ${String(n)} is not a world number`);
	return (WORLD_ONE_SEED + n - FIRST_WORLD) >>> 0;
}

/**
 * The world number a kid typed: digits only (leading zeros are fine: "007"
 * is World 7), from `FIRST_WORLD` to `LAST_WORLD`. Null for anything else.
 */
export function parseWorldNumber(text: string): number | null {
	if (!/^[0-9]{1,8}$/.test(text)) return null;
	const n = Number(text);
	return isWorldNumber(n) ? n : null;
}

/**
 * A world the player has been to and left: where they stood, the way they
 * faced, and the tiles they cleared there (`WorldEdits`' text form, empty
 * when none). Going back there picks it up exactly so.
 */
export interface WorldStay {
	world: number;
	pos: GridPos;
	facing: Direction;
	edits: readonly string[];
}

/**
 * How many worlds left behind a game remembers, the home world always among
 * them: past it, the one left longest ago is forgotten, and a later visit
 * there starts at its spawn. Room for every world a kid visits with friends,
 * and a bound on the save however many numbers a kid tries.
 */
export const MAX_WORLDS_KEPT = 100;

/** The part of a game that belongs to the world the player is in, and the worlds they left. */
export interface Whereabouts {
	world: number;
	pos: GridPos;
	facing: Direction;
	edits: WorldEdits;
	/** The worlds left behind, the one left most recently first; never the current world. */
	worlds: readonly WorldStay[];
}

/** Why `travel` went nowhere, as a code the client may word. */
export type TravelRejection =
	/** Not a world number: not a whole number from `FIRST_WORLD` to `LAST_WORLD`. */
	| 'not-a-world'
	/** The player is in that world already. */
	| 'already-there';

export type TravelStep =
	| {
			ok: true;
			whereabouts: Whereabouts;
			/** Whether the player had never been to the world reached (or it was forgotten): they start at its spawn. */
			firstVisit: boolean;
	  }
	| { ok: false; reason: TravelRejection };

/**
 * Go from the world in `from` to world `to`. The world left is remembered as
 * the player leaves it, most recently left first (`remember`), and the world
 * reached is picked up where they left it; a world they have never been to
 * (or that was forgotten) starts at its spawn, facing down, with nothing
 * cleared. Where they stood is theirs again only if they can still stand
 * there with what they own (`items`: the boat keeps them on the water);
 * otherwise, as when a save is loaded, they start at the spawn, facing down,
 * the tiles they cleared still cleared. The tiles cleared in every world
 * together stay within the budget they were in: travelling only moves them.
 */
export function travel(
	from: Whereabouts,
	to: unknown,
	player: { home: number; items: readonly string[] }
): TravelStep {
	if (!isWorldNumber(to)) return { ok: false, reason: 'not-a-world' };
	if (to === from.world) return { ok: false, reason: 'already-there' };
	const kept = from.worlds.find((stay) => stay.world === to);
	const left: WorldStay = {
		world: from.world,
		pos: { x: from.pos.x, y: from.pos.y },
		facing: from.facing,
		edits: [...from.edits.encode()]
	};
	const worlds = remember(
		from.worlds.filter((stay) => stay.world !== to),
		left,
		player.home
	);
	const seed = worldSeed(to);
	const edits = kept ? WorldEdits.decode(kept.edits) : WorldEdits.none;
	const back =
		kept && isPassable(editedTileAt(seed, edits, kept.pos.x, kept.pos.y).kind, gearOf(player))
			? kept
			: null;
	return {
		ok: true,
		whereabouts: {
			world: to,
			pos: back ? { x: back.pos.x, y: back.pos.y } : spawnPoint(seed),
			facing: back ? back.facing : 'down',
			edits,
			worlds
		},
		firstVisit: kept === undefined
	};
}

/**
 * The worlds left behind, with `left` (the world just left) first and no
 * other stay of that world. Past `MAX_WORLDS_KEPT` the ones left longest ago
 * are forgotten, but never the home world.
 */
export function remember(worlds: readonly WorldStay[], left: WorldStay, home: number): WorldStay[] {
	return keepWorlds([left, ...worlds.filter((stay) => stay.world !== left.world)], home);
}

/**
 * At most `MAX_WORLDS_KEPT` worlds, in the order given, the first stay of each
 * world only: past the cap, the last ones go, but never the home world's.
 */
export function keepWorlds(worlds: readonly WorldStay[], home: number): WorldStay[] {
	const seen = new Set<number>();
	const unique = worlds.filter((stay) => !seen.has(stay.world) && seen.add(stay.world));
	if (unique.length <= MAX_WORLDS_KEPT) return unique;
	const homeStay = unique.find((stay) => stay.world === home);
	const others = unique.filter((stay) => stay !== homeStay);
	const room = MAX_WORLDS_KEPT - (homeStay ? 1 : 0);
	const keep = new Set<WorldStay>(others.slice(0, room));
	if (homeStay) keep.add(homeStay);
	return unique.filter((stay) => keep.has(stay));
}

/**
 * The worlds left behind with their cleared tiles cut to what fits beside
 * `current` (the world the player is in) within `EDITS_BUDGET`, all worlds
 * together. The current world's are kept whole; then the home world's, then
 * the rest, the world left most recently first. The first that no longer fits
 * loses its chunks farthest from where the player stood there, and the ones
 * after it lose all of theirs: those tiles grow back. Unchanged (the same
 * array) when everything fits.
 */
export function fitWorlds(
	current: WorldEdits,
	worlds: readonly WorldStay[],
	home: number
): readonly WorldStay[] {
	const lengths = worlds.map((stay) => editsLength(stay.edits));
	let room = EDITS_BUDGET - editsLength(current.encode());
	if (lengths.reduce((sum, n) => sum + n, 0) <= room) return worlds;
	const order = worlds
		.map((stay, index) => index)
		.sort((a, b) => Number(worlds[b]!.world === home) - Number(worlds[a]!.world === home) || a - b);
	const fitted = [...worlds];
	for (const index of order) {
		const stay = worlds[index]!;
		const length = lengths[index]!;
		if (length === 0) continue;
		if (length <= room) {
			room -= length;
			continue;
		}
		const trimmed =
			room > 0
				? WorldEdits.decode(stay.edits).trimmedAround(stay.pos, room).edits
				: WorldEdits.none;
		room -= editsLength(trimmed.encode());
		fitted[index] = { ...stay, edits: [...trimmed.encode()] };
	}
	return fitted;
}

/** The characters a world's cleared tiles take in a save: none when nothing is cleared there. */
function editsLength(edits: readonly string[]): number {
	return edits.length === 0 ? 0 : JSON.stringify(edits).length;
}
