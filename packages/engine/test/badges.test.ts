import { describe, expect, it } from 'vitest';
import { bookOf } from '../src/animals/book.js';
import { ANIMALS } from '../src/animals/catalog.js';
import type { AnimalInstance } from '../src/animals/types.js';
import {
	BADGE_FAMILIES,
	BADGE_IDS,
	BADGE_MOMENTS,
	isBadgeId
} from '../src/badges/catalog.js';
import {
	badgeCount,
	badgeCounts,
	badgeTarget,
	badgesHeld,
	earnBadges,
	groupCaught,
	groupKinds,
	type BadgeProgress
} from '../src/badges/earn.js';
import { battleMoment, catchMoments, rideMoment, tripMoment } from '../src/badges/moments.js';
import { EMPTY_TALLY, addToTally, tallyDay, type Tally } from '../src/badges/tally.js';
import { LAND_IDS } from '../src/lands/ids.js';
import { getLand, shopFor } from '../src/lands/lands.js';
import { ALL_PUZZLE_TOPICS } from '../src/puzzles/types.js';
import { Rng } from '../src/rng.js';
import {
	isContentId,
	newGame,
	readSave,
	restoreGame,
	sameProgress,
	saveDocument,
	validateSave,
	type SaveV6,
	type SavedGame
} from '../src/save.js';

/** The game as the badges read it: what `LocalAuthority` hands `earnBadges`. */
function progressOf(game: SavedGame): BadgeProgress {
	return {
		solved: game.solved,
		puzzles: game.puzzles,
		book: bookOf(game.seen, game.caught, game.freed, game.told),
		party: game.party,
		steps: game.steps,
		visits: game.visits,
		land: game.land,
		world: game.world,
		worlds: game.worlds,
		items: game.items,
		lands: game.lands,
		tally: game.tally
	};
}

const starter = (): AnimalInstance => ({ id: 's', speciesId: 'squirrel', hp: 20 });
const fresh = (): SavedGame => newGame(7, starter());
const ladders = BADGE_FAMILIES.flatMap((f) => (f.kind === 'ladder' ? [f] : []));

describe('the catalogue', () => {
	it('holds the 282 badges, each id once, each a family and a name joined by a dot', () => {
		expect(BADGE_IDS).toHaveLength(282);
		expect(new Set(BADGE_IDS).size).toBe(BADGE_IDS.length);
		const bad = BADGE_FAMILIES.flatMap((f) =>
			f.badges
				.map((b) => b.id)
				.filter((id) => {
					const [family, name, ...rest] = id.split('.');
					return family !== f.id || !isContentId(name) || rest.length > 0;
				})
		);
		expect(bad).toEqual([]);
		expect(BADGE_IDS.every(isBadgeId)).toBe(true);
		expect(isBadgeId('solved.no-such-badge')).toBe(false);
	});

	it('names every kind of puzzle there is in a ladder of its own', () => {
		const topics = ladders.flatMap((f) =>
			f.count.startsWith('topic:') ? [f.count.slice('topic:'.length)] : []
		);
		expect([...topics].sort()).toEqual([...ALL_PUZZLE_TOPICS].sort());
	});

	it('asks more of each badge of a ladder than of the one before it, and every tool of every land last', () => {
		const bad: string[] = [];
		for (const f of ladders) {
			const targets = f.badges.map(badgeTarget);
			if (targets[0]! < 1) bad.push(`${f.id} starts below 1`);
			for (let i = 1; i < targets.length; i++) {
				if (targets[i]! <= targets[i - 1]!) bad.push(`${f.badges[i]!.id} asks no more than the one before`);
			}
			f.badges.forEach((b, i) => {
				if (b.at === 'all' && i !== f.badges.length - 1) bad.push(`${b.id} is 'all' but not last`);
			});
		}
		expect(bad).toEqual([]);
		const everyTool = LAND_IDS.filter((l) => getLand(l).available).flatMap(shopFor).length;
		expect(badgeTarget({ id: 'tools.toolmaker', at: 'all' })).toBe(everyTool);
	});

	it("asks every collection for animals of this build's catalogue, at least two kinds each", () => {
		const species = new Set(ANIMALS.map((a) => a.id));
		const bad: string[] = [];
		for (const f of BADGE_FAMILIES) {
			if (f.kind !== 'collection') continue;
			for (const b of f.badges) {
				const kinds = groupKinds(b.group);
				if (kinds.length < 2) bad.push(`${b.id} asks for ${kinds.length} kinds`);
				for (const any of kinds) {
					if (any.length === 0) bad.push(`${b.id} has an empty choice`);
					for (const id of any) if (!species.has(id)) bad.push(`${b.id}: ${id}`);
				}
			}
		}
		expect(bad).toEqual([]);
	});

	it('has a first for every moment, and every moment a first', () => {
		const firsts = BADGE_FAMILIES.find((f) => f.id === 'firsts')!.badges.map((b) => b.id);
		expect(BADGE_MOMENTS.every((m) => firsts.includes(m))).toBe(true);
	});
});

