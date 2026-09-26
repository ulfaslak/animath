import type { AnimalInstance, ItemId } from '@mathgame/engine';
import { language, t } from '../copy';
import { itemWords } from '../items';
import { animalWords, nameOf } from '../names';

/**
 * What the doctor says, as data: on the card, as the player leaves, and after
 * a lost battle. The client chooses a line from the doctor's events (the
 * engine says nothing), keeps it in state as one of these, and words it with
 * `doctorWords` when it is shown, in the language on screen (DECISIONS § Copy
 * and languages). An animal travels as itself, so its name is worded at
 * display time too.
 */
export type DoctorLine =
	| { say: 'hello' }
	| { say: 'helloAllFit' }
	/** A healing puzzle for `animal`, which heals `others` more of its species too. */
	| { say: 'letsHelp'; animal: AnimalInstance; others: number }
	/** A healing puzzle missed: another one comes. */
	| { say: 'notQuite' }
	/** A token sum missed: the same one stays. */
	| { say: 'tryAgain' }
	| { say: 'healed'; animal: AnimalInstance; others: number; someoneStillHurt: boolean }
	/** The home tab: why wild animals are grumpy. */
	| { say: 'homeIntro' }
	/** The confirm before a hand-over. */
	| { say: 'homeSure' }
	/** A hand-over's token sum is up. */
	| { say: 'homeCount' }
	| { say: 'wentHome'; animals: readonly AnimalInstance[] }
	| { say: 'tokensGiven'; amount: number; tokens: number }
	| { say: 'shopIntro'; empty: boolean }
	/** A purchase's token sum is up. */
	| { say: 'shopCount' }
	| { say: 'bought'; itemId: ItemId; tokens: number }
	| { say: 'goodbye' }
	| { say: 'rescued'; atTent: boolean };

export function doctorWords(line: DoctorLine): string {
	switch (line.say) {
		case 'hello':
			return t('doctor.hello');
		case 'helloAllFit':
			return t('doctor.helloAllFit');
		case 'letsHelp':
			return line.others > 0
				? t('doctor.letsHelpMore', { animal: animalWords(line.animal), others: line.others })
				: t('doctor.letsHelp', { animal: animalWords(line.animal) });
		case 'notQuite':
			return t('doctor.notQuite');
		case 'tryAgain':
			return t('doctor.tryAgain');
		case 'healed': {
			const animal = animalWords(line.animal);
			const others = line.others;
			if (others > 0) {
				return line.someoneStillHurt
					? t('doctor.healedMoreNext', { animal, others })
					: t('doctor.healedMoreAll', { animal, others });
			}
			return line.someoneStillHurt
				? t('doctor.healedNext', { animal })
				: t('doctor.healedAll', { animal });
		}
		case 'homeIntro':
			return t('doctor.home.intro');
		case 'homeSure':
			return t('doctor.home.sure');
		case 'homeCount':
			return t('doctor.home.count');
		case 'wentHome': {
			const [first] = line.animals;
			if (line.animals.length === 1 && first) {
				return t('doctor.home.wentHomeOne', { animal: animalWords(first) });
			}
			return line.animals.length <= NAMES_LISTED
				? t('doctor.home.wentHomeFew', { names: namesOf(line.animals) })
				: t('doctor.home.wentHomeMany', { many: line.animals.length });
		}
		case 'tokensGiven':
			return t('doctor.home.tokensGiven', { amount: line.amount, count: line.tokens });
		case 'shopIntro':
			return line.empty ? t('doctor.shop.introEmpty') : t('doctor.shop.intro');
		case 'shopCount':
			return t('doctor.shop.count');
		case 'bought':
			return t('doctor.shop.bought', { item: itemWords(line.itemId), count: line.tokens });
		case 'goodbye':
			return t('doctor.goodbye');
		case 'rescued':
			return line.atTent ? t('doctor.rescuedAtTent') : t('doctor.rescuedHere');
	}
}

/** Up to this many animals going home are named; more are counted. */
export const NAMES_LISTED = 3;

/** Animals' names as the language lists them: "Pip, Fox and Rabbit", "Pip, Ræv og Kanin". */
export function namesOf(animals: readonly AnimalInstance[]): string {
	return new Intl.ListFormat(language.current, { type: 'conjunction' }).format(animals.map(nameOf));
}
