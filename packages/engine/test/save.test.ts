import { describe, expect, it } from 'vitest';
import { ANIMALS, canFightIn, getAnimal } from '../src/animals/catalog.js';
import { REALMS, type AnimalInstance } from '../src/animals/types.js';
import { applyBattleIntent, startBattle } from '../src/battle/reducer.js';
import type { BattleState } from '../src/battle/types.js';
import { needsDoctor } from '../src/doctor/party.js';
import { MAX_NAME_LENGTH } from '../src/names.js';
import { bundled, isBundled } from '../src/party/bundles.js';
import { leadIndex } from '../src/party/reducer.js';
import { Rng, hashInts } from '../src/rng.js';
import { landSeed } from '../src/lands/ids.js';
import { getLand } from '../src/lands/lands.js';
import {
	MAX_SAVED_NAME_LENGTH,
	MAX_SAVED_NICKNAME_LENGTH,
	MAX_SAVE_DEPTH,
	SAVE_UPGRADES,
	SAVE_VERSION,
	STARTER_SPECIES,
	V1_KEPT,
	V2_KEPT,
	V3_KEPT,
	canReplace,
	defaultStarter,
	isContentId,
	isNewerSave,
	newGame,
	readBattle,
	readSave,
	replacesAnotherGame,
	restoreGame,
	sameProgress,
	saveDocument,
	saveExtras,
	saveLineage,
	saveSeq,
	saveVersion,
	upgradeSave,
	validateSave,
	validateSaveWrite,
	type SaveV4,
	type SavedGame
} from '../src/save.js';
import { ITEM_IDS, gearOf } from '../src/items/catalog.js';
import { ALL_PUZZLE_KINDS } from '../src/puzzles/types.js';
import { EDITS_BUDGET, WorldEdits } from '../src/world/edits.js';
import { tileAtWorld } from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import { nearestTent } from '../src/world/tents.js';
import { isPassable, isWalkable, isWater, tileRealm, type Direction } from '../src/world/types.js';
import {
	FIRST_WORLD,
	MAX_WORLDS_KEPT,
	WORLD_ONE_SEED,
	worldSeed,
	type WorldStay
} from '../src/world/worlds.js';
import { makeParty, makeWild, playBattle } from './battle-sim.js';
import { mint, mints, testStarter } from './minted.js';

/**
 * The save document: what a save may hold (the validator both the client and
 * the server use), how an old or broken one is read (the v1 → v2 upgrade
 * among them), how a loaded game is made playable, how a saved battle is
 * picked up again, and the rules that decide which of two saves wins.
 */

/** World 1, where every game was played before worlds had numbers. */
const SEED = worldSeed(FIRST_WORLD);
/** Another world, for saves that are not in World 1. */
const WORLD = 7;
const SEED7 = worldSeed(WORLD);
const SEEDS = 25;

function animal(i: number, overrides: Record<string, unknown> = {}) {
	return { id: `a${i}`, speciesId: 'squirrel', hp: 10 + i, ...overrides };
}

/**
 * Ids none of this build's catalogs has, standing for what a later build
 * added: a save that names one was written by that later build.
 */
const LATER = {
	species: 'later-species',
	realm: 'later-realm',
	kind: 'later-kind'
};

/** The five fields every v4 save has (and every v2 and v3 save had, version aside). */
const v4 = {
	version: 4,
	home: WORLD,
	world: WORLD,
	pos: { x: -7, y: 3 },
	party: [animal(1, { nickname: 'Nutkin' }), animal(2, { speciesId: 'fox' })]
};

/** A document ready to write. */
const written = { ...v4, facing: 'left', steps: 12, visits: 2, lineage: 'game-a', seq: 3 };

/** A save from before numbered worlds: the four fields every v1 save has had. */
const v1 = {
	version: 1,
	seed: WORLD_ONE_SEED,
	pos: { x: -7, y: 3 },
	party: [animal(1, { nickname: 'Nutkin' }), animal(2, { speciesId: 'fox' })]
};

/** A v1 document an older build wrote. */
const writtenV1 = { ...v1, facing: 'left', steps: 12, visits: 2, lineage: 'game-a', seq: 3 };

function error(input: unknown): string {
	const checked = validateSave(input);
	return checked.ok ? '' : checked.error;
}

/** `levels` lists, each the only thing in the one around it: `[[[]]]` is 3. */
function lists(levels: number): unknown {
	let v: unknown = [];
	for (let i = 1; i < levels; i++) v = [v];
	return v;
}

/** `levels` objects, each under the key "0" of the one around it, as JSON reads `{"0":{"0":{}}}`. */
function objects(levels: number): unknown {
	let v: unknown = {};
	for (let i = 1; i < levels; i++) v = { 0: v };
	return v;
}

/** How deep a value nests: a list or an object is 1 more than the deepest thing in it. */
function depthOf(v: unknown): number {
	if (typeof v !== 'object' || v === null) return 0;
	return 1 + Math.max(0, ...Object.values(v).map(depthOf));
}

