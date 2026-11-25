import { BADGE_FAMILIES, badgeTarget, type BadgeFamily } from '@mathgame/engine';
import { t } from '../copy';

/**
 * A badge's words, in the language on screen: its family's and its own keys
 * under `badges.families` in the copy files, built from its id
 * (`<family>.<name>`), as a species' are from its id. `badges.test.ts` checks
 * every id has every key in every language.
 */

/** The family of every badge, by badge id. */
const FAMILY_OF: ReadonlyMap<string, BadgeFamily> = new Map(
	BADGE_FAMILIES.flatMap((f) => f.badges.map((b) => [b.id, f] as const))
);

function badgeKey(id: string): string {
	const dot = id.indexOf('.');
	return `badges.families.${id.slice(0, dot)}.badges.${id.slice(dot + 1)}`;
}

export function badgeName(id: string): string {
	return t(`${badgeKey(id)}.name`);
}

/** The line under a badge's name: the piece of biology it is named after. */
export function badgeLine(id: string): string {
	return t(`${badgeKey(id)}.line`);
}

/**
 * What a badge asks for: a ladder's goal said with the number its badge asks
 * for ("Solve 50 puzzles"), or a collection's or a first's own.
 */
export function badgeGoal(id: string): string {
	const family = FAMILY_OF.get(id);
	if (family?.kind !== 'ladder') return t(`${badgeKey(id)}.goal`);
	const badge = family.badges.find((b) => b.id === id)!;
	return t(`badges.families.${family.id}.goal`, { count: badgeTarget(badge) });
}

export function familyTitle(family: string): string {
	return t(`badges.families.${family}.title`);
}

/** A family's line: what its badges are for. */
export function familyAbout(family: string): string {
	return t(`badges.families.${family}.about`);
}
