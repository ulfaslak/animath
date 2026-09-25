import type { AnimalInstance, GridPos } from '@mathgame/engine';
import { ANIMALS } from '@mathgame/engine';

/**
 * The save document a client PUTs to `/api/players/:id/save` and GETs back.
 *
 * Versioned envelope. The required fields are validated strictly; any extra
 * top-level or per-animal field is stored and returned as sent, so a newer
 * client can add data without a server change. "As sent" means JSON
 * semantics: key order and `-0` are not preserved, and a document holding
 * something JSON/jsonb cannot represent (a NUL character, a lone surrogate, a
 * number that overflows to Infinity) is rejected with 400 rather than stored
 * mangled. Bumping `version` is for a change that makes an old document
 * unreadable.
 */
export interface SaveV1 {
	version: 1;
	/** World seed: the world is a pure function of it. */
	seed: number;
	/** Player position on the grid, in world tile coordinates. */
	pos: GridPos;
	/** The party, in slot order. At most `MAX_PARTY` animals. */
	party: AnimalInstance[];
}

export const SAVE_VERSION = 1;
export const MAX_PARTY = 6;
/** Hard cap on a PUT body. A full party with nicknames is well under 1 KB. */
export const SAVE_MAX_BYTES = 64 * 1024;

const MAX_ID_LENGTH = 64;
const MAX_NICKNAME_LENGTH = 40;
const SPECIES_IDS = new Set(ANIMALS.map((a) => a.id));

export type SaveValidation = { ok: true; value: SaveV1 } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(error: string): SaveValidation {
	return { ok: false, error };
}

/** Postgres jsonb refuses NUL and unpaired surrogates (error 22P05). */
const UNSTORABLE_TEXT = /\0|\p{Surrogate}/u;

/**
 * Walks the whole document — extras included — for values that would either
 * make the insert throw (NUL, lone surrogate) or come back changed (a number
 * `JSON.parse` turned into ±Infinity is written as `null`). Returns the first
 * offending path, or null.
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
	if (typeof v.id !== 'string' || v.id.length === 0 || v.id.length > MAX_ID_LENGTH) {
		return `${label}.id must be a string of 1–${MAX_ID_LENGTH} characters`;
	}
	if (typeof v.speciesId !== 'string' || !SPECIES_IDS.has(v.speciesId)) {
		return `${label}.speciesId must name a known species`;
	}
	if (
		v.nickname !== undefined &&
		(typeof v.nickname !== 'string' ||
			v.nickname.length === 0 ||
			v.nickname.length > MAX_NICKNAME_LENGTH)
	) {
		return `${label}.nickname must be a string of 1–${MAX_NICKNAME_LENGTH} characters`;
	}
	if (!Number.isSafeInteger(v.hp) || (v.hp as number) < 0) {
		return `${label}.hp must be a whole number of 0 or more`;
	}
	return null;
}

/**
 * Checks an untrusted JSON value against the v1 envelope. On success the
 * returned value is the input object itself (extra fields preserved).
 */
export function validateSave(input: unknown): SaveValidation {
	if (!isRecord(input)) return fail('save must be a JSON object');
	const unstorable = findUnstorable(input, '');
	if (unstorable) return fail(unstorable);
	if (input.version !== SAVE_VERSION) return fail(`version must be ${SAVE_VERSION}`);
	if (!Number.isSafeInteger(input.seed)) return fail('seed must be a whole number');
	const pos = input.pos;
	if (!isRecord(pos) || !Number.isSafeInteger(pos.x) || !Number.isSafeInteger(pos.y)) {
		return fail('pos must be an object with whole-number x and y');
	}
	const party = input.party;
	if (!Array.isArray(party)) return fail('party must be a list');
	if (party.length > MAX_PARTY) return fail(`party must have at most ${MAX_PARTY} animals`);
	const ids = new Set<string>();
	for (let i = 0; i < party.length; i++) {
		const error = validateAnimal(party[i], `party[${i}]`);
		if (error) return fail(error);
		const id = (party[i] as AnimalInstance).id;
		if (ids.has(id)) return fail(`party[${i}].id repeats an earlier id`);
		ids.add(id);
	}
	return { ok: true, value: input as unknown as SaveV1 };
}
