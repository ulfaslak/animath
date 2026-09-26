import { getAnimal } from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { MAX_SEEDED_PARTY, parseParty, readFlags } from '../src/flags';

/** The URL switches (CHEATSHEET § Hidden behaviour): a typo must start an ordinary game. */
describe('URL switches', () => {
	it('reads ?zoo, ?debug, ?party= and ?new', () => {
		expect(readFlags('')).toEqual({
			zoo: null,
			debug: false,
			party: null,
			fresh: false,
			throwaway: false
		});
		expect(readFlags('?zoo&debug&party=fox&new')).toEqual({
			zoo: 'standing',
			debug: true,
			party: [{ id: 'party-1', speciesId: 'fox', hp: getAnimal('fox').maxHp }],
			fresh: true,
			throwaway: true
		});
	});

	it('?zoo=tired lays the line-up down to rest; any other value is the standing zoo', () => {
		expect(readFlags('?zoo=tired').zoo).toBe('tired');
		expect(readFlags('?zoo=').zoo).toBe('standing');
		expect(readFlags('?zoo=sleepy').zoo).toBe('standing');
		expect(readFlags('?zoo=tired').throwaway).toBe(true);
	});

	it('?new, ?party= and ?zoo each play a throwaway game past the title; ?debug and ?lang do not', () => {
		for (const search of ['?new', '?party=bear', '?zoo', '?debug&new', '?lang=da&zoo']) {
			expect(readFlags(search).throwaway, search).toBe(true);
		}
		// A misspelt party is no party: the title, as without it.
		for (const search of ['', '?debug', '?lang=da', '?party=dragon', '?party=']) {
			expect(readFlags(search).throwaway, search).toBe(false);
		}
	});

	it('?party= takes species with an optional HP, clamped to the species', () => {
		expect(parseParty('bear:10,fox:0,rabbit')).toEqual([
			{ id: 'party-1', speciesId: 'bear', hp: 10 },
			{ id: 'party-2', speciesId: 'fox', hp: 0 },
			{ id: 'party-3', speciesId: 'rabbit', hp: getAnimal('rabbit').maxHp }
		]);
		expect(parseParty('squirrel:999,squirrel:-3')).toEqual([
			{ id: 'party-1', speciesId: 'squirrel', hp: 20 },
			{ id: 'party-2', speciesId: 'squirrel', hp: 0 }
		]);
	});

	it('?party= takes a count for many of one kind, as many animals as a kid could catch', () => {
		const big = parseParty('squirrel*3,rabbit:0*2,fox,bear:10*2')!;
		expect(big.map((a) => `${a.speciesId}:${a.hp}`)).toEqual([
			'squirrel:20',
			'squirrel:20',
			'squirrel:20',
			'rabbit:0',
			'rabbit:0',
			`fox:${getAnimal('fox').maxHp}`,
			'bear:10',
			'bear:10'
		]);
		expect(big.map((a) => a.id)).toEqual(big.map((_, i) => `party-${i + 1}`));
		// Seven of a kind, which the six-animal build refused, and the most it seeds.
		expect(parseParty(Array(7).fill('rabbit').join(','))).toHaveLength(7);
		expect(parseParty(`squirrel*${MAX_SEEDED_PARTY - 1},rabbit`)).toHaveLength(MAX_SEEDED_PARTY);
	});

	it('?party= with anything wrong is ignored as a whole', () => {
		for (const bad of [
			'',
			',',
			'dragon',
			'squirrel,dragon',
			'squirrel:',
			'squirrel:abc',
			'squirrel:1.5',
			'squirrel:1:2',
			'squirrel: ', // `?party=squirrel:%20`: Number(' ') is 0, a tired squirrel nobody asked for
			'bear:1e1',
			'bear:0x5',
			'bear:+3',
			'Squirrel',
			'rabbit*0',
			'rabbit*',
			'rabbit*2.5',
			'rabbit*-1',
			'rabbit*2*3',
			'rabbit*3:5',
			`rabbit*${MAX_SEEDED_PARTY + 1}`,
			`rabbit*${MAX_SEEDED_PARTY},fox`
		]) {
			expect(parseParty(bad), bad).toBeNull();
		}
		expect(parseParty(null)).toBeNull();
	});
});