describe('earning', () => {
	it('gives a new game its first animal and nothing it has not done', () => {
		const held = badgesHeld(progressOf(fresh()));
		expect(held).toContain('firsts.imprinting');
		const counted = ['solved', 'catches', 'battles', 'steps', 'visits', 'clearing', 'matches', 'days'];
		expect(held.filter((id) => counted.includes(id.split('.')[0]!))).toEqual([]);
		expect(held.filter((id) => (BADGE_MOMENTS as readonly string[]).includes(id))).toEqual([]);
	});

	it("gives each ladder's badges from its number on, and none before", () => {
		const bad: string[] = [];
		for (const f of ladders) {
			for (const b of f.badges) {
				const at = badgeTarget(b);
				const below = withCount(f.count, at - 1);
				const on = withCount(f.count, at);
				if (!below || !on) continue;
				if (badgeCount(on, f.count) !== at) bad.push(`${f.count} reads ${badgeCount(on, f.count)}, not ${at}`);
				if (badgesHeld(below).includes(b.id)) bad.push(`${b.id} at ${at - 1}`);
				if (!badgesHeld(on).includes(b.id)) bad.push(`${b.id} not at ${at}`);
			}
		}
		expect(bad).toEqual([]);
	});

	it('never takes a badge back, keeps one this build lacks, and celebrates each badge once', () => {
		const rng = new Rng(11);
		const bad: string[] = [];
		for (let run = 0; run < 200; run++) {
			const start = BADGE_IDS.filter(() => rng.next() < 0.1);
			const earned = [...start, 'shells.conch'];
			const n = Math.floor(rng.next() * 3000);
			const progress = { ...progressOf(fresh()), solved: n, steps: n * 7 };
			const moments = BADGE_MOMENTS.filter(() => rng.next() < 0.3);
			const once = earnBadges(earned, progress, moments);
			if (once.earned.slice(0, earned.length).join() !== earned.join()) bad.push(`run ${run}: reordered or dropped`);
			if (once.fresh.some((id) => earned.includes(id))) bad.push(`run ${run}: celebrated again`);
			if (once.earned.length !== earned.length + once.fresh.length) bad.push(`run ${run}: lost a fresh one`);
			if (!moments.every((m) => once.earned.includes(m))) bad.push(`run ${run}: a moment unearned`);
			// The same game again earns nothing more; and a game gone down (a smaller team) takes nothing back.
			const again = earnBadges(once.earned, { ...progress, solved: 0, steps: 0, party: [] });
			if (again.fresh.length > 0 || again.earned !== once.earned) bad.push(`run ${run}: changed again`);
		}
		expect(bad).toEqual([]);
	});

	it('gives the firsts a game proves as soon as it holds them', () => {
		const game = fresh();
		const held = (g: Partial<BadgeProgress>) => badgesHeld({ ...progressOf(game), ...g });
		expect(held({ party: [{ ...starter(), nickname: 'Nøddi' }] })).toContain('firsts.latin-name');
		expect(held({})).not.toContain('firsts.latin-name');
		expect(held({ land: 'arctic' })).toContain('firsts.tundra');
		const nordland = { land: 'nordland' as const, items: [], worlds: [{ world: 7 }] };
		expect(held({ land: 'arctic', lands: [nordland] })).toContain('firsts.tundra');
		expect(held({})).not.toContain('firsts.tundra');
		const bySize = [1, 2, 3, 4, 5].map((tier, i) => ({
			id: `t${i}`,
			speciesId: ANIMALS.find((a) => a.tier === tier)!.id,
			hp: 1
		}));
		expect(held({ party: bySize })).toContain('firsts.food-chain');
		expect(held({ party: bySize.slice(1) })).not.toContain('firsts.food-chain');
	});

	it('counts a world in each land on its own, and a world left and come back to once', () => {
		const p = progressOf(fresh());
		expect(badgeCount({ ...p, world: 5, worlds: [{ world: 5 }, { world: 9 }] }, 'worlds')).toBe(2);
		const arctic = { land: 'arctic' as const, items: [], worlds: [{ world: 5 }, { world: 6 }] };
		expect(badgeCount({ ...p, world: 5, worlds: [], lands: [arctic] }, 'worlds')).toBe(3);
	});

	it('counts the tools of each land on their own, and every tool of every land is Toolmaker', () => {
		const p = progressOf(fresh());
		const nordland = shopFor('nordland');
		const arctic = shopFor('arctic');
		const home = { ...p, items: nordland };
		expect(badgeCount(home, 'tools')).toBe(nordland.length);
		expect(badgesHeld(home)).not.toContain('tools.toolmaker');
		const both = { ...home, lands: [{ land: 'arctic' as const, items: arctic, worlds: [] }] };
		expect(badgeCount(both, 'tools')).toBe(nordland.length + arctic.length);
		expect(badgesHeld(both)).toContain('tools.toolmaker');
	});

	it('counts the kinds of puzzle solved, and the fewest right answers of any kind', () => {
		const p = progressOf(fresh());
		const puzzles = Object.fromEntries(
			ALL_PUZZLE_TOPICS.map((t, i) => [t, { tried: 40, right: 10 + i, recent: '' }])
		);
		expect(badgeCount({ ...p, puzzles }, 'kinds')).toBe(ALL_PUZZLE_TOPICS.length);
		expect(badgeCount({ ...p, puzzles }, 'every-kind')).toBe(10);
		const noAdding: Record<string, unknown> = { ...puzzles };
		delete noAdding.add;
		expect(badgeCount({ ...p, puzzles: noAdding as typeof puzzles }, 'every-kind')).toBe(0);
		expect(badgeCounts({ ...p, puzzles }).omnivore).toBe(10);
	});

	it('gives a collection once every kind it asks for is caught, any penguin for a penguin', () => {
		const pole = BADGE_FAMILIES.flatMap((f) => (f.kind === 'collection' ? f.badges : [])).find(
			(b) => 'oneOfEach' in b.group
		)!;
		const kinds = groupKinds(pole.group);
		const one = kinds.map((any) => any[any.length - 1]!);
		expect(groupCaught(pole.group, one)).toBe(true);
		expect(groupCaught(pole.group, one.slice(1))).toBe(false);
	});
});

