import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import { MAX_PARTY, type AnimalInstance } from '../src/animals/types.js';
import { applyBattleIntent, startBattle } from '../src/battle/reducer.js';
import type { BattleState } from '../src/battle/types.js';
import { Rng, hashInts, hashString } from '../src/rng.js';
import {
	MAX_NICKNAME_LENGTH,
	SAVE_UPGRADES,
	SAVE_VERSION,
	STARTER_SPECIES,
	canReplace,
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
	upgradeSave,
	validateSave,
	validateSaveWrite,
	type SaveV1,
	type SavedGame
} from '../src/save.js';
import { spawnPoint, tileAtWorld } from '../src/world/generate.js';
import { isWalkable, type Direction } from '../src/world/types.js';
import { makeParty, makeWild, playBattle } from './battle-sim.js';

/**
 * The save document: what a save may hold (the validator both the client and
 * the server use), how an old or broken one is read, how a loaded game is made
 * playable, how a saved battle is picked up again, and the rules that decide
 * which of two saves wins.
 */

const SEED = hashString('prototype');
const SEEDS = 25;

function animal(i: number, overrides: Record<string, unknown> = {}) {
	return { id: `a${i}`, speciesId: 'squirrel', hp: 10 + i, ...overrides };
}

/** The four fields every v1 save has had since the first one. */
const v1 = {
	version: 1,
	seed: 12345,
	pos: { x: -7, y: 3 },
	party: [animal(1, { nickname: 'Nutkin' }), animal(2, { speciesId: 'fox' })]
};

/** A document ready to write. */
const written = { ...v1, facing: 'left', steps: 12, lineage: 'game-a', seq: 3 };

function error(input: unknown): string {
	const checked = validateSave(input);
	return checked.ok ? '' : checked.error;
}

describe('validateSave', () => {
	it('accepts a v1 save from before the client wrote any, and one the client writes', () => {
		expect(validateSave(v1)).toEqual({ ok: true, value: v1 });
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
		expect(error({ ...v1, version: 2 })).toMatch(/version/);
		expect(error({ ...v1, version: '1' })).toMatch(/version/);
	});

	it('refuses a missing or fractional seed and a bad position', () => {
		const { seed: _seed, ...noSeed } = v1;
		expect(error(noSeed)).toMatch(/seed/);
		expect(error({ ...v1, seed: 1.5 })).toMatch(/seed/);
		expect(error({ ...v1, pos: { x: '1', y: 2 } })).toMatch(/pos/);
		expect(error({ ...v1, pos: [1, 2] })).toMatch(/pos/);
		expect(error({ ...v1, pos: { x: 1 } })).toMatch(/pos/);
	});

	it(`caps the party at ${MAX_PARTY} and refuses one that is not a list`, () => {
		const full = Array.from({ length: MAX_PARTY }, (_, i) => animal(i));
		expect(error({ ...v1, party: full })).toBe('');
		expect(error({ ...v1, party: [...full, animal(MAX_PARTY)] })).toMatch(/party/);
		expect(error({ ...v1, party: { a: 1 } })).toMatch(/party/);
	});

	it('refuses an animal with an unknown species, bad hp, a bad id or nickname, or a repeated id', () => {
		expect(error({ ...v1, party: [animal(1, { speciesId: 'dragon' })] })).toMatch(/species/);
		expect(error({ ...v1, party: [animal(1, { hp: -1 })] })).toMatch(/hp/);
		expect(error({ ...v1, party: [animal(1, { hp: 2.5 })] })).toMatch(/hp/);
		expect(error({ ...v1, party: [animal(1, { hp: '10' })] })).toMatch(/hp/);
		expect(error({ ...v1, party: [animal(1, { id: '' })] })).toMatch(/id/);
		expect(error({ ...v1, party: [animal(1, { id: 'x'.repeat(65) })] })).toMatch(/id/);
		expect(error({ ...v1, party: [animal(1, { nickname: 7 })] })).toMatch(/nickname/);
		expect(error({ ...v1, party: [animal(1, { nickname: null })] })).toMatch(/nickname/);
		const long = 'n'.repeat(MAX_NICKNAME_LENGTH + 1);
		expect(error({ ...v1, party: [animal(1, { nickname: long })] })).toMatch(/nickname/);
		expect(error({ ...v1, party: [animal(1), animal(1)] })).toMatch(/id/);
	});

	it('checks the later fields when they are present', () => {
		expect(error({ ...written, facing: 'north' })).toMatch(/facing/);
		expect(error({ ...written, steps: -1 })).toMatch(/steps/);
		expect(error({ ...written, steps: 1.5 })).toMatch(/steps/);
		expect(error({ ...written, seq: '3' })).toMatch(/seq/);
		expect(error({ ...written, lineage: '' })).toMatch(/lineage/);
		expect(error({ ...written, lineage: 7 })).toMatch(/lineage/);
	});

	it('does not look inside a battle, but a battle must still be storable', () => {
		expect(error({ ...written, battle: 'anything' })).toBe('');
		expect(error({ ...written, battle: { log: ['a\u0000b'] } })).toMatch(/battle/);
	});

	it('refuses what the server could not store as sent: NUL, lone surrogates, infinities', () => {
		expect(error({ ...v1, party: [animal(1, { nickname: 'a\u0000b' })] })).toMatch(/nickname/);
		expect(error({ ...v1, party: [animal(1, { id: 'a\ud800' })] })).toMatch(/id/);
		expect(error({ ...v1, note: '\udc00' })).toMatch(/note/);
		expect(error({ ...v1, ['a\u0000b']: 1 })).toMatch(/key/);
		expect(error({ ...v1, big: Infinity })).toMatch(/big/);
		expect(error({ ...v1, party: [animal(1, { x: -Infinity })] })).toMatch(/x/);
		// A surrogate pair (an emoji) is fine.
		expect(error({ ...v1, party: [animal(1, { nickname: 'Nut 🐿️' })] })).toBe('');
	});
});

