import { newGame, saveDocument } from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { describeSave } from '../src/save-export.js';

describe('describeSave', () => {
	it('names the land, its money, and the teams left in other lands: a first arrival is not an empty game', () => {
		const start = newGame(42, { id: 'sq', speciesId: 'squirrel', hp: 20 }, 'Ida');
		const arrived = {
			...start,
			land: 'arctic' as const,
			party: [],
			tokens: 8,
			lands: [
				{ land: 'nordland' as const, party: start.party, tokens: 30, items: ['axe'], worlds: [] }
			],
			unlocked: ['nordland', 'arctic']
		};
		const line = describeSave(saveDocument(arrived, { lineage: 'l', seq: 3 }));
		expect(line).toMatch(/^Ida: in arctic 0 animals \(\), 8 ice dollars, no tools, World 42 at /);
		expect(line).toContain('; in nordland 1 animals (squirrel)');
	});
});