/** A game whose number `count` reads is `n`, or null for a count this helper cannot set alone. */
function withCount(count: string, n: number): BadgeProgress | null {
	const p = progressOf(fresh());
	const tally = (key: keyof Tally): BadgeProgress => ({ ...p, tally: { ...EMPTY_TALLY, [key]: n } });
	if (count.startsWith('topic:')) {
		return { ...p, puzzles: { [count.slice(6)]: { tried: n, right: n, recent: '' } } };
	}
	switch (count) {
		case 'solved':
			return { ...p, solved: n };
		case 'steps':
			return { ...p, steps: n };
		case 'visits':
			return { ...p, visits: n };
		case 'catches':
		case 'wins':
		case 'matches':
		case 'cleared':
		case 'days':
			return tally(count);
		case 'team':
			return { ...p, party: Array.from({ length: n }, (_, i) => ({ ...starter(), id: `a${i}` })) };
		case 'seen':
		case 'caught':
		case 'freed':
		case 'told': {
			if (n > ANIMALS.length) return null;
			const ids = ANIMALS.slice(0, n).map((a) => a.id);
			const lists = { seen: ids, caught: [] as string[], freed: [] as string[], told: [] as string[] };
			if (count !== 'seen') lists[count] = ids;
			return { ...p, party: [], book: bookOf(lists.seen, lists.caught, lists.freed, lists.told) };
		}
		case 'worlds':
			return { ...p, world: 1, worlds: Array.from({ length: n - 1 }, (_, i) => ({ world: i + 2 })) };
		case 'kinds': {
			const topics = ALL_PUZZLE_TOPICS.slice(0, n);
			if (topics.length < n) return null;
			return { ...p, puzzles: Object.fromEntries(topics.map((t) => [t, { tried: 1, right: 1, recent: '1' }])) };
		}
		case 'every-kind':
			return {
				...p,
				puzzles: Object.fromEntries(ALL_PUZZLE_TOPICS.map((t) => [t, { tried: n, right: n, recent: '' }]))
			};
		case 'tools': {
			const every = LAND_IDS.filter((l) => getLand(l).available).flatMap((land) =>
				shopFor(land).map((item) => ({ land, item }))
			);
			if (n > every.length || n < 0) return null;
			const chosen = every.slice(0, n);
			const own = (land: string) => chosen.filter((t) => t.land === land).map((t) => t.item);
			return {
				...p,
				items: own('nordland'),
				lands: [{ land: 'arctic', items: own('arctic'), worlds: [] }]
			};
		}
		default:
			return null;
	}
}