describe('validateSave', () => {
	it('accepts a v4 save with only the fields it needs, and one the client writes', () => {
		expect(validateSave(v4)).toEqual({ ok: true, value: v4 });
		expect(validateSave(written)).toEqual({ ok: true, value: written });
	});

	it('keeps fields it does not know, at the top level and on an animal', () => {
		const extra = { ...written, inventory: { leashes: 3 }, party: [animal(1, { mood: 'happy' })] };
		const checked = validateSave(extra);
		expect(checked.ok && checked.value).toBe(extra);
	});

	it('refuses a document that is not an object or has the wrong version', () => {
		expect(error([1, 2, 3])).toMatch(/object/);
		expect(error('a string')).toMatch(/object/);
		expect(error(null)).toMatch(/object/);
		// A v1 document is read through the upgrade (`readSave`), never as it is.
		expect(error({ ...v4, version: 1 })).toMatch(/version/);
		expect(error({ ...v4, version: 2 })).toMatch(/version/);
		expect(error({ ...v4, version: 3 })).toMatch(/version/);
		expect(error({ ...v4, version: 5 })).toMatch(/version/);
		expect(error({ ...v4, version: '3' })).toMatch(/version/);
	});

	it('refuses a missing or wrong world or home, and a bad position', () => {
		for (const key of ['home', 'world'] as const) {
			const { [key]: _gone, ...without } = v4;
			expect(error(without), key).toMatch(new RegExp(key));
			for (const bad of [0, 10_000, -1, 1.5, '7', null]) {
				expect(error({ ...v4, [key]: bad }), `${key} ${String(bad)}`).toMatch(new RegExp(key));
			}
		}
		expect(error({ ...v4, world: 1, home: 9999 })).toBe('');
		expect(error({ ...v4, pos: { x: '1', y: 2 } })).toMatch(/pos/);
		expect(error({ ...v4, pos: [1, 2] })).toMatch(/pos/);
		expect(error({ ...v4, pos: { x: 1 } })).toMatch(/pos/);
	});

	it('takes a name as text of a sane length, and never needs one', () => {
		expect(error({ ...v4, name: 'Nini' })).toBe('');
		// Whether it is a name is `checkName`'s to say, on load: a save is never unreadable over one.
		expect(error({ ...v4, name: 'x'.repeat(MAX_SAVED_NAME_LENGTH) })).toBe('');
		for (const name of ['', 'x'.repeat(MAX_SAVED_NAME_LENGTH + 1), 7, null, ['Nini']]) {
			expect(error({ ...v4, name }), JSON.stringify(name)).toMatch(/name/);
		}
	});

	it('takes a party of any size, with no cap, and refuses one that is not a list', () => {
		const many = Array.from({ length: 1000 }, (_, i) => animal(i));
		expect(error({ ...v4, party: many })).toBe('');
		expect(error({ ...v4, party: [] })).toBe('');
		expect(error({ ...v4, party: { a: 1 } })).toMatch(/party/);
	});

	it('refuses an animal with an unknown species, bad hp, a bad id or nickname, or a repeated id', () => {
		expect(error({ ...v4, party: [animal(1, { speciesId: 'dragon' })] })).toMatch(/species/);
		expect(error({ ...v4, party: [animal(1, { hp: -1 })] })).toMatch(/hp/);
		expect(error({ ...v4, party: [animal(1, { hp: 2.5 })] })).toMatch(/hp/);
		expect(error({ ...v4, party: [animal(1, { hp: '10' })] })).toMatch(/hp/);
		expect(error({ ...v4, party: [animal(1, { id: '' })] })).toMatch(/id/);
		expect(error({ ...v4, party: [animal(1, { id: 'x'.repeat(65) })] })).toMatch(/id/);
		expect(error({ ...v4, party: [animal(1, { nickname: 7 })] })).toMatch(/nickname/);
		expect(error({ ...v4, party: [animal(1, { nickname: null })] })).toMatch(/nickname/);
		const long = 'n'.repeat(MAX_SAVED_NICKNAME_LENGTH + 1);
		expect(error({ ...v4, party: [animal(1, { nickname: long })] })).toMatch(/nickname/);
		expect(error({ ...v4, party: [animal(1), animal(1)] })).toMatch(/id/);
	});

	it('checks the later fields when they are present', () => {
		expect(error({ ...written, facing: 'north' })).toMatch(/facing/);
		expect(error({ ...written, steps: -1 })).toMatch(/steps/);
		expect(error({ ...written, steps: 1.5 })).toMatch(/steps/);
		expect(error({ ...written, visits: -2 })).toMatch(/visits/);
		expect(error({ ...written, seq: '3' })).toMatch(/seq/);
		expect(error({ ...written, lineage: '' })).toMatch(/lineage/);
		expect(error({ ...written, lineage: 7 })).toMatch(/lineage/);
		for (const tokens of [-1, 2.5, '8', null, Infinity]) {
			expect(error({ ...written, tokens }), String(tokens)).toMatch(/tokens/);
		}
		for (const solved of [-1, 2.5, '312', null, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			expect(error({ ...written, solved }), String(solved)).toMatch(/solved/);
		}
		for (const items of ['axe', [7], [''], ['x'.repeat(65)], [null], { axe: true }]) {
			expect(error({ ...written, items }), JSON.stringify(items)).toMatch(/items/);
		}
		// The animal book: lists of ids shaped as species ids are (a species this build lacks is
		// a newer build's, not a broken save: below).
		for (const key of ['seen', 'caught', 'freed']) {
			for (const list of ['fox', [7], [''], ['Fox'], ['wood mouse'], [null], { fox: true }, null]) {
				const at = `${key}: ${JSON.stringify(list)}`;
				expect(error({ ...written, [key]: list }), at).toMatch(new RegExp(`^${key} `));
			}
		}
		expect(error({ ...written, seen: [], caught: [], freed: [] })).toBe('');
		// A species listed twice is no harm: it is in the book once.
		expect(error({ ...written, seen: ['fox', 'fox'], caught: ['fox', 'fox'] })).toBe('');
	});

	it('checks the worlds left behind: each a world once, where the player stood and faced, and what they cleared', () => {
		const stay = { world: 3, pos: { x: 4, y: -5 }, facing: 'up' };
		expect(error({ ...written, worlds: [] })).toBe('');
		expect(error({ ...written, worlds: [stay, { ...stay, world: 4, edits: ['0,0:11'] }] })).toBe(
			''
		);
		for (const worlds of [
			'3',
			{ 3: stay },
			[null],
			[{ ...stay, world: 0 }],
			[{ ...stay, world: 2.5 }],
			[{ ...stay, pos: { x: 1 } }],
			[{ ...stay, facing: 'north' }],
			[{ ...stay, edits: ['0,0:1'] }],
			[stay, { ...stay, pos: { x: 0, y: 0 } }]
		]) {
			expect(error({ ...written, worlds }), JSON.stringify(worlds)).toMatch(/worlds/);
		}
	});

	it('takes tokens, items and the puzzles solved, an item it does not know included, and needs none of them', () => {
		expect(error({ ...written, tokens: 0, items: [], solved: 0 })).toBe('');
		expect(error({ ...written, tokens: 40, items: ['axe', 'boat'], solved: 312 })).toBe('');
		expect(error({ ...written, solved: Number.MAX_SAFE_INTEGER })).toBe('');
		// An item a later build sells: kept as it is, never a reason to set the save aside,
		// nor to call it a newer build's.
		expect(error({ ...written, items: ['lantern'] })).toBe('');
		expect(readSave({ ...written, items: ['axe', 'lantern'] })).toMatchObject({ ok: true });
		expect(validateSaveWrite(written).ok).toBe(true);
	});

	it('does not look inside a battle, but a battle must still be storable', () => {
		expect(error({ ...written, battle: 'anything' })).toBe('');
		expect(error({ ...written, battle: { log: ['a\u0000b'] } })).toMatch(/battle/);
	});

	it('refuses what the server could not store as sent: NUL, lone surrogates, infinities', () => {
		expect(error({ ...v4, party: [animal(1, { nickname: 'a\u0000b' })] })).toMatch(/nickname/);
		expect(error({ ...v4, party: [animal(1, { id: 'a\ud800' })] })).toMatch(/id/);
		expect(error({ ...v4, note: '\udc00' })).toMatch(/note/);
		expect(error({ ...v4, ['a\u0000b']: 1 })).toMatch(/key/);
		expect(error({ ...v4, big: Infinity })).toMatch(/big/);
		expect(error({ ...v4, party: [animal(1, { x: -Infinity })] })).toMatch(/x/);
		expect(error({ ...v4, name: 'Ni\u0000ni' })).toMatch(/name/);
		// A surrogate pair (an emoji) is fine.
		expect(error({ ...v4, party: [animal(1, { nickname: 'Nut 🐿️' })] })).toBe('');
	});
});

describe('how deep a save nests', () => {
	it(`takes a document ${MAX_SAVE_DEPTH} deep and refuses one deeper, wherever the nesting is`, () => {
		// Each place holds what it is given `above` deep into the document: an extra field and a
		// battle a level in, an extra field on an animal three (the document, the party, the animal).
		const places: [number, string, (inner: unknown) => unknown][] = [
			[1, 'deep', (inner) => ({ ...written, deep: inner })],
			[3, 'party[0].deep', (inner) => ({ ...written, party: [animal(1, { deep: inner })] })],
			[1, 'battle', (inner) => ({ ...written, battle: inner })]
		];
		for (const [above, path, place] of places) {
			for (const nest of [lists, objects]) {
				const levels = MAX_SAVE_DEPTH - above;
				expect(depthOf(place(nest(levels)))).toBe(MAX_SAVE_DEPTH);
				expect(error(place(nest(levels))), path).toBe('');
				expect(depthOf(place(nest(levels + 1)))).toBe(MAX_SAVE_DEPTH + 1);
				const refused = error(place(nest(levels + 1)));
				expect(refused.startsWith(path), refused).toBe(true);
				expect(refused).toMatch(/^\S+ is nested more than 64 levels deep$/);
			}
		}
	});

	it('reads a document nested hundreds of thousands deep as broken, and never throws', () => {
		// What a body within the server's 1 MiB can hold: a list is 2 bytes a level, an object 6.
		const levels = 400_000;
		const texts = [
			'['.repeat(levels) + ']'.repeat(levels),
			'{"0":'.repeat(levels / 4) + '{}' + '}'.repeat(levels / 4)
		];
		for (const text of texts) {
			// As the server gets it, and as the browser keeps it: JSON text, parsed.
			for (const base of [written, writtenV1]) {
				const doc: unknown = JSON.parse(`${JSON.stringify(base).slice(0, -1)},"deep":${text}}`);
				const read = readSave(doc);
				expect(read).toMatchObject({ ok: false, reason: 'invalid' });
				expect(read.ok ? '' : read.error).toMatch(/^deep\S* is nested more than 64 levels deep$/);
				expect(validateSaveWrite(doc)).toMatchObject({ ok: false, reason: 'invalid' });
				expect(validateSave(doc).ok).toBe(false);
				expect(isNewerSave(doc)).toBe(false);
				// Stored on the server, it is a save no build can read: replaced, and kept aside.
				expect(canReplace(doc, { seq: 4 })).toBe(true);
				expect(replacesAnotherGame(doc, { lineage: 'game-a' })).toBe(true);
			}
		}
		// 0.8 s alone at a load average of 10 and 3.3 s in the whole suite at 30, which scales to 17 s
		// at 150.
	}, 60_000);

	it('reads a later version as newer however deep it nests: a build that saves deeper bumps it', () => {
		// The version is read before anything walks the document, so the way a later build
		// saves deeper than this one allows is never mistaken for a broken save.
		const later = { ...written, version: SAVE_VERSION + 1, deep: lists(100_000) };
		expect(readSave(later)).toMatchObject({ ok: false, reason: 'newer' });
		expect(validateSaveWrite(later)).toMatchObject({ ok: false, reason: 'newer' });
		expect(isNewerSave(later)).toBe(true);
		expect(canReplace(later, { seq: 99 })).toBe(false);
	});

	it(`a game's save nests 6 deep at most, well inside ${MAX_SAVE_DEPTH}`, () => {
		// The deepest things a game saves: a battle's party and its puzzle (mid-puzzle among the
		// states below), a world left behind, where the player stood and what they cleared, and
		// the same in a land left behind (#191), two levels further down.
		let deepest = 0;
		let solving = 0;
		for (let seed = 1; seed <= SEEDS; seed++) {
			for (const { state } of battleStates(seed, ['squirrel', 'fox'], 'rabbit')) {
				if (state.phase.kind === 'solving') solving++;
				const game: SavedGame = {
					...newGame(WORLD, testStarter(), 'Nini'),
					party: state.party.map((a) => ({ ...a })),
					battle: state,
					edits: ['0,0:0a91'],
					worlds: [{ world: 3, pos: { x: 1, y: -2 }, facing: 'up', edits: ['-1,0:0a91'] }],
					lands: [
						{
							land: 'arctic',
							party: [{ id: 'a1', speciesId: 'rabbit', hp: 4, nickname: 'Snow' }],
							tokens: 5,
							items: ['axe'],
							worlds: [{ world: 3, pos: { x: 1, y: -2 }, facing: 'up', edits: ['-1,0:0a91'] }]
						}
					],
					unlocked: ['nordland', 'arctic']
				};
				const doc = saveDocument(game, { lineage: 'game-a', seq: 1 }, { later: { kept: [1] } });
				expect(validateSaveWrite(doc).ok).toBe(true);
				deepest = Math.max(deepest, depthOf(doc));
			}
		}
		expect(solving).toBeGreaterThan(0);
		expect(deepest).toBe(6);
	});
});

describe('validateSaveWrite', () => {
	it('needs facing, steps, visits, lineage and a seq of at least 1', () => {
		expect(validateSaveWrite(written).ok).toBe(true);
		for (const key of ['facing', 'steps', 'visits', 'lineage', 'seq']) {
			const partial: Record<string, unknown> = { ...written };
			delete partial[key];
			const checked = validateSaveWrite(partial);
			expect(checked.ok ? '' : checked.error).toMatch(new RegExp(key));
		}
		const zero = validateSaveWrite({ ...written, seq: 0 });
		expect(zero.ok ? '' : zero.error).toMatch(/seq/);
		expect(validateSaveWrite(v4).ok).toBe(false);
	});

	it("takes an older build's backup, upgraded: a page still open from before an update keeps backing up", () => {
		const checked = validateSaveWrite(JSON.parse(JSON.stringify(writtenV1)));
		expect(checked.ok).toBe(true);
		if (!checked.ok) return;
		const { seed: _seed, ...rest } = writtenV1;
		expect(checked.value).toEqual({
			...rest,
			version: SAVE_VERSION,
			world: 1,
			home: 1,
			land: 'nordland'
		});
		// Not a document the server can't read, nor a later version's.
		expect(validateSaveWrite({ ...writtenV1, seed: 'x' }).ok).toBe(false);
		const newer = validateSaveWrite({ ...written, version: SAVE_VERSION + 1 });
		expect(newer.ok ? '' : newer.error).toMatch(/version/);
		// A current document comes back as itself.
		const current = validateSaveWrite(written);
		expect(current.ok && current.value).toBe(written);
	});
});

describe('readSave and the upgrade seam', () => {
	it('reads the current version, and a v1 document through the upgrade, into World 1', () => {
		expect(readSave(written)).toEqual({ ok: true, save: written });
		const { seed: _seed, ...rest } = v1;
		expect(readSave(v1)).toEqual({
			ok: true,
			save: { ...rest, version: SAVE_VERSION, world: 1, home: 1, land: 'nordland' }
		});
	});

	it('calls a later version newer, and anything else it cannot read invalid', () => {
		expect(readSave({ ...written, version: SAVE_VERSION + 1 })).toMatchObject({
			ok: false,
			reason: 'newer'
		});
		for (const bad of [
			null,
			[],
			'text',
			{ ...written, version: 0 },
			{ ...written, version: '2' },
			{ ...written, version: 1.5 },
			// A species no build could have written is a broken animal, not a newer build's:
			// none, not text, too long, or not shaped as a catalog id.
			{ ...written, party: [animal(1, { speciesId: '' })] },
			{ ...written, party: [animal(1, { speciesId: 7 })] },
			{ ...written, party: [animal(1, { speciesId: 'x'.repeat(65) })] },
			{ ...written, party: [animal(1, { speciesId: 'Fox' })] },
			{ ...written, party: [animal(1, { speciesId: 'wood mouse' })] },
			{ ...written, party: [animal(1, { speciesId: 'wood--mouse' })] },
			// A shape no build writes stays broken, whatever else the document names.
			{ ...written, party: [animal(1, { speciesId: LATER.species, hp: -1 })] },
			{ ...written, party: [animal(1, { speciesId: LATER.species })], items: [''] },
			// A v1 document was unreadable without a whole-number seed, and stays so.
			{ ...v1, seed: 1.5 },
			{ ...v1, seed: undefined },
			{ ...v1, pos: { x: 1 } }
		]) {
			expect(readSave(bad), JSON.stringify(bad)).toMatchObject({ ok: false, reason: 'invalid' });
		}
	});

	it('calls a save that names a species, or a battle realm or puzzle kind, it does not have newer, never invalid', () => {
		const { state } = battleStates(3, ['squirrel', 'fox'], 'rabbit')[0]!;
		const battle = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
		const inBattle = (patch: Record<string, unknown>) => ({
			...written,
			party: state!.party,
			battle: { ...battle, ...patch }
		});
		const solving = {
			kind: 'solving',
			attackIndex: 1,
			level: 1,
			puzzle: { kind: LATER.kind, prompt: '½ + ½ = ?', answer: 1, difficulty: 1 }
		};
		expect(readSave(inBattle({}))).toMatchObject({ ok: true });
		for (const later of [
			{ ...written, party: [animal(1), animal(2, { speciesId: LATER.species })] },
			{ ...writtenV1, party: [animal(1, { speciesId: LATER.species })] },
			// The animal book: a species a later build met or caught, helped home since or not.
			{ ...written, seen: ['squirrel', 'fox', LATER.species], caught: ['squirrel', 'fox'] },
			{ ...written, seen: ['squirrel', 'fox'], caught: ['squirrel', LATER.species] },
			{ ...written, seen: ['squirrel', 'fox'], caught: ['squirrel'], freed: [LATER.species] },
			inBattle({ realm: LATER.realm }),
			inBattle({ opponent: { ...state!.opponent, speciesId: LATER.species } }),
			inBattle({ party: [{ ...state!.party[0]!, speciesId: LATER.species }] }),
			inBattle({ phase: solving })
		]) {
			const read = readSave(JSON.parse(JSON.stringify(later)));
			expect(read, JSON.stringify(later)).toMatchObject({ ok: false, reason: 'newer' });
			// The same answer wherever a save is checked: a write of it is refused as newer too.
			const write = validateSaveWrite(JSON.parse(JSON.stringify(later)));
			expect(write).toMatchObject({ ok: false, reason: 'newer' });
		}
		// Anything in a battle that no catalog would name is the battle's own problem: it is
		// dropped on load (`readBattle`), as before, and the save reads.
		for (const odd of [
			{ realm: 7 },
			{ realm: '' },
			{ realm: 'Air' },
			{ opponent: { speciesId: null } },
			{ opponent: { ...state!.opponent, speciesId: 'Fox' } }
		]) {
			expect(readSave(inBattle(odd)), JSON.stringify(odd)).toMatchObject({ ok: true });
		}
	});

	it('reads any save with one of its species, or its battle realm or puzzle kind, swapped for one it does not have as newer', () => {
		// Real saves of every shape (the v1 → v2 upgrade's generator, and real battles), each
		// with one species, realm or puzzle kind a later build could have added.
		let swapped = 0;
		for (let s = 0; s < 300; s++) {
			const rng = new Rng(hashInts(37, s));
			const read = readSave(JSON.parse(JSON.stringify(randomV1(rng, WORLD_ONE_SEED))));
			if (!read.ok) throw new Error(`save ${s} should read: ${read.error}`);
			const doc = JSON.parse(JSON.stringify(read.save)) as Record<string, unknown>;
			const places: (() => void)[] = [];
			if (s % 3 === 0) {
				// Mid-battle: the party is the battle's, as a save of a battle in progress holds it.
				const states = battleStates(s + 1, ['squirrel', 'fox'], 'rabbit');
				const { state } = states[rng.int(0, states.length - 1)]!;
				const battle = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
				doc.party = JSON.parse(JSON.stringify(battle.party));
				doc.battle = battle;
				const opponent = battle.opponent as Record<string, unknown>;
				places.push(() => (battle.realm = LATER.realm));
				places.push(() => (opponent.speciesId = LATER.species));
				(battle.party as Record<string, unknown>[]).forEach((a) =>
					places.push(() => (a.speciesId = LATER.species))
				);
				const phase = battle.phase as Record<string, unknown>;
				if (phase.kind === 'solving') {
					places.push(() => ((phase.puzzle as Record<string, unknown>).kind = LATER.kind));
				}
			}
			(doc.party as Record<string, unknown>[]).forEach((a) =>
				places.push(() => (a.speciesId = LATER.species))
			);
			if (s % 2 === 0) {
				// The animal book, as this build writes it: the party's species caught, and some met.
				const met = Array.from({ length: rng.int(0, 8) }, () => rng.pick(ANIMALS).id);
				const caught = [...(doc.party as { speciesId: string }[]).map((a) => a.speciesId)];
				const seen = [...caught, ...met];
				// Some of what was met set free since.
				const freed = met.slice(0, rng.int(0, met.length));
				doc.seen = seen;
				doc.caught = caught;
				doc.freed = freed;
				seen.forEach((_, i) => places.push(() => (seen[i] = LATER.species)));
				caught.forEach((_, i) => places.push(() => (caught[i] = LATER.species)));
				freed.forEach((_, i) => places.push(() => (freed[i] = LATER.species)));
			}
			expect(readSave(doc), `${s}`).toMatchObject({ ok: true });
			if (places.length === 0) continue;
			rng.pick(places)();
			expect(readSave(doc), `${s}: ${JSON.stringify(doc)}`).toMatchObject({
				ok: false,
				reason: 'newer'
			});
			swapped++;
		}
		expect(swapped).toBeGreaterThan(200);
		// About 1 s alone (a hundred real battles played for their states, 300 saves read twice).
	}, 30_000);

	it('has an upgrade from every version before the current one', () => {
		for (let v = 1; v < SAVE_VERSION; v++) expect(SAVE_UPGRADES[v]).toBeTypeOf('function');
	});

	it('stands for later content with ids no catalog of this build has, shaped as every catalog id is', () => {
		expect(ANIMALS.map((a) => a.id)).not.toContain(LATER.species);
		expect(REALMS).not.toContain(LATER.realm);
		expect(ALL_PUZZLE_KINDS).not.toContain(LATER.kind);
		// Every id a catalog has is shaped so: an id of another shape in a save is broken, not newer.
		for (const id of [
			...Object.values(LATER),
			...ANIMALS.flatMap((a) => [a.id, ...a.attacks.map((k) => k.id)]),
			...ITEM_IDS,
			...REALMS,
			...ALL_PUZZLE_KINDS
		]) {
			expect(isContentId(id), id).toBe(true);
		}
		for (const odd of ['', 'Fox', 'wood mouse', 'wood--mouse', '-fox', 'fox-', 'æble', 7, null]) {
			expect(isContentId(odd), JSON.stringify(odd)).toBe(false);
		}
	});

	it('still reads a party of any species that has shipped: one leaves the catalog only through an upgrade', () => {
		// Every species a kid may have caught and saved, by id. A save naming a
		// species the catalog no longer has reads as a newer build's, and no build
		// would ever load it again, so removing one takes a version bump and an
		// upgrade that turns it into a species still in the catalog. Adding one:
		// add it here.
		const shipped = [
			'squirrel',
			'rabbit',
			'frog',
			'fox',
			'otter',
			'deer',
			'wolf',
			'bear',
			// #89 wave 1.
			'shrew',
			'wood-mouse',
			'brown-rat',
			'hedgehog',
			'mole',
			'common-lizard',
			'common-toad',
			'robin',
			'stag-beetle',
			'roe-deer',
			'badger',
			'pine-marten',
			'stoat',
			'adder',
			'grey-heron',
			'tawny-owl',
			'raccoon',
			'beaver',
			// #89 wave 2.
			'wild-boar',
			'mute-swan',
			'eagle-owl',
			'lynx',
			'wolverine',
			'golden-eagle',
			'white-tailed-eagle',
			'moose',
			'european-bison',
			'crab',
			'starfish',
			'turtle',
			'dolphin',
			'octopus',
			'whale',
			// #91's birds in the air.
			'buzzard',
			// #89 wave 3.
			'moon-jellyfish',
			'plaice',
			'lions-mane-jellyfish',
			'lobster',
			'harbour-seal',
			'harbour-porpoise',
			'grey-seal',
			'orca',
			// #192 wave 1: The Arctic's small land animals.
			'arctic-fox',
			'arctic-hare',
			'puffin',
			'arctic-lemming',
			'snow-bunting',
			'rock-ptarmigan',
			'waxwing',
			'adelie-penguin',
			'snow-petrel',
			'arctic-tern',
			'king-eider',
			'raven',
			'barnacle-goose',
			'gentoo-penguin',
			'chinstrap',
			// #192 wave 3: The Arctic's sea and fishing-hole animals.,
			'sea-angel',
			'polar-cod',
			'antarctic-krill',
			'arctic-char',
			'lumpsucker',
			'ringed-seal',
			'icefish',
			'harp-seal',
			'wolffish',
			'snow-crab',
			'weddell-seal',
			'beluga',
			'hooded-seal',
			'minke-whale',
			'toothfish',
			'crabeater-seal',
			'walrus',
			'bowhead-whale',
			'greenland-shark',
			'narwhal',
			'elephant-seal',
			'blue-whale',
			'leopard-seal'
		];
		expect(ANIMALS.map((a) => a.id).filter((id) => !shipped.includes(id))).toEqual([]);
		for (const speciesId of shipped) {
			for (const doc of [written, writtenV1]) {
				const save = { ...doc, party: [animal(1, { speciesId, hp: 1 })] };
				expect(readSave(save), speciesId).toMatchObject({ ok: true });
			}
		}
	});

	it('chains upgrades from any older version, and refuses a gap', () => {
		const upgrades = {
			1: (d: Record<string, unknown>) => ({ ...d, version: 2, a: true }),
			2: (d: Record<string, unknown>) => ({ ...d, version: 3, b: true })
		};
		expect(upgradeSave({ version: 1 }, upgrades, 3)).toEqual({
			ok: true,
			doc: { version: 3, a: true, b: true }
		});
		expect(upgradeSave({ version: 2 }, upgrades, 3)).toEqual({
			ok: true,
			doc: { version: 3, b: true }
		});
		expect(upgradeSave({ version: 3 }, upgrades, 3)).toEqual({ ok: true, doc: { version: 3 } });
		expect(upgradeSave({ version: 4 }, upgrades, 3)).toMatchObject({ ok: false, reason: 'newer' });
		expect(upgradeSave({ version: 1 }, { 2: upgrades[2] }, 3)).toMatchObject({
			ok: false,
			reason: 'invalid'
		});
	});
});

/** What a v1 save could hold beside its four fields, as the builds before numbered worlds wrote it. */
function randomV1(rng: Rng, seed: unknown): Record<string, unknown> {
	const party = Array.from({ length: rng.int(0, 12) }, (_, i) => {
		const spec = rng.pick(ANIMALS);
		const a: Record<string, unknown> = { id: `m${i}-${rng.int(0, 9999)}`, speciesId: spec.id };
		a.hp = rng.int(0, spec.maxHp + 3);
		if (rng.chance(0.3)) a.nickname = rng.pick(['Pip', 'nini', 'Mr Whiskers', 'Ørn', 'राम']);
		if (rng.chance(0.1)) a.mood = 'happy';
		return a;
	});
	const doc: Record<string, unknown> = {
		version: 1,
		seed,
		pos: { x: rng.int(-2000, 2000), y: rng.int(-2000, 2000) },
		party
	};
	if (rng.chance(0.8)) doc.facing = rng.pick(['up', 'down', 'left', 'right']);
	if (rng.chance(0.8)) doc.steps = rng.int(0, 20_000);
	if (rng.chance(0.8)) doc.visits = rng.int(0, 60);
	if (rng.chance(0.8)) doc.lineage = `lineage-${rng.int(0, 1e6)}`;
	if (rng.chance(0.8)) doc.seq = rng.int(1, 30_000);
	if (rng.chance(0.6)) doc.tokens = rng.int(0, 500);
	if (rng.chance(0.6)) doc.items = rng.pick([[], ['axe'], ['boat', 'axe'], ['lantern']]);
	if (rng.chance(0.3)) doc.battle = { step: rng.int(0, 5), anything: rng.int(0, 9) };
	if (rng.chance(0.5)) {
		let edits = WorldEdits.none;
		for (let i = rng.int(1, 40); i > 0; i--) {
			edits = edits.with({ x: rng.int(-600, 600), y: rng.int(-600, 600) });
		}
		doc.edits = [...edits.encode()];
	}
	// Extras a newer build could have left, some under the names v2 took.
	for (const key of [
		'inventory',
		'name',
		'home',
		'world',
		'worlds',
		'solved',
		'seen',
		'caught',
		'freed',
		'land',
		'lands',
		'unlocked',
		V1_KEPT,
		V2_KEPT,
		V3_KEPT
	]) {
		if (rng.chance(0.15)) doc[key] = rng.pick([7, 'Nini', { deep: [1, 2] }, [3], null]);
	}
	return doc;
}

/**
 * The v3 document a v4 one was upgraded from: the v3 → v4 upgrade's inverse,
 * a check that it drops nothing. `land` goes, and what v4 has no place for
 * comes back from `v3`.
 */
function downgradeToV3(doc: Record<string, unknown>): Record<string, unknown> {
	const { version: _version, land: _land, [V3_KEPT]: kept, ...rest } = doc;
	const out: Record<string, unknown> = { ...rest, version: 3 };
	for (const [key, value] of Object.entries((kept ?? {}) as Record<string, unknown>)) {
		out[key] = value;
	}
	return out;
}

/**
 * The v2 document a v4 one was upgraded from: the v2 → v3 upgrade's inverse
 * after v4's, a check that it drops nothing. `freed` goes, and what v3 has no
 * place for comes back from `v2`.
 */
function downgradeToV2(v4doc: Record<string, unknown>): Record<string, unknown> {
	const doc = downgradeToV3(v4doc);
	const { version: _version, freed: _freed, [V2_KEPT]: kept, ...rest } = doc;
	const out: Record<string, unknown> = { ...rest, version: 2 };
	for (const [key, value] of Object.entries((kept ?? {}) as Record<string, unknown>)) {
		out[key] = value;
	}
	return out;
}

/**
 * The v1 document a v3 one was upgraded from: the upgrades' inverse, a check
 * that they drop nothing. What v2 has no place for came back from `v1`.
 */
function downgrade(v3doc: Record<string, unknown>): Record<string, unknown> {
	const doc = downgradeToV2(v3doc);
	const { version: _version, world: _world, home: _home, [V1_KEPT]: kept, ...rest } = doc;
	const out: Record<string, unknown> = { ...rest, version: 1, seed: WORLD_ONE_SEED };
	for (const [key, value] of Object.entries((kept ?? {}) as Record<string, unknown>)) {
		out[key] = value;
	}
	return out;
}

describe('the v1 → v2 upgrade', () => {
	it('puts a v1 save in World 1, its home, with everything else exactly as it was', () => {
		const doc = {
			...writtenV1,
			tokens: 9,
			items: ['axe', 'boat'],
			edits: ['-5,-37:1f2a', '0,0:11'],
			battle: { step: 2 },
			inventory: { leashes: 3 }
		};
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const { seed: _seed, ...rest } = doc;
		expect(read.save).toEqual({
			...rest,
			version: SAVE_VERSION,
			world: 1,
			home: 1,
			land: 'nordland'
		});
		// Nothing to keep aside: no seed but World 1's, no extra under a name v2 took.
		expect(V1_KEPT in read.save).toBe(false);
	});

	it('keeps what v2 has no place for under `v1`, as it was: a seed not World 1, extras under the names v2 took', () => {
		const doc = {
			...writtenV1,
			seed: 12345,
			name: 7,
			world: 'there',
			// A name v2 took later: a v1 extra never becomes the kid's count of puzzles solved.
			solved: 'lots',
			[V1_KEPT]: { a: 1 }
		};
		const read = readSave(doc);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.save).toMatchObject({ world: 1, home: 1 });
		expect('name' in read.save).toBe(false);
		expect('solved' in read.save).toBe(false);
		expect((read.save as unknown as Record<string, unknown>)[V1_KEPT]).toEqual({
			seed: 12345,
			name: 7,
			world: 'there',
			solved: 'lots',
			[V1_KEPT]: { a: 1 }
		});
		expect(downgrade(read.save as unknown as Record<string, unknown>)).toEqual(doc);
	});

	it('keeps a v1 extra under `v1` for every name a save is written with that v1 did not have, later ones too', () => {
		// The fields of `SaveV1`: frozen with it.
		const v1Fields = new Set([
			'version',
			'seed',
			'pos',
			'party',
			'facing',
			'steps',
			'visits',
			'lineage',
			'seq',
			'tokens',
			'items',
			'battle',
			'edits'
		]);
		// Every field this build writes, the optional ones included: a name, a battle, cleared
		// tiles, a world left. A field a later change adds is in it without touching this test.
		const game: SavedGame = {
			...newGame(WORLD, testStarter(), 'Nini'),
			battle: { step: 0 } as unknown as BattleState,
			edits: ['0,0:11'],
			worlds: [{ world: 3, pos: { x: 0, y: 0 }, facing: 'up', edits: [] }],
			lands: [{ land: 'arctic', party: [], tokens: 0, items: [], worlds: [] }],
			unlocked: ['nordland', 'arctic']
		};
		const taken = Object.keys(saveDocument(game, { lineage: 'L', seq: 1 })).filter(
			(key) => !v1Fields.has(key)
		);
		expect(taken).toEqual(
			expect.arrayContaining([
				'name',
				'home',
				'world',
				'worlds',
				'solved',
				'land',
				'lands',
				'unlocked'
			])
		);
		const bad: string[] = [];
		for (const key of taken) {
			for (const junk of ['x', -1, 1.5, 12, { a: 1 }, [2], null]) {
				const read = readSave({ ...writtenV1, [key]: junk });
				// Under `v1` a name v2 took, under `v2` one v3 took (`freed`), under `v3` one v4 took.
				const keptBy =
					key === 'freed'
						? V2_KEPT
						: ['land', 'lands', 'unlocked'].includes(key)
							? V3_KEPT
							: V1_KEPT;
				const kept = read.ok
					? (read.save as unknown as Record<string, Record<string, unknown>>)[keptBy]
					: undefined;
				if (!read.ok || !kept || JSON.stringify(kept[key]) !== JSON.stringify(junk)) {
					bad.push(
						`${key}: ${JSON.stringify(junk)} → ${read.ok ? JSON.stringify(kept) : read.error}`
					);
				}
			}
		}
		expect(bad).toEqual([]);
	});

	it('is total and loses nothing: every valid v1 save upgrades to a valid v2 one it can be rebuilt from', () => {
		for (let s = 0; s < 500; s++) {
			const rng = new Rng(hashInts(21, s));
			const seed = rng.chance(0.7) ? WORLD_ONE_SEED : rng.int(-(2 ** 31), 2 ** 32);
			const doc = JSON.parse(JSON.stringify(randomV1(rng, seed))) as Record<string, unknown>;
			const before = JSON.stringify(doc);
			const read = readSave(doc);
			expect(read.ok, `${s}: ${JSON.stringify(read)}`).toBe(true);
			if (!read.ok) continue;
			// The document it was read from is untouched.
			expect(JSON.stringify(doc)).toBe(before);
			const up = read.save as unknown as Record<string, unknown>;
			expect(up).toMatchObject({ version: SAVE_VERSION, world: 1, home: 1, land: 'nordland' });
			// A v1 save has no book (`seen` and `caught` were only ever extras): nothing set free.
			expect('freed' in up).toBe(false);
			expect(downgrade(up)).toEqual(doc);
			// Whatever it held, it is a document a write may carry once it has a write's stamp.
			const stamp = { facing: 'down', steps: 0, visits: 0, lineage: 'L', seq: 1 };
			expect(validateSaveWrite({ ...stamp, ...up }).ok).toBe(true);
		}
		// About 0.25 s alone (500 random v1 saves, each read, rebuilt and checked as a write);
		// 3.4 s at a load average of 40.
		// 0.55 s alone at a load average of 10 and 2.5 s in the whole suite at 31 (2026-09-28), which
		// scales to 12 s at 150.
	}, 60_000);

	it('keeps party, tokens, items, position and cleared tiles: a v1 game plays on in World 1 as it was', () => {
		const pos = findTile(SEED, true);
		const cleared = clearableNearSpawn(SEED, 12);
		const edits = cleared.reduce((e, p) => e.with(p), WorldEdits.none);
		for (let s = 0; s < 200; s++) {
			const rng = new Rng(hashInts(23, s));
			const doc = randomV1(rng, WORLD_ONE_SEED);
			// Standing somewhere a kid could have stood: near spawn, on ground or a cleared tile.
			doc.pos = rng.chance(0.5) ? pos : cleared[0]!;
			doc.edits = [...edits.encode()];
			const read = readSave(JSON.parse(JSON.stringify(doc)));
			expect(read.ok).toBe(true);
			if (!read.ok) continue;
			const game = restoreGame(read.save, mint);
			expect(game.world).toBe(1);
			expect(game.home).toBe(1);
			expect(game.name).toBeNull();
			expect(game.worlds).toEqual([]);
			expect(game.pos).toEqual(doc.pos);
			expect(game.facing).toBe(doc.facing ?? 'down');
			expect(game.steps).toBe(doc.steps ?? 0);
			expect(game.visits).toBe(doc.visits ?? 0);
			expect(game.tokens).toBe(doc.tokens ?? 0);
			expect(game.items).toEqual([...new Set((doc.items as string[] | undefined) ?? [])]);
			expect(game.edits).toEqual(edits.encode());
			const party = doc.party as AnimalInstance[];
			if (party.some((a) => canFightIn(a.speciesId, 'land'))) {
				expect(new Set(game.party.map((a) => a.id))).toEqual(new Set(party.map((a) => a.id)));
			}
		}
	});
});

