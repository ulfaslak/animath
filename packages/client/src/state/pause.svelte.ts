import {
	bundles,
	leadRefusal,
	parseWorldNumber,
	speciesLeadRefusal,
	type AnimalInstance,
	type LeadRefusal,
	type Realm
} from '@mathgame/engine';
import { flags } from '../flags';
import { account } from './account.svelte';

/**
 * What the pause menu shows and which screen the keys drive. Written only by
 * `PauseController`, except `draft`, which the name box binds as the player
 * types. The team itself is `game.party`, which only authority events change.
 *
 * `screen`: `list` walks the team's cards (one per species, in battle order)
 * and then the menu items; `bundle` is what can be done with a card of
 * several animals, and its animals; `options` is what can be done with the
 * picked animal; `naming` is the name box; `worlds` is the Worlds screen:
 * the world the player is in and their home, a number pad for a world's
 * number, Go, Go home and Back; `players` is who else is in this world,
 * each one a "Go to" (`presence.roster`); `book` is the animal book, a page
 * per land (`book.land`) with a card for every species of the land in the
 * book's order (`bookOrder`), the lit one `option`; `puzzles` is "My
 * puzzles", a row per topic (`statRows`), the lit one `option`.
 */
export type PauseScreen =
	'list' | 'bundle' | 'options' | 'naming' | 'worlds' | 'players' | 'book' | 'puzzles';

/**
 * The rows under the team, in order: Worlds, Who's here, the settings, the
 * account's rows (as `menuItems` shows them), then "Keep playing" and Quit
 * to title, which are drawn side by side; and last "My puzzles" and the
 * animal book, which are drawn side by side at the top, on the menu's title
 * line, so up from the first card reaches the book and down from the last
 * row comes round to "My puzzles". A new row is a
 * new id here, before Keep playing, its label in `PauseMenu.svelte`, and its
 * case in `PauseController.chooseItem` — the cursor, keys and layout already
 * count every row shown. A setting's row also takes left and right
 * (`PauseController.settingKey`); the paired rows take them to step between
 * each other. `worlds` opens the Worlds screen, with the world the player is
 * in beside it; `players` opens the list of the other players in this world
 * on the right, where picking one goes to them; `language` switches every
 * word on screen to the next language at once and remembers it on this
 * device; `sound` turns the sound off and on (`sfx`); the account's rows
 * open the account card or log out (`PauseHooks`); `quit` (Start screen)
 * saves the game as it stands and goes back to the title, where Continue
 * picks it up; `puzzles` opens "My puzzles" in the menu's place, and `book`
 * the animal book.
 */
export const MENU_ITEMS = [
	'worlds',
	'players',
	'language',
	'sound',
	'makeAccount',
	'logIn',
	'logOut',
	'resume',
	'quit',
	'puzzles',
	'book'
] as const;
export type MenuItem = (typeof MENU_ITEMS)[number];

/**
 * The rows the menu shows now. The account rows ([[UI_SPEC]] § Accounts)
 * follow who is playing: a guest has "Make an account" and "Log in"; a
 * player logged in has "Log out", and "Log in" again once the server has
 * said the session is over. "Make an account" and "Log in" show only while
 * the server says it can keep an account (`account.ready`); "Log out" works
 * without it. A throwaway game (`?new` and the like) has none: it saves
 * nothing, so it has no game to keep safe.
 */
export function menuItems(): MenuItem[] {
	return MENU_ITEMS.filter((item) => {
		if (item !== 'makeAccount' && item !== 'logIn' && item !== 'logOut') return true;
		if (flags.throwaway) return false;
		if (item === 'logOut') return account.name !== null;
		if (!account.ready) return false;
		return account.name === null || (item === 'logIn' && account.session === 'ended');
	});
}

/**
 * Rows drawn side by side on one line, so the menu keeps its height (eight
 * cards fit 1024×768): Worlds beside Who's here, Language beside Sound, the
 * account's rows beside each other (those `menuItems` shows), Keep playing
 * beside Start screen, and on the title line "My puzzles" beside the book.
 * Each line is neighbours in `MENU_ITEMS`. Up and down walk them in order as
 * any rows; left and right step between them, except
 * on a setting, where they change it.
 */
