import { bundles, leadIndex, type AnimalInstance } from '@mathgame/engine';

/**
 * What the pause menu shows and which screen the keys drive. Written only by
 * `PauseController`, except `draft`, which the name box binds as the player
 * types. The team itself is `game.party`, which only authority events change.
 *
 * `screen`: `list` walks the team's cards (one per species, in battle order)
 * and then the menu items; `bundle` is what can be done with a card of
 * several animals, and its animals; `options` is what can be done with the
 * picked animal; `naming` is the name box.
 */
export type PauseScreen = 'list' | 'bundle' | 'options' | 'naming';

/**
 * The rows under the team, in order: the settings, then "Keep playing" and
 * Quit to title. A new one is a new id here, its label in
 * `PauseMenu.svelte`, and its case in `PauseController.chooseItem` — the
 * cursor, keys and layout already count every row listed. A setting's row
 * also takes left and right (`PauseController.settingKey`). `language`
 * switches every word on screen to the next language at once and remembers
 * it on this device; `sound` turns the sound off and on (`sfx`); `quit`
 * (Start screen) saves the game as it stands and goes back to the title,
 * where Continue picks it up.
 */
export const MENU_ITEMS = ['language', 'sound', 'resume', 'quit'] as const;
export type MenuItem = (typeof MENU_ITEMS)[number];

class PauseView {
	/** True from Escape in explore until the menu is closed. Walking waits meanwhile. */
	open = $state(false);
	screen = $state<PauseScreen>('list');
	/** Highlighted row of the list: the team's cards in order, then `MENU_ITEMS`. */
	cursor = $state(0);
	/**
	 * The card of several animals open on the right (`bundle`), by species;
	 * it stays set while one of its animals is picked, so Back returns to it.
	 */
	species = $state<string | null>(null);
	/** The animal the options and the name box are for, by id, so it stays picked as it moves. */
	picked = $state<string | null>(null);
	/** Highlighted row on the right: an option, or on a card's screen an option or an animal. */
	option = $state(0);
	/** The name typed so far. */
	draft = $state('');

	reset(): void {
		this.open = false;
		this.screen = 'list';
		this.cursor = 0;
		this.species = null;
		this.picked = null;
		this.option = 0;
		this.draft = '';
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
 * What can be done with the animal in slot `index`. "Go first" is the
 * engine's `select-lead`, so it is offered only where that would be
 * accepted: the animal is not tired and does not lead already. Moving is
 * within its card when the card holds others of its kind (the engine's
 * `reorder`), and the card itself when the animal is alone on it
 * (`move-species`), so it is greyed at the end it can't go past.
 */
export function partyOptions(
	party: readonly AnimalInstance[],
	index: number
): OptionRow<PartyOption>[] {
	const animal = party[index];
	const list = bundles(party);
	const place = list.findIndex((b) => b.speciesId === animal?.speciesId);
	const bundle = list[place];
	const alone = bundle?.animals.length === 1;
	const at = bundle ? bundle.slots.indexOf(index) : -1;
	return [
		{ id: 'first', enabled: !!animal && animal.hp > 0 && leadIndex(party) !== index },
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
export function cardRows(party: readonly AnimalInstance[], speciesId: string): CardRow[] {
	const bundle = bundles(party).find((b) => b.speciesId === speciesId);
	return [
		...bundleOptions(party, speciesId).map((o) => ({ kind: 'option' as const, ...o })),
		...(bundle?.animals ?? []).map((animal) => ({
			kind: 'animal' as const,
			animal,
			enabled: true as const
		}))
	];
}

/**
 * What can be done with the card of `speciesId`: go first (the engine's
 * `lead-species`, offered while one of its animals stands and none of them
 * leads already), move up or down among the cards (`move-species`), back.
 */
export function bundleOptions(
	party: readonly AnimalInstance[],
	speciesId: string
): OptionRow<BundleOption>[] {
	const list = bundles(party);
	const place = list.findIndex((b) => b.speciesId === speciesId);
	const bundle = list[place];
	const lead = party[leadIndex(party)];
	return [
		{
			id: 'first',
			enabled: !!bundle && bundle.animals.some((a) => a.hp > 0) && lead?.speciesId !== speciesId
		},
		{ id: 'up', enabled: place > 0 },
		{ id: 'down', enabled: place >= 0 && place < list.length - 1 },
		{ id: 'back', enabled: true }
	];
}
