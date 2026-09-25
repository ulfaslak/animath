import { getAnimal, type AnimalInstance } from '@mathgame/engine';
import { t } from '../copy';

/**
 * What the doctor says, as data: on the card, as the player leaves, and after
 * a lost battle. The client chooses a line from the doctor's events (the
 * engine's `DoctorState.log` and `Rescue.message` are not shown), keeps it in
 * state as one of these, and words it with `doctorWords` when it is shown, in
 * the language on screen (DECISIONS § Copy and languages). An animal travels
 * as itself, so its name is worded at display time too.
 */
export type DoctorLine =
	| { say: 'hello' }
	| { say: 'helloAllFit' }
	| { say: 'letsHelp'; animal: AnimalInstance }
	| { say: 'notQuite' }
	| { say: 'healed'; animal: AnimalInstance; someoneStillHurt: boolean }
	| { say: 'goodbye' }
	| { say: 'rescued'; atTent: boolean };

export function doctorWords(line: DoctorLine): string {
	switch (line.say) {
		case 'hello':
			return t('doctor.hello');
		case 'helloAllFit':
			return t('doctor.helloAllFit');
		case 'letsHelp':
			return t('doctor.letsHelp', { name: nameOf(line.animal) });
		case 'notQuite':
			return t('doctor.notQuite');
		case 'healed':
			return line.someoneStillHurt
				? t('doctor.healedNext', { name: nameOf(line.animal) })
				: t('doctor.healedAll', { name: nameOf(line.animal) });
		case 'goodbye':
			return t('doctor.goodbye');
		case 'rescued':
			return line.atTent ? t('doctor.rescuedAtTent') : t('doctor.rescuedHere');
	}
}

/** An animal's name as the game shows it: its nickname, else its species. */
export function nameOf(animal: AnimalInstance): string {
	return animal.nickname ?? getAnimal(animal.speciesId).name;
}
