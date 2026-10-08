import { describe, expect, it } from 'vitest';
import {
	bookOrder,
	EMPTY_BOOK,
	bookOf,
	catchSpecies,
	freeSpecies,
	hasCaught,
	hasFreed,
	hasSeen,
	recordBattle,
	recordParty,
	recordWentHome,
	seeSpecies,
	type AnimalBook
} from '../src/animals/book.js';
import { ANIMALS, canFightIn, getAnimal } from '../src/animals/catalog.js';
import { applyDoctorIntent, startDoctorVisit } from '../src/doctor/reducer.js';
import { LANDS } from '../src/lands/lands.js';
import type { DoctorIntent, DoctorState } from '../src/doctor/types.js';
import type { BattleOutcome, BattleState, BattleStep } from '../src/battle/types.js';
import { Rng, hashInts } from '../src/rng.js';
import { makeParty, makeWild, playBattle } from './battle-sim.js';

/**
 * The animal book ([[PRODUCT]] §4 "The animal book"): its order, and the
 * rules that fill it at the events that show an animal — a wild battle's
 * start and its leash throws, and the party.
 */

const IDS = ANIMALS.map((a) => a.id);
/** Ids no catalog of this build has: a later build's species, and junk. */
const NOT_SPECIES = ['later-species', 'Fox', '', 'fox ', 'wood mouse'];

/** Every species caught or set free is seen, and each list names each species once, all of the catalog. */
function whole(book: AnimalBook): string[] {
	const bad: string[] = [];
	for (const key of ['seen', 'caught', 'freed'] as const) {
		if (new Set(book[key]).size !== book[key].length) bad.push(`${key} repeats: ${book[key]}`);
	}
	for (const id of book.caught) if (!book.seen.includes(id)) bad.push(`${id} caught, not seen`);
	for (const id of book.freed) if (!book.seen.includes(id)) bad.push(`${id} set free, not seen`);
	for (const id of [...book.seen, ...book.caught, ...book.freed]) {
		if (!IDS.includes(id)) bad.push(`${id}?`);
	}
	return bad;
}

describe("the book's order", () => {
	it("holds every species of each land once, on the land's own page, by tier from small to big, then in catalog order", () => {
		const pages = LANDS.map((land) => bookOrder(land.id));
		// Every species is on exactly one land's page: no Arctic animal in Nordland's, and none left out.
		expect(pages.flatMap((page) => page.map((a) => a.id)).sort()).toEqual([...IDS].sort());
		const bad: string[] = [];
		for (const [i, page] of pages.entries()) {
			expect(page.map((a) => a.id).sort()).toEqual([...LANDS[i]!.species].sort());
			for (let j = 1; j < page.length; j++) {
				const [a, b] = [page[j - 1]!, page[j]!];
				if (a.tier > b.tier) bad.push(`${a.id} (${a.tier}) before ${b.id} (${b.tier})`);
				if (a.tier === b.tier && IDS.indexOf(a.id) > IDS.indexOf(b.id)) {
					bad.push(`${a.id} before ${b.id}, against the catalog`);
				}
			}
			// The land's starters lead, as the catalog lists them.
			const starters = LANDS[i]!.starters;
			expect(page.slice(0, starters.length).map((a) => a.id)).toEqual([...starters]);
		}
		expect(bad).toEqual([]);
		// Nordland's 50, the biggest last; The Arctic's first wave, its small land animals.
		expect(bookOrder('nordland')).toHaveLength(50);
		expect(bookOrder('nordland').at(-1)!.tier).toBe(5);
		expect(bookOrder('arctic').slice(0, 3).map((a) => a.id)).toEqual([
			'arctic-fox',
			'arctic-hare',
			'puffin'
		]);
		expect(bookOrder('arctic')).toBe(bookOrder('arctic'));
	});
});

