import type { AnimalInstance } from './animals/types.js';
import { ATTACK_LEVELS, MAX_PARTY } from './animals/types.js';
import { ANIMALS, getAnimal } from './animals/catalog.js';
import type { BattleState } from './battle/types.js';
import { normalizeNickname } from './party/names.js';
import { ALL_PUZZLE_KINDS, MAX_DIFFICULTY, MIN_DIFFICULTY } from './puzzles/types.js';
import { spawnPoint, tileAtWorld } from './world/generate.js';
import type { Direction, GridPos } from './world/types.js';
import { isWalkable } from './world/types.js';

/**
 * The save: one document per game. The client writes it to the browser's
 * storage (the primary copy) and to the server (a backup), and both sides
 * check it with this module, so there is one definition of what a save is.
 * Error strings here are for developers and API clients, never for players.
 */

/** The newest save format this build reads and writes. */
export const SAVE_VERSION = 1;

/** The longest animal id, or lineage id, a save may hold. */
export const MAX_SAVE_ID_LENGTH = 64;
/**
 * The longest nickname a save accepts, in UTF-16 units. Renames are cut much
 * shorter (`MAX_NICKNAME_LENGTH`, in code points, `party/names.ts`); this is
 * the storage limit, with room for a name of 4-byte letters twice over.
 */
export const MAX_SAVED_NICKNAME_LENGTH = 40;

/** The species a new game starts with ([[PRODUCT]] §4 "Starting out"). */
export const STARTER_SPECIES = 'squirrel';

/** What a save remembers about the game: everything an authority needs to carry on from it. */
export interface SavedGame {
	/** World seed: the world is a pure function of it. */
	seed: number;
	/** Where the player stands, in world tile coordinates. */
	pos: GridPos;
	/** Which way the player faces. */
	facing: Direction;
	/** Completed steps. Keys every encounter roll and battle seed, so a reload carries on the sequence. */
	steps: number;
	/** Doctor visits opened. With `steps`, keys each visit's puzzles, so a reload carries those on too. */
	visits: number;
	/** The party, in slot order, at most `MAX_PARTY`. During a battle, HP as it stands in the battle. */
	party: AnimalInstance[];
	/** The battle in progress, or null. Its seed is not saved: the authority derives it from `steps`. */
	battle: BattleState | null;
}

/**
 * Version 1 of the save document.
 *
 * `version`, `seed`, `pos` and `party` have been required since the first
 * save. The other fields arrived with client saves: older v1 documents lack
 * them and `restoreGame` fills them in, while every write must carry
 * `facing`, `steps`, `visits`, `lineage` and `seq` (`validateSaveWrite`). Any field this
 * type does not name, at the top level or on an animal, is kept as sent, so a
 * newer client can add data without a server change. Bump `version` only
 * when an old document becomes unreadable, and add the upgrade that reads it
 * (`SAVE_UPGRADES`).
 */
export interface SaveV1 {
	version: 1;
	seed: number;
	pos: GridPos;
	party: AnimalInstance[];
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
	/** The battle in progress when it was saved. Checked on load (`readBattle`), dropped if unusable. */
	battle?: unknown;
}

/** A document ready to be written: every field a write must carry is present. */
export type SaveWrite = SaveV1 &
	Required<Pick<SaveV1, 'facing' | 'steps' | 'visits' | 'lineage' | 'seq'>>;

/** The fields `SaveV1` names. Everything else in a document is an extra and is kept as sent. */
const SAVE_KEYS: ReadonlySet<string> = new Set([
	'version',
	'seed',
	'pos',
	'party',
	'facing',
	'steps',
	'visits',
	'lineage',
	'seq',
	'battle'
]);

/** Fields that say where the player is, or which write a document is — not what they have. */
const WHEREABOUTS: ReadonlySet<string> = new Set([
	'pos',
	'facing',
	'steps',
	'visits',
	'lineage',
	'seq'
]);

const DIRECTIONS: ReadonlySet<string> = new Set(['up', 'down', 'left', 'right']);
const SPECIES_IDS: ReadonlySet<string> = new Set(ANIMALS.map((a) => a.id));
const PUZZLE_KINDS: ReadonlySet<string> = new Set(ALL_PUZZLE_KINDS);

export type SaveCheck<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * A stored document, read: `newer` when a later build wrote it, `invalid`
 * when this build cannot make sense of it. Either way the caller leaves the
 * document alone — see [[INVARIANTS]] § Saves.
 */
export type SaveRead =
	{ ok: true; save: SaveV1 } | { ok: false; reason: 'newer' | 'invalid'; error: string };

type Doc = Record<string, unknown>;

/**
 * Upgrades, indexed by the version they read: `SAVE_UPGRADES[1]` turns a v1
 * document into a v2 one. Version N + 1 ships with `SAVE_UPGRADES[N]`, and
 * `readSave` chains them, so a save from any earlier version still loads.
 */
export const SAVE_UPGRADES: Readonly<Record<number, (doc: Doc) => Doc>> = {};