export const MENU_LINES: readonly (readonly MenuItem[])[] = [
	['worlds', 'players'],
	['language', 'sound'],
	['makeAccount', 'logIn', 'logOut'],
	['resume', 'quit'],
	['puzzles', 'book']
];

/** The rows drawn on the line `item` is on, of those the menu shows (`items`). */
export function lineOf(item: MenuItem, items: readonly MenuItem[] = menuItems()): MenuItem[] {
	const line = MENU_LINES.find((l) => l.includes(item));
	return line ? line.filter((i) => items.includes(i)) : [item];
}

class PauseView {
	/** True from Escape in explore until the menu is closed. Walking waits meanwhile. */
	open = $state(false);
	screen = $state<PauseScreen>('list');
	/** Highlighted row of the list: the team's cards in order, then `menuItems()`. */
	cursor = $state(0);
	/**
	 * The card of several animals open on the right (`bundle`), by species;
	 * it stays set while one of its animals is picked, so Back returns to it.
	 */
	species = $state<string | null>(null);
	/** The animal the options and the name box are for, by id, so it stays picked as it moves. */
	picked = $state<string | null>(null);
	/**
	 * Highlighted row on the right: an option, or on a card's screen an option
	 * or an animal; on the Worlds screen a row; in the animal book the lit
	 * card, by its place on the open page (`bookOrder(book.land)`); in "My
	 * puzzles" the lit row.
	 */
	option = $state(0);
	/** The name typed so far. */
	draft = $state('');
	/** The world's number typed on the Worlds screen so far: up to `WORLD_DIGITS` digits. */
	worldDraft = $state('');

	reset(): void {
		this.open = false;
		this.screen = 'list';
		this.cursor = 0;
		this.species = null;
		this.picked = null;
		this.option = 0;
		this.draft = '';
		this.worldDraft = '';
	}
}

export const pause = new PauseView();

export type PartyOption = 'first' | 'up' | 'down' | 'name' | 'back';
export type BundleOption = 'first' | 'up' | 'down' | 'back';

export interface OptionRow<T extends string> {
	id: T;
	/** An option that can't be done now is shown greyed and skipped by the cursor. */
	enabled: boolean;
}

/**
 * Why "Go first" is greyed, said under the options so a kid knows: the
 * animal can't go first where the player stands (out on the water it can't
 * swim, `cantSwim`; on land it lives in the sea, `inTheSea`), it is tired, or
 * it goes first already. The engine's own refusal (`leadRefusal`,
 * `speciesLeadRefusal`), so the panel says what the number key's line says.
 */
export type NotFirst = 'cantSwim' | 'inTheSea' | 'tired' | 'already';

/** Why the animal in slot `index` can't go first where the player stands in `realm`; null if it can. */
export function whyNotFirst(
	party: readonly AnimalInstance[],
	index: number,
	realm: Realm = 'land'
): NotFirst | null {
	const animal = party[index];
	return animal ? notFirst(leadRefusal(party, animal.id, realm), realm) : null;
}

/** Why the card of `speciesId` can't go first where the player stands in `realm`; null if it can. */
export function whyCardNotFirst(
	party: readonly AnimalInstance[],
	speciesId: string,
	realm: Realm = 'land'
): NotFirst | null {
	return notFirst(speciesLeadRefusal(party, speciesId, realm), realm);
}

/** The engine's refusal, said as the panel says it. */
function notFirst(refusal: LeadRefusal | null, realm: Realm): NotFirst | null {
	switch (refusal) {
		case 'cannot-fight-here':
			return realm === 'water' ? 'cantSwim' : 'inTheSea';
		case 'tired':
			return 'tired';
		case 'already-lead':
			return 'already';
		case null:
			return null;
	}
}

/**
 * What can be done with the animal in slot `index`, where the player stands
 * in `realm`. "Go first" is the engine's `select-lead`, so it is offered only
 * where that would be accepted (`whyNotFirst`): the animal can fight there
 * (out on the water, it swims), is not tired and does not lead there
 * already. Moving is
 * within its card when the card holds others of its kind (the engine's
 * `reorder`), and the card itself when the animal is alone on it
 * (`move-species`), so it is greyed at the end it can't go past.
 */
