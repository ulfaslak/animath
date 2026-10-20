import { getAnimal, type AnimalInstance } from '@mathgame/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { language } from '../src/copy';
import { leadLines } from '../src/where';

const team = (...ids: string[]): AnimalInstance[] =>
	ids.map((speciesId, i) => ({ id: `t${i}`, speciesId, hp: getAnimal(speciesId).maxHp }));

describe("the druid's tip on which animal to put first", () => {
	afterEach(() => language.set('en'));

	it("names the kid's own animal, in Danish as the lead's tag calls it: aktiv", () => {
		language.set('da');
		expect(leadLines('badger', team('squirrel', 'fox'))).toEqual([
			'Gør ræven til dit aktive dyr, så møder du en grævling oftere.'
		]);
		expect(leadLines('bear', team('squirrel'))).toEqual([
			'Behold egernet som dit aktive dyr, så møder du en bjørn oftere.',
			'Egernet er mindre end bjørnen, så du skal lede langt væk fra der, hvor du startede.'
		]);
	});

	it('says the first that swims leads on the water, not that the animal tagged on land should stay', () => {
		// The squirrel wears the tag on land; out in the boat the frog goes first.
		expect(leadLines('crab', team('squirrel', 'frog'))).toEqual([
			'On the water Frog already goes first. Good, then you meet a Crab more often.'
		]);
		expect(leadLines('crab', team('squirrel', 'fox'))).toEqual([
			'None of your animals can swim yet. Catch one that can first!'
		]);
	});
});
