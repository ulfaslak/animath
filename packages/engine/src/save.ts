import type { AnimalInstance, Realm } from './animals/types.js';
import { ATTACK_LEVELS, REALMS } from './animals/types.js';
import { bookOf, recordParty, seeSpecies, type AnimalBook } from './animals/book.js';
import { ANIMALS, canFightIn, getAnimal } from './animals/catalog.js';
import type { BattleState } from './battle/types.js';
import { gearOf } from './items/catalog.js';
import { checkName } from './names.js';
import { bundled, joinParty } from './party/bundles.js';
import { normalizeNickname } from './party/names.js';
import { ALL_PUZZLE_KINDS, MAX_DIFFICULTY, MIN_DIFFICULTY } from './puzzles/types.js';
import { WorldEdits, editedTileAt, isEditsText } from './world/edits.js';
import { spawnPoint } from './world/spawn.js';
import type { Direction, GridPos } from './world/types.js';
import { isPassable, tileRealm } from './world/types.js';
import {
	FIRST_WORLD,
	LAST_WORLD,
	WORLD_ONE_SEED,
	fitWorlds,
	isWorldNumber,
	keepWorlds,
	worldSeed,
	type WorldStay
} from './world/worlds.js';

/**
 * The save: one document per game. The client writes it to the browser's
 * storage (the primary copy) and, for an account, to the server, and both sides
 * check it with this module, so there is one definition of what a save is.
 * Error strings here are for developers and API clients, never for players.
 */

/** The newest save format this build reads and writes. */
export const SAVE_VERSION = 2;

/** The longest animal id, or lineage id, a save may hold. */
export const MAX_SAVE_ID_LENGTH = 64;
/**
 * The longest nickname a save accepts, in UTF-16 units. Renames are cut much
 * shorter (`MAX_NICKNAME_LENGTH`, in code points, `party/names.ts`); this is
 * the storage limit, with room for a name of 4-byte letters twice over.
 */
export const MAX_SAVED_NICKNAME_LENGTH = 40;
/**
 * The longest player name a save accepts, in UTF-16 units: a name is at most
 * `MAX_NAME_LENGTH` code points (`names.ts`), so this holds one of 4-byte
 * letters with room to spare. Whether it is a name is `checkName`'s to say,
 * on load: a stored name it refuses is no name, and the player is asked again.
 */
export const MAX_SAVED_NAME_LENGTH = 40;

/**
 * How deep a save may nest: the document is 1 deep, an object or a list in
 * it 2, and so on, counted as this build reads it (a v1 document after its
 * upgrade, which moves some fields a level down, under `V1_KEPT`). A game's
 * save is 4 deep at most (a saved battle's party or puzzle, a world left
 * behind's position: `save.test.ts` pins it). A document nested deeper is
 * invalid: a body within the server's limit can nest hundreds of thousands
 * deep, and the walks that go down one level at a time (the check here, V8's
 * `JSON.stringify` for some shapes, Postgres' jsonb) run out of stack
 * thousands deep, and would throw where the document is to be refused. The
 * limit is part of the format: a build reads a document deeper than its own
 * limit as broken, never as a newer build's, so a build that saves deeper,
 * or raises the limit, bumps `SAVE_VERSION` too.
 */
export const MAX_SAVE_DEPTH = 64;

/**
 * The starter of a game nobody chose one for: a throwaway game (`?new`), and
 * a saved party that came back empty. A player picks theirs from `STARTERS`
 * ([[PRODUCT]] §4 "Starting out").
 */
export const STARTER_SPECIES = 'squirrel';

/** What a save remembers about the game: everything an authority needs to carry on from it. */
export interface SavedGame {
	/** The player's name (`checkName`'s), or null until they have chosen one. */
	name: string | null;
	/** The world the game began in, a world number: a new game's is picked for it; a game from before numbered worlds began in World 1. */
	home: number;
	/** The world the player is in, a world number: the world is a pure function of `worldSeed(world)`. */
	world: number;
	/** Where the player stands in `world`, in world tile coordinates. */
	pos: GridPos;
	/** Which way the player faces. */
	facing: Direction;
	/**
	 * Completed steps, in every world together. Keys every encounter roll and
	 * battle seed with the world's seed, so a reload carries on the sequence,
	 * and no world ever meets a step's animals twice.
	 */
	steps: number;
	/** Doctor visits opened, in every world together. With `steps`, keys each visit's puzzles, so a reload carries those on too. */
	visits: number;
	/**
	 * The party, in slot order and in species bundles (`party/bundles.ts`), as
	 * many animals as the player caught. During a battle, HP as it stands in the battle.
	 */
	party: AnimalInstance[];
	/** The tokens the doctor has given, less what the shop took. A whole number. */
	tokens: number;
	/** The ids of the items the player owns, each once, in the order bought (`hasItem`). */
	items: string[];
	/**
	 * Puzzles the player has solved, in every world together: every right
	 * answer adds one (`countSolved`), and nothing takes one away. A whole number.
	 */
	solved: number;
	/**
	 * The animal book's species seen (`animals/book.ts`), each once, in the
	 * order first seen, every caught one among them. The player's, in every
	 * world: it only grows.
	 */
	seen: string[];
	/**
	 * The animal book's species caught, each once, in the order first caught:
	 * every species in the party, and every one caught and helped home since.
	 */
	caught: string[];
	/**
	 * The battle in progress, or null: always in `world`, since nobody leaves
	 * a world mid-battle. Its seed is not saved: the authority derives it from `steps`.
	 */
	battle: BattleState | null;
	/**
	 * The tiles the player has cleared with a tool in `world`: `WorldEdits`'
	 * text form (`encode`), canonical, so two games with the same edits hold
	 * the same text. Empty in a new game.
	 */
	edits: string[];
	/**
	 * The worlds the player has been to and left, the one left most recently
	 * first, never `world`: where they stood and what they cleared in each
	 * (`world/worlds.ts`). At most `MAX_WORLDS_KEPT`, the home world always
	 * among them once left; their cleared tiles share `EDITS_BUDGET` with
	 * `edits` (`fitWorlds`).
	 */
	worlds: WorldStay[];
}