describe('validateSaveWrite', () => {
	it('needs facing, steps, lineage and a seq of at least 1', () => {
		expect(validateSaveWrite(written).ok).toBe(true);
		for (const key of ['facing', 'steps', 'lineage', 'seq']) {
			const partial: Record<string, unknown> = { ...written };
			delete partial[key];
			const checked = validateSaveWrite(partial);
			expect(checked.ok ? '' : checked.error).toMatch(new RegExp(key));
		}
		const zero = validateSaveWrite({ ...written, seq: 0 });
		expect(zero.ok ? '' : zero.error).toMatch(/seq/);
		expect(validateSaveWrite(v1).ok).toBe(false);
	});
});

describe('readSave and the upgrade seam', () => {
	it('reads the current version, older v1 documents included', () => {
		expect(readSave(written)).toEqual({ ok: true, save: written });
		expect(readSave(v1)).toEqual({ ok: true, save: v1 });
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
			{ ...written, version: '1' },
			{ ...written, version: 1.5 },
			{ ...written, party: [animal(1, { speciesId: 'dragon' })] }
		]) {
			expect(readSave(bad)).toMatchObject({ ok: false, reason: 'invalid' });
		}
	});

	it('has an upgrade from every version before the current one', () => {
		for (let v = 1; v < SAVE_VERSION; v++) expect(SAVE_UPGRADES[v]).toBeTypeOf('function');
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
	it('a new game starts on the spawn tile, facing down, with one full-HP starter', () => {
		const game = newGame(SEED);
		expect(game).toEqual({
			seed: SEED,
			pos: spawnPoint(SEED),
			facing: 'down',
			steps: 0,
			party: [{ id: 'starter', speciesId: STARTER_SPECIES, hp: getAnimal(STARTER_SPECIES).maxHp }],
			battle: null
		});
	});

	it('an older v1 save gets facing down and no steps', () => {
		const pos = findTile(v1.seed, true);
		const game = restoreGame({ ...v1, pos } as SaveV1);
		expect(game).toMatchObject({ seed: v1.seed, pos, facing: 'down', steps: 0, battle: null });
		expect(game.party).toEqual(v1.party);
	});

	it('a save of a game restores exactly that game', () => {
		const game: SavedGame = {
			seed: SEED,
			pos: findTile(SEED, true),
			facing: 'up',
			steps: 321,
			party: [
				{ id: 'a', speciesId: 'fox', hp: 3, nickname: 'Rusty' },
				{ id: 'b', speciesId: 'bear', hp: 0 }
			],
			battle: null
		};
		const doc = saveDocument(game, { lineage: 'L', seq: 9 });
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		expect(read.ok).toBe(true);
		if (read.ok) expect(restoreGame(read.save)).toEqual(game);
	});

	it('never strands the player: a blocked tile becomes the spawn tile', () => {
		const blocked = findTile(v1.seed, false);
		const game = restoreGame({ ...v1, pos: blocked } as SaveV1);
		expect(game.pos).toEqual(spawnPoint(v1.seed));
	});

	it('cuts an HP above the maximum, gives an empty party the starter, and rests an all-tired party', () => {
		const pos = findTile(v1.seed, true);
		const over = restoreGame({ ...v1, pos, party: [animal(1, { hp: 999 })] } as SaveV1);
		expect(over.party[0]!.hp).toBe(getAnimal('squirrel').maxHp);

		const empty = restoreGame({ ...v1, pos, party: [] } as SaveV1);
		expect(empty.party).toEqual(newGame(v1.seed).party);

		const tired = restoreGame({
			...v1,
			pos,
			party: [animal(1, { hp: 0 }), animal(2, { speciesId: 'bear', hp: 0 })]
		} as SaveV1);
		expect(tired.party.map((a) => a.hp)).toEqual([
			getAnimal('squirrel').maxHp,
			getAnimal('bear').maxHp
		]);
	});

	it('over random saves of every shape, the restored game is always playable', () => {
		for (let s = 0; s < 400; s++) {
			const rng = new Rng(hashInts(7, s));
			const seed = rng.int(-1_000_000, 1_000_000);
			const size = rng.int(0, MAX_PARTY);
			const party: AnimalInstance[] = Array.from({ length: size }, (_, i) => {
				const spec = rng.pick(ANIMALS);
				return { id: `m${i}`, speciesId: spec.id, hp: rng.int(0, spec.maxHp + 5) };
			});
			const save = {
				...v1,
				seed,
				pos: { x: rng.int(-300, 300), y: rng.int(-300, 300) },
				party,
				facing: rng.pick(['up', 'down', 'left', 'right'] as Direction[]),
				steps: rng.int(0, 10_000)
			} as SaveV1;
			const game = restoreGame(save);
			expect(isWalkable(tileAtWorld(seed, game.pos.x, game.pos.y).kind)).toBe(true);
			expect(game.party.length).toBeGreaterThan(0);
			expect(game.party.some((a) => a.hp > 0)).toBe(true);
			for (const a of game.party) {
				expect(a.hp).toBeGreaterThanOrEqual(0);
				expect(a.hp).toBeLessThanOrEqual(getAnimal(a.speciesId).maxHp);
			}
			// A battle can start with it: the party is one `startBattle` accepts.
			expect(() => startBattle(game.party, makeWild('rabbit'))).not.toThrow();
			// What was fine to begin with comes back unchanged.
			if (isWalkable(tileAtWorld(seed, save.pos.x, save.pos.y).kind))
				expect(game.pos).toEqual(save.pos);
			expect(game.facing).toBe(save.facing);
			expect(game.steps).toBe(save.steps);
		}
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

describe('readBattle', () => {
	it('picks up every state of real battles, and the battle goes on exactly as it would have', () => {
		let solving = 0;
		for (let seed = 1; seed <= SEEDS; seed++) {
			for (const { state, next } of battleStates(seed, ['squirrel', 'fox'], 'rabbit')) {
				const party = state.party.map((a) => ({ ...a }));
				const restored = readBattle(JSON.parse(JSON.stringify(state)), party);
				expect(restored).toEqual(state);
				if (state.phase.kind === 'solving') solving++;
				// Same seed, same intent: the same step, whether or not the page reloaded.
				expect(applyBattleIntent(restored!, next, seed)).toEqual(
					applyBattleIntent(state, next, seed)
				);
			}
		}
		expect(solving).toBeGreaterThan(0);
	});

	it('drops a battle that does not fit the party or the rules', () => {
		const [{ state }] = battleStates(3, ['squirrel', 'fox'], 'rabbit');
		const party = state!.party.map((a) => ({ ...a }));
		const json = (patch: Record<string, unknown>) => ({
			...JSON.parse(JSON.stringify(state)),
			...patch
		});
		expect(readBattle(json({}), party)).not.toBeNull();
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
			json({ log: [1, 2] }),
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

	it('comes back with the saved game only while the player stands where the battle is', () => {
		const pos = findTile(SEED, true);
		const party = makeParty(['squirrel']);
		const battle = startBattle(party, makeWild('rabbit'));
		const doc = saveDocument(
			{ seed: SEED, pos, facing: 'left', steps: 11, party, battle },
			{ lineage: 'L', seq: 2 }
		);
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		expect(read.ok && restoreGame(read.save).battle).toEqual(battle);
		const moved = { ...doc, pos: findTile(SEED, false) };
		expect(restoreGame(moved).battle).toBeNull();
	});
});

describe('which save wins', () => {
	it('saveSeq and saveLineage read any stored value, and default to 0 and ""', () => {
		expect(saveSeq(written)).toBe(3);
		expect(saveLineage(written)).toBe('game-a');
		for (const junk of [
			null,
			undefined,
			'x',
			[],
			{ seq: -1 },
			{ seq: 1.5 },
			{ seq: '4' },
			{ lineage: '' },
			{ lineage: 3 }
		]) {
			expect(saveSeq(junk)).toBe(0);
			expect(saveLineage(junk)).toBe('');
		}
	});

	it('the server takes a save only with a higher seq than it holds, whatever game it is', () => {
		expect(canReplace(null, { seq: 1 })).toBe(true);
		expect(canReplace(written, { seq: 4 })).toBe(true);
		expect(canReplace(written, { seq: 3 })).toBe(false);
		expect(canReplace(written, { seq: 2 })).toBe(false);
		expect(canReplace({ ...written, lineage: 'other' }, { seq: 3 })).toBe(false);
		expect(canReplace(v1, { seq: 1 })).toBe(true);
		expect(canReplace('garbage', { seq: 1 })).toBe(true);
	});

	it('the server keeps what a save replaces only when it is another game or unreadable', () => {
		expect(replacesAnotherGame(null, { lineage: 'game-a' })).toBe(false);
		expect(replacesAnotherGame(written, { lineage: 'game-a' })).toBe(false);
		expect(replacesAnotherGame(written, { lineage: 'game-b' })).toBe(true);
		expect(replacesAnotherGame(v1, { lineage: 'game-a' })).toBe(true);
		expect(replacesAnotherGame({ ...written, version: 2 }, { lineage: 'game-a' })).toBe(true);
		expect(replacesAnotherGame('garbage', { lineage: 'game-a' })).toBe(true);
	});

	it('sameProgress ignores where the player is and which write it is, and nothing else', () => {
		const moved = {
			...written,
			pos: { x: 50, y: 60 },
			facing: 'up',
			steps: 900,
			lineage: 'game-z',
			seq: 77
		};
		expect(sameProgress(written as SaveV1, moved as SaveV1)).toBe(true);
		// Key order and absent-versus-undefined do not matter.
		const reordered = JSON.parse(JSON.stringify({ party: written.party, ...written }));
		expect(sameProgress(written as SaveV1, { ...reordered, extra: undefined })).toBe(true);
		for (const changed of [
			{ ...written, party: [animal(1, { nickname: 'Nutkin', hp: 3 }), written.party[1]] },
			{ ...written, party: [...written.party].reverse() },
			{ ...written, party: [...written.party, animal(3)] },
			{ ...written, party: [animal(1), written.party[1]] },
			{ ...written, seed: 1 },
			{ ...written, battle: { step: 0 } },
			{ ...written, inventory: { leashes: 1 } }
		]) {
			expect(sameProgress(written as SaveV1, changed as SaveV1)).toBe(false);
		}
	});

	it('saveExtras returns only the fields SaveV1 does not name, and saveDocument writes them back', () => {
		const withExtras = { ...written, inventory: { leashes: 2 }, battle: { step: 1 } } as SaveV1;
		expect(saveExtras(withExtras)).toEqual({ inventory: { leashes: 2 } });
		const doc = saveDocument(newGame(SEED), { lineage: 'L', seq: 1 }, saveExtras(withExtras));
		expect(doc).toMatchObject({
			inventory: { leashes: 2 },
			lineage: 'L',
			seq: 1,
			version: SAVE_VERSION
		});
		expect(validateSaveWrite(doc).ok).toBe(true);
		expect('battle' in doc).toBe(false);
	});
});
