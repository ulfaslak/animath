import type { BattleEvent, BattleState } from '../battle/types.js';
import { ANIMALS } from './catalog.js';
import type { AnimalInstance, AnimalSpec } from './types.js';

/**
 * The animal book ([[PRODUCT]] §4 "The animal book"): every species a player
 * has seen, and every one they have caught, for as long as the game lasts.
 * It only grows. An animal helped home by the doctor stays caught, a battle run
 * from leaves its animal seen, and travelling takes the book along: it is the
 * player's, like the party.
 *
 * Each species is recorded at the point of the event that shows it, by the
 * rules here, which the authority calls: a wild battle's animal is seen the
 * moment the battle starts (`recordBattle`), and caught when a leash throw
 * lands (the same call, with the step's events); every animal in the party is
 * caught, the starter first (`recordParty`). Nothing else records: a friendly
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
}

/** A book with nothing in it. A game never has one: it starts with its starter caught. */
export const EMPTY_BOOK: AnimalBook = { seen: [], caught: [] };

/**
 * Every species of the catalog, in the book's order: by tier, from small to
 * big, and within a tier in catalog order (the sort is stable). A species the
 * catalog grows is in the book at once.
 */
export const BOOK_ORDER: readonly AnimalSpec[] = [...ANIMALS].sort((a, b) => a.tier - b.tier);

const SPECIES: ReadonlySet<string> = new Set(ANIMALS.map((a) => a.id));

/** Whether `speciesId` is in the book as seen (caught ones included). */
export function hasSeen(book: AnimalBook, speciesId: string): boolean {
	return book.seen.includes(speciesId);
}

/** Whether `speciesId` is in the book as caught. */
export function hasCaught(book: AnimalBook, speciesId: string): boolean {
	return book.caught.includes(speciesId);
}

/**
 * `book` with `speciesId` seen, at the end of `seen` when it is new there.
 * The very same book when nothing changes: already seen, or not a species of
 * the catalog.
 */
export function seeSpecies(book: AnimalBook, speciesId: string): AnimalBook {
	if (!SPECIES.has(speciesId) || book.seen.includes(speciesId)) return book;
	return { seen: [...book.seen, speciesId], caught: book.caught };
}

/**
 * `book` with `speciesId` caught, and so seen. The very same book when
 * nothing changes: already caught, or not a species of the catalog.
 */
export function catchSpecies(book: AnimalBook, speciesId: string): AnimalBook {
	if (!SPECIES.has(speciesId) || book.caught.includes(speciesId)) return book;
	const seen = seeSpecies(book, speciesId).seen;
	return { seen, caught: [...book.caught, speciesId] };
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
 * A book from two lists as a save holds them: each species once, in the
 * order listed, the caught ones seen too, and nothing the catalog lacks.
 */
export function bookOf(seen: readonly string[], caught: readonly string[]): AnimalBook {
	let book: AnimalBook = EMPTY_BOOK;
	for (const id of seen) book = seeSpecies(book, id);
	for (const id of caught) book = catchSpecies(book, id);
	return book;
}