/**
 * Version 1 of the save document, from before numbered worlds: every game
 * was played in the one world of `seed`. Read through `SAVE_UPGRADES[1]`,
 * which puts it in World 1.
 */
export interface SaveV1 {
	version: 1;
	seed: number;
	pos: GridPos;
	party: AnimalInstance[];
	facing?: Direction;
	steps?: number;
	visits?: number;
	lineage?: string;
	seq?: number;
	tokens?: number;
	items?: string[];
	battle?: unknown;
	edits?: string[];
}

/** A world the player left, as a save holds it: `edits` only once something was cleared there. */
export interface SavedWorldStay {
	world: number;
	pos: GridPos;
	facing: Direction;
	edits?: string[];
}

/**
 * Version 2 of the save document, since numbered worlds and names: the
 * version this build writes.
 *
 * `version`, `home`, `world`, `pos` and `party` are required; the others are
 * checked when present, and every write must carry `facing`, `steps`,
 * `visits`, `lineage` and `seq` (`validateSaveWrite`). Any field this type
 * does not name, at the top level or on an animal, is kept as sent, so a
 * newer client can add data without a server change. Bump `version` only
 * when an old document becomes unreadable, and add the upgrade that reads it
 * (`SAVE_UPGRADES`).
 */
export interface SaveV2 {
	version: 2;
	/** The world the game began in. */
	home: number;
	/** The world the player is in; `pos`, `facing` and `edits` are that world's. */
	world: number;
	pos: GridPos;
	party: AnimalInstance[];
	/** The player's name, once chosen. A stored name `checkName` refuses loads as no name. */
	name?: string;
	facing?: Direction;
	steps?: number;
	visits?: number;
	/**
	 * The game this document belongs to: a random id minted when the game
	 * started, the same in every save of it. Two lineages are two different
	 * games, never an older and a newer copy of one.
	 */
	lineage?: string;
	/** This document's number within its game: every save is numbered one above the last. */
	seq?: number;
	/** The player's tokens. Optional in a write too: a save without them has none. */
	tokens?: number;
	/**
	 * The ids of the items the player owns. An id this build doesn't know is
	 * kept as it is and does nothing, so a save never becomes unreadable, or
	 * a newer build's, over an item.
	 */
	items?: string[];
	/**
	 * The puzzles the player has solved. Optional in a write too: a save
	 * without it, from before the count, has solved none yet.
	 */
	solved?: number;
	/**
	 * The animal book: the species seen and caught, by id, each list in the
	 * order first met. Optional in a write too: a save without them, from
	 * before the book (or played on by a build from then, which keeps them as
	 * they were), gets them back from what it proves itself (`restoreGame`).
	 * A species this build does not have in either makes the save a newer
	 * build's, as one in the party does.
	 */
	seen?: string[];
	caught?: string[];
	/** The battle in progress when it was saved. Checked on load (`readBattle`), dropped if unusable. */
	battle?: unknown;
	/**
	 * The tiles the player has cleared with a tool in `world`: `WorldEdits`'
	 * text form. Written only once something is cleared: a save without it has
	 * cleared nothing there.
	 */
	edits?: string[];
	/** The worlds the player has been to and left, the one left most recently first. Written only once there is one. */
	worlds?: SavedWorldStay[];
}

/** A document ready to be written: every field a write must carry is present. */
export type SaveWrite = SaveV2 &
	Required<Pick<SaveV2, 'facing' | 'steps' | 'visits' | 'lineage' | 'seq'>>;

/** The fields `SaveV2` names. Everything else in a document is an extra and is kept as sent. */
const SAVE_KEYS: ReadonlySet<string> = new Set([
	'version',
	'name',
	'home',
	'world',
	'pos',
	'party',
	'facing',
	'steps',
	'visits',
	'lineage',
	'seq',
	'tokens',
	'items',
	'solved',
	'seen',
	'caught',
	'battle',
	'edits',
	'worlds'
]);

/**
 * Fields that say where the player is in the world they are in, or which
 * write a document is — not what they have. Travelling to another world is
 * progress, not whereabouts: `world`, `home` and `worlds` are compared.
 */
const WHEREABOUTS: ReadonlySet<string> = new Set([
	'pos',
	'facing',
	'steps',
	'visits',
	'lineage',
	'seq'
]);

/** The animal book's two lists of species ids. */
const BOOK_KEYS = ['seen', 'caught'] as const;

const DIRECTIONS: ReadonlySet<string> = new Set(['up', 'down', 'left', 'right']);
const SPECIES_IDS: ReadonlySet<string> = new Set(ANIMALS.map((a) => a.id));
const REALMS_KNOWN: ReadonlySet<string> = new Set(REALMS);
const PUZZLE_KINDS: ReadonlySet<string> = new Set(ALL_PUZZLE_KINDS);