/** The nearest water of a depth to World 1's spawn. */
function waterNearSpawn(kind: 'water' | 'deepwater'): { x: number; y: number } {
	return findKind(SEED, kind);
}

/** A tile of this kind near spawn, found by scanning outward. */
function findKind(seed: number, kind: string): { x: number; y: number } {
	const spawn = spawnPoint(seed);
	for (let r = 1; r < 200; r++)
		for (let dx = -r; dx <= r; dx++)
			for (const dy of [-r, r])
				if (tileAtWorld(seed, spawn.x + dx, spawn.y + dy).kind === kind)
					return { x: spawn.x + dx, y: spawn.y + dy };
	throw new Error(`no ${kind} near spawn`);
}

/** A tile of `kind`-ness near spawn, found by scanning outward. */
function findTile(seed: number, walkable: boolean): { x: number; y: number } {
	const spawn = spawnPoint(seed);
	for (let r = 1; r < 200; r++) {
		for (let dx = -r; dx <= r; dx++) {
			for (const dy of [-r, r]) {
				const x = spawn.x + dx;
				const y = spawn.y + dy;
				if (isWalkable(tileAtWorld(seed, x, y).kind) === walkable) return { x, y };
			}
		}
	}
	throw new Error('no such tile');
}

describe('newGame and restoreGame', () => {
	it('a new game starts in its home world, on the spawn tile, facing down, with one full-HP starter, and nothing else', () => {
		const game = newGame(WORLD, testStarter());
		expect(game).toEqual({
			name: null,
			home: WORLD,
			world: WORLD,
			pos: spawnPoint(SEED7),
			facing: 'down',
			steps: 0,
			visits: 0,
			party: [{ id: 'starter', speciesId: STARTER_SPECIES, hp: getAnimal(STARTER_SPECIES).maxHp }],
			tokens: 0,
			items: [],
			solved: 0,
			// The animal book holds the starter alone: a starter counts as caught.
			seen: [STARTER_SPECIES],
			caught: [STARTER_SPECIES],
			freed: [],
			battle: null,
			edits: [],
			worlds: [],
			land: 'nordland',
			lands: [],
			unlocked: ['nordland']
		});
		expect(newGame(1, testStarter(), 'Nini').name).toBe('Nini');
		expect(newGame(1, testStarter()).pos).toEqual({ x: -2, y: 6 });
	});

	it('a save with only the fields it needs gets facing down, no steps, tokens, items, puzzles solved, name, nothing cleared, no world left', () => {
		const pos = findTile(SEED7, true);
		const game = restoreGame({ ...v4, pos } as SaveV4, mint);
		expect(game).toMatchObject({
			name: null,
			home: WORLD,
			world: WORLD,
			pos,
			facing: 'down',
			steps: 0,
			visits: 0,
			tokens: 0,
			items: [],
			solved: 0,
			// No book saved: the party's own, every animal in it caught.
			seen: ['squirrel', 'fox'],
			caught: ['squirrel', 'fox'],
			battle: null,
			edits: [],
			worlds: []
		});
		expect(game.party).toEqual(v4.party);
	});

	it('a save of a game restores exactly that game, its name, tokens, items, puzzles solved and worlds included', () => {
		const game: SavedGame = {
			name: 'Nini',
			home: 4321,
			world: FIRST_WORLD,
			pos: findTile(SEED, true),
			facing: 'up',
			steps: 321,
			visits: 4,
			party: [
				{ id: 'a', speciesId: 'fox', hp: 3, nickname: 'Rusty' },
				{ id: 'b', speciesId: 'bear', hp: 0 }
			],
			tokens: 17,
			// 'lantern' is an item this build doesn't know: kept, doing nothing.
			items: ['boat', 'axe', 'lantern'],
			solved: 312,
			// A wolf met and run from, a rabbit caught and helped home: both stay in the book.
			seen: ['rabbit', 'fox', 'wolf', 'bear'],
			caught: ['rabbit', 'fox', 'bear'],
			freed: ['rabbit'],
			battle: null,
			edits: [],
			worlds: [
				{ world: 4321, pos: { x: 3, y: -9 }, facing: 'left', edits: ['0,0:11'] },
				{ world: 12, pos: { x: 0, y: 0 }, facing: 'down', edits: [] }
			],
			land: 'nordland',
			lands: [],
			unlocked: ['nordland']
		};
		const doc = saveDocument(game, { lineage: 'L', seq: 9 });
		expect(validateSaveWrite(doc).ok).toBe(true);
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		expect(read.ok).toBe(true);
		if (read.ok) expect(restoreGame(read.save, mint)).toEqual(game);
	});

	it('an item listed twice is owned once, and the list is never shared with the save', () => {
		const pos = findTile(SEED7, true);
		const save = { ...v4, pos, tokens: 5, items: ['axe', 'boat', 'axe'] } as SaveV4;
		const game = restoreGame(save, mint);
		expect(game.items).toEqual(['axe', 'boat']);
		game.items.push('pickaxe');
		expect(save.items).toEqual(['axe', 'boat', 'axe']);
	});

	it('never strands the player: a blocked tile becomes the spawn tile', () => {
		const blocked = findTile(SEED7, false);
		const game = restoreGame({ ...v4, pos: blocked } as SaveV4, mint);
		expect(game.pos).toEqual(spawnPoint(SEED7));
	});

	it('out on the water with the boat, the player is still in it; without the boat, back on the spawn tile', () => {
		const worldOne = { ...v4, world: FIRST_WORLD };
		const shallow = waterNearSpawn('water');
		const deep = waterNearSpawn('deepwater');
		for (const pos of [shallow, deep]) {
			const withBoat = restoreGame({ ...worldOne, pos, items: ['axe', 'boat'] } as SaveV4, mint);
			expect(withBoat.pos).toEqual(pos);
			// A game that somehow lost its boat (a hand-edited save) never leaves the
			// kid stuck out on the water: it starts again from the spawn tile.
			for (const items of [[], ['axe', 'pickaxe'], undefined]) {
				const without = restoreGame({ ...worldOne, pos, items } as SaveV4, mint);
				expect(without.pos).toEqual(spawnPoint(SEED));
			}
		}
		// Rock, trees and tents are no place for anyone, boat or not.
		for (const kind of ['rock', 'tree', 'tent']) {
			const pos = findKind(SEED, kind);
			expect(restoreGame({ ...worldOne, pos, items: ['boat'] } as SaveV4, mint).pos).toEqual(
				spawnPoint(SEED)
			);
		}
	});

	it('cuts an HP above the maximum, gives an empty party the starter, and keeps a tired party tired', () => {
		const pos = findTile(SEED7, true);
		const over = restoreGame({ ...v4, pos, party: [animal(1, { hp: 999 })] } as SaveV4, mint);
		expect(over.party[0]!.hp).toBe(getAnimal('squirrel').maxHp);

		const empty = restoreGame({ ...v4, pos, party: [] } as SaveV4, mint);
		expect(empty.party).toEqual(newGame(WORLD, testStarter()).party);

		// A doctor's tent is a walk away from beside the spawn: a reload is no heal.
		expect(nearestTent(SEED7, pos)).not.toBeNull();
		const tired = restoreGame(
			{
				...v4,
				pos,
				party: [animal(1, { hp: 0 }), animal(2, { speciesId: 'bear', hp: 0 })]
			} as SaveV4,
			mint
		);
		expect(tired.party.map((a) => a.hp)).toEqual([0, 0]);
		expect(tired.pos).toEqual(pos);
	});

	it('a team that needs the doctor comes back exactly as tired as it was, a tent in reach or none: a reload is no heal', () => {
		const tired = [animal(1, { hp: 0 }), animal(2, { speciesId: 'bear', hp: 0 })];
		// Walled in: a walkable tile with nothing walkable and no tent beside it. The game that
		// saved it is the one to have sent a doctor (a lost battle, a go-to, a trip there, each
		// asks); a restore that asked again would heal a team a glide took somewhere the live
		// game left it tired (the adversarial review of #116).
		let walled: { x: number; y: number } | null = null;
		const spawn = spawnPoint(SEED7);
		for (let r = 1; r < 300 && !walled; r++)
			for (let dx = -r; dx <= r && !walled; dx++)
				for (const dy of [-r, r]) {
					const at = { x: spawn.x + dx, y: spawn.y + dy };
					if (!isWalkable(tileAtWorld(SEED7, at.x, at.y).kind)) continue;
					const round = [
						[1, 0],
						[-1, 0],
						[0, 1],
						[0, -1]
					].map(([x, y]) => tileAtWorld(SEED7, at.x + x!, at.y + y!).kind);
					if (round.every((k) => !isWalkable(k) && k !== 'tent')) walled = at;
				}
		expect(walled).not.toBeNull();
		const walledIn = restoreGame({ ...v4, pos: walled!, party: tired } as SaveV4, mint);
		expect(walledIn.party.map((a) => a.hp)).toEqual([0, 0]);
		expect(walledIn.pos).toEqual(walled);

		// Out on the water in the boat, with nobody standing: a tent over the water is in reach.
		const deep = findKind(SEED7, 'deepwater');
		const swimmers = [animal(1, { speciesId: 'otter', hp: 0 })];
		const atSea = restoreGame(
			{ ...v4, pos: deep, items: ['boat'], party: swimmers } as SaveV4,
			mint
		);
		expect(atSea.pos).toEqual(deep);
		expect(atSea.party.map((a) => a.hp)).toEqual([0]);
		// A walker standing in the boat can battle on land: nobody needs the doctor, so nobody comes.
		const walker = [...swimmers, animal(2, { speciesId: 'squirrel', hp: 3 })];
		const inBoat = restoreGame(
			{ ...v4, pos: deep, items: ['boat'], party: walker } as SaveV4,
			mint
		);
		expect(inBoat.party.map((a) => a.hp)).toEqual([0, 3]);
		// On land with only a sea animal standing: the grass is quiet, the tent a walk away.
		const crab = [animal(1, { hp: 0 }), animal(2, { speciesId: 'crab', hp: 5 })];
		const ashore = restoreGame({ ...v4, pos: spawn, party: crab } as SaveV4, mint);
		expect(ashore.party.map((a) => a.hp)).toEqual([0, 5]);
	});

	it('gives a party of only sea animals the starter too, behind them: the grass is never out of reach', () => {
		const pos = findTile(SEED7, true);
		const sea = [animal(1, { speciesId: 'crab', hp: 0 }), animal(2, { speciesId: 'whale' })];
		for (const items of [[], ['boat']]) {
			const game = restoreGame({ ...v4, pos, items, party: sea } as SaveV4, mint);
			expect(game.party.map((a) => a.speciesId)).toEqual(['crab', 'whale', STARTER_SPECIES]);
			expect(game.party[leadIndex(game.party, 'land')]!.speciesId).toBe(STARTER_SPECIES);
			// Somebody stood already: nobody is rested, the tired crab included.
			expect(game.party[0]!.hp).toBe(0);
		}
		// Its id is new to the party, whatever the save called its animals.
		const taken = [animal(1, { id: 'starter', speciesId: 'turtle' })];
		const ids = restoreGame(
			{ ...v4, pos, party: taken } as SaveV4,
			mints('starter', 'fresh')
		).party.map((a) => a.id);
		expect(ids).toEqual(['starter', 'fresh']);
		// A battle saved with such a party is dropped: it was not fought with the starter.
		const deep = findKind(SEED7, 'deepwater');
		const whale = [animal(1, { speciesId: 'whale', hp: 50 })];
		const battle = startBattle(whale, makeWild('crab'), { realm: 'water' });
		const atSea = { ...v4, pos: deep, items: ['boat'], party: whale, battle } as SaveV4;
		const back = restoreGame(JSON.parse(JSON.stringify(atSea)), mint);
		expect(back.battle).toBeNull();
		expect(back.pos).toEqual(deep);
		expect(back.party.map((a) => a.speciesId)).toEqual(['whale', STARTER_SPECIES]);
		// An animal that walks, even tired, is enough: the doctor is a walk away.
		const walker = [animal(1, { speciesId: 'crab' }), animal(2, { speciesId: 'frog', hp: 0 })];
		expect(restoreGame({ ...v4, pos, party: walker } as SaveV4, mint).party).toHaveLength(2);
	});

	it('over random saves of every shape, the restored game is always playable', () => {
		// A handful of worlds, so the spawns are worked out once each. What each save must
		// keep is collected and compared once, and every rule it breaks noted: an `expect` per
		// animal made seven tenths of the test's time.
		const worlds = [1, 2, 7, 42, 999, 5000, 9999];
		const bad: string[] = [];
		let more = 0;
		const got: unknown[] = [];
		const want: unknown[] = [];
		for (let s = 0; s < 400; s++) {
			const rng = new Rng(hashInts(7, s));
			const world = rng.pick(worlds);
			const seed = worldSeed(world);
			const size = rng.int(0, 40);
			const party: AnimalInstance[] = Array.from({ length: size }, (_, i) => {
				const spec = rng.pick(ANIMALS);
				return { id: `m${i}`, speciesId: spec.id, hp: rng.int(0, spec.maxHp + 5) };
			});
			const save = {
				...v4,
				world,
				home: rng.pick(worlds),
				pos: { x: rng.int(-300, 300), y: rng.int(-300, 300) },
				party,
				facing: rng.pick(['up', 'down', 'left', 'right'] as Direction[]),
				steps: rng.int(0, 10_000),
				items: rng.pick([[], ['boat'], ['axe'], ['boat', 'boat']])
			} as SaveV4;
			const game = restoreGame(save, mint);
			const gear = gearOf(game);
			const note = (broken: string) => {
				if (bad.length < 20) bad.push(`save ${s}: ${broken}`);
				else bad[19] = `…and ${++more} more`;
			};
			if (!isPassable(tileAtWorld(seed, game.pos.x, game.pos.y).kind, gear))
				note(`stands where it cannot, at ${JSON.stringify(game.pos)}`);
			if (!(game.party.length > 0)) note('an empty party');
			for (const a of game.party) {
				const max = getAnimal(a.speciesId).maxHp;
				if (!(typeof a.hp === 'number' && a.hp >= 0 && a.hp <= max)) note(`${a.id} at ${a.hp} HP`);
			}
			// Every animal comes back with the HP it was saved with (cut to its maximum), tired
			// ones too, wherever it stands: a reload is no heal.
			const saved = new Map(party.map((a) => [a.id, a]));
			for (const a of game.party) {
				const was = saved.get(a.id);
				if (was && a.hp !== Math.min(was.hp, getAnimal(was.speciesId).maxHp)) {
					note(`${a.id} came back at ${a.hp} HP, saved at ${was.hp}`);
				}
			}
			// A battle can start with it where an animal standing can fight: the party is one
			// `startBattle` accepts there (only sea animals standing, out on the water); with
			// nobody standing, the team needs the doctor.
			const here = tileRealm(tileAtWorld(seed, game.pos.x, game.pos.y).kind);
			const realm = REALMS.find((r) => leadIndex(game.party, r) >= 0);
			if (realm === undefined && !needsDoctor(game.party, here)) {
				note('nobody standing, and no doctor needed');
			}
			const wild = makeWild(realm === 'land' ? 'rabbit' : 'crab');
			try {
				if (realm !== undefined) startBattle(game.party, wild, { realm });
			} catch (error) {
				note(`no battle: ${error}`);
			}
			// In bundles: every animal once, each species behind its first, in its own order.
			if (!isBundled(game.party)) note('not in bundles');
			// Always an animal that can fight on land: a party of only sea animals gets the starter.
			if (!game.party.some((a) => canFightIn(a.speciesId, 'land'))) note('nobody for the land');
			// What was fine to begin with comes back unchanged, out on the water with a boat too.
			const stood = isPassable(tileAtWorld(seed, save.pos.x, save.pos.y).kind, gear);
			const walks = party.some((a) => canFightIn(a.speciesId, 'land'));
			const kept = bundled(party).map((a) => a.id);
			const { facing, steps, world: inWorld, home } = game;
			got.push({
				s,
				pos: game.pos,
				facing,
				steps,
				inWorld,
				home,
				ids: game.party.map((a) => a.id)
			});
			want.push({
				s,
				pos: stood ? save.pos : game.pos,
				facing: save.facing,
				steps: save.steps,
				inWorld: save.world,
				home: save.home,
				ids: size === 0 ? game.party.map((a) => a.id) : walks ? kept : [...kept, 'starter']
			});
		}
		expect(bad).toEqual([]);
		expect(got).toEqual(want);
	});

	it('keeps who leads when it puts a party from before bundles in them', () => {
		// A squirrel, tired; a fox, leading; a squirrel caught after the fox.
		const party: AnimalInstance[] = [
			{ id: 'sq1', speciesId: 'squirrel', hp: 0 },
			{ id: 'fox', speciesId: 'fox', hp: getAnimal('fox').maxHp },
			{ id: 'sq2', speciesId: 'squirrel', hp: getAnimal('squirrel').maxHp }
		];
		const pos = findTile(SEED, true);
		const game = restoreGame({ ...written, world: 1, pos, party } as SaveV4, mint);
		expect(game.party.map((a) => a.id)).toEqual(['fox', 'sq1', 'sq2']);
		expect(game.party[leadIndex(game.party)]!.id).toBe('fox');
		// Over random parties of every kind in any order, the lead is the lead before.
		const bad: string[] = [];
		for (let s = 0; s < 300; s++) {
			const rng = new Rng(hashInts(11, s));
			const mixed: AnimalInstance[] = Array.from({ length: rng.int(1, 12) }, (_, i) => {
				const spec = rng.pick(ANIMALS.slice(0, 4));
				return { id: `m${i}`, speciesId: spec.id, hp: rng.next() < 0.4 ? 0 : spec.maxHp };
			});
			if (!mixed.some((a) => a.hp > 0)) continue;
			const restored = restoreGame(
				{ ...written, world: 1, pos, party: mixed } as SaveV4,
				mint
			).party;
			const was = mixed[leadIndex(mixed)]!.id;
			const is = restored[leadIndex(restored)]!.id;
			if (was !== is)
				bad.push(`${mixed.map((a) => `${a.id}:${a.speciesId}:${a.hp}`).join(' ')}: ${was} → ${is}`);
		}
		expect(bad).toEqual([]);
	});

	it('puts a party from before bundles in them, a saved battle the same way with the same animal in front', () => {
		// Squirrel, rabbit, squirrel: the kind of team the six-animal build let a kid make.
		const party: AnimalInstance[] = [
			{ id: 'a', speciesId: 'squirrel', hp: 0 },
			{ id: 'b', speciesId: 'rabbit', hp: 22 },
			{ id: 'c', speciesId: 'squirrel', hp: 14 }
		];
		const seed = hashInts(SEED, 99);
		// The rabbit leads (the first squirrel is tired) and picks an attack: a puzzle is up.
		let state = startBattle(party, makeWild('fox'));
		state = applyBattleIntent(state, { type: 'attack', attackIndex: 1, level: 1 }, seed).state;
		expect(state.party[state.active]!.id).toBe('b');
		const pos = findTile(SEED, true);
		const save = JSON.parse(JSON.stringify({ ...written, world: 1, pos, party, battle: state }));
		const game = restoreGame(save, mint);
		// The rabbit led behind the tired squirrel, and still does: gathered, the second
		// squirrel would have stood in front of it, so the rabbit's bundle goes first.
		expect(game.party.map((a) => a.id)).toEqual(['b', 'a', 'c']);
		expect(game.battle!.party.map((a) => a.id)).toEqual(['b', 'a', 'c']);
		expect(game.battle!.party[game.battle!.active]!.id).toBe('b');
		expect(game.battle!.phase).toEqual(state.phase);
		// The same answer plays on as it would have: the same hits, the same HP for each animal.
		if (state.phase.kind !== 'solving') throw new Error('no puzzle');
		const input = String(state.phase.puzzle.answer);
		const was = applyBattleIntent(state, { type: 'answer', input }, seed);
		const now = applyBattleIntent(game.battle!, { type: 'answer', input }, seed);
		expect(now.events).toEqual(was.events);
		const hp = (s: BattleState) => Object.fromEntries(s.party.map((a) => [a.id, a.hp]));
		expect(hp(now.state)).toEqual(hp(was.state));
		expect(now.state.opponent).toEqual(was.state.opponent);
		expect(now.state.party[now.state.active]!.id).toBe(was.state.party[was.state.active]!.id);
	});
});

