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
import {
	MAX_SAVED_NAME_LENGTH,
	MAX_SAVED_NICKNAME_LENGTH,
	SAVE_UPGRADES,
	SAVE_VERSION,
	STARTER_SPECIES,
	V1_KEPT,
	canReplace,
	isContentId,
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
	type SaveV2,
	type SavedGame
} from '../src/save.js';
import { ITEM_IDS, gearOf } from '../src/items/catalog.js';
import { ALL_PUZZLE_KINDS } from '../src/puzzles/types.js';
import { EDITS_BUDGET, WorldEdits } from '../src/world/edits.js';
import { tileAtWorld } from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import { TENT_SEARCH_STEPS, nearestTent } from '../src/world/tents.js';
import { isPassable, isWalkable, isWater, tileRealm, type Direction } from '../src/world/types.js';
import {
	FIRST_WORLD,
	MAX_WORLDS_KEPT,
	WORLD_ONE_SEED,
	worldSeed,
	type WorldStay
} from '../src/world/worlds.js';
import { makeParty, makeWild, playBattle } from './battle-sim.js';

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

/** The five fields every v2 save has. */
const v2 = {
	version: 2,
	home: WORLD,
	world: WORLD,
	pos: { x: -7, y: 3 },
	party: [animal(1, { nickname: 'Nutkin' }), animal(2, { speciesId: 'fox' })]
};

/** A document ready to write. */
const written = { ...v2, facing: 'left', steps: 12, visits: 2, lineage: 'game-a', seq: 3 };

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

