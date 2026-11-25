import type { AnimalBook } from '../animals/book.js';
import { ANIMALS, getAnimal } from '../animals/catalog.js';
import type { AnimalInstance } from '../animals/types.js';
import { LAND_IDS, type LandId } from '../lands/ids.js';
import { getLand, shopFor } from '../lands/lands.js';
import type { PuzzleRecord } from '../puzzles/record.js';
import { ALL_PUZZLE_TOPICS } from '../puzzles/types.js';
import {
	BADGE_FAMILIES,
	BADGE_IDS,
	type BadgeCount,
	type BadgeGroup,
	type BadgeMoment
} from './catalog.js';
import type { Tally } from './tally.js';

/**
 * Everything a badge is read from: the kid's game as the authority holds it.
 * Each number only grows in play but `team` and `tools`, which is why a badge,
 * once earned, is kept (`earnBadges`), never read again.
 */
export interface BadgeProgress {
	readonly solved: number;
	readonly record: PuzzleRecord;
	readonly book: AnimalBook;
	/** The team in the land the kid is in. */
	readonly party: readonly AnimalInstance[];
	readonly steps: number;
	readonly visits: number;
	/** Every world number the kid has been to, in any land, the one they are in included, each once. */
	readonly worlds: number;
	/** The items the kid owns, land by land. */
	readonly items: Readonly<Partial<Record<LandId, readonly string[]>>>;
	/** Every land the kid has been to, the one they are in included. */
	readonly lands: readonly LandId[];
	readonly tally: Tally;
}

/** The number ladder `count` reads from `progress`. */
export function badgeCount(progress: BadgeProgress, count: BadgeCount): number {
	switch (count) {
		case 'solved':
			return progress.solved;
		case 'kinds':
			return ALL_PUZZLE_TOPICS.filter((t) => (progress.record[t]?.right ?? 0) > 0).length;
		case 'every-kind':
			return Math.min(...ALL_PUZZLE_TOPICS.map((t) => progress.record[t]?.right ?? 0));
		case 'seen':
			return progress.book.seen.length;
		case 'caught':
			return progress.book.caught.length;
		case 'freed':
			return progress.book.freed.length;
		case 'told':
			return progress.book.told.length;
		case 'team':
			return progress.party.length;
		case 'steps':
			return progress.steps;
		case 'visits':
			return progress.visits;
		case 'worlds':
			return progress.worlds;
		case 'tools':
			return toolsOwned(progress);
		case 'catches':
		case 'wins':
		case 'matches':
		case 'cleared':
		case 'days':
			return progress.tally[count];
		default:
			return progress.record[count.slice('topic:'.length) as keyof PuzzleRecord]?.right ?? 0;
	}
}

/** Every tool a land's druid sells, land by land: what "every tool in every land" asks for. */
function everyTool(): { land: LandId; item: string }[] {
	return LAND_IDS.filter((l) => getLand(l).available).flatMap((land) =>
		shopFor(land).map((item) => ({ land, item }))
	);
}

/** The tools owned, each land's counted on its own: a boat in Nordland and one in the Arctic are two. */
function toolsOwned(progress: BadgeProgress): number {
	return everyTool().filter(({ land, item }) => progress.items[land]?.includes(item)).length;
}

/** The kinds of animal `group` asks for, as lists of which at least one of each must be caught. */
function groupNeeds(group: BadgeGroup): readonly (readonly string[])[] {
	if ('every' in group) return group.every.map((id) => [id]);
	if ('oneOfEach' in group) return group.oneOfEach;
	if ('tier' in group) return ANIMALS.filter((a) => a.tier === group.tier).map((a) => [a.id]);
	if ('realm' in group)
		return ANIMALS.filter((a) => a.realms.length === 1 && a.realms[0] === 'water').map((a) => [a.id]);
	return getLand(group.land).species.map((id) => [id]);
}

/** Whether every kind `group` asks for is in `caught`. */
export function groupCaught(group: BadgeGroup, caught: readonly string[]): boolean {
	const have = new Set(caught);
	return groupNeeds(group).every((any) => any.some((id) => have.has(id)));
}

/** The firsts the game's state proves, whenever it is read. */
function firstHolds(id: string, progress: BadgeProgress): boolean {
	switch (id) {
		case 'firsts.imprinting':
			return progress.party.length > 0 || progress.book.caught.length > 0;
		case 'firsts.latin-name':
			return progress.party.some((a) => a.nickname !== undefined && a.nickname !== '');
		case 'firsts.tundra':
			return progress.lands.includes('arctic');
		case 'firsts.food-chain': {
			const tiers = new Set<number>(progress.party.map((a) => getAnimal(a.speciesId).tier));
			return [1, 2, 3, 4, 5].every((t) => tiers.has(t));
		}
		default:
			return false;
	}
}

/** Every badge `progress` holds now, in the catalogue's order. The firsts only a moment proves are never among them. */
export function badgesHeld(progress: BadgeProgress): string[] {
	const held: string[] = [];
	for (const family of BADGE_FAMILIES) {
		if (family.kind === 'ladder') {
			const n = badgeCount(progress, family.count);
			const all = family.count === 'tools' ? everyTool().length : Infinity;
			for (const b of family.badges) if (n >= (b.at === 'all' ? all : b.at)) held.push(b.id);
		} else if (family.kind === 'collection') {
			for (const b of family.badges)
				if (groupCaught(b.group, progress.book.caught)) held.push(b.id);
		} else {
			for (const b of family.badges) if (firstHolds(b.id, progress)) held.push(b.id);
		}
	}
	return held;
}

/**
 * The badges after `progress` and `moments`, and which of them are new.
 * `earned` stays as it is, ids this build does not have included, and comes
 * first: what is new joins it in the catalogue's order. A badge is never
 * taken back, however `progress` has gone down since it was earned.
 */
export function earnBadges(
	earned: readonly string[],
	progress: BadgeProgress,
	moments: readonly BadgeMoment[] = []
): { readonly earned: readonly string[]; readonly fresh: readonly string[] } {
	const have = new Set(earned);
	const now = new Set([...badgesHeld(progress), ...moments]);
	const fresh = BADGE_IDS.filter((id) => now.has(id) && !have.has(id));
	return { earned: fresh.length === 0 ? earned : [...earned, ...fresh], fresh };
}
