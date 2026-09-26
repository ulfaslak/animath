import { bundles, canFightIn, leadIndex, type AnimalInstance, type Realm } from '@mathgame/engine';

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
 * Why "Go first" is greyed, said under the options so a kid knows: the
 * animal can't go first where the player stands (out on the water it can't
 * swim, `cantSwim`; on land it lives in the sea, `inTheSea`), it is tired, or
 * it goes first already. The first that holds, in the order the engine
 * refuses in, so the panel says what the number key's line says.
 */
export type NotFirst = 'cantSwim' | 'inTheSea' | 'tired' | 'already';

/** Why the animal in slot `index` can't go first where the player stands in `realm`; null if it can. */
export function whyNotFirst(
	party: readonly AnimalInstance[],
	index: number,
	realm: Realm = 'land'
): NotFirst | null {
	const animal = party[index];
	if (!animal) return null;
	if (!canFightIn(animal.speciesId, realm)) return realm === 'water' ? 'cantSwim' : 'inTheSea';
	if (animal.hp <= 0) return 'tired';
	return leadIndex(party, realm) === index ? 'already' : null;
}

/** Why the card of `speciesId` can't go first where the player stands in `realm`; null if it can. */
export function whyCardNotFirst(
	party: readonly AnimalInstance[],
	speciesId: string,
	realm: Realm = 'land'
): NotFirst | null {
	const bundle = bundles(party).find((b) => b.speciesId === speciesId);
	if (!bundle) return null;
	if (!canFightIn(speciesId, realm)) return realm === 'water' ? 'cantSwim' : 'inTheSea';
	if (!bundle.animals.some((a) => a.hp > 0)) return 'tired';
	return party[leadIndex(party, realm)]?.speciesId === speciesId ? 'already' : null;
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