describe('validateSave', () => {
	it('accepts a v2 save with only the fields it needs, and one the client writes', () => {
		expect(validateSave(v2)).toEqual({ ok: true, value: v2 });
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
		expect(error({ ...v2, version: 1 })).toMatch(/version/);
		expect(error({ ...v2, version: 3 })).toMatch(/version/);
		expect(error({ ...v2, version: '2' })).toMatch(/version/);
	});

	it('refuses a missing or wrong world or home, and a bad position', () => {
		for (const key of ['home', 'world'] as const) {
			const { [key]: _gone, ...without } = v2;
			expect(error(without), key).toMatch(new RegExp(key));
			for (const bad of [0, 10_000, -1, 1.5, '7', null]) {
				expect(error({ ...v2, [key]: bad }), `${key} ${String(bad)}`).toMatch(new RegExp(key));
			}
		}
		expect(error({ ...v2, world: 1, home: 9999 })).toBe('');
		expect(error({ ...v2, pos: { x: '1', y: 2 } })).toMatch(/pos/);
		expect(error({ ...v2, pos: [1, 2] })).toMatch(/pos/);
		expect(error({ ...v2, pos: { x: 1 } })).toMatch(/pos/);
	});

	it('takes a name as text of a sane length, and never needs one', () => {
		expect(error({ ...v2, name: 'Nini' })).toBe('');
		// Whether it is a name is `checkName`'s to say, on load: a save is never unreadable over one.
		expect(error({ ...v2, name: 'x'.repeat(MAX_SAVED_NAME_LENGTH) })).toBe('');
		for (const name of ['', 'x'.repeat(MAX_SAVED_NAME_LENGTH + 1), 7, null, ['Nini']]) {
			expect(error({ ...v2, name }), JSON.stringify(name)).toMatch(/name/);
		}
	});

	it('takes a party of any size, with no cap, and refuses one that is not a list', () => {
		const many = Array.from({ length: 1000 }, (_, i) => animal(i));
		expect(error({ ...v2, party: many })).toBe('');
		expect(error({ ...v2, party: [] })).toBe('');
		expect(error({ ...v2, party: { a: 1 } })).toMatch(/party/);
	});

	it('refuses an animal with an unknown species, bad hp, a bad id or nickname, or a repeated id', () => {
		expect(error({ ...v2, party: [animal(1, { speciesId: 'dragon' })] })).toMatch(/species/);
		expect(error({ ...v2, party: [animal(1, { hp: -1 })] })).toMatch(/hp/);
		expect(error({ ...v2, party: [animal(1, { hp: 2.5 })] })).toMatch(/hp/);
		expect(error({ ...v2, party: [animal(1, { hp: '10' })] })).toMatch(/hp/);
		expect(error({ ...v2, party: [animal(1, { id: '' })] })).toMatch(/id/);
		expect(error({ ...v2, party: [animal(1, { id: 'x'.repeat(65) })] })).toMatch(/id/);
		expect(error({ ...v2, party: [animal(1, { nickname: 7 })] })).toMatch(/nickname/);
		expect(error({ ...v2, party: [animal(1, { nickname: null })] })).toMatch(/nickname/);
		const long = 'n'.repeat(MAX_SAVED_NICKNAME_LENGTH + 1);
		expect(error({ ...v2, party: [animal(1, { nickname: long })] })).toMatch(/nickname/);
		expect(error({ ...v2, party: [animal(1), animal(1)] })).toMatch(/id/);
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
		expect(error({ ...v2, party: [animal(1, { nickname: 'a\u0000b' })] })).toMatch(/nickname/);
		expect(error({ ...v2, party: [animal(1, { id: 'a\ud800' })] })).toMatch(/id/);
		expect(error({ ...v2, note: '\udc00' })).toMatch(/note/);
		expect(error({ ...v2, ['a\u0000b']: 1 })).toMatch(/key/);
		expect(error({ ...v2, big: Infinity })).toMatch(/big/);
		expect(error({ ...v2, party: [animal(1, { x: -Infinity })] })).toMatch(/x/);
		expect(error({ ...v2, name: 'Ni\u0000ni' })).toMatch(/name/);
		// A surrogate pair (an emoji) is fine.
		expect(error({ ...v2, party: [animal(1, { nickname: 'Nut 🐿️' })] })).toBe('');
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
		expect(validateSaveWrite(v2).ok).toBe(false);
	});

	it("takes an older build's backup, upgraded: a page still open from before an update keeps backing up", () => {
		const checked = validateSaveWrite(JSON.parse(JSON.stringify(writtenV1)));
		expect(checked.ok).toBe(true);
		if (!checked.ok) return;
		const { seed: _seed, ...rest } = writtenV1;
		expect(checked.value).toEqual({ ...rest, version: 2, world: 1, home: 1 });
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
		expect(readSave(v1)).toEqual({ ok: true, save: { ...rest, version: 2, world: 1, home: 1 } });
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
		const [{ state }] = battleStates(3, ['squirrel', 'fox'], 'rabbit');
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
	});

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
			'crab',
			'starfish',
			'turtle',
			'dolphin',
			'octopus',
			'whale'
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
	for (const key of ['inventory', 'name', 'home', 'world', 'worlds', 'solved', V1_KEPT]) {
		if (rng.chance(0.15)) doc[key] = rng.pick([7, 'Nini', { deep: [1, 2] }, [3], null]);
	}
	return doc;
}

/**
 * The v1 document a v2 one was upgraded from: the upgrade's inverse, a check
 * that it drops nothing. What v2 has no place for came back from `v1`.
 */
function downgrade(doc: Record<string, unknown>): Record<string, unknown> {
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
		expect(read.save).toEqual({ ...rest, version: 2, world: 1, home: 1 });
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
			...newGame(WORLD, undefined, 'Nini'),
			battle: { step: 0 } as unknown as BattleState,
			edits: ['0,0:11'],
			worlds: [{ world: 3, pos: { x: 0, y: 0 }, facing: 'up', edits: [] }]
		};
		const taken = Object.keys(saveDocument(game, { lineage: 'L', seq: 1 })).filter(
			(key) => !v1Fields.has(key)
		);
		expect(taken).toEqual(expect.arrayContaining(['name', 'home', 'world', 'worlds', 'solved']));
		const bad: string[] = [];
		for (const key of taken) {
			for (const junk of ['x', -1, 1.5, 12, { a: 1 }, [2], null]) {
				const read = readSave({ ...writtenV1, [key]: junk });
				const kept = read.ok
					? (read.save as unknown as Record<string, Record<string, unknown>>)[V1_KEPT]
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
			expect(up).toMatchObject({ version: 2, world: 1, home: 1 });
			expect(downgrade(up)).toEqual(doc);
			// Whatever it held, it is a document a write may carry once it has a write's stamp.
			const stamp = { facing: 'down', steps: 0, visits: 0, lineage: 'L', seq: 1 };
			expect(validateSaveWrite({ ...stamp, ...up }).ok).toBe(true);
		}
		// About 0.25 s alone (500 random v1 saves, each read, rebuilt and checked as a write);
		// 3.4 s at a load average of 40.
	}, 30_000);

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
			const game = restoreGame(read.save);
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
		const game = newGame(WORLD);
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
			battle: null,
			edits: [],
			worlds: []
		});
		expect(newGame(1, undefined, 'Nini').name).toBe('Nini');
		expect(newGame(1).pos).toEqual({ x: -2, y: 6 });
	});

	it('a save with only the fields it needs gets facing down, no steps, tokens, items, puzzles solved, name, nothing cleared, no world left', () => {
		const pos = findTile(SEED7, true);
		const game = restoreGame({ ...v2, pos } as SaveV2);
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
			battle: null,
			edits: [],
			worlds: []
		});
		expect(game.party).toEqual(v2.party);
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
			battle: null,
			edits: [],
			worlds: [
				{ world: 4321, pos: { x: 3, y: -9 }, facing: 'left', edits: ['0,0:11'] },
				{ world: 12, pos: { x: 0, y: 0 }, facing: 'down', edits: [] }
			]
		};
		const doc = saveDocument(game, { lineage: 'L', seq: 9 });
		expect(validateSaveWrite(doc).ok).toBe(true);
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		expect(read.ok).toBe(true);
		if (read.ok) expect(restoreGame(read.save)).toEqual(game);
	});

	it('an item listed twice is owned once, and the list is never shared with the save', () => {
		const pos = findTile(SEED7, true);
		const save = { ...v2, pos, tokens: 5, items: ['axe', 'boat', 'axe'] } as SaveV2;
		const game = restoreGame(save);
		expect(game.items).toEqual(['axe', 'boat']);
		game.items.push('pickaxe');
		expect(save.items).toEqual(['axe', 'boat', 'axe']);
	});

	it('never strands the player: a blocked tile becomes the spawn tile', () => {
		const blocked = findTile(SEED7, false);
		const game = restoreGame({ ...v2, pos: blocked } as SaveV2);
		expect(game.pos).toEqual(spawnPoint(SEED7));
	});

	it('out on the water with the boat, the player is still in it; without the boat, back on the spawn tile', () => {
		const worldOne = { ...v2, world: FIRST_WORLD };
		const shallow = waterNearSpawn('water');
		const deep = waterNearSpawn('deepwater');
		for (const pos of [shallow, deep]) {
			const withBoat = restoreGame({ ...worldOne, pos, items: ['axe', 'boat'] } as SaveV2);
			expect(withBoat.pos).toEqual(pos);
			// A game that somehow lost its boat (a hand-edited save) never leaves the
			// kid stuck out on the water: it starts again from the spawn tile.
			for (const items of [[], ['axe', 'pickaxe'], undefined]) {
				const without = restoreGame({ ...worldOne, pos, items } as SaveV2);
				expect(without.pos).toEqual(spawnPoint(SEED));
			}
		}
		// Rock, trees and tents are no place for anyone, boat or not.
		for (const kind of ['rock', 'tree', 'tent']) {
			const pos = findKind(SEED, kind);
			expect(restoreGame({ ...worldOne, pos, items: ['boat'] } as SaveV2).pos).toEqual(
				spawnPoint(SEED)
			);
		}
	});

	it('cuts an HP above the maximum, gives an empty party the starter, and keeps a tired party tired', () => {
		const pos = findTile(SEED7, true);
		const over = restoreGame({ ...v2, pos, party: [animal(1, { hp: 999 })] } as SaveV2);
		expect(over.party[0]!.hp).toBe(getAnimal('squirrel').maxHp);

		const empty = restoreGame({ ...v2, pos, party: [] } as SaveV2);
		expect(empty.party).toEqual(newGame(WORLD).party);

		// A doctor's tent is a walk away from beside the spawn: a reload is no heal.
		expect(nearestTent(SEED7, pos)).not.toBeNull();
		const tired = restoreGame({
			...v2,
			pos,
			party: [animal(1, { hp: 0 }), animal(2, { speciesId: 'bear', hp: 0 })]
		} as SaveV2);
		expect(tired.party.map((a) => a.hp)).toEqual([0, 0]);
		expect(tired.pos).toEqual(pos);
	});

	it('a team that needs the doctor stays tired where a tent is in reach, and a doctor comes where none is', () => {
		const tired = [animal(1, { hp: 0 }), animal(2, { speciesId: 'bear', hp: 0 })];
		const rested = tired.map((a) => getAnimal(a.speciesId).maxHp);
		// Walled in: a walkable tile with nothing walkable and no tent beside it.
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
		const cameThere = restoreGame({ ...v2, pos: walled!, party: tired } as SaveV2);
		expect(cameThere.party.map((a) => a.hp)).toEqual(rested);
		expect(cameThere.pos).toEqual(walled);

		// Out on the water in the boat, with nobody standing: a tent over the water is in reach.
		const deep = findKind(SEED7, 'deepwater');
		const swimmers = [animal(1, { speciesId: 'otter', hp: 0 })];
		const atSea = restoreGame({ ...v2, pos: deep, items: ['boat'], party: swimmers } as SaveV2);
		expect(atSea.pos).toEqual(deep);
		expect(atSea.party.map((a) => a.hp)).toEqual([0]);
		// A walker standing in the boat can battle on land: nobody needs the doctor, so nobody comes.
		const walker = [...swimmers, animal(2, { speciesId: 'squirrel', hp: 3 })];
		const inBoat = restoreGame({ ...v2, pos: deep, items: ['boat'], party: walker } as SaveV2);
		expect(inBoat.party.map((a) => a.hp)).toEqual([0, 3]);
		// On land with only a sea animal standing: the grass is quiet, the tent a walk away.
		const crab = [animal(1, { hp: 0 }), animal(2, { speciesId: 'crab', hp: 5 })];
		const ashore = restoreGame({ ...v2, pos: spawn, party: crab } as SaveV2);
		expect(ashore.party.map((a) => a.hp)).toEqual([0, 5]);
	});

	it('gives a party of only sea animals the starter too, behind them: the grass is never out of reach', () => {
		const pos = findTile(SEED7, true);
		const sea = [animal(1, { speciesId: 'crab', hp: 0 }), animal(2, { speciesId: 'whale' })];
		for (const items of [[], ['boat']]) {
			const game = restoreGame({ ...v2, pos, items, party: sea } as SaveV2);
			expect(game.party.map((a) => a.speciesId)).toEqual(['crab', 'whale', STARTER_SPECIES]);
			expect(game.party[leadIndex(game.party, 'land')]!.speciesId).toBe(STARTER_SPECIES);
			// Somebody stood already: nobody is rested, the tired crab included.
			expect(game.party[0]!.hp).toBe(0);
		}
		// Its id is new to the party, whatever the save called its animals.
		const taken = [animal(1, { id: 'starter', speciesId: 'turtle' })];
		const ids = restoreGame({ ...v2, pos, party: taken } as SaveV2).party.map((a) => a.id);
		expect(new Set(ids).size).toBe(2);
		// A battle saved with such a party is dropped: it was not fought with the starter.
		const deep = findKind(SEED7, 'deepwater');
		const whale = [animal(1, { speciesId: 'whale', hp: 50 })];
		const battle = startBattle(whale, makeWild('crab'), { realm: 'water' });
		const atSea = { ...v2, pos: deep, items: ['boat'], party: whale, battle } as SaveV2;
		const back = restoreGame(JSON.parse(JSON.stringify(atSea)));
		expect(back.battle).toBeNull();
		expect(back.pos).toEqual(deep);
		expect(back.party.map((a) => a.speciesId)).toEqual(['whale', STARTER_SPECIES]);
		// An animal that walks, even tired, is enough: the doctor is a walk away.
		const walker = [animal(1, { speciesId: 'crab' }), animal(2, { speciesId: 'frog', hp: 0 })];
		expect(restoreGame({ ...v2, pos, party: walker } as SaveV2).party).toHaveLength(2);
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
				...v2,
				world,
				home: rng.pick(worlds),
				pos: { x: rng.int(-300, 300), y: rng.int(-300, 300) },
				party,
				facing: rng.pick(['up', 'down', 'left', 'right'] as Direction[]),
				steps: rng.int(0, 10_000),
				items: rng.pick([[], ['boat'], ['axe'], ['boat', 'boat']])
			} as SaveV2;
			const game = restoreGame(save);
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
			// A team that needs the doctor has one in reach, the way the kid gets about: never
			// stranded with nobody to fight and nowhere to heal.
			const here = tileRealm(tileAtWorld(seed, game.pos.x, game.pos.y).kind);
			const edits = WorldEdits.decode(game.edits);
			if (
				needsDoctor(game.party, here) &&
				nearestTent(seed, game.pos, TENT_SEARCH_STEPS, edits, gear) === null
			) {
				note('tired, with no doctor in reach');
			}
			// A battle can start with it where an animal standing can fight: the party is one
			// `startBattle` accepts there (only sea animals standing, out on the water).
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
		const game = restoreGame({ ...written, world: 1, pos, party } as SaveV2);
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
			const restored = restoreGame({ ...written, world: 1, pos, party: mixed } as SaveV2).party;
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
		const game = restoreGame(save);
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

describe("the player's name in a save", () => {
	it('comes back as saved, and is written only once there is one', () => {
		const pos = findTile(SEED7, true);
		expect(restoreGame({ ...v2, pos, name: 'Nini' } as SaveV2).name).toBe('Nini');
		expect(restoreGame({ ...v2, pos, name: 'Ørn-Åse 2' } as SaveV2).name).toBe('Ørn-Åse 2');
		expect('name' in saveDocument(newGame(1), { lineage: 'L', seq: 1 })).toBe(false);
		expect(saveDocument(newGame(1, undefined, 'Bo'), { lineage: 'L', seq: 1 }).name).toBe('Bo');
	});

	it('a stored name that is not one (hand-edited, or a rule grown since) loads as no name: the kid is asked again', () => {
		const pos = findTile(SEED7, true);
		for (const name of ['x', 'Fuck', 'a'.repeat(MAX_NAME_LENGTH + 1), 'Pip!', '  ']) {
			expect(restoreGame({ ...v2, pos, name } as SaveV2).name, name).toBeNull();
		}
		// One that only needed tidying comes back tidy.
		expect(restoreGame({ ...v2, pos, name: '  Ida   Marie ' } as SaveV2).name).toBe('Ida Marie');
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
		...newGame(1),
		home: 1,
		worlds,
		...extra
	});
	const roundTrip = (g: SavedGame) => {
		const read = readSave(JSON.parse(JSON.stringify(saveDocument(g, { lineage: 'L', seq: 1 }))));
		if (!read.ok) throw new Error(read.error);
		return restoreGame(read.save);
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
		} as SaveV2;
		expect(restoreGame(doc).worlds).toEqual([
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
		const game: SavedGame = { ...newGame(1), edits: [...edits.encode()] };
		const doc = saveDocument(game, { lineage: 'L', seq: 4 });
		expect(validateSaveWrite(doc).ok).toBe(true);
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const restored = restoreGame(read.save);
		expect(restored).toEqual(game);
		const back = WorldEdits.decode(restored.edits);
		for (const p of cleared) expect(back.has(p.x, p.y)).toBe(true);
		expect(back.size).toBe(40);
		// The restored list is the game's own, never the document's.
		restored.edits.push('9,9:00');
		expect(read.save.edits).toHaveLength(edits.encode().length);
	});

	it('are written only once something is cleared, so a game that never used a tool saves as before', () => {
		expect('edits' in saveDocument(newGame(1), { lineage: 'L', seq: 1 })).toBe(false);
		expect(restoreGame(v2 as SaveV2).edits).toEqual([]);
	});

	it('are written canonically, whatever order a save held them in', () => {
		const shuffled = new Rng(4).shuffle([...edits.encode()]);
		const pos = findTile(SEED, true);
		const restored = restoreGame({ ...written, world: 1, pos, edits: shuffled } as SaveV2);
		expect(restored.edits).toEqual(edits.encode());
	});

	it('keep a player standing where they cleared: a cleared tree is ground to stand on', () => {
		// Stand on a cleared tree or rock: without the overlay that tile is blocked.
		const on = cleared[0]!;
		const save = { ...written, world: 1, pos: on, edits: [...edits.encode()] } as SaveV2;
		expect(restoreGame(save).pos).toEqual(on);
		// The same save without its edits cannot stand there, and goes to the spawn tile.
		expect(restoreGame({ ...save, edits: undefined }).pos).toEqual(spawnPoint(SEED));
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
		const restored = restoreGame(read.save);
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

	it('drops a battle that does not fit the party or the rules', () => {
		const [{ state }] = battleStates(3, ['squirrel', 'fox'], 'rabbit');
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

	it('comes back with the saved game out on the water only with the boat', () => {
		const pos = waterNearSpawn('deepwater');
		const party = makeParty(['squirrel', 'otter']);
		const battle = startBattle(party, makeWild('otter'), { realm: 'water' });
		const game = { ...newGame(1), pos, facing: 'left' as const, steps: 11, party };
		const withBoat = saveDocument({ ...game, items: ['boat'], battle }, { lineage: 'L', seq: 2 });
		expect(restoreGame(JSON.parse(JSON.stringify(withBoat))).battle).toEqual(battle);
		const noBoat = saveDocument({ ...game, items: [], battle }, { lineage: 'L', seq: 2 });
		const restored = restoreGame(JSON.parse(JSON.stringify(noBoat)));
		expect(restored.battle).toBeNull();
		expect(restored.pos).toEqual(spawnPoint(SEED));
		expect(isWater(tileAtWorld(SEED, pos.x, pos.y).kind)).toBe(true);
	});

	it('comes back with the saved game only while the player stands where the battle is', () => {
		const pos = findTile(SEED, true);
		const party = makeParty(['squirrel']);
		const battle = startBattle(party, makeWild('rabbit'));
		const doc = saveDocument(
			{ ...newGame(1), pos, facing: 'left', steps: 11, party, battle },
			{ lineage: 'L', seq: 2 }
		);
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		expect(read.ok && restoreGame(read.save).battle).toEqual(battle);
		const moved = { ...doc, pos: findTile(SEED, false) };
		expect(restoreGame(moved).battle).toBeNull();
	});
});

describe('which save wins', () => {
	it('saveSeq, saveLineage and saveVersion read any stored value, and default to 0, "" and 0', () => {
		expect(saveSeq(written)).toBe(3);
		expect(saveLineage(written)).toBe('game-a');
		expect(saveVersion(written)).toBe(2);
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
		expect(sameProgress(written as SaveV2, moved as SaveV2)).toBe(true);
		// Key order and absent-versus-undefined do not matter.
		const reordered = JSON.parse(JSON.stringify({ party: written.party, ...written }));
		expect(sameProgress(written as SaveV2, { ...reordered, extra: undefined })).toBe(true);
		// A save from before the shop has no tokens and no items: the same as none written out.
		expect(sameProgress(written as SaveV2, { ...moved, tokens: 0, items: [] } as SaveV2)).toBe(
			true
		);
		// One from before the count of puzzles has solved none: the same as 0 written out,
		// both ways, so a tab that loaded it can carry on from a tab that walked and wrote 0.
		expect(sameProgress(written as SaveV2, { ...moved, solved: 0 } as SaveV2)).toBe(true);
		expect(sameProgress({ ...moved, solved: 0 } as SaveV2, written as SaveV2)).toBe(true);
		// One from before the tools has cleared nothing: the same as an empty overlay; and one
		// that never travelled has left no world behind.
		expect(sameProgress(written as SaveV2, { ...moved, edits: [], worlds: [] } as SaveV2)).toBe(
			true
		);
		for (const changed of [
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
			expect(sameProgress(written as SaveV2, changed as SaveV2)).toBe(false);
		}
	});

	it('saveExtras returns only the fields SaveV2 does not name, and saveDocument writes them back', () => {
		const withExtras = {
			...written,
			name: 'Nini',
			worlds: [],
			solved: 312,
			inventory: { leashes: 2 },
			battle: { step: 1 }
		} as SaveV2;
		expect(saveExtras(withExtras)).toEqual({ inventory: { leashes: 2 } });
		const doc = saveDocument(newGame(1), { lineage: 'L', seq: 1 }, saveExtras(withExtras));
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
