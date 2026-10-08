import {
	ATTACK_LEVELS,
	facePrompt,
	getAnimal,
	isPictureKind,
	puzzleDifficulty,
	puzzleTopics,
	type PuzzleFace,
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
		case 'thermometer':
			return t('battle.kinds.thermometer');
		case 'kroner':
			return t('battle.kinds.kroner');
		case 'fraction':
			return t('battle.kinds.fraction');
		case 'area':
			return t('battle.kinds.area');
		case 'perimeter':
			return t('battle.kinds.perimeter');
		case 'barchart':
			return t('battle.kinds.barchart');
		case 'balance':
			return t('battle.kinds.balance');
		case 'clock':
			return t('battle.kinds.clock');
	}
}

/**
 * What a kind of puzzle looks like as a picture, for a kid who can't read
 * the words yet: its operator, in the glyphs the prompts use (DESIGN §
 * Typography), a "?" where a sum has a number missing, a row of numbers
 * for a pattern. The battle's operator chips show them beside the words.
 */
export function kindGlyph(topic: PuzzleTopic): string {
	switch (topic) {
		case 'add':
			return '+';
		case 'sub':
			return '−';
		case 'mul':
			return '×';
		case 'div':
			return '÷';
		case 'missing':
			return '?';
		case 'sequence':
			return '2 4 6';
		case 'sqrt':
			return '√';
		// The Arctic's kinds (#191): a sign of the picture each puzzle draws.
		case 'thermometer':
			return '−3°';
		case 'kroner':
			return 'kr';
		case 'fraction':
			return '½';
		case 'area':
			return '▦';
		case 'perimeter':
			return '▢';
		case 'barchart':
			return '▂▅▇';
		case 'balance':
			return '□';
		case 'clock':
			return '3:00';
	}
}

/**
 * A puzzle as a thought bubble over a player near a battle shows it: a sum
 * as the prompt the engine writes ("7 × 8 = ?"), and a puzzle with a
 * picture, which no bubble has room to draw, as its kind's sign and a "?"
 * ("½ ?", "3:00 ?"). Never a word.
 */
export function thoughtSum(face: PuzzleFace): string {
	if (!isPictureKind(face.kind)) return facePrompt(face);
	// A shape's floor (0, or a side from the floor: 2) or its fence (1, 3).
	const topic =
		face.kind === 'shape' ? ((face.numbers[0] ?? 0) % 2 === 0 ? 'area' : 'perimeter') : face.kind;
	return `${kindGlyph(topic)} ?`;
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