export function partyOptions(
	party: readonly AnimalInstance[],
	index: number,
	realm: Realm = 'land'
): OptionRow<PartyOption>[] {
	const animal = party[index];
	const list = bundles(party);
	const place = list.findIndex((b) => b.speciesId === animal?.speciesId);
	const bundle = list[place];
	const alone = bundle?.animals.length === 1;
	const at = bundle ? bundle.slots.indexOf(index) : -1;
	return [
		{ id: 'first', enabled: !!animal && whyNotFirst(party, index, realm) === null },
		{ id: 'up', enabled: alone ? place > 0 : at > 0 },
		{
			id: 'down',
			enabled: alone ? place < list.length - 1 : !!bundle && at >= 0 && at < bundle.slots.length - 1
		},
		{ id: 'name', enabled: true },
		{ id: 'back', enabled: true }
	];
}

/** A row of a card's screen: one of the card's options, or one of its animals. */
export type CardRow =
	| ({ kind: 'option' } & OptionRow<BundleOption>)
	| { kind: 'animal'; animal: AnimalInstance; enabled: true };

/**
 * The rows of the card of `speciesId` on the right of the menu, in order: its
 * options (`bundleOptions`), then its animals in party order, each of which
 * opens its own options. One cursor walks them all, and a tap on row `i` is
 * `option:<i>`.
 */
export function cardRows(
	party: readonly AnimalInstance[],
	speciesId: string,
	realm: Realm = 'land'
): CardRow[] {
	const bundle = bundles(party).find((b) => b.speciesId === speciesId);
	return [
		...bundleOptions(party, speciesId, realm).map((o) => ({ kind: 'option' as const, ...o })),
		...(bundle?.animals ?? []).map((animal) => ({
			kind: 'animal' as const,
			animal,
			enabled: true as const
		}))
	];
}

/**
 * What can be done with the card of `speciesId`, where the player stands in
 * `realm`: go first (the engine's `lead-species`, offered while the species
 * can fight there, one of its animals stands and none of them leads there
 * already: `whyCardNotFirst`), move up or down among the cards
 * (`move-species`), back.
 */
export function bundleOptions(
	party: readonly AnimalInstance[],
	speciesId: string,
	realm: Realm = 'land'
): OptionRow<BundleOption>[] {
	const list = bundles(party);
	const place = list.findIndex((b) => b.speciesId === speciesId);
	const bundle = list[place];
	return [
		{ id: 'first', enabled: !!bundle && whyCardNotFirst(party, speciesId, realm) === null },
		{ id: 'up', enabled: place > 0 },
		{ id: 'down', enabled: place >= 0 && place < list.length - 1 },
		{ id: 'back', enabled: true }
	];
}

/** The most digits a world's number has (9999). */
export const WORLD_DIGITS = 4;

export type WorldOption = 'go' | 'home' | 'back';

/**
 * Why Go is greyed on the Worlds screen, said under it: nothing typed yet
 * (`type`), a number that is no world (`notAWorld`: 0), or the world the
 * player is in (`here`).
 */
export type NoGo = 'type' | 'notAWorld' | 'here';

/** Why the Worlds screen's Go can't go to what is typed; null when it can. */
export function whyNoGo(draft: string, world: number): NoGo | null {
	if (draft === '') return 'type';
	const to = parseWorldNumber(draft);
	if (to === null) return 'notAWorld';
	return to === world ? 'here' : null;
}

/**
 * The Worlds screen's rows, in order: Go (to the world typed, while it is
 * one and not the world the player is in: `whyNoGo`), Go home (while the
 * player is away from home), Back. The number pad is not a row: its keys are
 * keys, a digit, Backspace and Enter.
 */
export function worldRows(draft: string, world: number, home: number): OptionRow<WorldOption>[] {
	return [
		{ id: 'go', enabled: whyNoGo(draft, world) === null },
		{ id: 'home', enabled: world !== home },
		{ id: 'back', enabled: true }
	];
}