describe('the engine mints no ids', () => {
	const pos = findTile(SEED7, true);
	const sea = [animal(1, { speciesId: 'crab', hp: 0 }), animal(2, { speciesId: 'whale' })];

	it('newGame keeps the id the authority gave the starter', () => {
		const starter = { ...defaultStarter(), id: 'minted-1' };
		expect(newGame(WORLD, starter).party).toEqual([starter]);
		expect('id' in defaultStarter()).toBe(false);
	});

	it('the starter restoreGame adds, to an empty party or one of only sea animals, has the minted id', () => {
		for (const party of [[], sea]) {
			const mintId = mints('minted-1');
			const game = restoreGame({ ...v4, pos, party } as SaveV4, mintId);
			expect(mintId.calls).toBe(1);
			const joined = game.party.filter((a) => !party.some((b) => b.id === a.id));
			expect(joined).toEqual([{ ...defaultStarter(), id: 'minted-1' }]);
		}
	});

	it('a party that can fight on land asks for no id, and an old save keeps its literal `starter` ids', () => {
		const old = {
			...written,
			pos,
			party: [
				{ id: 'starter', speciesId: 'squirrel', hp: 20, nickname: 'Nini' },
				{ id: 'starter-2', speciesId: 'squirrel', hp: 3 },
				{ id: 'f1', speciesId: 'fox', hp: 35 }
			]
		};
		const read = readSave(JSON.parse(JSON.stringify(old)));
		if (!read.ok) throw new Error('unreadable');
		const mintId = mints();
		const game = restoreGame(read.save, mintId);
		expect(mintId.calls).toBe(0);
		expect(game.party).toEqual(old.party);
		const again = readSave(
			JSON.parse(JSON.stringify(saveDocument(game, { lineage: 'L', seq: 4 })))
		);
		expect(again.ok && restoreGame(again.save, mints()).party).toEqual(old.party);
	});

	it('never gives the starter an id already in the party, and gives up on a mintId that keeps doing so', () => {
		const taken = [
			animal(1, { id: 'x', speciesId: 'crab' }),
			animal(2, { id: 'y', speciesId: 'whale' })
		];
		const mintId = mints('y', 'x', 'z');
		const game = restoreGame({ ...v4, pos, party: taken } as SaveV4, mintId);
		expect(game.party.map((a) => a.id)).toEqual(['x', 'y', 'z']);
		expect(mintId.calls).toBe(3);
		expect(() => restoreGame({ ...v4, pos, party: taken } as SaveV4, () => 'x')).toThrow(
			/already in the party/
		);
	});

	it('the same save and the same minted id give the same game', () => {
		for (const party of [[], sea, v4.party]) {
			const save = { ...v4, pos, party } as SaveV4;
			expect(restoreGame(save, mints('m'))).toEqual(restoreGame(save, mints('m')));
		}
	});

	it('over random parties, every id in a restored game is the save’s or one the authority minted, each once', () => {
		const pool = ['starter', 'starter-2', 'a', 'b', 'minted-0', 'minted-1'];
		for (let s = 0; s < 300; s++) {
			const rng = new Rng(hashInts(11, s));
			// Ids drawn from a small pool, each once, some of them what the authority mints.
			const ids = pool.filter(() => rng.next() < 0.5);
			const party = ids.map((id) => {
				const spec = rng.pick(ANIMALS);
				return { id, speciesId: spec.id, hp: rng.int(0, spec.maxHp) };
			});
			let n = 0;
			const minted: string[] = [];
			const mintId = () => {
				const id = `minted-${n++}`;
				minted.push(id);
				return id;
			};
			const game = restoreGame({ ...v4, pos, party } as SaveV4, mintId);
			const out = game.party.map((a) => a.id);
			expect(new Set(out).size, `save ${s}`).toBe(out.length);
			const added = out.filter((id) => !ids.includes(id));
			const landless = !party.some((a) => canFightIn(a.speciesId, 'land'));
			expect(added, `save ${s}`).toEqual(landless ? [minted.at(-1)] : []);
			expect(minted.length > 0, `save ${s}`).toBe(landless);
		}
	});
});

