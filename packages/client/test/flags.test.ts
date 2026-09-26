import { getAnimal } from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { parseParty, parseTokens, readFlags } from '../src/flags';

/** The URL switches (CHEATSHEET § Hidden behaviour): a typo must start an ordinary game. */
describe('URL switches', () => {
	it('reads ?zoo, ?debug, ?party=, ?new, ?tokens= and ?shop', () => {
		expect(readFlags('')).toEqual({
			zoo: null,
			debug: false,
			party: null,
			fresh: false,
			tokens: null,
			shop: null,
			throwaway: false
		});
		expect(readFlags('?zoo&debug&party=fox&new&tokens=40&shop')).toEqual({
			zoo: 'standing',
			debug: true,
			party: [{ id: 'party-1', speciesId: 'fox', hp: getAnimal('fox').maxHp }],
			fresh: true,
			tokens: 40,
			shop: ['axe', 'pickaxe', 'boat'],
			throwaway: true
		});
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
			Array(7).fill('rabbit').join(',')
		]) {
			expect(parseParty(bad), bad).toBeNull();
		}
		expect(parseParty(null)).toBeNull();
	});
});
