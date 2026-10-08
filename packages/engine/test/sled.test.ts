import { describe, expect, it } from 'vitest';
import { ANIMALS, canPull, canRide } from '../src/animals/catalog.js';
import { getItem } from '../src/items/catalog.js';
import { getLand, priceIn, shopFor } from '../src/lands/lands.js';

/** The dog sled (#191 step 6): The Arctic's harness, a look only. */
describe('the dog sled', () => {
	it('is pulled only by a species that pulls, and only for a kid who owns the sled', () => {
		const pullers = ANIMALS.filter((a) => canPull({ items: ['sled'] }, a.id)).map((a) => a.id);
		expect(pullers).toEqual(ANIMALS.filter((a) => a.pulls).map((a) => a.id));
		expect(pullers.length).toBeGreaterThan(0);
		for (const id of pullers) {
			expect(canPull({ items: [] }, id)).toBe(false);
			expect(canPull({ items: ['harness', 'skis'] }, id)).toBe(false);
			// The harness never makes one ride, nor the sled carry.
			expect(canRide({ items: ['sled'] }, id)).toBe(false);
		}
	});

	it("is on sale in The Arctic for what its paraglider costs, as Nordland's harness is", () => {
		expect(getItem('sled').available).toBe(true);
		expect(shopFor('arctic')).toContain('sled');
		expect(priceIn('arctic', 'sled')).toBe(priceIn('arctic', 'glider'));
		expect(Object.keys(getLand('nordland').shop)).not.toContain('sled');
	});
});