describe('the moments', () => {
	it('marks the first battle on the water and up in the air, never on land', () => {
		expect(battleMoment('water')).toBe('firsts.webbed-feet');
		expect(battleMoment('air')).toBe('firsts.hollow-bones');
		expect(battleMoment('land')).toBeNull();
	});

	it('marks a ride on the back of a lead big enough, with the harness, and nothing else', () => {
		const carrier = ANIMALS.find((a) => a.carries)!.id;
		const small = ANIMALS.find((a) => !a.carries && a.realms.includes('land'))!.id;
		const lead = (speciesId: string, hp = 10): AnimalInstance => ({ id: speciesId, speciesId, hp });
		expect(rideMoment({ items: ['harness'] }, [lead(carrier)])).toBe('firsts.symbiosis');
		expect(rideMoment({ items: [] }, [lead(carrier)])).toBeNull();
		expect(rideMoment({ items: ['harness'] }, [lead(small)])).toBeNull();
		// A tired carrier leads nobody: the small one walks in front.
		expect(rideMoment({ items: ['harness'] }, [lead(carrier, 0), lead(small)])).toBeNull();
	});

	it('marks a catch two sizes or more above the animal that threw, and one from a fishing hole', () => {
		const ofTier = (tier: number): AnimalInstance => {
			const a = ANIMALS.find((s) => s.tier === tier)!;
			return { id: a.id, speciesId: a.id, hp: 1 };
		};
		const bad: string[] = [];
		for (let front = 1; front <= 5; front++) {
			for (let caught = 1; caught <= 5; caught++) {
				const moments = catchMoments(ofTier(front), ofTier(caught), false);
				const strong = caught - front >= 2;
				if (moments.includes('firsts.ant-strength') !== strong) bad.push(`${front} → ${caught}`);
			}
		}
		expect(bad).toEqual([]);
		expect(catchMoments(ofTier(3), ofTier(3), true)).toEqual(['firsts.kingfisher']);
	});

	it('marks a trip back to the home world from another, never one away from it', () => {
		expect(tripMoment(12, 7, 7)).toBe('firsts.homing-instinct');
		expect(tripMoment(7, 12, 7)).toBeNull();
		expect(tripMoment(12, 13, 7)).toBeNull();
	});
});