describe('the v2 → v3 upgrade', () => {
	/** A v2 save with a book, as production holds them before this build. */
	const kidsV2 = {
		...written,
		version: 2,
		party: [
			{ id: 's', speciesId: 'squirrel', hp: 20 },
			{ id: 'f1', speciesId: 'fox', hp: 35 },
			{ id: 'f2', speciesId: 'fox', hp: 3 }
		],
		// The rabbit and the otter were caught and helped home; the wolf and the bear were met
		// and run from; the fox is still on the team.
		seen: ['squirrel', 'wolf', 'rabbit', 'fox', 'otter', 'bear'],
		caught: ['squirrel', 'rabbit', 'fox', 'otter']
	};

	it('counts every kind in the book and not on the team as set free, the human’s rule', () => {
		const read = readSave(JSON.parse(JSON.stringify(kidsV2)));
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.save.version).toBe(SAVE_VERSION);
		// In the order the book met them; caught or only seen alike.
		expect(read.save.freed).toEqual(['wolf', 'rabbit', 'otter', 'bear']);
		const game = restoreGame(read.save, mint);
		expect(game.freed).toEqual(['wolf', 'rabbit', 'otter', 'bear']);
		// The rest of the book, and the game, exactly as they were.
		expect(game.seen).toEqual(kidsV2.seen);
		expect(game.caught).toEqual(kidsV2.caught);
		expect(game.party.map((a) => a.id)).toEqual(['s', 'f1', 'f2']);
		// The document it was read from is untouched, and comes back from the upgrade as it was.
		expect(downgradeToV2(read.save as unknown as Record<string, unknown>)).toEqual(
			JSON.parse(JSON.stringify(kidsV2))
		);
	});

	it('counts a kind caught but missing from `seen` too, and nothing in a save without a book', () => {
		const read = readSave({ ...kidsV2, seen: ['squirrel'], caught: ['squirrel', 'deer'] });
		expect(read.ok && read.save.freed).toEqual(['deer']);
		const { seen: _seen, caught: _caught, ...bookless } = kidsV2;
		const none = readSave(bookless);
		expect(none.ok).toBe(true);
		if (!none.ok) return;
		expect('freed' in none.save).toBe(false);
		expect(restoreGame(none.save, mint).freed).toEqual([]);
	});

	it('keeps a v2 extra under a name v4 took under `v2`, as it was, and never reads it as the list', () => {
		const doc = { ...kidsV2, freed: { lots: true }, [V2_KEPT]: 7 };
		const read = readSave(doc);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.save.freed).toEqual(['wolf', 'rabbit', 'otter', 'bear']);
		expect((read.save as unknown as Record<string, unknown>)[V2_KEPT]).toEqual({
			freed: { lots: true },
			[V2_KEPT]: 7
		});
		expect(downgradeToV2(read.save as unknown as Record<string, unknown>)).toEqual(doc);
	});

	it('is total and loses nothing: every valid v2 save upgrades to a valid v3 one it can be rebuilt from', () => {
		let freedSome = 0;
		for (let s = 0; s < 400; s++) {
			const rng = new Rng(hashInts(41, s));
			const up = upgradeSave(randomV1(rng, WORLD_ONE_SEED), SAVE_UPGRADES, 2);
			if (!up.ok) throw new Error(`save ${s} should upgrade to v2`);
			const v2doc = JSON.parse(JSON.stringify(up.doc)) as Record<string, unknown>;
			const held = (v2doc.party as { speciesId: string }[]).map((a) => a.speciesId);
			if (rng.chance(0.7)) {
				const met = Array.from({ length: rng.int(0, 10) }, () => rng.pick(ANIMALS).id);
				const caught = [...held, ...met.filter(() => rng.chance(0.5))];
				v2doc.seen = [...held, ...met];
				v2doc.caught = caught;
			}
			for (const key of ['freed', V2_KEPT]) {
				if (rng.chance(0.15)) v2doc[key] = rng.pick([7, 'Nini', { deep: [1, 2] }, [3], null]);
			}
			const before = JSON.stringify(v2doc);
			const read = readSave(v2doc);
			expect(read.ok, `${s}: ${JSON.stringify(read)}`).toBe(true);
			if (!read.ok) continue;
			expect(JSON.stringify(v2doc)).toBe(before);
			const doc = read.save as unknown as Record<string, unknown>;
			expect(doc.version).toBe(SAVE_VERSION);
			expect(downgradeToV2(doc)).toEqual(v2doc);
			// The rule, re-derived: every kind in either list and not held, each once.
			const book = [...((v2doc.seen as string[]) ?? []), ...((v2doc.caught as string[]) ?? [])];
			const expected = [...new Set(book.filter((id) => !held.includes(id)))];
			if (v2doc.seen === undefined) expect('freed' in doc, `${s}`).toBe(false);
			else expect(doc.freed, `${s}`).toEqual(expected);
			if (expected.length > 0) freedSome++;
			const game = restoreGame(read.save, mint);
			expect(new Set(game.freed), `${s}`).toEqual(new Set(expected));
			for (const id of game.freed) expect(game.seen, `${s}`).toContain(id);
		}
		expect(freedSome).toBeGreaterThan(100);
	});
});

describe('the animal book in a save', () => {
	/**
	 * A kid's account save from before the book, as production holds one: v2,
	 * World 1, eleven animals of eight kinds (the starter named, a tired one, a
	 * sea animal, two of wave 1's small animals), tokens, the axe and the boat,
	 * a name, a world left behind, and no `seen` or `caught` at all.
	 */
	const kidsSave = {
		version: 2,
		home: FIRST_WORLD,
		world: FIRST_WORLD,
		name: 'Aslak',
		pos: spawnPoint(SEED),
		facing: 'left',
		steps: 9120,
		visits: 44,
		lineage: 'kid-game',
		seq: 6310,
		tokens: 23,
		items: ['axe', 'boat'],
		solved: 412,
		worlds: [{ world: 7, pos: { x: 3, y: -2 }, facing: 'down' }],
		party: [
			{ id: 'starter', speciesId: 'squirrel', hp: 20, nickname: 'nini' },
			{ id: 'f1', speciesId: 'fox', hp: 35 },
			{ id: 'f2', speciesId: 'fox', hp: 12 },
			{ id: 'r1', speciesId: 'rabbit', hp: 22 },
			{ id: 'o1', speciesId: 'otter', hp: 30 },
			{ id: 'o2', speciesId: 'otter', hp: 0 },
			{ id: 'd1', speciesId: 'deer', hp: 50 },
			{ id: 't1', speciesId: 'turtle', hp: 30 },
			{ id: 'h1', speciesId: 'hedgehog', hp: 26 },
			{ id: 'h2', speciesId: 'hedgehog', hp: 9 },
			{ id: 'm1', speciesId: 'wood-mouse', hp: 19 }
		]
	};
	const KINDS = ['squirrel', 'fox', 'rabbit', 'otter', 'deer', 'turtle', 'hedgehog', 'wood-mouse'];

	it('back-fills a save from before the book: every kind in the party caught, and seen', () => {
		expect(kidsSave.party).toHaveLength(11);
		const stored = JSON.parse(JSON.stringify(kidsSave));
		// What the server and the page make of it: readable, and neither broken nor a newer build's.
		expect(validateSaveWrite(stored).ok).toBe(true);
		const read = readSave(stored);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const game = restoreGame(read.save, mint);
		expect(game.caught).toEqual(KINDS);
		expect(game.seen).toEqual(KINDS);
		// Nothing else changes: the game plays on exactly where it was, with all eleven.
		expect(game).toMatchObject({
			world: 1,
			pos: kidsSave.pos,
			tokens: 23,
			solved: 412,
			name: 'Aslak'
		});
		expect(game.party.map((a) => a.id).sort()).toEqual(kidsSave.party.map((a) => a.id).sort());
		expect(game.worlds).toHaveLength(1);
		// No book, so no kind counts as set free: the rule reads the book, and there is none.
		expect(game.freed).toEqual([]);
		// Its next save writes the book out, and the server takes it over the stored one, as the
		// same game's next save, keeping the stored one aside once, as an older build's.
		const doc = saveDocument(game, { lineage: 'kid-game', seq: 6311 }, saveExtras(read.save));
		expect(doc).toMatchObject({ seen: KINDS, caught: KINDS, freed: [] });
		expect(validateSaveWrite(JSON.parse(JSON.stringify(doc))).ok).toBe(true);
		expect(canReplace(stored, doc)).toBe(true);
		expect(replacesAnotherGame(stored, doc)).toBe(true);
		expect(replacesAnotherGame(doc, { lineage: 'kid-game' })).toBe(false);
		// Field for field the stored save, `seq` one on, the version this build's, the land it is
		// in (Nordland), and the book's three lists added.
		const wrote = doc as unknown as Record<string, unknown>;
		for (const key of Object.keys(stored).filter((k) => k !== 'seq' && k !== 'version')) {
			expect(wrote[key], key).toEqual(stored[key]);
		}
		expect(wrote.version).toBe(SAVE_VERSION);
		expect(wrote.land).toBe('nordland');
		expect(Object.keys(wrote).filter((k) => !(k in stored))).toEqual([
			'land',
			'seen',
			'caught',
			'freed'
		]);
		const again = readSave(JSON.parse(JSON.stringify(doc)));
		expect(again.ok && restoreGame(again.save, mint)).toEqual(game);
		// And it holds the same progress as the save it came from, both ways: only the book was
		// written out, so another tab still on the old save carries on from it, and it from them.
		expect(sameProgress(read.save, doc)).toBe(true);
		expect(sameProgress(doc, read.save)).toBe(true);
	});

	it('a saved battle proves its wild animal was met, even one that cannot be picked up again', () => {
		const { state } = battleStates(3, ['squirrel', 'fox'], 'rabbit')[0]!;
		const doc = { ...written, pos: findTile(SEED7, true), party: state!.party, battle: state };
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const inBattle = restoreGame(read.save, mint);
		expect(inBattle.battle).not.toBeNull();
		expect(inBattle.seen).toEqual(['squirrel', 'fox', 'rabbit']);
		expect(inBattle.caught).toEqual(['squirrel', 'fox']);
		// Standing somewhere else now, the battle is dropped, as if the kid had run away: the
		// rabbit was met all the same.
		const moved = restoreGame({ ...doc, pos: findTile(SEED7, false) } as unknown as SaveV4, mint);
		expect(moved.battle).toBeNull();
		expect(moved.seen).toContain('rabbit');
		expect(moved.caught).not.toContain('rabbit');
	});

	it('keeps what the book says: a kind helped home stays caught and set free, one met and run from stays seen', () => {
		const pos = findTile(SEED7, true);
		const game = restoreGame(
			{
				...written,
				pos,
				seen: ['bear', 'squirrel', 'fox', 'wolf', 'rabbit'],
				caught: ['rabbit', 'squirrel', 'fox'],
				freed: ['rabbit', 'fox']
			} as SaveV4,
			mint
		);
		// The rabbit went home with the doctor long ago, and one fox of several; the bear and the
		// wolf were run from.
		expect(game.party.map((a) => a.speciesId)).toEqual(['squirrel', 'fox']);
		expect(game.seen).toEqual(['bear', 'squirrel', 'fox', 'wolf', 'rabbit']);
		expect(game.caught).toEqual(['rabbit', 'squirrel', 'fox']);
		expect(game.freed).toEqual(['rabbit', 'fox']);
	});

	it('mends a set-free list a hand left odd: each kind once, every one seen, nothing the catalog lacks', () => {
		const pos = findTile(SEED7, true);
		const game = restoreGame(
			{ ...written, pos, seen: ['fox'], caught: [], freed: ['otter', 'otter', 'fox'] } as SaveV4,
			mint
		);
		expect(game.freed).toEqual(['otter', 'fox']);
		expect(game.seen).toEqual(expect.arrayContaining(['fox', 'otter']));
		expect(game.caught).not.toContain('otter');
	});

	it('mends a book a hand, or an older build playing on, left short: the party caught, every catch seen, each once', () => {
		const pos = findTile(SEED7, true);
		// An older build caught the fox and kept the lists as they were; a hand listed the rabbit
		// twice and caught a bear it never saw.
		const game = restoreGame(
			{
				...written,
				pos,
				seen: ['rabbit', 'rabbit'],
				caught: ['bear', 'rabbit', 'bear']
			} as SaveV4,
			mint
		);
		expect(game.seen).toEqual(['rabbit', 'bear', 'squirrel', 'fox']);
		expect(game.caught).toEqual(['bear', 'rabbit', 'squirrel', 'fox']);
	});

	it('gives the starter a party got back to the book too: every animal a kid has is caught', () => {
		const pos = findTile(SEED7, true);
		const game = restoreGame(
			{ ...written, pos, party: [], seen: ['wolf'], caught: [] } as SaveV4,
			mint
		);
		expect(game.party.map((a) => a.speciesId)).toEqual([STARTER_SPECIES]);
		expect(game.seen).toEqual(['wolf', STARTER_SPECIES]);
		expect(game.caught).toEqual([STARTER_SPECIES]);
	});

	it('is written in every save, the lists never shared with the game', () => {
		const game = newGame(WORLD, { id: 'a', speciesId: 'frog', hp: 20 });
		const doc = saveDocument(game, { lineage: 'L', seq: 1 });
		expect(doc).toMatchObject({ seen: ['frog'], caught: ['frog'], freed: [] });
		doc.seen!.push('bear');
		doc.freed!.push('bear');
		expect(game.freed).toEqual([]);
		expect(game.seen).toEqual(['frog']);
		const restored = restoreGame({ ...doc, seen: ['frog'] }, mint);
		restored.caught.push('wolf');
		expect(doc.caught).toEqual(['frog']);
	});
});

