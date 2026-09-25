import { leadIndex, type AnimalInstance } from '@mathgame/engine';

/**
 * What the pause menu shows and which screen the keys drive. Written only by
 * `PauseController`, except `draft`, which the name box binds as the player
 * types. The team itself is `game.party`, which only authority events change.
 *
 * `screen`: `list` walks the team and then the menu items; `options` is what
 * can be done with the picked animal; `naming` is the name box.
 */
export type PauseScreen = 'list' | 'options' | 'naming';

/**
 * The rows under the team, in order. A new one (Settings, Quit to title) is a
 * new id here, its label in `PauseMenu.svelte`, and its case in
 * `PauseController.chooseItem` — the cursor, keys and layout already count
 * every row listed.
 */
export const MENU_ITEMS = ['resume'] as const;
export type MenuItem = (typeof MENU_ITEMS)[number];

class PauseView {
	/** True from Escape in explore until the menu is closed. Walking waits meanwhile. */
	open = $state(false);
	screen = $state<PauseScreen>('list');
	/** Highlighted row of the list: the party in order, then `MENU_ITEMS`. */
	cursor = $state(0);
	/** The animal the options and the name box are for, by id, so it stays picked as it moves. */
	picked = $state<string | null>(null);
	/** Highlighted row of the options. */
	option = $state(0);
	/** The name typed so far. */
	draft = $state('');

	reset(): void {
		this.open = false;
		this.screen = 'list';
		this.cursor = 0;
		this.picked = null;
		this.option = 0;
		this.draft = '';
	}
}

export const pause = new PauseView();

export type PartyOption = 'first' | 'up' | 'down' | 'name' | 'back';

export interface PartyOptionRow {
	id: PartyOption;
	/** An option that can't be done now is shown greyed and skipped by the cursor. */
	enabled: boolean;
}

/**
 * What can be done with the animal in slot `index`. "Go first" is the engine's
 * `select-lead`, so it is offered only where that would be accepted: the
 * animal is not tired and does not lead already.
 */
export function partyOptions(party: readonly AnimalInstance[], index: number): PartyOptionRow[] {
	const animal = party[index];
	return [
		{ id: 'first', enabled: !!animal && animal.hp > 0 && leadIndex(party) !== index },
		{ id: 'up', enabled: index > 0 },
		{ id: 'down', enabled: index < party.length - 1 },
		{ id: 'name', enabled: true },
		{ id: 'back', enabled: true }
	];
}
