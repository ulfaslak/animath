import { getAnimal } from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { MAX_SEEDED_PARTY, parseHour, parseParty, parseTokens, readFlags } from '../src/flags';

/** The URL switches (CHEATSHEET § Hidden behaviour): a typo must start an ordinary game. */
describe('URL switches', () => {
	it('reads ?zoo, ?debug, ?hour=, ?party=, ?new, ?tokens= and ?shop', () => {
		expect(readFlags('')).toEqual({
			zoo: null,
			debug: false,
			hourSeconds: null,
			party: null,
			fresh: false,
			tokens: null,
			shop: null,
			throwaway: false
		});
		expect(readFlags('?zoo&debug&hour=20&party=fox&new&tokens=40&shop')).toEqual({
			zoo: 'standing',
			debug: true,
			hourSeconds: 20,
			party: [{ id: 'party-1', speciesId: 'fox', hp: getAnimal('fox').maxHp }],
			fresh: true,
			tokens: 40,
			shop: ['axe', 'pickaxe', 'boat', 'glider'],
			throwaway: true
		});
	});

	it('?hour= takes whole seconds from 5 to 3600, is no throwaway, and anything else is no switch', () => {
		expect(parseHour('5')).toBe(5);
		expect(parseHour('30')).toBe(30);
		expect(parseHour('3600')).toBe(3600);
		for (const bad of [null, '', '4', '0', '3601', '-30', '1.5', 'soon', ' 30']) {
			expect(parseHour(bad), String(bad)).toBeNull();
		}
		expect(readFlags('?hour=30').throwaway).toBe(false);
	});

	it('?tokens= takes a whole number up to 9999, and anything else is no switch', () => {
		expect(parseTokens('0')).toBe(0);
		expect(parseTokens('21')).toBe(21);
		expect(parseTokens('9999')).toBe(9999);
		for (const bad of [null, '', '-3', '1.5', '10000', '1e3', ' 8', 'lots', '0x10']) {
			expect(parseTokens(bad), String(bad)).toBeNull();
		}
	});

	it('?zoo=tired lays the line-up down to rest; any other value is the standing zoo', () => {
		expect(readFlags('?zoo=tired').zoo).toBe('tired');
		expect(readFlags('?zoo=').zoo).toBe('standing');
		expect(readFlags('?zoo=sleepy').zoo).toBe('standing');
		expect(readFlags('?zoo=tired').throwaway).toBe(true);
	});

	it('?new, ?party=, ?zoo, ?tokens= and ?shop each play a throwaway game past the title; ?debug and ?lang do not', () => {
		for (const search of [
			'?new',
			'?party=bear',
			'?zoo',
			'?debug&new',
			'?lang=da&zoo',
			'?tokens=30',
			'?shop'
		]) {
			expect(readFlags(search).throwaway, search).toBe(true);
		}
		// A misspelt party or tokens is no switch: the title, as without it.
		for (const search of ['', '?debug', '?lang=da', '?party=dragon', '?party=', '?tokens=lots']) {
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