export type SaveCheck<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Why a document is not one this build can use: `newer` when a later build
 * wrote it (a later `version`, or content this build cannot carry on with:
 * a species, or a battle's realm or puzzle kind), `invalid` when it makes no
 * sense to any build.
 */
export type SaveProblem = 'newer' | 'invalid';

/**
 * A stored document, read: `newer` when a later build wrote it, `invalid`
 * when this build cannot make sense of it. Either way the caller leaves the
 * document alone, and a newer one is never written over or set aside — see
 * [[INVARIANTS]] § Saves.
 */
export type SaveRead =
	{ ok: true; save: SaveV2 } | { ok: false; reason: SaveProblem; error: string };

/** A document someone wants to write, checked (`validateSaveWrite`). */
export type SaveWriteCheck =
	{ ok: true; value: SaveWrite } | { ok: false; reason: SaveProblem; error: string };

type Doc = Record<string, unknown>;

/**
 * Where the v1 → v2 upgrade keeps what a v2 document has no place for, as it
 * was: a v1 extra under a key v2 has taken (`name`, `home`, `world`,
 * `worlds`, `solved`, `seen`, `caught`, or this key itself), and a seed other
 * than World 1's (no game this client wrote had one). An extra from then on,
 * kept as sent.
 */
export const V1_KEPT = 'v1';

/**
 * The keys a v1 document could hold only as extras and a v2 document names:
 * every key `SaveV2` has that `SaveV1` has not, the ones v2 grew later too
 * (`solved`, the book's `seen` and `caught`), so a v1 extra never becomes one
 * of them.
 */
const NAMED_SINCE_V2 = ['name', 'home', 'world', 'worlds', 'solved', 'seen', 'caught'] as const;

/**
 * Upgrades, indexed by the version they read: `SAVE_UPGRADES[1]` turns a v1
 * document into a v2 one. Version N + 1 ships with `SAVE_UPGRADES[N]`, and
 * `readSave` chains them, so a save from any earlier version still loads.
 *
 * v1 → v2: every v1 game was played in the world of its seed, which for
 * every game the client wrote is World 1's, so the game is in World 1, and
 * World 1 is its home. Everything else stays exactly as it was: the
 * position, facing and cleared tiles become World 1's, and the party,
 * tokens, items, counts, battle, lineage, `seq` and extras are untouched. A
 * v1 document without a whole-number seed was unreadable and stays so: it
 * gets no world.
 */
export const SAVE_UPGRADES: Readonly<Record<number, (doc: Doc) => Doc>> = {
	1: (doc) => {
		const { seed, ...rest } = doc;
		const out: Doc = { ...rest, version: 2 };
		const kept: Doc = {};
		for (const key of [...NAMED_SINCE_V2, V1_KEPT]) {
			if (!Object.prototype.hasOwnProperty.call(out, key)) continue;
			kept[key] = out[key];
			delete out[key];
		}
		if (seed !== undefined && seed !== WORLD_ONE_SEED) kept.seed = seed;
		if (Object.keys(kept).length > 0) out[V1_KEPT] = kept;
		if (Number.isSafeInteger(seed)) {
			out.world = FIRST_WORLD;
			out.home = FIRST_WORLD;
		}
		return out;
	}
};

function isRecord(v: unknown): v is Doc {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isWhole(v: unknown): v is number {
	return Number.isSafeInteger(v) && (v as number) >= 0;
}

function isId(v: unknown): v is string {
	return typeof v === 'string' && v.length > 0 && v.length <= MAX_SAVE_ID_LENGTH;
}

function isPos(v: unknown): v is GridPos {
	return isRecord(v) && Number.isSafeInteger(v.x) && Number.isSafeInteger(v.y);
}

/** Postgres jsonb refuses NUL and unpaired surrogates (error 22P05). */
const UNSTORABLE_TEXT = /\0|\p{Surrogate}/u;

/**
 * Walks the whole document — extras included — for values that would either
 * make the server's insert throw (NUL, lone surrogate, nesting deeper than
 * `MAX_SAVE_DEPTH`) or come back changed (a number `JSON.parse` turned into
 * ±Infinity is written as `null`). Returns the first offending path, or null.
 * `depth` is how many objects and lists hold `v`: the walk never goes past
 * `MAX_SAVE_DEPTH`, so however deep a document nests, it answers and never
 * runs out of stack.
 */
function findUnstorable(v: unknown, path: string, depth = 0): string | null {
	if (typeof v === 'string') {
		return UNSTORABLE_TEXT.test(v) ? `${path} contains characters that cannot be saved` : null;
	}
	if (typeof v === 'number') return Number.isFinite(v) ? null : `${path} must be a finite number`;
	if (typeof v !== 'object' || v === null) return null;
	if (depth >= MAX_SAVE_DEPTH) return `${path} is nested more than ${MAX_SAVE_DEPTH} levels deep`;
	if (Array.isArray(v)) {
		for (let i = 0; i < v.length; i++) {
			const error = findUnstorable(v[i], `${path}[${i}]`, depth + 1);
			if (error) return error;
		}
		return null;
	}
	for (const [key, value] of Object.entries(v)) {
		if (UNSTORABLE_TEXT.test(key)) return `${path} has a key that cannot be saved`;
		const error = findUnstorable(value, path ? `${path}.${key}` : key, depth + 1);
		if (error) return error;
	}
	return null;
}

/**
 * An animal's shape. Whether this build knows its species is a separate
 * question (`findUnknownContent`): a species it does not know makes the save
 * a newer build's, not a broken one.
 */
function validateAnimal(v: unknown, label: string): string | null {
	if (!isRecord(v)) return `${label} must be an object`;
	if (!isId(v.id)) return `${label}.id must be a string of 1–${MAX_SAVE_ID_LENGTH} characters`;
	if (!isContentId(v.speciesId)) return `${label}.speciesId must be a species id`;
	if (
		v.nickname !== undefined &&
		(typeof v.nickname !== 'string' ||
			v.nickname.length === 0 ||
			v.nickname.length > MAX_SAVED_NICKNAME_LENGTH)
	) {
		return `${label}.nickname must be a string of 1–${MAX_SAVED_NICKNAME_LENGTH} characters`;
	}
	if (!isWhole(v.hp)) return `${label}.hp must be a whole number of 0 or more`;
	return null;
}

function validateStay(v: unknown, label: string): string | null {
	if (!isRecord(v)) return `${label} must be an object`;
	if (!isWorldNumber(v.world)) return `${label}.world must be a world number`;
	if (!isPos(v.pos)) return `${label}.pos must be an object with whole-number x and y`;
	if (!DIRECTIONS.has(v.facing as string)) return `${label}.facing must be up, down, left or right`;
	if (v.edits !== undefined && !isEditsText(v.edits)) {
		return `${label}.edits must be a list of "cx,cy:" entries with tile indices in hex`;
	}
	return null;
}

/**
 * Checks an untrusted value against the v2 document. `version`, `home`,
 * `world`, `pos` and `party` are required; the other fields are checked when
 * present, except `battle`, which only has to be storable (a load checks it
 * with `readBattle`). A document of the right shape that names something
 * this build does not have (`findUnknownContent`) is refused too. On success
 * the value is the input object itself.
 */
export function validateSave(input: unknown): SaveCheck<SaveV2> {
	const checked = checkSave(input);
	return checked.ok ? { ok: true, value: checked.save } : { ok: false, error: checked.error };
}

/**
 * The v2 check, saying why a document fails: its shape makes it `invalid`;
 * a document of the right shape that names content this build does not have
 * was written by a newer build, and is `newer`.
 */
function checkSave(input: unknown): SaveRead {
	if (!isRecord(input))
		return { ok: false, reason: 'invalid', error: 'save must be a JSON object' };
	const error = findSaveError(input);
	if (error) return { ok: false, reason: 'invalid', error };
	const unknown = findUnknownContent(input);
	if (unknown) return { ok: false, reason: 'newer', error: unknown };
	return { ok: true, save: input as unknown as SaveV2 };
}

/**
 * The first id in a well-formed document that this build cannot carry on
 * with, as an error, or null: one none of its catalogs has, which only a
 * later build writes (a species that has shipped never leaves the catalog:
 * [[INVARIANTS]] § Saves). That is a species in the party or in the animal
 * book (`seen`, `caught`), or in a saved battle its realm, an animal's
 * species or the puzzle's kind: a game with such an animal cannot be played
 * here, a book with it would lose it at this build's next write, and such a
 * battle could only be dropped. An item this build does not have is not one
 * of them: it is kept as it is and does nothing, so the save plays on and
 * loses nothing.
 *
 * Only ids are seen. A battle that a later build's other growth made (a new
 * attack for an existing species, a realm it newly goes to, a new phase) is
 * still dropped on load here as if the kid had run away ([[DEFERRED]]).
 */
function findUnknownContent(doc: Doc): string | null {
	const party = doc.party as { speciesId: string }[];
	for (let i = 0; i < party.length; i++) {
		const unknown = unknownId(party[i]!.speciesId, SPECIES_IDS, `party[${i}].speciesId`);
		if (unknown) return unknown;
	}
	for (const key of BOOK_KEYS) {
		const list = doc[key];
		if (!Array.isArray(list)) continue;
		for (let i = 0; i < list.length; i++) {
			const unknown = unknownId(list[i], SPECIES_IDS, `${key}[${i}]`);
			if (unknown) return unknown;
		}
	}
	const battle = doc.battle;
	if (!isRecord(battle)) return null;
	const realm = unknownId(battle.realm, REALMS_KNOWN, 'battle.realm');
	if (realm) return realm;
	const fighters: [unknown, string][] = [[battle.opponent, 'battle.opponent']];
	if (Array.isArray(battle.party)) {
		battle.party.forEach((a, i) => fighters.push([a, `battle.party[${i}]`]));
	}
	for (const [animal, label] of fighters) {
		if (!isRecord(animal)) continue;
		const unknown = unknownId(animal.speciesId, SPECIES_IDS, `${label}.speciesId`);
		if (unknown) return unknown;
	}
	const phase = battle.phase;
	if (isRecord(phase) && isRecord(phase.puzzle)) {
		return unknownId(phase.puzzle.kind, PUZZLE_KINDS, 'battle.phase.puzzle.kind');
	}
	return null;
}

/**
 * An error when `value` is shaped as a catalog id (`isContentId`) and
 * `known` lacks it; null for anything else, a known id or something no
 * catalog would name.
 */
function unknownId(value: unknown, known: ReadonlySet<string>, label: string): string | null {
	if (!isContentId(value) || known.has(value)) return null;
	return `${label} is ${JSON.stringify(value)}, which a newer build has and this one does not`;
}

/**
 * The shape of every id in the engine's catalogs (species, attacks, items,
 * realms, puzzle kinds): lower-case letters and digits in words joined by
 * single hyphens, as `save.test.ts` checks. An id of another shape was never
 * written by any build, so it is broken, not newer.
 */
const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isContentId(v: unknown): v is string {
	return isId(v) && CONTENT_ID.test(v);
}

function findSaveError(input: Doc): string | null {
	const unstorable = findUnstorable(input, '');
	if (unstorable) return unstorable;
	if (input.version !== SAVE_VERSION) return `version must be ${SAVE_VERSION}`;
	for (const key of ['home', 'world'] as const) {
		if (!isWorldNumber(input[key])) {
			return `${key} must be a world number from ${FIRST_WORLD} to ${LAST_WORLD}`;
		}
	}
	const name = input.name;
	if (
		name !== undefined &&
		(typeof name !== 'string' || name.length === 0 || name.length > MAX_SAVED_NAME_LENGTH)
	) {
		return `name must be a string of 1–${MAX_SAVED_NAME_LENGTH} characters`;
	}
	if (!isPos(input.pos)) return 'pos must be an object with whole-number x and y';
	const party = input.party;
	// Any number of animals: a party has no cap. What bounds a document is the server's body limit.
	if (!Array.isArray(party)) return 'party must be a list';
	const ids = new Set<string>();
	for (let i = 0; i < party.length; i++) {
		const error = validateAnimal(party[i], `party[${i}]`);
		if (error) return error;
		const id = (party[i] as AnimalInstance).id;
		if (ids.has(id)) return `party[${i}].id repeats an earlier id`;
		ids.add(id);
	}
	if (input.facing !== undefined && !DIRECTIONS.has(input.facing as string)) {
		return 'facing must be up, down, left or right';
	}
	for (const key of ['steps', 'visits', 'seq', 'tokens', 'solved'] as const) {
		if (input[key] !== undefined && !isWhole(input[key])) {
			return `${key} must be a whole number of 0 or more`;
		}
	}
	const items = input.items;
	if (items !== undefined && (!Array.isArray(items) || !items.every(isId))) {
		return `items must be a list of ids of 1–${MAX_SAVE_ID_LENGTH} characters`;
	}
	// The animal book: species ids, whether this build has them or not (one it lacks makes the
	// save a newer build's: `findUnknownContent`). A species listed twice is listed once.
	for (const key of BOOK_KEYS) {
		const list = input[key];
		if (list !== undefined && (!Array.isArray(list) || !list.every(isContentId))) {
			return `${key} must be a list of species ids`;
		}
	}
	if (input.lineage !== undefined && !isId(input.lineage)) {
		return `lineage must be a string of 1–${MAX_SAVE_ID_LENGTH} characters`;
	}
	if (input.edits !== undefined && !isEditsText(input.edits)) {
		return 'edits must be a list of "cx,cy:" entries with tile indices in hex, each of a chunk a save can hold';
	}
	const worlds = input.worlds;
	if (worlds !== undefined) {
		if (!Array.isArray(worlds)) return 'worlds must be a list';
		const seen = new Set<number>();
		for (let i = 0; i < worlds.length; i++) {
			const error = validateStay(worlds[i], `worlds[${i}]`);
			if (error) return error;
			const world = (worlds[i] as SavedWorldStay).world;
			if (seen.has(world)) return `worlds[${i}].world repeats an earlier world`;
			seen.add(world);
		}
	}
	return null;
}

/**
 * Checks a document someone wants to write: one this build can read (an
 * older version is upgraded first, as `readSave` reads it) that also carries
 * `facing`, `steps`, `visits`, `lineage` and a `seq` of at least 1. The value
 * is the document as this build reads it: a save an older build sends (a page
 * still open from before an update) is kept upgraded, so the server holds
 * this version's document from then on. A refusal says why, as `readSave`
 * does: a newer build's document (`newer`) is not a broken one.
 */
export function validateSaveWrite(input: unknown): SaveWriteCheck {
	const read = readSave(input);
	if (!read.ok) return read;
	const doc = read.save;
	for (const key of ['facing', 'steps', 'visits', 'lineage', 'seq'] as const) {
		if (doc[key] === undefined) {
			return { ok: false, reason: 'invalid', error: `a save being written needs ${key}` };
		}
	}
	if (doc.seq! < 1) return { ok: false, reason: 'invalid', error: 'seq must be 1 or more' };
	return { ok: true, value: doc as SaveWrite };
}

/**
 * Brings a document of any version up to `target` through `upgrades`.
 * `readSave` uses the real table; tests pass their own.
 */
export function upgradeSave(
	input: unknown,
	upgrades: Readonly<Record<number, (doc: Doc) => Doc>>,
	target: number
): { ok: true; doc: Doc } | { ok: false; reason: SaveProblem; error: string } {
	if (!isRecord(input))
		return { ok: false, reason: 'invalid', error: 'save must be a JSON object' };
	const version = input.version;
	if (!Number.isSafeInteger(version) || (version as number) < 1) {
		return { ok: false, reason: 'invalid', error: 'version must be a whole number from 1' };
	}
	if ((version as number) > target) {
		return { ok: false, reason: 'newer', error: `version ${version} is newer than ${target}` };
	}
	let doc = input;
	for (let from = version as number; from < target; from++) {
		const upgrade = upgrades[from];
		if (!upgrade) return { ok: false, reason: 'invalid', error: `no upgrade from version ${from}` };
		doc = upgrade(doc);
	}
	return { ok: true, doc };
}

/**
 * Reads a stored document: upgrades it from an older version, then checks
 * it. A document this build cannot read comes back `ok: false`; the caller
 * must leave it where it is or set it aside, never throw it away. One a
 * newer build wrote (`newer`: a later version, or content this build does
 * not have) is never set aside or written over either: it waits, untouched,
 * for a build that can read it.
 */
export function readSave(input: unknown): SaveRead {
	const upgraded = upgradeSave(input, SAVE_UPGRADES, SAVE_VERSION);
	return upgraded.ok ? checkSave(upgraded.doc) : upgraded;
}

/** Whether a stored document, whatever shape it is in, was written by a newer build (`readSave`'s `newer`). */
export function isNewerSave(doc: unknown): boolean {
	const read = readSave(doc);
	return !read.ok && read.reason === 'newer';
}

/** The default starter at full HP: a throwaway game's, and a saved party's that came back empty. */
function defaultStarter(): AnimalInstance {
	return { id: 'starter', speciesId: STARTER_SPECIES, hp: getAnimal(STARTER_SPECIES).maxHp };
}

/**
 * A new game in world `world`, which is its home: that world's spawn tile,
 * facing down, nothing walked, no tokens, no items, no puzzle solved, nothing
 * cleared and no other world visited, the player called `name` (checked by the caller with
 * `checkName`; null for none yet), and one animal, `starter` (the chosen one,
 * `chooseStarter`'s with an id from the authority), or else the default
 * starter at full HP. The animal book holds the starter alone, caught: a
 * starter counts as caught.
 */
export function newGame(
	world: number,
	starter?: AnimalInstance,
	name: string | null = null
): SavedGame {
	const party = [starter ? { ...starter } : defaultStarter()];
	const book = recordParty(bookOf([], []), party);
	return {
		name,
		home: world,
		world,
		pos: spawnPoint(worldSeed(world)),
		facing: 'down',
		steps: 0,
		visits: 0,
		party,
		tokens: 0,
		items: [],
		solved: 0,
		seen: [...book.seen],
		caught: [...book.caught],
		battle: null,
		edits: [],
		worlds: []
	};
}

/** An animal from a save as a rename would leave it: its nickname cleaned, and none when nothing is left. */
function cleanAnimal(animal: AnimalInstance): AnimalInstance {
	const { nickname, ...rest } = animal;
	const clean = normalizeNickname(nickname);
	return clean === undefined ? rest : { ...rest, nickname: clean };
}

/**
 * The game a readable save describes, made playable. Nicknames go through
 * the same cleaning as a rename (`normalizeNickname`), in the party and in a
 * saved battle's party alike, and the player's name through `checkName`: a
 * name it refuses (a rule that has grown since, a hand-edited save) is no
 * name, and the player is asked for one again. Fields a document lacks get
 * their defaults (facing down, no steps or visits, no tokens or items, no
 * puzzle solved, nothing cleared, no other world visited; an item listed twice is owned
 * once; the edits in their canonical text, within `EDITS_BUDGET`, trimmed
 * round the player as a clear trims them when a save holds more), and
 * nothing in it can leave the player stuck: a position the player can't be
 * on, in the world as they left it, with what they own (the world generator
 * changed under it, or water without a boat) becomes the spawn tile, an HP
 * above the species' maximum is cut to it, an empty party gets the starter,
 * a party with no animal that can fight on land (only sea animals: no save a
 * kid's game writes holds one) gets it too, behind the others, so the grass
 * is never out of reach. A team that needs the doctor (`needsDoctor`) comes
 * back exactly as tired as it was: a reload is never a heal. The live game
 * left it with a way to a doctor (`careFor`, asked after a lost battle, a
 * go-to and a trip), and asking again here, where the player now stands,
 * would heal a team a glide took somewhere the live game kept it tired.
 * The battle comes back only if
 * `readBattle` accepts it where the player stands, and never when the
 * position had to move, nor when the starter joined (it was not in the
 * battle). See [[INVARIANTS]] § "A loaded save never strands the player".
 *
 * The worlds left behind come back in the order they were left, each world
 * once and never the current one, at most `MAX_WORLDS_KEPT` (`keepWorlds`),
 * their cleared tiles in canonical text and within what `EDITS_BUDGET` leaves
 * beside the current world's (`fitWorlds`).
 *
 * The party comes back in species bundles (`bundled`), a saved battle's
 * party in the same order with the same animal in front. A save this build
 * wrote is in bundles already and comes back as it was; one from before
 * bundles is put in them, each species behind its first animal.
 *
 * The animal book comes back as saved, made whole with what the save proves
 * itself (`savedBook`): a save from before the book gets one back.
 */
export function restoreGame(save: SaveV2): SavedGame {
	const seed = worldSeed(save.world);
	const items = [...new Set(save.items ?? [])];
	// Kept within the budget as a clear keeps it, whatever wrote the save (a hand-edited
	// one can hold more): the chunks round the player are the last to go, and never go.
	const edits = (save.edits ? WorldEdits.decode(save.edits) : WorldEdits.none).trimmedAround(
		save.pos
	).edits;
	const here = editedTileAt(seed, edits, save.pos.x, save.pos.y).kind;
	// Out on the water only with the boat; without it (a save from a game that
	// somehow lost it) the player is back on the spawn tile, never stranded.
	const standable = isPassable(here, gearOf({ items }));
	let party = save.party.map((a) =>
		cleanAnimal({ ...a, hp: Math.min(a.hp, getAnimal(a.speciesId).maxHp) })
	);
	if (party.length === 0) party = [defaultStarter()];
	else if (!party.some((a) => canFightIn(a.speciesId, 'land'))) {
		let id = 'starter';
		for (let n = 2; party.some((a) => a.id === id); n++) id = `starter-${n}`;
		party = joinParty(party, {
			id,
			speciesId: STARTER_SPECIES,
			hp: getAnimal(STARTER_SPECIES).maxHp
		});
	}
	const pos = standable ? { x: save.pos.x, y: save.pos.y } : spawnPoint(seed);
	const battle = standable ? readBattle(save.battle, party, tileRealm(here)) : null;
	const named = save.name === undefined ? null : checkName(save.name);
	const worlds = fitWorlds(
		edits,
		keepWorlds(staysOf(save.worlds, save.world), save.home),
		save.home
	);
	const book = savedBook(save, party);
	return {
		name: named?.ok ? named.name : null,
		home: save.home,
		world: save.world,
		pos,
		facing: save.facing ?? 'down',
		steps: save.steps ?? 0,
		visits: save.visits ?? 0,
		party: bundled(party),
		tokens: save.tokens ?? 0,
		items,
		solved: save.solved ?? 0,
		seen: [...book.seen],
		caught: [...book.caught],
		battle: battle && bundledBattle(battle),
		edits: [...edits.encode()],
		worlds: [...worlds]
	};
}

/**
 * The animal book a save holds, made whole ([[PRODUCT]] §4 "The animal
 * book"): its lists as saved, each species once and every caught one seen
 * too, and then what the save proves by itself, for a save from before the
 * book, or one a build from then played on (keeping the lists as they were,
 * never adding to them): every species in `party` was caught (the starter
 * counts as caught), and a saved battle's wild animal was seen, whether or
 * not the battle can be picked up. Nothing else in a save names a species:
 * `lineage` is a random id, the tokens and items say animals went home but
 * not which. `party` is the party the game goes on with (`restoreGame`'s,
 * which a starter may have joined); by default the save's own.
 */
function savedBook(save: SaveV2, party: readonly AnimalInstance[] = save.party): AnimalBook {
	let book = recordParty(bookOf(save.seen ?? [], save.caught ?? []), party);
	const battle = save.battle;
	if (isRecord(battle) && isRecord(battle.opponent)) {
		const wild = battle.opponent.speciesId;
		if (typeof wild === 'string') book = seeSpecies(book, wild);
	}
	return book;
}

/** The worlds left behind in a save, but `current`, their cleared tiles in canonical text. */
function staysOf(saved: readonly SavedWorldStay[] | undefined, current: number): WorldStay[] {
	return (saved ?? [])
		.filter((stay) => stay.world !== current)
		.map((stay) => ({
			world: stay.world,
			pos: { x: stay.pos.x, y: stay.pos.y },
			facing: stay.facing,
			edits: stay.edits ? [...WorldEdits.decode(stay.edits).encode()] : []
		}));
}

/** The battle with its party in bundles and the same animal in front. */
function bundledBattle(state: BattleState): BattleState {
	const front = state.party[state.active]!.id;
	const party = bundled(state.party);
	return { ...state, party, active: party.findIndex((a) => a.id === front) };
}

/**
 * A saved battle, if it can be picked up again with `party` (the party
 * restored beside it) where the player stands, in `where`: fought there (a
 * battle saved before battles had a realm was fought on land), or up in the
 * air, which a bird that followed the glider down starts on whatever tile the
 * player landed on, ground or water; the same animals with the same HP, a
 * standing animal that can fight in the battle's realm in front (or, waiting
 * for a replacement after a knock-out, a tired one with someone standing
 * behind it who can), a wild animal that is still standing and can fight
 * there, and a phase the reducer can take the next intent in. Anything else
 * is null, and the player is back in explore as if they had run away, with
 * the HP they had. A `log` of English lines, from a build before the engine
 * held no words, is ignored.
 */
export function readBattle(
	value: unknown,
	party: readonly AnimalInstance[],
	where: Realm = 'land'
): BattleState | null {
	// Only what a save's battle can be (`findUnstorable`, a level into the document): the
	// comparison and the copy below go down one level at a time.
	if (!isRecord(value) || findUnstorable(value, 'battle', 1) !== null) return null;
	const { step, turn, active, opponent, leashQuality, phase } = value;
	const fought = value.realm ?? 'land';
	if (fought !== where && fought !== 'air') return null;
	const realm = fought as Realm;
	const fights = (a: AnimalInstance) => a.hp > 0 && canFightIn(a.speciesId, realm);
	if (!isWhole(step) || !Number.isSafeInteger(turn) || (turn as number) < 1) return null;
	if (!Array.isArray(value.party)) return null;
	// Cleaned as the restored party was, so the two compare as the game would see them.
	const members = value.party.map((a) =>
		isRecord(a) ? cleanAnimal(a as unknown as AnimalInstance) : a
	);
	if (canonical(members) !== canonical(party)) return null;
	if (!Number.isSafeInteger(active)) return null;
	const front = party[active as number];
	if (!front) return null;
	// After a knock-out (`choose-animal`) the tired animal is still in front, waiting to
	// be replaced by one that is standing; in every other phase the front one stands.
	if (isRecord(phase) && phase.kind === 'choose-animal') {
		if (front.hp !== 0 || !party.some(fights)) return null;
	} else if (!fights(front)) {
		return null;
	}
	if (validateAnimal(opponent, 'opponent') !== null) return null;
	const wild = opponent as unknown as AnimalInstance;
	if (!SPECIES_IDS.has(wild.speciesId)) return null;
	if (wild.hp === 0 || wild.hp > getAnimal(wild.speciesId).maxHp) return null;
	if (!canFightIn(wild.speciesId, realm)) return null;
	if (party.some((a) => a.id === wild.id)) return null;
	if (typeof leashQuality !== 'number' || !Number.isFinite(leashQuality) || leashQuality <= 0) {
		return null;
	}
	if (!isRecord(phase)) return null;
	if (phase.kind === 'solving') {
		const attacks = getAnimal(front.speciesId).attacks.length;
		const { attackIndex, level, puzzle } = phase;
		if (!Number.isSafeInteger(attackIndex) || (attackIndex as number) < 1) return null;
		if ((attackIndex as number) > attacks) return null;
		if (!(ATTACK_LEVELS as readonly unknown[]).includes(level)) return null;
		if (!isRecord(puzzle) || !PUZZLE_KINDS.has(puzzle.kind as string)) return null;
		if (typeof puzzle.prompt !== 'string' || !Number.isSafeInteger(puzzle.answer)) return null;
		if (!Number.isSafeInteger(puzzle.difficulty)) return null;
		const difficulty = puzzle.difficulty as number;
		if (difficulty < MIN_DIFFICULTY || difficulty > MAX_DIFFICULTY) return null;
	} else if (phase.kind !== 'choose-action' && phase.kind !== 'choose-animal') {
		return null;
	}
	return {
		step: step as number,
		turn: turn as number,
		party: party.map((a) => ({ ...a })),
		active: active as number,
		opponent: { ...wild },
		leashQuality,
		realm,
		phase: JSON.parse(JSON.stringify(phase)) as BattleState['phase']
	};
}

/** The top-level fields of a document that `SaveV2` does not name. */
export function saveExtras(doc: SaveV2): Doc {
	const extras: Doc = {};
	for (const [key, value] of Object.entries(doc)) if (!SAVE_KEYS.has(key)) extras[key] = value;
	return extras;
}

/**
 * The document that saves `game` as number `seq` of `lineage`. `extras` are
 * fields a newer build left in the save this one was loaded from; they are
 * written back unchanged rather than dropped.
 */
export function saveDocument(
	game: SavedGame,
	stamp: { lineage: string; seq: number },
	extras: Doc = {}
): SaveWrite {
	const doc: SaveWrite = {
		...extras,
		version: SAVE_VERSION,
		home: game.home,
		world: game.world,
		pos: { x: game.pos.x, y: game.pos.y },
		facing: game.facing,
		steps: game.steps,
		visits: game.visits,
		party: game.party.map((a) => ({ ...a })),
		tokens: game.tokens,
		items: [...game.items],
		solved: game.solved,
		seen: [...game.seen],
		caught: [...game.caught],
		lineage: stamp.lineage,
		seq: stamp.seq
	};
	if (game.name !== null) doc.name = game.name;
	if (game.battle) doc.battle = JSON.parse(JSON.stringify(game.battle));
	// Only once something is cleared: a game that never used a tool saves as it did before tools.
	if (game.edits.length > 0) doc.edits = [...game.edits];
	// Only once another world was visited.
	if (game.worlds.length > 0) doc.worlds = game.worlds.map(savedStay);
	return doc;
}

function savedStay(stay: WorldStay): SavedWorldStay {
	const saved: SavedWorldStay = {
		world: stay.world,
		pos: { x: stay.pos.x, y: stay.pos.y },
		facing: stay.facing
	};
	if (stay.edits.length > 0) saved.edits = [...stay.edits];
	return saved;
}

/** The `version` of a stored document, whatever shape it is in: 0 when it has none. */
export function saveVersion(doc: unknown): number {
	return isRecord(doc) && isWhole(doc.version) ? doc.version : 0;
}

/** The `seq` of a stored document, whatever shape it is in: 0 when it has none. */
export function saveSeq(doc: unknown): number {
	return isRecord(doc) && isWhole(doc.seq) ? doc.seq : 0;
}

/** The `lineage` of a stored document, whatever shape it is in: '' when it has none. */
export function saveLineage(doc: unknown): string {
	return isRecord(doc) && isId(doc.lineage) ? doc.lineage : '';
}

/**
 * The server's stale-write guard: may `incoming` replace `stored` (null when
 * nothing is stored)? Only with a higher `seq`. Within one game that puts
 * writes in order however the network delivers them; the browser's own
 * storage already keeps a game's saves in one line (see the client's
 * autosave). Between two different games — a lineage started while an older
 * one was out of reach — the one saved more often wins, and the server keeps
 * the loser (`replacesAnotherGame`). A save a newer build wrote is never
 * replaced, whatever the `seq`: this build cannot read it, and it waits for
 * one that can.
 */
export function canReplace(stored: unknown, incoming: Pick<SaveWrite, 'seq'>): boolean {
	return stored === null || (incoming.seq > saveSeq(stored) && !isNewerSave(stored));
}

/**
 * Whether writing `incoming` over `stored` would lose a different game, a
 * document this build cannot read (an invalid one: a newer build's is never
 * replaced at all, `canReplace`), or a document an older build wrote (the
 * first save after an update, which is this version's) — the cases where
 * the server copies `stored` aside, as it was, before replacing it.
 */
export function replacesAnotherGame(
	stored: unknown,
	incoming: Pick<SaveWrite, 'lineage'>
): boolean {
	if (stored === null) return false;
	return (
		!readSave(stored).ok ||
		saveLineage(stored) !== incoming.lineage ||
		saveVersion(stored) < SAVE_VERSION
	);
}

/**
 * Whether two saves hold the same progress: they may differ in where the
 * player is in the world they are in (position, facing, steps, doctor
 * visits) and in which write they are, and in nothing else — not the party,
 * not a battle, not the puzzles solved, not the animal book, not the world
 * they are in or the worlds they left, not the name, not any extra field. A
 * page whose save was replaced by another page
 * that only walked around can take the save back without losing anything a
 * kid would miss.
 */
export function sameProgress(a: SaveV2, b: SaveV2): boolean {
	const left = withProgressDefaults(a);
	const right = withProgressDefaults(b);
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		if (WHEREABOUTS.has(key)) continue;
		if (canonical(left[key]) !== canonical(right[key])) return false;
	}
	return true;
}

/**
 * A document with what an older save leaves unsaid said: no tokens, no
 * items, no puzzle solved, nothing cleared, no other world visited, and the
 * animal book it proves (`savedBook`). A save from before the shop, the count
 * of puzzles, the tools, travel or the book holds the same progress as one
 * that writes it out. The book's lists compare as sets: the order a species
 * was first met in is no progress.
 */
function withProgressDefaults(doc: SaveV2): Doc {
	const out: Doc = { ...(doc as unknown as Doc) };
	if (out.tokens === undefined) out.tokens = 0;
	if (out.items === undefined) out.items = [];
	if (out.solved === undefined) out.solved = 0;
	if (out.edits === undefined) out.edits = [];
	if (out.worlds === undefined) out.worlds = [];
	const book = savedBook(doc);
	out.seen = [...book.seen].sort();
	out.caught = [...book.caught].sort();
	return out;
}

/**
 * JSON text with object keys sorted and `undefined` fields dropped, for
 * comparing values. It recurses once a level, so it is only given what a
 * save's check has walked: at most `MAX_SAVE_DEPTH` deep.
 */
function canonical(v: unknown): string {
	if (v === undefined) return 'undefined';
	if (Array.isArray(v)) {
		return `[${v.map((x) => (x === undefined ? 'null' : canonical(x))).join(',')}]`;
	}
	if (isRecord(v)) {
		const keys = Object.keys(v)
			.filter((k) => v[k] !== undefined)
			.sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
	}
	return JSON.stringify(v);
}