describe("the player's name in a save", () => {
	it('comes back as saved, and is written only once there is one', () => {
		const pos = findTile(SEED7, true);
		expect(restoreGame({ ...v4, pos, name: 'Nini' } as SaveV4, mint).name).toBe('Nini');
		expect(restoreGame({ ...v4, pos, name: 'Ørn-Åse 2' } as SaveV4, mint).name).toBe('Ørn-Åse 2');
		expect('name' in saveDocument(newGame(1, testStarter()), { lineage: 'L', seq: 1 })).toBe(false);
		expect(saveDocument(newGame(1, testStarter(), 'Bo'), { lineage: 'L', seq: 1 }).name).toBe('Bo');
	});

	it('a stored name that is not one (hand-edited, or a rule grown since) loads as no name: the kid is asked again', () => {
		const pos = findTile(SEED7, true);
		for (const name of ['x', 'Fuck', 'a'.repeat(MAX_NAME_LENGTH + 1), 'Pip!', '  ']) {
			expect(restoreGame({ ...v4, pos, name } as SaveV4, mint).name, name).toBeNull();
		}
		// One that only needed tidying comes back tidy.
		expect(restoreGame({ ...v4, pos, name: '  Ida   Marie ' } as SaveV4, mint).name).toBe(
			'Ida Marie'
		);
	});
});

describe('the worlds left behind, in a save', () => {
	const stay = (world: number, edits: readonly string[] = []): WorldStay => ({
		world,
		pos: { x: world, y: -world },
		facing: 'right',
		edits
	});
	const game = (worlds: WorldStay[], extra: Partial<SavedGame> = {}): SavedGame => ({
		...newGame(1, testStarter()),
		home: 1,
		worlds,
		...extra
	});
	const roundTrip = (g: SavedGame) => {
		const read = readSave(JSON.parse(JSON.stringify(saveDocument(g, { lineage: 'L', seq: 1 }))));
		if (!read.ok) throw new Error(read.error);
		return restoreGame(read.save, mint);
	};

	it('come back in the order they were left, what was cleared in each included', () => {
		const worlds = [stay(5, ['0,0:11']), stay(9), stay(2, ['-3,4:00ff'])];
		expect(roundTrip(game(worlds)).worlds).toEqual(worlds);
	});

	it('never hold the world the player is in, and each world once (a hand-edited save)', () => {
		const pos = findTile(SEED7, true);
		const doc = {
			...written,
			pos,
			worlds: [
				{ world: WORLD, pos: { x: 1, y: 1 }, facing: 'up' },
				{ world: 3, pos: { x: 2, y: 2 }, facing: 'up', edits: ['0,0:11', '0,0:22'] }
			]
		} as SaveV4;
		expect(restoreGame(doc, mint).worlds).toEqual([
			{ world: 3, pos: { x: 2, y: 2 }, facing: 'up', edits: ['0,0:1122'] }
		]);
	});

	it(`keep at most ${MAX_WORLDS_KEPT}, the ones left longest ago forgotten first, never home`, () => {
		const many = Array.from({ length: MAX_WORLDS_KEPT + 20 }, (_, i) => stay(i + 2));
		const home = many.at(-1)!.world;
		const back = roundTrip(game(many, { home })).worlds;
		expect(back).toHaveLength(MAX_WORLDS_KEPT);
		expect(back.slice(0, MAX_WORLDS_KEPT - 1)).toEqual(many.slice(0, MAX_WORLDS_KEPT - 1));
		expect(back.at(-1)!.world).toBe(home);
	});

	it('keep every world’s cleared tiles within the one budget, the current world’s first, then home’s', () => {
		// Each far world full of clearings: together far past the budget.
		const full = (seed: number) => {
			let edits = WorldEdits.none;
			for (let c = 0; c < 30; c++) {
				for (let i = 0; i < 200; i++)
					edits = edits.with({ x: c * 16 + (i % 16), y: seed * 16 + (i >> 4) });
			}
			return [...edits.encode()];
		};
		const worlds = [stay(3, full(1)), stay(4, full(2)), stay(5, full(3))];
		const back = roundTrip(game(worlds, { home: 5 })).worlds;
		const total = back.reduce(
			(n, w) => n + (w.edits.length ? JSON.stringify(w.edits).length : 0),
			0
		);
		expect(total).toBeLessThanOrEqual(EDITS_BUDGET);
		// Home keeps all of its own; the most recently left gets what is left.
		expect(back.find((w) => w.world === 5)!.edits).toEqual(worlds[2]!.edits);
		expect(back[0]!.edits.length).toBeGreaterThan(0);
		expect(back[1]!.edits).toEqual([]);
		// Where the player stood in each is never forgotten.
		expect(back.map((w) => [w.world, w.pos, w.facing])).toEqual(
			worlds.map((w) => [w.world, w.pos, w.facing])
		);
	});
});

/** Every state a battle passes through before its end, with the intent sent in it. */
function battleStates(seed: number, speciesIds: string[], wild: string) {
	const states: { state: BattleState; next: Parameters<typeof applyBattleIntent>[1] }[] = [];
	playBattle(
		seed,
		makeParty(speciesIds),
		makeWild(wild),
		{ accuracy: 0.6, policy: 'random', leash: 0.1 },
		(before, intent) => states.push({ state: before, next: intent })
	);
	return states;
}

/** The trees and rocks nearest the spawn: tiles a kid could clear. */
function clearableNearSpawn(seed: number, n: number): { x: number; y: number }[] {
	const spawn = spawnPoint(seed);
	const out: { x: number; y: number }[] = [];
	for (let r = 1; out.length < n && r < 200; r++) {
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
				const kind = tileAtWorld(seed, spawn.x + dx, spawn.y + dy).kind;
				if (kind === 'tree' || kind === 'rock') out.push({ x: spawn.x + dx, y: spawn.y + dy });
			}
		}
	}
	return out.slice(0, n);
}

describe('the tiles a kid cleared', () => {
	const cleared = clearableNearSpawn(SEED, 40);
	const edits = cleared.reduce((e, p) => e.with(p), WorldEdits.none);

	it('come back through a save, JSON and all, exactly as they were', () => {
		const game: SavedGame = { ...newGame(1, testStarter()), edits: [...edits.encode()] };
		const doc = saveDocument(game, { lineage: 'L', seq: 4 });
		expect(validateSaveWrite(doc).ok).toBe(true);
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const restored = restoreGame(read.save, mint);
		expect(restored).toEqual(game);
		const back = WorldEdits.decode(restored.edits);
		for (const p of cleared) expect(back.has(p.x, p.y)).toBe(true);
		expect(back.size).toBe(40);
		// The restored list is the game's own, never the document's.
		restored.edits.push('9,9:00');
		expect(read.save.edits).toHaveLength(edits.encode().length);
	});

	it('are written only once something is cleared, so a game that never used a tool saves as before', () => {
		expect('edits' in saveDocument(newGame(1, testStarter()), { lineage: 'L', seq: 1 })).toBe(
			false
		);
		expect(restoreGame(v4 as SaveV4, mint).edits).toEqual([]);
	});

	it('are written canonically, whatever order a save held them in', () => {
		const shuffled = new Rng(4).shuffle([...edits.encode()]);
		const pos = findTile(SEED, true);
		const restored = restoreGame({ ...written, world: 1, pos, edits: shuffled } as SaveV4, mint);
		expect(restored.edits).toEqual(edits.encode());
	});

	it('keep a player standing where they cleared: a cleared tree is ground to stand on', () => {
		// Stand on a cleared tree or rock: without the overlay that tile is blocked.
		const on = cleared[0]!;
		const save = { ...written, world: 1, pos: on, edits: [...edits.encode()] } as SaveV4;
		expect(restoreGame(save, mint).pos).toEqual(on);
		// The same save without its edits cannot stand there, and goes to the spawn tile.
		expect(restoreGame({ ...save, edits: undefined }, mint).pos).toEqual(spawnPoint(SEED));
	});

	it('refuses an overlay that is not one', () => {
		for (const bad of ['0,0:00', [1], ['0,0:'], ['x'], [null], ['0,0:0'], { '0,0': '00' }]) {
			expect(error({ ...written, edits: bad })).toMatch(/edits/);
		}
		expect(validateSave({ ...written, edits: [] }).ok).toBe(true);
		expect(validateSave({ ...written, edits: ['3,-4:00ff', '-1,0:10'] }).ok).toBe(true);
	});

	it('come back within the budget from a save that holds more (a hand-edited one), trimmed far from the player', () => {
		// One tile in each of 3,000 far-flung chunks: half again over the budget. Read from text,
		// as a hand-edited save holds it: built with `with`, the overlay was copied 3,000 times.
		const far = Array.from({ length: 3000 }, (_, i) =>
			WorldEdits.none.with({ x: 70_000 + i * 16, y: -70_000 - i * 16 }).encode()
		);
		const over = WorldEdits.decode([...edits.encode(), ...far.flat()]);
		expect(over.size).toBe(edits.size + 3000);
		expect(over.textLength).toBeGreaterThan(EDITS_BUDGET * 1.4);
		const on = cleared[0]!;
		const doc = { ...written, world: 1, pos: on, edits: [...over.encode()] };
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const restored = restoreGame(read.save, mint);
		const back = WorldEdits.decode(restored.edits);
		expect(back.textLength).toBeLessThanOrEqual(EDITS_BUDGET);
		// Every tile cleared round home is kept, so the player still stands where they cleared.
		expect(restored.pos).toEqual(on);
		for (const p of cleared) expect(back.has(p.x, p.y)).toBe(true);
		// And the save written from it stays within the budget too.
		const text = saveDocument(restored, { lineage: 'L', seq: 2 }).edits!;
		expect(JSON.stringify(text).length).toBeLessThanOrEqual(EDITS_BUDGET);
	});
});

