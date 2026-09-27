import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import { MAX_NICKNAME_LENGTH } from '../src/party/names.js';
import { STARTERS, STARTER_TIER, chooseStarter, isStarter } from '../src/party/starters.js';
import { STARTER_SPECIES, newGame, validateSaveWrite, saveDocument } from '../src/save.js';
import { spawnPoint } from '../src/world/spawn.js';
import { worldSeed } from '../src/world/worlds.js';

/**
 * Starting out: a new game starts with a starter the player picks, and only
 * the smallest animals are starters ([[PRODUCT]] §4 "Starting out"). The
 * authority asks `chooseStarter`; a server running the same engine refuses
 * exactly the same choices.
 */

describe('starters', () => {
	it('the starters are the squirrel, the rabbit and the frog, each a tier-1 animal that can fight on land, in catalog order', () => {
		// Named by id, not every tier-1 animal (#89): the other small animals are caught.
		expect(STARTERS).toEqual(['squirrel', 'rabbit', 'frog']);
		expect(STARTER_TIER).toBe(1);
		for (const id of STARTERS) {
			const spec = getAnimal(id);
			expect(spec.tier, id).toBe(STARTER_TIER);
			expect(spec.realms, id).toContain('land');
		}
		expect(STARTERS).toEqual(ANIMALS.map((a) => a.id).filter((id) => STARTERS.includes(id)));
		for (const spec of ANIMALS) expect(isStarter(spec.id), spec.id).toBe(STARTERS.includes(spec.id));
		// Tier-1 animals that are caught, never chosen: the new small ones on land, and the sea's
		// small ones, which live only out on the deep water where a new game never starts.
		for (const id of ['shrew', 'hedgehog', 'common-toad', 'robin', 'crab', 'starfish']) {
			expect(getAnimal(id).tier, id).toBe(1);
			expect(isStarter(id), id).toBe(false);
		}
	});

	it('the starter of a game nobody chose one for is a starter too', () => {
		expect(isStarter(STARTER_SPECIES)).toBe(true);
	});

	it('refuses anything that is not a starter id', () => {
		for (const speciesId of [
			'fox',
			'otter',
			'deer',
			'wolf',
			'bear',
			'shrew',
			'wood-mouse',
			'dragon',
			'',
			'Squirrel'
		]) {
			expect(chooseStarter({ speciesId }), speciesId).toEqual({
				ok: false,
				reason: 'not-a-starter'
			});
		}
		for (const choice of [null, undefined, 'squirrel', 7, [], { speciesId: 7 }, {}]) {
			expect(chooseStarter(choice)).toEqual({ ok: false, reason: 'not-a-starter' });
		}
		expect(isStarter(undefined)).toBe(false);
		expect(isStarter({ toString: () => 'squirrel' })).toBe(false);
	});

	it('gives every starter at full HP, with no nickname unless one is given', () => {
		for (const speciesId of STARTERS) {
			const pick = chooseStarter({ speciesId });
			// No `nickname` key at all: a save stores the animal as it is.
			expect(pick).toStrictEqual({
				ok: true,
				starter: { speciesId, hp: getAnimal(speciesId).maxHp }
			});
		}
	});

	it('cleans the nickname the way a rename does, and drops one with nothing usable left', () => {
		const named = (nickname: unknown) => chooseStarter({ speciesId: 'rabbit', nickname });
		expect(named('Hop')).toStrictEqual({
			ok: true,
			starter: { speciesId: 'rabbit', hp: 22, nickname: 'Hop' }
		});
		expect(named('  Søren   2nd 🐇 ')).toMatchObject({ starter: { nickname: 'Søren 2nd' } });
		const long = named('Abcdefghijklmnopqrstuvwxyz');
		expect(long.ok && Array.from(long.starter.nickname ?? '').length).toBe(MAX_NICKNAME_LENGTH);
		for (const nothing of ['', '   ', '🐇🐇', 'ㅤ']) {
			expect(named(nothing), JSON.stringify(nothing)).toStrictEqual({
				ok: true,
				starter: { speciesId: 'rabbit', hp: 22 }
			});
		}
		expect(named(undefined)).toMatchObject({ ok: true });
		for (const notText of [42, null, ['Hop'], { name: 'Hop' }]) {
			expect(named(notText), JSON.stringify(notText)).toEqual({ ok: false, reason: 'not-text' });
		}
	});

	it('ignores anything else a choice carries', () => {
		const pick = chooseStarter({ speciesId: 'squirrel', hp: 1, id: 'mine', tier: 5 });
		expect(pick).toStrictEqual({ ok: true, starter: { speciesId: 'squirrel', hp: 20 } });
	});
});

describe('newGame with a starter', () => {
	const WORLD = 1234;

	it('puts the chosen starter alone in the party, at the spawn tile of its home world, facing down, nothing walked, owned or cleared', () => {
		const game = newGame(WORLD, { id: 'a1', speciesId: 'rabbit', nickname: 'Hop', hp: 22 }, 'Ida');
		expect(game).toStrictEqual({
			name: 'Ida',
			home: WORLD,
			world: WORLD,
			pos: spawnPoint(worldSeed(WORLD)),
			facing: 'down',
			steps: 0,
			visits: 0,
			party: [{ id: 'a1', speciesId: 'rabbit', nickname: 'Hop', hp: 22 }],
			tokens: 0,
			items: [],
			battle: null,
			edits: [],
			worlds: []
		});
		// A game that starts this way saves like any other.
		expect(validateSaveWrite(saveDocument(game, { lineage: 'L', seq: 1 })).ok).toBe(true);
	});

	it('copies the starter it is given', () => {
		const starter = { id: 'a1', speciesId: 'squirrel', hp: 20 };
		const game = newGame(WORLD, starter);
		game.party[0]!.hp = 3;
		expect(starter.hp).toBe(20);
	});
});
