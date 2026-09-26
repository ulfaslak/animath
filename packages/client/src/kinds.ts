import { getAnimal, type PuzzleKind } from '@mathgame/engine';
import { language, t } from './copy';

/**
 * What a kind of puzzle is about, in words a kid reads (`battle.kinds.*`):
 * "adding", "times tables". Each key is written out, so the copy tests can
 * check it; a new puzzle kind is a new case here and a line in every copy file.
 */
export function kindWord(kind: PuzzleKind): string {
	switch (kind) {
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
 * Kinds as the language lists them: "adding, taking away, or missing
 * numbers" (`disjunction`, one of them) or "adding, taking away and missing
 * numbers" (`conjunction`, all of them).
 */
export function kindList(
	kinds: readonly PuzzleKind[],
	type: 'conjunction' | 'disjunction'
): string {
	return new Intl.ListFormat(language.current, { type }).format(kinds.map(kindWord));
}

/** Every kind of puzzle a species' attacks ask, once each, weakest attack first. */
export function speciesKinds(speciesId: string): PuzzleKind[] {
	const kinds: PuzzleKind[] = [];
	for (const attack of getAnimal(speciesId).attacks) {
		for (const kind of attack.kinds) if (!kinds.includes(kind)) kinds.push(kind);
	}
	return kinds;
}