describe('readBattle', () => {
	it('picks up every state of real battles, and the battle goes on exactly as it would have', () => {
		let solving = 0;
		let replacing = 0;
		for (let seed = 1; seed <= SEEDS; seed++) {
			for (const { state, next } of battleStates(seed, ['squirrel', 'fox'], 'rabbit')) {
				const party = state.party.map((a) => ({ ...a }));
				const restored = readBattle(JSON.parse(JSON.stringify(state)), party);
				expect(restored).toEqual(state);
				if (state.phase.kind === 'solving') solving++;
				if (state.phase.kind === 'choose-animal') replacing++;
				// Same seed, same intent: the same step, whether or not the page reloaded.
				expect(applyBattleIntent(restored!, next, seed)).toEqual(
					applyBattleIntent(state, next, seed)
				);
			}
		}
		// Mid-puzzle, and waiting to replace a knocked-out animal, both come back.
		expect(solving).toBeGreaterThan(0);
		expect(replacing).toBeGreaterThan(0);
	});

	it('drops a battle nested deeper than a save can hold one, and never throws on one', () => {
		const { state } = battleStates(3, ['squirrel', 'fox'], 'rabbit')[0]!;
		// An extra field on the animal in front, with the party beside the battle holding it too.
		// In a save the battle is a level in, its party two and the animal three.
		const nested = (levels: number) => {
			const party = state!.party.map((a, i) => (i === 0 ? { ...a, deep: lists(levels) } : a));
			return [{ ...JSON.parse(JSON.stringify(state)), party }, party] as const;
		};
		expect(readBattle(...nested(MAX_SAVE_DEPTH - 4))).not.toBeNull();
		expect(readBattle(...nested(200_000))).toBeNull();
		expect(readBattle(...nested(MAX_SAVE_DEPTH - 3))).toBeNull();
	});

	it('drops a battle that does not fit the party or the rules', () => {
		const { state } = battleStates(3, ['squirrel', 'fox'], 'rabbit')[0]!;
		const party = state!.party.map((a) => ({ ...a }));
		const json = (patch: Record<string, unknown>) => ({
			...JSON.parse(JSON.stringify(state)),
			...patch
		});
		expect(readBattle(json({}), party)).not.toBeNull();
		// A battle saved by a build whose engine still wrote an English `log` reads, without it.
		const old = readBattle(json({ log: ['A wild Rabbit appears!', 'Go, Squirrel!'] }), party);
		expect(old).toEqual(readBattle(json({}), party));
		expect(old).not.toHaveProperty('log');
		for (const broken of [
			null,
			'battle',
			json({ step: -1 }),
			json({ turn: 0 }),
			json({ active: 5 }),
			json({ active: 1.5 }),
			json({ opponent: { ...state!.opponent, speciesId: 'dragon' } }),
			json({ opponent: { ...state!.opponent, hp: 0 } }),
			json({ opponent: { ...state!.opponent, hp: 999 } }),
			json({ opponent: { ...state!.opponent, id: party[0]!.id } }),
			json({ leashQuality: 0 }),
			json({ leashQuality: 'strong' }),

			json({ phase: { kind: 'ended', outcome: 'won' } }),
			json({ phase: { kind: 'wild-turn' } }),
			json({
				phase: {
					kind: 'solving',
					attackIndex: 9,
					level: 1,
					puzzle: { kind: 'add', prompt: '1 + 1 = ?', answer: 2, difficulty: 1 }
				}
			}),
			json({
				phase: {
					kind: 'solving',
					attackIndex: 1,
					level: 4,
					puzzle: { kind: 'add', prompt: '1 + 1 = ?', answer: 2, difficulty: 1 }
				}
			}),
			json({
				phase: {
					kind: 'solving',
					attackIndex: 1,
					level: 1,
					puzzle: { kind: 'poem', prompt: '?', answer: 2, difficulty: 1 }
				}
			}),
			json({
				phase: {
					kind: 'solving',
					attackIndex: 1,
					level: 1,
					puzzle: { kind: 'add', prompt: '?', answer: 2.5, difficulty: 1 }
				}
			})
		]) {
			expect(readBattle(broken, party)).toBeNull();
		}
		// The battle must be fought by the party saved beside it, HP and all.
		expect(readBattle(json({}), [{ ...party[0]!, hp: party[0]!.hp - 1 }, party[1]!])).toBeNull();
		expect(readBattle(json({}), party.slice(0, 1))).toBeNull();
		// A tired animal cannot be the one in front.
		const tiredFront = party.map((a, i) => (i === state!.active ? { ...a, hp: 0 } : a));
		expect(readBattle({ ...json({}), party: tiredFront }, tiredFront)).toBeNull();
	});

	it('picks up a battle on the water, fought only by the animals that swim', () => {
		let states = 0;
		for (let seed = 1; seed <= 10; seed++) {
			const all: { state: BattleState; next: Parameters<typeof applyBattleIntent>[1] }[] = [];
			playBattle(
				seed,
				makeParty(['squirrel', 'otter', 'frog']),
				makeWild('otter'),
				{ accuracy: 0.6, policy: 'random', leash: 0.1, switch: 0.2 },
				(before, intent) => all.push({ state: before, next: intent }),
				2000,
				'water'
			);
			for (const { state, next } of all) {
				states++;
				const party = state.party.map((a) => ({ ...a }));
				const doc = JSON.parse(JSON.stringify(state));
				const restored = readBattle(doc, party, 'water');
				expect(restored).toEqual(state);
				expect(applyBattleIntent(restored!, next, seed)).toEqual(
					applyBattleIntent(state, next, seed)
				);
				// Never on land: the player is not where it was fought.
				expect(readBattle(doc, party, 'land')).toBeNull();
			}
		}
		expect(states).toBeGreaterThan(50);

		const party = makeParty(['squirrel', 'otter']);
		const water = startBattle(party, makeWild('frog'), { realm: 'water' });
		const json = (patch: Record<string, unknown>) => ({
			...JSON.parse(JSON.stringify(water)),
			...patch
		});
		expect(readBattle(json({}), party, 'water')).toEqual(water);
		// The squirrel can't swim: it is never the one in front out on the water.
		expect(readBattle(json({ active: 0 }), party, 'water')).toBeNull();
		// Nor is a wild animal that can't swim met there.
		const squirrel = { id: 'wild-squirrel', speciesId: 'squirrel', hp: 20 };
		expect(readBattle(json({ opponent: squirrel }), party, 'water')).toBeNull();
		// A battle saved before battles had a realm was fought on land.
		const onLand = startBattle(party, makeWild('frog'));
		const { realm: _realm, ...old } = JSON.parse(JSON.stringify(onLand));
		expect(readBattle(old, party, 'land')).toEqual(onLand);
		expect(readBattle(old, party, 'water')).toBeNull();
		expect(readBattle(json({ realm: 'lava' }), party, 'water')).toBeNull();
	});

	it('picks up a battle in the air, fought only by birds, wherever the glider came down: on land or out on the water (#91)', () => {
		let states = 0;
		for (let seed = 1; seed <= 10; seed++) {
			const all: { state: BattleState; next: Parameters<typeof applyBattleIntent>[1] }[] = [];
			playBattle(
				seed,
				makeParty(['squirrel', 'robin', 'mute-swan']),
				makeWild('buzzard'),
				{ accuracy: 0.6, policy: 'random', leash: 0.1, switch: 0.2 },
				(before, intent) => all.push({ state: before, next: intent }),
				2000,
				'air'
			);
			for (const { state, next } of all) {
				states++;
				const party = state.party.map((a) => ({ ...a }));
				const doc = JSON.parse(JSON.stringify(state));
				// Down on the ground or in the boat: the bird followed the glider there.
				for (const where of ['land', 'water'] as const) {
					const restored = readBattle(doc, party, where);
					expect(restored).toEqual(state);
					expect(applyBattleIntent(restored!, next, seed)).toEqual(
						applyBattleIntent(state, next, seed)
					);
				}
			}
		}
		expect(states).toBeGreaterThan(50);

		const party = makeParty(['squirrel', 'robin']);
		const air = startBattle(party, makeWild('buzzard'), { realm: 'air' });
		const json = (patch: Record<string, unknown>) => ({
			...JSON.parse(JSON.stringify(air)),
			...patch
		});
		expect(readBattle(json({}), party, 'land')).toEqual(air);
		// The squirrel can't fly: it is never the one in front up in the air.
		expect(readBattle(json({ active: 0 }), party, 'land')).toBeNull();
		// Nor is a wild animal that can't fly met there.
		const squirrel = { id: 'wild-squirrel', speciesId: 'squirrel', hp: 20 };
		expect(readBattle(json({ opponent: squirrel }), party, 'land')).toBeNull();
		// A battle on land or on the water is still picked up only there.
		const onLand = startBattle(party, makeWild('buzzard'));
		expect(readBattle(JSON.parse(JSON.stringify(onLand)), party, 'water')).toBeNull();
	});

	it('comes back with a battle in the air where the glider came down: on the ground, in the boat, never out on the water without it', () => {
		const party = makeParty(['squirrel', 'robin']);
		const battle = startBattle(party, makeWild('buzzard'), { realm: 'air' });
		const game = { ...newGame(1, testStarter()), facing: 'up' as const, steps: 14, party, battle };
		const ground = saveDocument(
			{ ...game, pos: findTile(SEED, true), items: ['glider'] },
			{ lineage: 'L', seq: 2 }
		);
		const read = readSave(JSON.parse(JSON.stringify(ground)));
		expect(read.ok && restoreGame(read.save, mint).battle).toEqual(battle);
		const pos = waterNearSpawn('deepwater');
		const boat = saveDocument(
			{ ...game, pos, items: ['glider', 'boat'] },
			{ lineage: 'L', seq: 2 }
		);
		expect(restoreGame(JSON.parse(JSON.stringify(boat)), mint).battle).toEqual(battle);
		const noBoat = restoreGame(
			JSON.parse(
				JSON.stringify(saveDocument({ ...game, pos, items: ['glider'] }, { lineage: 'L', seq: 2 }))
			),
			mint
		);
		expect(noBoat.battle).toBeNull();
		expect(noBoat.pos).toEqual(spawnPoint(SEED));
	});

	it('comes back with the saved game out on the water only with the boat', () => {
		const pos = waterNearSpawn('deepwater');
		const party = makeParty(['squirrel', 'otter']);
		const battle = startBattle(party, makeWild('otter'), { realm: 'water' });
		const game = { ...newGame(1, testStarter()), pos, facing: 'left' as const, steps: 11, party };
		const withBoat = saveDocument({ ...game, items: ['boat'], battle }, { lineage: 'L', seq: 2 });
		expect(restoreGame(JSON.parse(JSON.stringify(withBoat)), mint).battle).toEqual(battle);
		const noBoat = saveDocument({ ...game, items: [], battle }, { lineage: 'L', seq: 2 });
		const restored = restoreGame(JSON.parse(JSON.stringify(noBoat)), mint);
		expect(restored.battle).toBeNull();
		expect(restored.pos).toEqual(spawnPoint(SEED));
		expect(isWater(tileAtWorld(SEED, pos.x, pos.y).kind)).toBe(true);
	});

	it('comes back with the saved game only while the player stands where the battle is', () => {
		const pos = findTile(SEED, true);
		const party = makeParty(['squirrel']);
		const battle = startBattle(party, makeWild('rabbit'));
		const doc = saveDocument(
			{ ...newGame(1, testStarter()), pos, facing: 'left', steps: 11, party, battle },
			{ lineage: 'L', seq: 2 }
		);
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		expect(read.ok && restoreGame(read.save, mint).battle).toEqual(battle);
		const moved = { ...doc, pos: findTile(SEED, false) };
		expect(restoreGame(moved, mint).battle).toBeNull();
	});
});

describe('which save wins', () => {
	it('saveSeq, saveLineage and saveVersion read any stored value, and default to 0, "" and 0', () => {
		expect(saveSeq(written)).toBe(3);
		expect(saveLineage(written)).toBe('game-a');
		expect(saveVersion(written)).toBe(SAVE_VERSION);
		expect(saveVersion(v1)).toBe(1);
		for (const junk of [
			null,
			undefined,
			'x',
			[],
			{ seq: -1, version: -1 },
			{ seq: 1.5, version: 1.5 },
			{ seq: '4', version: '2' },
			{ lineage: '' },
			{ lineage: 3 }
		]) {
			expect(saveSeq(junk)).toBe(0);
			expect(saveLineage(junk)).toBe('');
			expect(saveVersion(junk)).toBe(0);
		}
	});

	it('the server takes a save only with a higher seq than it holds, whatever game it is', () => {
		expect(canReplace(null, { seq: 1 })).toBe(true);
		expect(canReplace(written, { seq: 4 })).toBe(true);
		expect(canReplace(written, { seq: 3 })).toBe(false);
		expect(canReplace(written, { seq: 2 })).toBe(false);
		expect(canReplace({ ...written, lineage: 'other' }, { seq: 3 })).toBe(false);
		expect(canReplace(writtenV1, { seq: 3 })).toBe(false);
		expect(canReplace(v1, { seq: 1 })).toBe(true);
		expect(canReplace('garbage', { seq: 1 })).toBe(true);
		// A save this build cannot read, but no newer build wrote either, is replaced like any other,
		// and so is one holding an item this build does not sell: it reads.
		expect(canReplace({ ...written, pos: 'nowhere' }, { seq: 4 })).toBe(true);
		expect(canReplace({ ...written, items: ['lantern'] }, { seq: 4 })).toBe(true);
	});

	it('the server never takes a save over one a newer build wrote, whatever the seq', () => {
		for (const newer of [
			{ ...written, version: SAVE_VERSION + 1 },
			{ ...written, party: [animal(1, { speciesId: LATER.species })] },
			{ ...written, battle: { realm: LATER.realm } }
		]) {
			for (const seq of [1, 3, 4, 1_000_000]) {
				expect(canReplace(newer, { seq }), `${JSON.stringify(newer)} ${seq}`).toBe(false);
			}
		}
	});

	it('the server keeps what a save replaces when it is another game, unreadable, or an older build’s', () => {
		expect(replacesAnotherGame(null, { lineage: 'game-a' })).toBe(false);
		expect(replacesAnotherGame(written, { lineage: 'game-a' })).toBe(false);
		expect(replacesAnotherGame(written, { lineage: 'game-b' })).toBe(true);
		// The first backup after an update keeps the older build's document of the same game.
		expect(replacesAnotherGame(writtenV1, { lineage: 'game-a' })).toBe(true);
		expect(replacesAnotherGame(v1, { lineage: 'game-a' })).toBe(true);
		expect(replacesAnotherGame({ ...written, version: 2 }, { lineage: 'game-a' })).toBe(true);
		expect(replacesAnotherGame({ ...written, version: 3 }, { lineage: 'game-a' })).toBe(true);
		expect(replacesAnotherGame('garbage', { lineage: 'game-a' })).toBe(true);
	});

	it('sameProgress ignores where the player is in their world and which write it is, and nothing else', () => {
		const moved = {
			...written,
			pos: { x: 50, y: 60 },
			facing: 'up',
			steps: 900,
			visits: 9,
			lineage: 'game-z',
			seq: 77
		};
		expect(sameProgress(written as SaveV4, moved as SaveV4)).toBe(true);
		// Key order and absent-versus-undefined do not matter.
		const { party, ...rest } = written;
		const reordered = JSON.parse(JSON.stringify({ party, ...rest }));
		expect(sameProgress(written as SaveV4, { ...reordered, extra: undefined })).toBe(true);
		// A save from before the shop has no tokens and no items: the same as none written out.
		expect(sameProgress(written as SaveV4, { ...moved, tokens: 0, items: [] } as SaveV4)).toBe(
			true
		);
		// One from before the count of puzzles has solved none: the same as 0 written out,
		// both ways, so a tab that loaded it can carry on from a tab that walked and wrote 0.
		expect(sameProgress(written as SaveV4, { ...moved, solved: 0 } as SaveV4)).toBe(true);
		expect(sameProgress({ ...moved, solved: 0 } as SaveV4, written as SaveV4)).toBe(true);
		// One from before the tools has cleared nothing: the same as an empty overlay; and one
		// that never travelled has left no world behind.
		expect(sameProgress(written as SaveV4, { ...moved, edits: [], worlds: [] } as SaveV4)).toBe(
			true
		);
		// One from before the animal book holds the book its party proves: the same as that book
		// written out, in whichever order, both ways, so a tab that loaded it can carry on from a
		// tab that walked and wrote the book.
		const book = { seen: ['fox', 'squirrel'], caught: ['squirrel', 'fox'], freed: [] };
		expect(sameProgress(written as SaveV4, { ...moved, ...book } as SaveV4)).toBe(true);
		expect(sameProgress({ ...moved, ...book } as SaveV4, written as SaveV4)).toBe(true);
		for (const changed of [
			// A new animal met, or caught, is something done: the book is progress.
			{ ...written, seen: ['squirrel', 'fox', 'wolf'] },
			{ ...written, caught: ['squirrel', 'fox', 'wolf'] },
			{ ...written, seen: ['squirrel', 'fox', 'wolf'], caught: ['squirrel', 'fox', 'wolf'] },
			// So is a kind set free.
			{ ...written, freed: ['fox'] },
			{ ...written, party: [animal(1, { nickname: 'Nutkin', hp: 3 }), written.party[1]] },
			{ ...written, party: [...written.party].reverse() },
			{ ...written, party: [...written.party, animal(3)] },
			{ ...written, party: [animal(1), written.party[1]] },
			// Another world is somewhere else entirely: travelling is progress, as a catch is.
			{ ...written, world: 8 },
			{ ...written, home: 8 },
			{ ...written, worlds: [{ world: 3, pos: { x: 0, y: 0 }, facing: 'up' }] },
			{ ...written, name: 'Nini' },
			{ ...written, battle: { step: 0 } },
			{ ...written, inventory: { leashes: 1 } },
			// Tokens and items are what a kid has, not where they are.
			{ ...written, tokens: 8 },
			{ ...written, items: ['axe'] },
			// A puzzle solved is something done.
			{ ...written, solved: 1 },
			// A tree chopped down is something done, too.
			{ ...written, edits: ['0,0:11'] }
		]) {
			expect(sameProgress(written as SaveV4, changed as SaveV4)).toBe(false);
		}
	});

	it('saveExtras returns only the fields SaveV4 does not name, and saveDocument writes them back', () => {
		const withExtras = {
			...written,
			name: 'Nini',
			worlds: [],
			solved: 312,
			inventory: { leashes: 2 },
			battle: { step: 1 }
		} as SaveV4;
		expect(saveExtras(withExtras)).toEqual({ inventory: { leashes: 2 } });
		const doc = saveDocument(
			newGame(1, testStarter()),
			{ lineage: 'L', seq: 1 },
			saveExtras(withExtras)
		);
		expect(doc).toMatchObject({
			inventory: { leashes: 2 },
			lineage: 'L',
			seq: 1,
			version: SAVE_VERSION
		});
		expect(validateSaveWrite(doc).ok).toBe(true);
		expect('battle' in doc).toBe(false);
		expect('worlds' in doc).toBe(false);
	});
});

