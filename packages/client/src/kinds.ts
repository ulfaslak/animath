import {
	ATTACK_LEVELS,
	getAnimal,
	puzzleDifficulty,
	puzzleTopics,
	type PuzzleTopic
} from '@mathgame/engine';
import { language, t } from './copy';

/**
 * What a kind of puzzle looks like to the kid, in words (`battle.kinds.*`):
 * "adding", "times tables". Each key is written out, so the copy tests can
 * check it; a new topic is a new case here and a line in every copy file.
 */
export function kindWord(topic: PuzzleTopic): string {
	switch (topic) {
		case 'add':
			return t('battle.kinds.add');
		case 'sub':
			return t('battle.kinds.sub');
		case 'mul':
			return t('battle.kinds.mul');
		case 'div':
			return t('battle.kinds.div');
		case 'missing':
			return t('battle.kinds.missing');
		case 'sequence':
			return t('battle.kinds.sequence');
		case 'sqrt':
			return t('battle.kinds.sqrt');
	}
}

/**
 * Topics as the language lists them: "adding, taking away, or missing
 * numbers" (`disjunction`: one of them) or "adding, taking away and missing
 * numbers" (`conjunction`: all of them).
 */
export function kindList(
	topics: readonly PuzzleTopic[],
	type: 'conjunction' | 'disjunction'
): string {
	return new Intl.ListFormat(language.current, { type }).format(topics.map(kindWord));
}

/**
 * Every kind of puzzle a species can ask, from its weakest attack on easy to
 * its strongest on hard, each once, in the order they first come up: what
 * the engine's `puzzleTopics` says each attack's puzzles can be at each level.
 */
export function speciesTopics(speciesId: string): PuzzleTopic[] {
	const spec = getAnimal(speciesId);
	const topics: PuzzleTopic[] = [];
	spec.attacks.forEach((attack, i) => {
		for (const level of ATTACK_LEVELS) {
			const difficulty = puzzleDifficulty(spec.tier, i + 1, level);
			for (const topic of puzzleTopics(attack.kinds, difficulty)) {
				if (!topics.includes(topic)) topics.push(topic);
			}
		}
	});
	return topics;
}
