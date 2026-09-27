import { describe, expect, it } from 'vitest';
import {
	BOOK_ORDER,
	EMPTY_BOOK,
	bookOf,
	catchSpecies,
	hasCaught,
	hasSeen,
	recordBattle,
	recordParty,
	seeSpecies,
	type AnimalBook
} from '../src/animals/book.js';
import { ANIMALS, canFightIn } from '../src/animals/catalog.js';
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

/** Every species caught is seen, and each list names each species once, all of the catalog. */
function whole(book: AnimalBook): string[] {
	const bad: string[] = [];
	if (new Set(book.seen).size !== book.seen.length) bad.push(`seen repeats: ${book.seen}`);
	if (new Set(book.caught).size !== book.caught.length) bad.push(`caught repeats: ${book.caught}`);
	for (const id of book.caught) if (!book.seen.includes(id)) bad.push(`${id} caught, not seen`);
	for (const id of [...book.seen, ...book.caught]) if (!IDS.includes(id)) bad.push(`${id}?`);
	return bad;
}

describe("the book's order", () => {
	it('holds every species of the catalog once, by tier from small to big, then in catalog order', () => {
		expect(BOOK_ORDER.map((a) => a.id).sort()).toEqual([...IDS].sort());
		expect(BOOK_ORDER).toHaveLength(ANIMALS.length);
		const bad: string[] = [];
		for (let i = 1; i < BOOK_ORDER.length; i++) {
			const [a, b] = [BOOK_ORDER[i - 1]!, BOOK_ORDER[i]!];
			if (a.tier > b.tier) bad.push(`${a.id} (${a.tier}) before ${b.id} (${b.tier})`);
			if (a.tier === b.tier && IDS.indexOf(a.id) > IDS.indexOf(b.id)) {
				bad.push(`${a.id} before ${b.id}, against the catalog`);
			}
		}
		expect(bad).toEqual([]);
		// The small ones first, the starters leading as the catalog lists them; the biggest last.
		expect(BOOK_ORDER.slice(0, 3).map((a) => a.id)).toEqual(['squirrel', 'rabbit', 'frog']);
		expect(BOOK_ORDER.at(-1)!.tier).toBe(5);
	});
});

describe('seeing and catching', () => {
	it('sees a species once, in the order first seen; catching one sees it too, once', () => {
		let book = seeSpecies(EMPTY_BOOK, 'fox');
		book = seeSpecies(book, 'bear');
		book = seeSpecies(book, 'fox');
		expect(book).toEqual({ seen: ['fox', 'bear'], caught: [] });
		book = catchSpecies(book, 'rabbit');
		book = catchSpecies(book, 'fox');
		book = catchSpecies(book, 'rabbit');
		expect(book).toEqual({ seen: ['fox', 'bear', 'rabbit'], caught: ['rabbit', 'fox'] });
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
		}
		expect(bookOf(['fox', 'later-species'], ['Fox', 'bear'])).toEqual({
			seen: ['fox', 'bear'],
			caught: ['bear']
		});
	});

	it('only grows, whatever order animals are met and caught in', () => {
		const bad: string[] = [];
		for (let s = 0; s < 60; s++) {
			const rng = new Rng(hashInts(71, s));
			let book: AnimalBook = EMPTY_BOOK;
			for (let i = 0; i < 40; i++) {
				const id = rng.chance(0.1) ? rng.pick(NOT_SPECIES) : rng.pick(IDS);
				const before = book;
				book = rng.chance(0.5) ? seeSpecies(book, id) : catchSpecies(book, id);
				// Everything in the book before is still there, in its place.
				if (before.seen.some((x, j) => book.seen[j] !== x)) bad.push(`${s}: seen shrank`);
				if (before.caught.some((x, j) => book.caught[j] !== x)) bad.push(`${s}: caught shrank`);
				bad.push(...whole(book).map((w) => `${s}: ${w}`));
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
		// About 0.1 s alone (60 × 40 steps, each checked whole); allowed for a loaded machine.
	}, 30_000);

	it('reads two saved lists as a book: each species once, in its first place, the caught ones seen too', () => {
		expect(bookOf(['fox', 'bear', 'fox'], ['rabbit', 'fox', 'rabbit'])).toEqual({
			seen: ['fox', 'bear', 'rabbit'],
			caught: ['rabbit', 'fox']
		});
		expect(bookOf([], [])).toEqual(EMPTY_BOOK);
	});
});

describe('recordParty', () => {
	it('catches every species in the party, in party order: a starter alone is the whole book', () => {
		expect(recordParty(EMPTY_BOOK, makeParty(['frog']))).toEqual({
			seen: ['frog'],
			caught: ['frog']
		});
		const book = recordParty(
			{ seen: ['bear'], caught: [] },
			makeParty(['fox', 'squirrel', 'fox', 'bear'])
		);
		expect(book).toEqual({
			seen: ['bear', 'fox', 'squirrel'],
			caught: ['fox', 'squirrel', 'bear']
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