function isRecord(v: unknown): v is Doc {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isWhole(v: unknown): v is number {
	return Number.isSafeInteger(v) && (v as number) >= 0;
}

function isId(v: unknown): v is string {
	return typeof v === 'string' && v.length > 0 && v.length <= MAX_SAVE_ID_LENGTH;
}

/** Postgres jsonb refuses NUL and unpaired surrogates (error 22P05). */
const UNSTORABLE_TEXT = /\0|\p{Surrogate}/u;

/**
 * Walks the whole document — extras included — for values that would either
 * make the server's insert throw (NUL, lone surrogate) or come back changed
 * (a number `JSON.parse` turned into ±Infinity is written as `null`). Returns
 * the first offending path, or null.
 */
function findUnstorable(v: unknown, path: string): string | null {
	if (typeof v === 'string') {
		return UNSTORABLE_TEXT.test(v) ? `${path} contains characters that cannot be saved` : null;
	}
	if (typeof v === 'number') return Number.isFinite(v) ? null : `${path} must be a finite number`;
	if (Array.isArray(v)) {
		for (let i = 0; i < v.length; i++) {
			const error = findUnstorable(v[i], `${path}[${i}]`);
			if (error) return error;
		}
		return null;
	}
	if (isRecord(v)) {
		for (const [key, value] of Object.entries(v)) {
			if (UNSTORABLE_TEXT.test(key)) return `${path} has a key that cannot be saved`;
			const error = findUnstorable(value, path ? `${path}.${key}` : key);
			if (error) return error;
		}
	}
	return null;
}

function validateAnimal(v: unknown, label: string): string | null {
	if (!isRecord(v)) return `${label} must be an object`;
	if (!isId(v.id)) return `${label}.id must be a string of 1–${MAX_SAVE_ID_LENGTH} characters`;
	if (typeof v.speciesId !== 'string' || !SPECIES_IDS.has(v.speciesId)) {
		return `${label}.speciesId must name a known species`;
	}
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

/**
 * Checks an untrusted value against the v1 document. The four original
 * fields are required; the later ones are checked when present, except
 * `battle`, which only has to be storable (a load checks it with
 * `readBattle`). On success the value is the input object itself.
 */
export function validateSave(input: unknown): SaveCheck<SaveV1> {
	if (!isRecord(input)) return { ok: false, error: 'save must be a JSON object' };
	const error = findSaveError(input);
	return error ? { ok: false, error } : { ok: true, value: input as unknown as SaveV1 };
}

function findSaveError(input: Doc): string | null {
	const unstorable = findUnstorable(input, '');
	if (unstorable) return unstorable;
	if (input.version !== SAVE_VERSION) return `version must be ${SAVE_VERSION}`;
	if (!Number.isSafeInteger(input.seed)) return 'seed must be a whole number';
	const pos = input.pos;
	if (!isRecord(pos) || !Number.isSafeInteger(pos.x) || !Number.isSafeInteger(pos.y)) {
		return 'pos must be an object with whole-number x and y';
	}
	const party = input.party;
	if (!Array.isArray(party)) return 'party must be a list';
	if (party.length > MAX_PARTY) return `party must have at most ${MAX_PARTY} animals`;
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
	for (const key of ['steps', 'visits', 'seq'] as const) {
		if (input[key] !== undefined && !isWhole(input[key])) {
			return `${key} must be a whole number of 0 or more`;
		}
	}
	if (input.lineage !== undefined && !isId(input.lineage)) {
		return `lineage must be a string of 1–${MAX_SAVE_ID_LENGTH} characters`;
	}
	return null;
}

/**
 * Checks a document someone wants to write: a valid v1 document that also
 * carries `facing`, `steps`, `visits`, `lineage` and a `seq` of at least 1.
 */
export function validateSaveWrite(input: unknown): SaveCheck<SaveWrite> {
	const checked = validateSave(input);
	if (!checked.ok) return checked;
	const doc = checked.value;
	for (const key of ['facing', 'steps', 'visits', 'lineage', 'seq'] as const) {
		if (doc[key] === undefined) return { ok: false, error: `a save being written needs ${key}` };
	}
	if (doc.seq! < 1) return { ok: false, error: 'seq must be 1 or more' };
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
): { ok: true; doc: Doc } | { ok: false; reason: 'newer' | 'invalid'; error: string } {
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
 * must leave it where it is or set it aside, never throw it away.
 */
export function readSave(input: unknown): SaveRead {
	const upgraded = upgradeSave(input, SAVE_UPGRADES, SAVE_VERSION);
	if (!upgraded.ok) return upgraded;
	const checked = validateSave(upgraded.doc);
	return checked.ok
		? { ok: true, save: checked.value }
		: { ok: false, reason: 'invalid', error: checked.error };
}

/** A new game in world `seed`: the spawn tile, facing down, one starter at full HP. */
export function newGame(seed: number): SavedGame {
	return {
		seed,
		pos: spawnPoint(seed),
		facing: 'down',
		steps: 0,
		visits: 0,
		party: [{ id: 'starter', speciesId: STARTER_SPECIES, hp: getAnimal(STARTER_SPECIES).maxHp }],
		battle: null
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
 * saved battle's party alike. Fields an older v1
 * document lacks get their defaults (facing down, no steps or visits), and nothing in
 * it can leave the player stuck: a position that is not walkable (the world
 * generator changed under it) becomes the spawn tile, an HP above the
 * species' maximum is cut to it, an empty party gets the starter, and a party
 * with nobody standing rests back to full, the same rest a lost battle gives.
 * The battle comes back only if `readBattle` accepts it, and never when the
 * position had to move. See [[INVARIANTS]] § "A loaded save never strands the
 * player".
 */
export function restoreGame(save: SaveV1): SavedGame {
	const { seed } = save;
	const standable = isWalkable(tileAtWorld(seed, save.pos.x, save.pos.y).kind);
	let party = save.party.map((a) =>
		cleanAnimal({ ...a, hp: Math.min(a.hp, getAnimal(a.speciesId).maxHp) })
	);
	if (party.length === 0) party = newGame(seed).party;
	else if (!party.some((a) => a.hp > 0)) {
		party = party.map((a) => ({ ...a, hp: getAnimal(a.speciesId).maxHp }));
	}
	return {
		seed,
		pos: standable ? { x: save.pos.x, y: save.pos.y } : spawnPoint(seed),
		facing: save.facing ?? 'down',
		steps: save.steps ?? 0,
		visits: save.visits ?? 0,
		party,
		battle: standable ? readBattle(save.battle, party) : null
	};
}

/**
 * A saved battle, if it can be picked up again with `party` (the party
 * restored beside it): the same animals with the same HP, a standing animal
 * in front, a wild animal that is still standing, and a phase the reducer
 * can take the next intent in. Anything else is null, and the player is back
 * in explore as if they had run away, with the HP they had.
 */
export function readBattle(value: unknown, party: readonly AnimalInstance[]): BattleState | null {
	if (!isRecord(value)) return null;
	const { step, turn, active, opponent, leashQuality, phase, log } = value;
	if (!isWhole(step) || !Number.isSafeInteger(turn) || (turn as number) < 1) return null;
	if (!Array.isArray(value.party)) return null;
	// Cleaned as the restored party was, so the two compare as the game would see them.
	const fought = value.party.map((a) =>
		isRecord(a) ? cleanAnimal(a as unknown as AnimalInstance) : a
	);
	if (canonical(fought) !== canonical(party)) return null;
	if (!Number.isSafeInteger(active)) return null;
	const front = party[active as number];
	if (!front || front.hp === 0) return null;
	if (validateAnimal(opponent, 'opponent') !== null) return null;
	const wild = opponent as unknown as AnimalInstance;
	if (wild.hp === 0 || wild.hp > getAnimal(wild.speciesId).maxHp) return null;
	if (party.some((a) => a.id === wild.id)) return null;
	if (typeof leashQuality !== 'number' || !Number.isFinite(leashQuality) || leashQuality <= 0) {
		return null;
	}
	if (!Array.isArray(log) || !log.every((line) => typeof line === 'string')) return null;
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
	} else if (phase.kind !== 'choose-action') {
		return null;
	}
	return {
		step: step as number,
		turn: turn as number,
		party: party.map((a) => ({ ...a })),
		active: active as number,
		opponent: { ...wild },
		leashQuality,
		phase: JSON.parse(JSON.stringify(phase)) as BattleState['phase'],
		log: [...(log as string[])]
	};
}

/** The top-level fields of a document that `SaveV1` does not name. */
export function saveExtras(doc: SaveV1): Doc {
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
		seed: game.seed,
		pos: { x: game.pos.x, y: game.pos.y },
		facing: game.facing,
		steps: game.steps,
		visits: game.visits,
		party: game.party.map((a) => ({ ...a })),
		lineage: stamp.lineage,
		seq: stamp.seq
	};
	if (game.battle) doc.battle = JSON.parse(JSON.stringify(game.battle));
	return doc;
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
 * the loser (`replacesAnotherGame`).
 */
export function canReplace(stored: unknown, incoming: Pick<SaveWrite, 'seq'>): boolean {
	return stored === null || incoming.seq > saveSeq(stored);
}

/**
 * Whether writing `incoming` over `stored` would lose a different game, or a
 * document this build cannot read — the cases where the server copies
 * `stored` aside before replacing it.
 */
export function replacesAnotherGame(
	stored: unknown,
	incoming: Pick<SaveWrite, 'lineage'>
): boolean {
	if (stored === null) return false;
	return !readSave(stored).ok || saveLineage(stored) !== incoming.lineage;
}

/**
 * Whether two saves hold the same progress: they may differ in where the
 * player is (position, facing, steps, doctor visits) and in which write they are, and in
 * nothing else — not the party, not a battle, not the world, not any extra
 * field. A page whose save was replaced by another page that only walked
 * around can take the save back without losing anything a kid would miss.
 */
export function sameProgress(a: SaveV1, b: SaveV1): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const key of keys) {
		if (WHEREABOUTS.has(key)) continue;
		const left = (a as unknown as Doc)[key];
		const right = (b as unknown as Doc)[key];
		if (canonical(left) !== canonical(right)) return false;
	}
	return true;
}

/** JSON text with object keys sorted and `undefined` fields dropped, for comparing values. */
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
