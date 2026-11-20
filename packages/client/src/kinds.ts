import {
	ATTACK_LEVELS,
	facePrompt,
	faceTopic,
	getAnimal,
	isPictureKind,
	isWordedKind,
	puzzleDifficulty,
	puzzleTopics,
	type PuzzleFace,
	type PuzzleKind,
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
		case 'double':
			return t('battle.kinds.double');
		case 'half':
			return t('battle.kinds.half');
		case 'numberline':
			return t('battle.kinds.numberline');
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
		case 'units':
			return t('battle.kinds.units');
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
		// Doubling and halving: what is done to the number, as a sign.
		case 'double':
			return '×2';
		case 'half':
			return '÷2';
		// The number line: a line with its marks.
		case 'numberline':
			return '┣╋┫';
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
		// A kind of words: the sign of a unit on a ruler.
		case 'units':
			return 'cm';
	}
}

/**
 * Whether a kind's question has the whole battle panel, as the preview's
 * page too: a picture's, and a sum in words (`units`: "2 hours and 35
 * minutes = ? minutes"), too long for the card beside the party list. A
 * short question in words ("Double 8 = ?") has that card, as a sum does.
 */
export function wholePanel(kind: PuzzleKind): boolean {
	return isPictureKind(kind) || kind === 'units';
}

/**
 * A puzzle as a thought bubble over a player near a battle shows it: a sum
 * as the prompt the engine writes ("7 × 8 = ?"), and a puzzle with words or
 * a picture, which no bubble has room for, as its kind's sign and a "?"
 * ("×2 ?", "÷2 ?", "3:00 ?", "cm ?"). Never a word.
 */
export function thoughtSum(face: PuzzleFace): string {
	if (!isWordedKind(face.kind)) return facePrompt(face);
	return `${kindGlyph(faceTopic(face))} ?`;
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
