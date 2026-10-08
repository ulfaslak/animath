import type { BattleEvent, BattleState } from '../battle/types.js';
import type { DoctorEvent } from '../doctor/types.js';
import type { LandId } from '../lands/ids.js';
import { getLand } from '../lands/lands.js';
import { ANIMALS } from './catalog.js';
import type { AnimalInstance, AnimalSpec } from './types.js';

/**
 * The animal book ([[PRODUCT]] §4 "The animal book"): every species a player
 * has seen, every one they have caught, and every one they have set free at
 * the witch doctor's, for as long as the game lasts.
 * It only grows. An animal helped home by the doctor stays caught, a battle run
 * from leaves its animal seen, and travelling takes the book along: it is the
 * player's, like the party.
 *
 * Each species is recorded at the point of the event that shows it, by the
 * rules here, which the authority calls: a wild battle's animal is seen the
 * moment the battle starts (`recordBattle`), and caught when a leash throw
 * lands (the same call, with the step's events); every animal in the party is
 * caught, the starter first (`recordParty`); a species is set free when one of
 * its kind goes home from the witch doctor's (`recordWentHome`). Nothing else records: a friendly
 * match changes nothing in a game but the puzzles solved ([[DECISIONS]]
 * § Multiplayer), and watching another player's battle from outside is not
 * the kid's own battle.
 *
 * Only species of the catalog go in: an id it does not have is never
 * written, so a kid's own save can never name a species this build lacks,
 * which would make it a newer build's (`findUnknownContent` in `save.ts`).
 */
export interface AnimalBook {
	/**
	 * Every species seen, each once, in the order first seen. Every caught
	 * species is in here too: catching one is seeing it.
	 */
	readonly seen: readonly string[];
	/** Every species caught, each once, in the order first caught: the starter first. */
	readonly caught: readonly string[];
	/**
	 * Every species set free at the witch doctor's, each once, in the order
	 * first set free: one of its kind went home in a hand-over the kid
	 * answered right (`recordWentHome`). Every one is seen too. A save from
	 * before it was kept counts every kind seen and not held as set free
	 * (`SAVE_UPGRADES[2]`), so a kind can be set free without being caught.
	 * One list for every land: species ids are unique across the catalog.
	 */
	readonly freed: readonly string[];
}

/** A book with nothing in it. A game never has one: it starts with its starter caught. */
export const EMPTY_BOOK: AnimalBook = { seen: [], caught: [], freed: [] };

/**
 * The book's page for land `land`, a tab of its own (#191): every species of
 * the land, in the book's order: by tier, from small to big, and within a
 * tier in catalog order (the sort is stable), so the land's starters lead. A
 * species the land grows is in its page at once. One book for every land:
 * it is the kid's, wherever they are, and a page counts its own land's kinds.
 */
export function bookOrder(land: LandId): readonly AnimalSpec[] {
	let page = PAGES.get(land);
	if (!page) {
		const ids = new Set(getLand(land).species);
		page = ANIMALS.filter((a) => ids.has(a.id)).sort((a, b) => a.tier - b.tier);
		PAGES.set(land, page);
	}
	return page;
}

const PAGES = new Map<LandId, readonly AnimalSpec[]>();

const SPECIES: ReadonlySet<string> = new Set(ANIMALS.map((a) => a.id));

/** Whether `speciesId` is in the book as seen (caught ones included). */
export function hasSeen(book: AnimalBook, speciesId: string): boolean {
	return book.seen.includes(speciesId);
}

/** Whether `speciesId` is in the book as caught. */
export function hasCaught(book: AnimalBook, speciesId: string): boolean {
	return book.caught.includes(speciesId);
}

/** Whether `speciesId` is in the book as set free. */
export function hasFreed(book: AnimalBook, speciesId: string): boolean {
	return book.freed.includes(speciesId);
}

/**
 * `book` with `speciesId` seen, at the end of `seen` when it is new there.
 * The very same book when nothing changes: already seen, or not a species of
 * the catalog.
 */
export function seeSpecies(book: AnimalBook, speciesId: string): AnimalBook {
	if (!SPECIES.has(speciesId) || book.seen.includes(speciesId)) return book;
	return { seen: [...book.seen, speciesId], caught: book.caught, freed: book.freed };
}

/**
 * `book` with `speciesId` caught, and so seen. The very same book when
 * nothing changes: already caught, or not a species of the catalog.
 */
export function catchSpecies(book: AnimalBook, speciesId: string): AnimalBook {
	if (!SPECIES.has(speciesId) || book.caught.includes(speciesId)) return book;
	const seen = seeSpecies(book, speciesId).seen;
	return { seen, caught: [...book.caught, speciesId], freed: book.freed };
}

/**
 * `book` with `speciesId` set free, and so seen. The very same book when
 * nothing changes: already set free, or not a species of the catalog.
 */
export function freeSpecies(book: AnimalBook, speciesId: string): AnimalBook {
	if (!SPECIES.has(speciesId) || book.freed.includes(speciesId)) return book;
	const { seen, caught } = seeSpecies(book, speciesId);
	return { seen, caught, freed: [...book.freed, speciesId] };
}

/**
 * `book` after a wild battle's start, or a step of it: its wild animal is
 * seen, from the moment the battle starts, however it ends; and when
 * `events`, the step's events, hold a leash throw that landed, it is caught.
 * The authority calls it with the battle's first state as it starts, and with
 * each step's state and events after, so a species is recorded at the event
 * that shows it. The very same book when nothing is new.
 */
export function recordBattle(
	book: AnimalBook,
	state: BattleState,
	events: readonly BattleEvent[] = []
): AnimalBook {
	const wild = state.opponent.speciesId;
	let next = seeSpecies(book, wild);
	for (const e of events) {
		if (e.type === 'leash-thrown' && e.success) next = catchSpecies(next, wild);
	}
	return next;
}

/**
 * `book` with every species in `party` caught, in party order: a new game's
 * starter, a `?party=` game's animals, and a save's party, since every
 * animal a kid has was caught (or was the starter, which counts as caught).
 */
export function recordParty(book: AnimalBook, party: readonly AnimalInstance[]): AnimalBook {
	let next = book;
	for (const animal of party) next = catchSpecies(next, animal.speciesId);
	return next;
}

/**
 * `book` after a step of a doctor visit, given the step's events: every
 * species of every animal that went home (`went-home`, which the reducer
 * emits only on a right answer to a hand-over's sum) is set free, in the
 * order they went. The authority calls it with each accepted step's events.
 * The very same book when nothing is new.
 */
export function recordWentHome(book: AnimalBook, events: readonly DoctorEvent[]): AnimalBook {
	let next = book;
	for (const e of events) {
		if (e.type !== 'went-home') continue;
		for (const animal of e.animals) next = freeSpecies(next, animal.speciesId);
	}
	return next;
}

/**
 * A book from its lists as a save holds them: each species once, in the
 * order listed, the caught and set-free ones seen too, and nothing the
 * catalog lacks.
 */
export function bookOf(
	seen: readonly string[],
	caught: readonly string[],
	freed: readonly string[] = []
): AnimalBook {
	let book: AnimalBook = EMPTY_BOOK;
	for (const id of seen) book = seeSpecies(book, id);
	for (const id of caught) book = catchSpecies(book, id);
	for (const id of freed) book = freeSpecies(book, id);
	return book;
}
