import {
	LAND_IDS,
	getAnimal,
	getLand,
	meetingPlaces,
	type Biome,
	type LandId
} from '@mathgame/engine';
import { language, t } from './copy';
import { animalWords } from './names';

/**
 * Where to look for an animal, as the druid tells it (his Ask tab) and the
 * animal book shows it for an animal he told about: a line for each way it
 * is met, from the engine's own rules (`meetingPlaces`), so the words never
 * send a kid where it cannot be met. Worded when shown, in the language on
 * screen.
 */
export function whereLines(speciesId: string): string[] {
	const spec = getAnimal(speciesId);
	const places = meetingPlaces(speciesId);
	const lines: string[] = [];
	if (places.grass.length > 0) {
		const where = {
			grass: t(`grass.${landOf(speciesId)}`),
			places: placesWords(places.grass)
		};
		switch (spec.favours) {
			case 'water':
				lines.push(t('where.grassWater', where));
				break;
			case 'trees':
				lines.push(t('where.grassTrees', where));
				break;
			case 'rocks':
				lines.push(t('where.grassRocks', where));
				break;
			case 'open':
				lines.push(t('where.grassOpen', where));
				break;
		}
	}
	if (places.sea.length > 0) lines.push(t('where.sea', { places: placesWords(places.sea) }));
	if (places.ice.length > 0) lines.push(t('where.ice', { places: placesWords(places.ice) }));
	// A bird met in the grass is met in the sky too: the one line that says so.
	if (places.sky.length > 0) lines.push(t('where.sky', { animal: animalWords({ speciesId }) }));
	return lines;
}

/**
 * Which animal to put first to meet it more often: one of its size, since the
 * lead's size is the likeliest to come out ([[PRODUCT]] §4 "Wild
 * encounters"); out on the water, and at a fishing hole, one that swims,
 * since the first swimmer standing leads there.
 */
export function leadLine(speciesId: string): string {
	const size = t(`where.size.tier${getAnimal(speciesId).tier}`);
	return meetingPlaces(speciesId).grass.length > 0
		? t('where.lead', { size })
		: t('where.leadSwim', { size });
}

/** What an animal is like, as the druid tells it. */
export function aboutWords(speciesId: string): string {
	return t(`about.${speciesId}`);
}

/** The land a species lives in. */
function landOf(speciesId: string): LandId {
	return LAND_IDS.find((land) => getLand(land).species.includes(speciesId)) ?? LAND_IDS[0]!;
}

/** Places as a sentence lists them: "in the meadow or in the forest", "på engen eller i skoven". */
function placesWords(biomes: readonly Biome[]): string {
	return new Intl.ListFormat(language.current, { type: 'disjunction' }).format(
		biomes.map((b) => t(`places.${b}`))
	);
}
