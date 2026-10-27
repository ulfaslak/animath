import { getAnimal, type AnimalInstance } from '@mathgame/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { language } from '../src/copy';
import { leadLines } from '../src/where';

const team = (...ids: string[]): AnimalInstance[] =>
	ids.map((speciesId, i) => ({ id: `t${i}`, speciesId, hp: getAnimal(speciesId).maxHp }));

describe("the druid's tip on which animal to make active", () => {
	afterEach(() => language.set('en'));

	it("names the kid's own animal, as the lead's tag calls it: active, aktiv", () => {
		language.set('da');
		expect(leadLines('badger', team('squirrel', 'fox'), [])).toEqual([
			'Gør ræven til dit aktive dyr, så møder du en grævling oftere.'
		]);
		expect(leadLines('bear', team('squirrel'), [])).toEqual([
			'Behold egernet som dit aktive dyr, så møder du en bjørn oftere.',
			'Egernet er mindre end bjørnen, så du skal lede langt væk fra der, hvor du startede.'
		]);
	});

	it('says the first that swims leads on the water, not that the animal tagged on land should stay', () => {
		// The squirrel wears the tag on land; out in the boat the frog is the active one.
		expect(leadLines('crab', team('squirrel', 'frog'), [])).toEqual([
			'On the water Frog is already your active animal. Good, then you meet a Crab more often.'
		]);
		expect(leadLines('crab', team('squirrel', 'fox'), [])).toEqual([
			'None of your animals can swim yet. Catch one that can first!'
		]);
	});

	it('says to heal a tired one, and to catch a smaller one when the team is too big', () => {
		const [bear, squirrel] = team('bear', 'squirrel');
		expect(leadLines('shrew', [{ ...bear!, hp: 0 }, squirrel!], [])).toEqual([
			'Make Squirrel your active animal, and you meet a Shrew more often.'
		]);
		expect(leadLines('shrew', [{ ...squirrel!, hp: 0 }, bear!], [])).toEqual([
			'Keep Squirrel as your active animal, and you meet a Shrew more often.',
			'Squirrel is tired. Heal it first!'
		]);
		language.set('da');
		expect(leadLines('shrew', [bear!], [])).toEqual([
			'Bjørnen er meget større end spidsmusen. Fang et mindre dyr og gør det til dit aktive dyr, så møder du spidsmusen oftere.'
		]);
	});
});