describe('the tally', () => {
	it('adds one at a time and never passes the most a save holds', () => {
		expect(addToTally(EMPTY_TALLY, 'wins').wins).toBe(1);
		const most = { ...EMPTY_TALLY, catches: Number.MAX_SAFE_INTEGER };
		expect(addToTally(most, 'catches').catches).toBe(Number.MAX_SAFE_INTEGER);
	});

	it('counts a day once however many puzzles are solved on it, and days apart as two', () => {
		let t = tallyDay(EMPTY_TALLY, '2026-11-24');
		t = tallyDay(t, '2026-11-24');
		expect(t).toEqual({ ...EMPTY_TALLY, days: 1, lastDay: '2026-11-24' });
		t = tallyDay(t, '2026-12-01');
		expect(t.days).toBe(2);
		expect(tallyDay(t, 'tuesday')).toBe(t);
	});
});

describe('the save', () => {
	const doc = (extra: Record<string, unknown>): unknown => ({
		...saveDocument(fresh(), { lineage: 'L', seq: 1 }),
		...extra
	});

	it('writes no badges and no tally before there are any, and reads a save without them as none', () => {
		const d = saveDocument(fresh(), { lineage: 'L', seq: 1 });
		expect('badges' in d).toBe(false);
		expect('tally' in d).toBe(false);
		const read = readSave(JSON.parse(JSON.stringify(d)));
		expect(read.ok && restoreGame(read.save, () => 'x')).toMatchObject({ badges: [], tally: EMPTY_TALLY });
	});

	it("keeps a badge this build lacks, and reads a badge listed twice once", () => {
		const read = readSave(doc({ badges: ['solved.atom', 'shells.conch', 'solved.atom'] }));
		expect(read.ok).toBe(true);
		if (read.ok) expect(restoreGame(read.save, () => 'x').badges).toEqual(['solved.atom', 'shells.conch']);
	});

	it('refuses badges and a tally of the wrong shape', () => {
		const refused = [
			{ badges: 'solved.atom' },
			{ badges: ['solved'] },
			{ badges: ['Solved.Atom'] },
			{ badges: [3] },
			{ tally: [] },
			{ tally: { wins: -1 } },
			{ tally: { days: 1.5 } },
			{ tally: { lastDay: '24/11/2026' } }
		].filter((extra) => validateSave(doc(extra)).ok);
		expect(refused).toEqual([]);
		expect(validateSave(doc({ tally: { wins: 2, future: 'kept elsewhere' } })).ok).toBe(true);
	});

	it('writes only the numbers counted, and reads the rest as 0', () => {
		const game = { ...fresh(), tally: addToTally(EMPTY_TALLY, 'cleared', 3) };
		const d = saveDocument(game, { lineage: 'L', seq: 1 });
		expect(d.tally).toStrictEqual({ cleared: 3 });
		const read = readSave(JSON.parse(JSON.stringify(d)));
		expect(read.ok && restoreGame(read.save, () => 'x').tally).toEqual(game.tally);
	});

	it('compares badges as a set: the order earned is no progress, a badge more is', () => {
		const a = doc({ badges: ['solved.atom', 'firsts.imprinting'] }) as SaveV6;
		const b = doc({ badges: ['firsts.imprinting', 'solved.atom'] }) as SaveV6;
		const c = doc({ badges: ['firsts.imprinting'] }) as SaveV6;
		expect(sameProgress(a, b)).toBe(true);
		expect(sameProgress(a, c)).toBe(false);
		expect(sameProgress(doc({}) as SaveV6, doc({ tally: {} }) as SaveV6)).toBe(true);
	});
});
