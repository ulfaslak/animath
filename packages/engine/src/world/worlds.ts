import { gearOf } from '../items/catalog.js';
import { EDITS_BUDGET, WorldEdits, editedTileAt } from './edits.js';
import { spawnPoint } from './spawn.js';
import { isPassable, type Direction, type GridPos } from './types.js';
import { FIRST_WORLD, LAST_WORLD, WORLD_ONE_SEED, isWorldNumber, worldSeed } from './numbers.js';
import { FIRST_LAND, landSeed, type LandId } from '../lands/ids.js';

export { FIRST_WORLD, LAST_WORLD, WORLD_ONE_SEED, isWorldNumber, worldSeed };

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
 *
 * Within one land (`player.land`, Nordland by default): the worlds left
 * behind are that land's, and the world reached is that land's world `to`
 * (`landSeed`). Lands and world numbers are two ways of going: a trip to
 * another number keeps the player in their land, with its party, money and
 * items, and a flight to another land (`lands/fly.ts`) keeps the number.
 */
export function travel(
	from: Whereabouts,
	to: unknown,
	player: { home: number; items: readonly string[]; land?: LandId }
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
	const seed = landSeed(player.land ?? FIRST_LAND, to);
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
 * the rest, the world left most recently first. Each in turn is kept whole
 * when it fits in the room still left, and otherwise loses its chunks
 * farthest from where the player stood there, down to that room (all of
 * them once none is left): those tiles grow back. So a small world after one
 * cut back can still keep all of its tiles. Unchanged (the same array) when
 * everything fits.
 */
export function fitWorlds(
	current: WorldEdits,
	worlds: readonly WorldStay[],
	home: number
): readonly WorldStay[] {
	return fitStays(current, [worlds], home)[0]!;
}

/**
 * `fitWorlds` over several lists of worlds left behind, one budget for all
 * (`EDITS_BUDGET`): the lands' (`lands/fly.ts`), the land the player is in
 * first. The current world's tiles are kept whole; then each list in turn,
 * its home world first, then the rest in order, cut back as `fitWorlds` cuts
 * them. Each list comes back the same array when nothing in it changed.
 */
export function fitStays(
	current: WorldEdits,
	groups: readonly (readonly WorldStay[])[],
	home: number
): (readonly WorldStay[])[] {
	let room = EDITS_BUDGET - editsLength(current.encode());
	const lengths = groups.map((worlds) => worlds.map((stay) => editsLength(stay.edits)));
	const total = lengths.flat().reduce((sum, n) => sum + n, 0);
	if (total <= room) return [...groups];
	return groups.map((worlds, g) => {
		const order = worlds
			.map((stay, index) => index)
			.sort(
				(a, b) => Number(worlds[b]!.world === home) - Number(worlds[a]!.world === home) || a - b
			);
		let fitted: WorldStay[] | null = null;
		for (const index of order) {
			const stay = worlds[index]!;
			const length = lengths[g]![index]!;
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
			fitted ??= [...worlds];
			fitted[index] = { ...stay, edits: [...trimmed.encode()] };
		}
		return fitted ?? worlds;
	});
}

/** The characters a world's cleared tiles take in a save: none when nothing is cleared there. */
function editsLength(edits: readonly string[]): number {
	return edits.length === 0 ? 0 : JSON.stringify(edits).length;
}