describe('seeing and catching', () => {
	it('sees a species once, in the order first seen; catching one sees it too, once', () => {
		let book = seeSpecies(EMPTY_BOOK, 'fox');
		book = seeSpecies(book, 'bear');
		book = seeSpecies(book, 'fox');
		expect(book).toEqual({ seen: ['fox', 'bear'], caught: [], freed: [] });
		book = catchSpecies(book, 'rabbit');
		book = catchSpecies(book, 'fox');
		book = catchSpecies(book, 'rabbit');
		expect(book).toEqual({
			seen: ['fox', 'bear', 'rabbit'],
			caught: ['rabbit', 'fox'],
			freed: []
		});
		expect([hasSeen(book, 'bear'), hasCaught(book, 'bear')]).toEqual([true, false]);
		expect([hasSeen(book, 'fox'), hasCaught(book, 'fox')]).toEqual([true, true]);
		expect([hasSeen(book, 'wolf'), hasCaught(book, 'wolf')]).toEqual([false, false]);
	});

	it('hands back the very same book when nothing is new, so a change is a new book', () => {
		const book = catchSpecies(seeSpecies(EMPTY_BOOK, 'fox'), 'rabbit');
		expect(seeSpecies(book, 'fox')).toBe(book);
		expect(seeSpecies(book, 'rabbit')).toBe(book);
		expect(catchSpecies(book, 'rabbit')).toBe(book);
		expect(recordParty(book, makeParty(['rabbit', 'rabbit']))).toBe(book);
		expect(catchSpecies(book, 'fox')).not.toBe(book);
	});

	it('never writes an id the catalog does not have: a kid’s own save must never read as a newer build’s', () => {
		for (const id of NOT_SPECIES) {
			expect(seeSpecies(EMPTY_BOOK, id), id).toBe(EMPTY_BOOK);
			expect(catchSpecies(EMPTY_BOOK, id), id).toBe(EMPTY_BOOK);
			expect(freeSpecies(EMPTY_BOOK, id), id).toBe(EMPTY_BOOK);
		}
		expect(bookOf(['fox', 'later-species'], ['Fox', 'bear'], ['later-species', 'otter'])).toEqual({
			seen: ['fox', 'bear', 'otter'],
			caught: ['bear'],
			freed: ['otter']
		});
		const later = { type: 'went-home', animals: [{ id: 'x', speciesId: 'later-species', hp: 1 }] };
		expect(recordWentHome(EMPTY_BOOK, [later as never])).toBe(EMPTY_BOOK);
	});

	it('only grows, whatever order animals are met and caught in', () => {
		const bad: string[] = [];
		for (let s = 0; s < 60; s++) {
			const rng = new Rng(hashInts(71, s));
			let book: AnimalBook = EMPTY_BOOK;
			for (let i = 0; i < 40; i++) {
				const id = rng.chance(0.1) ? rng.pick(NOT_SPECIES) : rng.pick(IDS);
				const before = book;
				const roll = rng.next();
				book =
					roll < 0.4
						? seeSpecies(book, id)
						: roll < 0.8
							? catchSpecies(book, id)
							: freeSpecies(book, id);
				// Everything in the book before is still there, in its place.
				for (const key of ['seen', 'caught', 'freed'] as const) {
					if (before[key].some((x, j) => book[key][j] !== x)) bad.push(`${s}: ${key} shrank`);
				}
				bad.push(...whole(book).map((w) => `${s}: ${w}`));
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
		// About 0.1 s alone (60 × 40 steps, each checked whole); allowed for a loaded machine.
	}, 30_000);

	it('reads two saved lists as a book: each species once, in its first place, the caught ones seen too', () => {
		expect(bookOf(['fox', 'bear', 'fox'], ['rabbit', 'fox', 'rabbit'])).toEqual({
			seen: ['fox', 'bear', 'rabbit'],
			caught: ['rabbit', 'fox'],
			freed: []
		});
		expect(bookOf([], [])).toEqual(EMPTY_BOOK);
		// A kind set free is seen too, and caught only when the save says so.
		expect(bookOf(['fox'], ['fox'], ['otter', 'fox', 'otter'])).toEqual({
			seen: ['fox', 'otter'],
			caught: ['fox'],
			freed: ['otter', 'fox']
		});
	});
});

describe('recordParty', () => {
	it('catches every species in the party, in party order: a starter alone is the whole book', () => {
		expect(recordParty(EMPTY_BOOK, makeParty(['frog']))).toEqual({
			seen: ['frog'],
			caught: ['frog'],
			freed: []
		});
		const book = recordParty(
			{ seen: ['bear'], caught: [], freed: [] },
			makeParty(['fox', 'squirrel', 'fox', 'bear'])
		);
		expect(book).toEqual({
			seen: ['bear', 'fox', 'squirrel'],
			caught: ['fox', 'squirrel', 'bear'],
			freed: []
		});
	});
});

describe('recordBattle', () => {
	/** Where `wild` is met: on land when it goes there, else out on the water. */
	const realmOf = (wild: string) => (canFightIn(wild, 'land') ? 'land' : 'water');
	/** A party that can meet `wild`: two of the land's, or two that swim. */
	const partyFor = (wild: string) =>
		makeParty(realmOf(wild) === 'land' ? ['fox', 'squirrel'] : ['otter', 'frog']);

	it('sees the wild animal as a battle starts, and catches it exactly at a leash throw that lands, over battles with every species', () => {
		const bad: string[] = [];
		const outcomes = new Map<BattleOutcome, number>();
		for (const spec of ANIMALS) {
			for (let s = 0; s < 4; s++) {
				const seed = hashInts(81, IDS.indexOf(spec.id), s);
				const party = partyFor(spec.id);
				const start = recordParty(EMPTY_BOOK, party);
				let book = start;
				let started = false;
				const onStep = (before: BattleState, _: unknown, step: BattleStep) => {
					if (!started) {
						// The battle's first state: the wild animal is seen before any intent.
						started = true;
						book = recordBattle(book, before);
						if (!hasSeen(book, spec.id)) bad.push(`${spec.id}/${s}: not seen at the start`);
						if (hasCaught(book, spec.id) !== hasCaught(start, spec.id)) {
							bad.push(`${spec.id}/${s}: caught at the start`);
						}
					}
					const was = book;
					book = recordBattle(book, step.state, step.events);
					const landed = step.events.some((e) => e.type === 'leash-thrown' && e.success);
					const newlyCaught = hasCaught(book, spec.id) && !hasCaught(was, spec.id);
					if (newlyCaught !== (landed && !hasCaught(was, spec.id))) {
						bad.push(`${spec.id}/${s}: caught ${newlyCaught} at a step, a throw landed ${landed}`);
					}
					// Nothing but the wild animal is ever added by a battle.
					for (const id of book.seen) {
						if (id !== spec.id && !was.seen.includes(id)) bad.push(`${spec.id}/${s}: saw ${id}`);
					}
					bad.push(...whole(book).map((w) => `${spec.id}/${s}: ${w}`));
				};
				const { state } = playBattle(
					seed,
					party,
					makeWild(spec.id),
					{ accuracy: 0.8, policy: 'random', leash: 0.35, flee: 0.04 },
					onStep,
					2000,
					realmOf(spec.id)
				);
				const outcome = state.phase.kind === 'ended' ? state.phase.outcome : null;
				if (outcome) outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
				const caughtNow = outcome === 'caught' || hasCaught(start, spec.id);
				if (hasCaught(book, spec.id) !== caughtNow) {
					bad.push(`${spec.id}/${s}: ended ${outcome}, caught in the book ${!caughtNow}`);
				}
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
		// Every way out of a battle was played: a battle run from, won or lost leaves it seen only.
		expect([...outcomes.keys()].sort()).toEqual(['caught', 'fled', 'lost', 'won']);
	}, 30_000);
});

describe('setting free', () => {
	it('sets a species free once, in the order first set free, and sees it; nothing else moves', () => {
		let book = catchSpecies(EMPTY_BOOK, 'fox');
		book = freeSpecies(book, 'fox');
		book = freeSpecies(book, 'wolf');
		const same = freeSpecies(book, 'fox');
		expect(same).toBe(book);
		expect(book).toEqual({ seen: ['fox', 'wolf'], caught: ['fox'], freed: ['fox', 'wolf'] });
		expect([hasFreed(book, 'fox'), hasFreed(book, 'wolf'), hasFreed(book, 'bear')]).toEqual([
			true,
			true,
			false
		]);
		// Seeing or catching again keeps the list.
		expect(catchSpecies(book, 'rabbit').freed).toEqual(['fox', 'wolf']);
		expect(seeSpecies(book, 'bear').freed).toEqual(['fox', 'wolf']);
	});

	it('sets free exactly the kinds that went home, at the step whose right answer sent them', () => {
		// Real visits, driven through the reducer by a kid who picks at random and is often wrong:
		// the book changes only at a step that took animals out of the party, and then by
		// exactly their kinds.
		let wentHome = 0;
		const bad: string[] = [];
		for (let s = 0; s < 80; s++) {
			const rng = new Rng(hashInts(83, s));
			const party = Array.from({ length: rng.int(2, 9) }, (_, i) => {
				const spec = rng.pick(ANIMALS);
				return { id: `a${i}`, speciesId: spec.id, hp: rng.int(0, getAnimal(spec.id).maxHp) };
			});
			let state: DoctorState = startDoctorVisit(party, { tokens: rng.int(0, 40) });
			let book = recordParty(EMPTY_BOOK, party);
			for (let i = 0; i < 60 && state.phase.kind !== 'ended'; i++) {
				const phase = state.phase;
				let intent: DoctorIntent;
				if (phase.kind === 'handing-over' || phase.kind === 'solving') {
					const a = phase.puzzle.answer;
					intent = { type: 'answer', input: String(rng.chance(0.6) ? a : a + 1) };
				} else {
					const ids = state.party.filter(() => rng.chance(0.4)).map((a) => a.id);
					intent = rng.chance(0.1) ? { type: 'leave' } : { type: 'hand-over', ids };
				}
				const step = applyDoctorIntent(state, intent, hashInts(s, i));
				const next = recordWentHome(book, step.events);
				const left = state.party.filter((a) => !step.state.party.some((b) => b.id === a.id));
				const newly = [...new Set(left.map((a) => a.speciesId))].filter(
					(id) => !book.freed.includes(id)
				);
				if (left.length > 0) wentHome++;
				if (newly.length === 0 && next !== book)
					bad.push(`${s}/${i}: changed with nobody new gone`);
				if (JSON.stringify(next.freed) !== JSON.stringify([...book.freed, ...newly])) {
					bad.push(`${s}/${i}: freed ${next.freed}, expected ${[...book.freed, ...newly]}`);
				}
				if (JSON.stringify(next.caught) !== JSON.stringify(book.caught)) {
					bad.push(`${s}/${i}: caught moved`);
				}
				bad.push(...whole(next).map((w) => `${s}/${i}: ${w}`));
				book = next;
				state = step.state;
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
		expect(wentHome).toBeGreaterThan(30);
	});
});
