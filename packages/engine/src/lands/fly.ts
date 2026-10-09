import type { AnimalInstance } from '../animals/types.js';
import { WorldEdits } from '../world/edits.js';
import { spawnPoint } from '../world/spawn.js';
import { tentArrival } from '../world/tent-map.js';
import type { Direction, GridPos } from '../world/types.js';
import { fitStays, remember, type WorldStay } from '../world/worlds.js';
import { isLandId, landSeed, type LandId } from './ids.js';
import { needsStarter } from './lands.js';

/**
 * Flying to another land ([[PRODUCT]] §4 "Lands", #191): what goes with the
 * player and what stays. A land keeps its own party, money and items, and its
 * own worlds as the player left them; the name, the animal book, the puzzles
 * solved, the step and visit counts and the home world are the player's in
 * every land. A flight keeps the world number: from Nordland 42 to Arktis 42.
 */

/**
 * A land the player has been to and left, as they left it: its party, its
 * money (`tokens`: the land's own currency, `LandSpec.currency`), its items,
 * and its worlds, each where they stood, the way they faced and what they
 * cleared there (the world they flew out of among them). A flight back picks
 * it up: its party and things exactly so, and the world's clearings, but not
 * the spot, since a flight comes down at a tent (`tentArrival`).
 */
export interface LandStay {
	land: LandId;
	party: AnimalInstance[];
	tokens: number;
	items: string[];
	worlds: WorldStay[];
}

/**
 * Everything of a game that belongs to the land the player is in, with the
 * lands they left: what a flight swaps.
 */
export interface LandPlace {
	land: LandId;
	world: number;
	pos: GridPos;
	facing: Direction;
	edits: WorldEdits;
	/** This land's worlds left behind, the one left most recently first; never `world`. */
	worlds: readonly WorldStay[];
	party: readonly AnimalInstance[];
	tokens: number;
	items: readonly string[];
	/** The lands left behind, the one left most recently first; never `land`. */
	lands: readonly LandStay[];
}

/** Why `fly` went nowhere, as a code. */
export type FlyRejection = 'no-such-land' | 'already-here';

export type FlyStep =
	| {
			ok: true;
			place: LandPlace;
			/** The player had never been to the land reached: they arrive with nothing of it, and pick a starter there (`needsStarter`). */
			firstVisit: boolean;
	  }
	| { ok: false; reason: FlyRejection };

/**
 * Fly from the witch doctor's tent at `tent` (the one the player faces) to
 * land `to`, in the same world number. The land left is remembered as the
 * player leaves it: its party, money and items, and the world they stood in
 * among its worlds (`remember`: most recently left first, at most
 * `MAX_WORLDS_KEPT`, home kept). The land reached comes back as it was left,
 * or with nothing on a first visit: no animal, no money, no item, nothing
 * cleared. They come down at the tent the mapping gives (`tentArrival`, in
 * that world as they left it), beside it and facing it; with no tent in
 * reach there, at the world's spawn, facing down. An arrival that asks for a
 * starter (`needsStarter`: no animal of the land kept, a first visit or one
 * left before a starter was picked) comes down at the world's spawn tent
 * instead, the tent the mapping gives from the spawn, so a brand-new starter
 * meets the gentle animals near it (the human's call, [[DECISIONS]] §
 * Lands). Every world's cleared tiles, in every land, stay within the one
 * budget (`fitStays`): the world reached keeps its own whole.
 *
 * Whether the flight may go at all (unlocked, built, at a witch doctor's) is
 * the witch doctor's reducer's to ask (`flyRefusal`): this is what a flight
 * does.
 */
export function fly(from: LandPlace, tent: GridPos, to: unknown, home: number): FlyStep {
	if (!isLandId(to)) return { ok: false, reason: 'no-such-land' };
	if (to === from.land) return { ok: false, reason: 'already-here' };
	const left: WorldStay = {
		world: from.world,
		pos: { x: from.pos.x, y: from.pos.y },
		facing: from.facing,
		edits: [...from.edits.encode()]
	};
	const leaving: LandStay = {
		land: from.land,
		party: from.party.map((a) => ({ ...a })),
		tokens: from.tokens,
		items: [...from.items],
		worlds: remember(from.worlds, left, home)
	};
	const kept = from.lands.find((stay) => stay.land === to);
	const reached = kept?.worlds.find((stay) => stay.world === from.world);
	const edits = reached ? WorldEdits.decode(reached.edits) : WorldEdits.none;
	const worlds = (kept?.worlds ?? []).filter((stay) => stay.world !== from.world);
	const others = [leaving, ...from.lands.filter((stay) => stay.land !== to)];
	const [fitted, ...fittedLands] = fitStays(
		edits,
		[worlds, ...others.map((stay) => stay.worlds)],
		home
	);
	const party = kept ? kept.party.map((a) => ({ ...a })) : [];
	const seed = landSeed(to, from.world);
	const spawn = spawnPoint(seed);
	// A first arrival, the one a starter is picked on (no animal of the land yet), comes down at the
	// world's spawn tent, where the land's gentlest animals live ([[DECISIONS]] § Lands); every other
	// flight at the tent the mapping gives from the one flown from.
	const arrival = tentArrival(seed, needsStarter(to, party) ? spawn : tent, edits);
	return {
		ok: true,
		place: {
			land: to,
			world: from.world,
			pos: arrival ? arrival.stand : spawn,
			facing: arrival ? arrival.facing : 'down',
			edits,
			worlds: fitted!,
			party,
			tokens: kept?.tokens ?? 0,
			items: kept ? [...kept.items] : [],
			lands: others.map((stay, i) => ({ ...stay, worlds: [...fittedLands[i]!] }))
		},
		firstVisit: kept === undefined
	};
}