describe('the v3 → v4 upgrade', () => {
	/** A v3 document from a random v1 one, a book and a freed list among its fields. */
	function randomV3(rng: Rng): Record<string, unknown> {
		const up = upgradeSave(randomV1(rng, WORLD_ONE_SEED), SAVE_UPGRADES, 3);
		if (!up.ok) throw new Error('should upgrade to v3');
		const doc = JSON.parse(JSON.stringify(up.doc)) as Record<string, unknown>;
		if (rng.chance(0.5)) doc.worlds = [{ world: 3, pos: { x: 1, y: 2 }, facing: 'up' }];
		if (rng.chance(0.5)) doc.name = 'Nini';
		// Extras a later build could have left under the names v4 took.
		for (const key of ['land', 'lands', 'unlocked', V3_KEPT]) {
			if (rng.chance(0.15)) doc[key] = rng.pick([7, 'arctic', { deep: [1, 2] }, [3], null]);
		}
		return doc;
	}

	it('puts every v3 save wholly in Nordland, everything else exactly as it was', () => {
		const doc = {
			...written,
			version: 3,
			tokens: 31,
			items: ['axe', 'boat'],
			freed: ['wolf'],
			seen: ['squirrel', 'fox', 'wolf'],
			caught: ['squirrel', 'fox'],
			edits: ['0,0:11'],
			worlds: [{ world: 3, pos: { x: 1, y: 2 }, facing: 'up' }],
			inventory: { leashes: 3 }
		};
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.save).toEqual({ ...doc, version: SAVE_VERSION, land: 'nordland' });
		expect(V3_KEPT in read.save).toBe(false);
		// The game it restores is the one the v3 save held, in Nordland, its world Nordland's.
		const game = restoreGame(read.save, mint);
		expect(game).toMatchObject({
			land: 'nordland',
			world: WORLD,
			pos: doc.pos,
			tokens: 31,
			items: ['axe', 'boat'],
			lands: [],
			unlocked: ['nordland']
		});
		expect(game.party.map((a) => a.id)).toEqual(doc.party.map((a) => a.id));
	});

	it('is total and loses nothing: every valid v3 save upgrades to a valid v4 one it can be rebuilt from', () => {
		let kept = 0;
		for (let s = 0; s < 400; s++) {
			const rng = new Rng(hashInts(91, s));
			const v3doc = randomV3(rng);
			const before = JSON.stringify(v3doc);
			const read = readSave(v3doc);
			expect(read.ok, `${s}: ${JSON.stringify(read)}`).toBe(true);
			if (!read.ok) continue;
			expect(JSON.stringify(v3doc)).toBe(before);
			const doc = read.save as unknown as Record<string, unknown>;
			expect(doc.version).toBe(SAVE_VERSION);
			expect(doc.land).toBe('nordland');
			expect(downgradeToV3(doc)).toEqual(v3doc);
			if (V3_KEPT in doc) kept++;
			// It plays: a game in Nordland, at its own spot when it can stand there.
			const game = restoreGame(read.save, mint);
			expect(game.land).toBe('nordland');
			expect(game.lands).toEqual([]);
		}
		expect(kept).toBeGreaterThan(20);
	});

	it("restores a v3 save to exactly the game the v3 build restored, with Nordland's fields beside", () => {
		// The v3 build's `restoreGame` is this one's without the lands: every field it had, the same.
		for (let s = 0; s < 200; s++) {
			const rng = new Rng(hashInts(92, s));
			const v3doc = randomV3(rng);
			const read = readSave(v3doc);
			if (!read.ok) throw new Error(`${s}`);
			const game = restoreGame(read.save, mints('minted'));
			const { land: _land, ...landless } = read.save;
			const asV4 = readSave(landless);
			if (!asV4.ok) throw new Error(`${s}: ${asV4.error}`);
			// A v4 save with no `land` is in Nordland: the same game.
			expect(restoreGame(asV4.save, mints('minted'))).toEqual(game);
		}
	});
});

describe('lands in a save', () => {
	const rabbit = { id: 'r1', speciesId: 'rabbit', hp: 22 };
	const arcticStay = {
		land: 'arctic',
		party: [rabbit],
		tokens: 6,
		items: ['axe'],
		worlds: [{ world: WORLD, pos: { x: 4, y: 5 }, facing: 'left' }]
	};

	it('checks a land left behind: its land, party, money, items and worlds', () => {
		expect(error({ ...written, lands: [arcticStay] })).toBe('');
		expect(
			error({ ...written, land: 'arctic', lands: [{ ...arcticStay, land: 'nordland' }] })
		).toBe('');
		expect(error({ ...written, lands: [{ land: 'arctic', party: [] }] })).toBe('');
		const bad: [unknown, RegExp][] = [
			['arctic', /lands must be a list/],
			[[7], /lands\[0\] must be an object/],
			[[{ ...arcticStay, land: 'Arctic!' }], /lands\[0\]\.land/],
			[[{ ...arcticStay, party: 'none' }], /lands\[0\]\.party must be a list/],
			[[{ ...arcticStay, party: [rabbit, rabbit] }], /lands\[0\]\.party\[1\]\.id repeats/],
			[[{ ...arcticStay, party: [{ ...rabbit, hp: -1 }] }], /lands\[0\]\.party\[0\]\.hp/],
			[[{ ...arcticStay, tokens: 1.5 }], /lands\[0\]\.tokens/],
			[[{ ...arcticStay, items: [7] }], /lands\[0\]\.items/],
			[[{ ...arcticStay, worlds: [{ world: 0 }] }], /lands\[0\]\.worlds\[0\]\.world/],
			[
				[{ ...arcticStay, worlds: [arcticStay.worlds[0], arcticStay.worlds[0]] }],
				/repeats an earlier world/
			],
			// Each land once, and never the land the player is in.
			[[arcticStay, arcticStay], /lands\[1\]\.land repeats/],
			[[{ ...arcticStay, land: 'nordland' }], /lands\[0\]\.land repeats/]
		];
		for (const [lands, message] of bad) {
			expect(error({ ...written, lands }), JSON.stringify(lands)).toMatch(message);
		}
		expect(error({ ...written, land: 7 })).toMatch(/land must be a land id/);
		expect(error({ ...written, unlocked: 'arctic' })).toMatch(/unlocked/);
		expect(error({ ...written, unlocked: ['Arctic!'] })).toMatch(/unlocked/);
		// A land unlocked that this build lacks is kept and does nothing.
		expect(error({ ...written, unlocked: ['nordland', 'savannah'] })).toBe('');
	});

	it("reads a land, or a species of a land left behind, that this build lacks as a newer build's", () => {
		const newer = [
			{ ...written, land: 'savannah' },
			{ ...written, lands: [{ ...arcticStay, land: 'savannah' }] },
			{ ...written, lands: [{ ...arcticStay, party: [{ ...rabbit, speciesId: LATER.species }] }] }
		];
		for (const doc of newer) {
			expect(readSave(doc), JSON.stringify(doc).slice(0, 120)).toMatchObject({
				ok: false,
				reason: 'newer'
			});
			expect(isNewerSave(doc)).toBe(true);
			expect(canReplace(doc, { seq: 99 })).toBe(false);
		}
	});

	it('a game in The Arctic, with Nordland left behind, restores exactly that game', () => {
		const game: SavedGame = {
			...newGame(WORLD, testStarter(), 'Nini'),
			land: 'arctic',
			pos: findTile(landSeed('arctic', WORLD), true),
			facing: 'up',
			party: [rabbit],
			tokens: 6,
			items: ['axe'],
			edits: ['0,0:11'],
			worlds: [{ world: 9, pos: { x: 3, y: 4 }, facing: 'down', edits: [] }],
			lands: [
				{
					land: 'nordland',
					party: [
						{ id: 's', speciesId: 'squirrel', hp: 3, nickname: 'Nutkin' },
						{ id: 'f', speciesId: 'fox', hp: 0 }
					],
					tokens: 40,
					items: ['boat', 'glider'],
					worlds: [{ world: WORLD, pos: { x: -7, y: 3 }, facing: 'left', edits: ['1,1:22'] }]
				}
			],
			seen: ['squirrel', 'fox', 'rabbit'],
			caught: ['squirrel', 'fox', 'rabbit'],
			freed: [],
			unlocked: ['nordland', 'arctic']
		};
		const doc = saveDocument(game, { lineage: 'L', seq: 9 });
		expect(doc).toMatchObject({ land: 'arctic', unlocked: ['nordland', 'arctic'] });
		expect(validateSaveWrite(doc).ok).toBe(true);
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		expect(read.ok).toBe(true);
		if (read.ok) expect(restoreGame(read.save, mint)).toEqual(game);
	});

	it('writes no lands and no unlocked lands until there are some, so a game in Nordland saves as before', () => {
		const doc = saveDocument(newGame(WORLD, testStarter()), { lineage: 'L', seq: 1 });
		expect(doc.land).toBe('nordland');
		expect('lands' in doc).toBe(false);
		expect('unlocked' in doc).toBe(false);
		// A land left behind with nothing in it writes only its land and party.
		const left = saveDocument(
			{
				...newGame(WORLD, testStarter()),
				lands: [{ land: 'arctic', party: [], tokens: 0, items: [], worlds: [] }]
			},
			{ lineage: 'L', seq: 2 }
		);
		expect(left.lands).toEqual([{ land: 'arctic', party: [] }]);
	});

	it('an empty party in a later land waits for a starter; in Nordland it gets the starter, as ever', () => {
		const arctic = restoreGame({ ...written, land: 'arctic', party: [] } as SaveV4, mint);
		expect(arctic.party).toEqual([]);
		const nordland = restoreGame({ ...written, party: [] } as SaveV4, mint);
		expect(nordland.party.map((a) => a.speciesId)).toEqual([STARTER_SPECIES]);
		// A land left behind is never given one: nobody plays it until the kid flies back.
		const left = restoreGame(
			{ ...written, lands: [{ land: 'arctic', party: [] }] } as SaveV4,
			mint
		);
		expect(left.lands[0]!.party).toEqual([]);
	});

	it("never puts another land's animal in a land's party: a land's own starter, or none while one is picked", () => {
		// The adversarial review of #196: a sea-only party in The Arctic got Nordland's squirrel.
		// Since #192 The Arctic has starters of its own, and its first one joins.
		const seaOnly = restoreGame(
			{ ...written, land: 'arctic', party: [{ id: 'c1', speciesId: 'crab', hp: 10 }] } as SaveV4,
			mint
		);
		expect(seaOnly.party.map((a) => a.speciesId)).toEqual(['crab', 'arctic-fox']);
		const empty = restoreGame({ ...written, land: 'arctic', party: [] } as SaveV4, mint);
		expect(empty.party).toEqual([]);
	});

	it('mends a land left behind as it mends the land the player is in, and unlocks what its kinds set free unlock', () => {
		const save = {
			...written,
			freed: getLand('nordland').species,
			seen: getLand('nordland').species,
			lands: [
				{
					land: 'arctic',
					party: [
						{ ...rabbit, hp: 999, nickname: '  Snow  ' },
						{ id: 'f2', speciesId: 'fox', hp: 3 },
						{ id: 'r2', speciesId: 'rabbit', hp: 1 }
					],
					items: ['axe', 'axe'],
					worlds: [
						arcticStay.worlds[0],
						{ world: 12, pos: { x: 0, y: 0 }, facing: 'down', edits: ['0,0:11'] }
					]
				}
			]
		} as SaveV4;
		const game = restoreGame(save, mint);
		const left = game.lands[0]!;
		// HP cut to the maximum, the nickname cleaned, the party in species bundles.
		expect(left.party.map((a) => [a.id, a.hp, a.nickname])).toEqual([
			['r1', 22, 'Snow'],
			['r2', 1, undefined],
			['f2', 3, undefined]
		]);
		expect(left).toMatchObject({ tokens: 0, items: ['axe'] });
		expect(left.worlds.map((w) => [w.world, w.edits])).toEqual([
			[WORLD, []],
			[12, ['0,0:11']]
		]);
		expect(game.unlocked).toEqual(['nordland', 'arctic']);
	});

	it("shares the one budget for cleared tiles with every land's worlds: the world the player is in whole", () => {
		const big = (x0: number) => {
			let e = WorldEdits.none;
			for (let cx = 0; cx < 40; cx++) {
				for (let i = 0; i < 200; i++)
					e = e.with({ x: x0 + cx * 16 + (i % 16), y: Math.floor(i / 16) });
			}
			return [...e.encode()];
		};
		const here = big(0);
		const save = {
			...written,
			edits: here,
			lands: [
				{
					land: 'arctic',
					party: [],
					worlds: [{ world: 2, pos: { x: 0, y: 0 }, facing: 'down', edits: big(9000) }]
				}
			]
		} as SaveV4;
		const game = restoreGame(save, mint);
		const length = (e: readonly string[]) => (e.length === 0 ? 0 : JSON.stringify(e).length);
		expect(game.edits).toEqual(here);
		const total = length(game.edits) + length(game.lands[0]!.worlds[0]!.edits);
		expect(total).toBeLessThanOrEqual(EDITS_BUDGET);
	});

	it('counts the land, the lands left and the lands unlocked as progress, never whereabouts', () => {
		const base = restoreGame(written as SaveV4, mint);
		const doc = (g: SavedGame) => saveDocument(g, { lineage: 'game-a', seq: 3 });
		const a = doc(base);
		expect(sameProgress(a, doc({ ...base, pos: { x: 0, y: 0 } }))).toBe(true);
		expect(sameProgress(a, doc({ ...base, land: 'arctic' }))).toBe(false);
		expect(sameProgress(a, doc({ ...base, unlocked: ['nordland', 'arctic'] }))).toBe(false);
		expect(
			sameProgress(
				a,
				doc({ ...base, lands: [{ land: 'arctic', party: [], tokens: 0, items: [], worlds: [] }] })
			)
		).toBe(false);
		// A save without `unlocked` holds what its kinds set free unlock: the same progress.
		const freedAll = {
			...a,
			freed: [...getLand('nordland').species],
			seen: [...getLand('nordland').species]
		};
		expect(sameProgress(freedAll, { ...freedAll, unlocked: ['nordland', 'arctic'] })).toBe(true);
	});
});
