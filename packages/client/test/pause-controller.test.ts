import type { GameEvent, Intent } from '@mathgame/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalAuthority } from '../src/authority/local';
import { language } from '../src/copy';
import { parseParty } from '../src/flags';
import { PauseController } from '../src/pause/controller';
import { game } from '../src/state/game.svelte';
import { MENU_ITEMS, pause } from '../src/state/pause.svelte';

/**
 * The pause menu's keys against the real authority: what each key does on
 * each screen, what it must never do (auto-repeat scrolling the list, a held
 * Enter saving the name box, letters typed into the name box moving the
 * cursor or being swallowed), and that the menu only ever shows the party the
 * authority's events describe. The name box itself is DOM; here the typed text
 * is set on `pause.draft` as the bound input would.
 */
interface Key extends KeyboardEvent {
	prevented: boolean;
}

function key(
	name: string,
	options: { repeat?: boolean; isComposing?: boolean; keyCode?: number } = {}
): Key {
	const event = {
		key: name,
		repeat: options.repeat ?? false,
		isComposing: options.isComposing ?? false,
		keyCode: options.keyCode ?? 0,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		prevented: false,
		preventDefault() {
			event.prevented = true;
		}
	};
	return event as unknown as Key;
}

function setup(startingParty = 'squirrel,rabbit,fox') {
	const authority = new LocalAuthority({ party: parseParty(startingParty)! });
	const controller = new PauseController(authority);
	const events: GameEvent[] = [];
	const sent: Intent[] = [];
	const dispatch = authority.dispatch.bind(authority);
	authority.dispatch = (intent) => {
		sent.push(intent);
		dispatch(intent);
	};
	authority.subscribe((e) => {
		events.push(e);
		game.apply(e);
		controller.handle(e);
	});
	authority.start();
	/** Press keys in order; the last key event, to look at. */
	const press = (...names: string[]) => {
		let last = key('');
		for (const n of names) controller.onKey((last = key(n)));
		return last;
	};
	const species = () => game.party.map((a) => a.speciesId);
	return { authority, controller, events, sent, press, species };
}

beforeEach(() => {
	pause.reset();
});

afterEach(() => {
	language.set('en');
});

describe('pause menu', () => {
	it('opens on Escape, closes on Escape or "Keep playing", and ignores a held Escape', () => {
		const { controller, press } = setup();
		expect(press('ArrowDown').prevented).toBe(false); // closed: explore's key, not the menu's
		expect(pause.open).toBe(false);
		expect(press('Escape').prevented).toBe(true);
		expect(pause.open).toBe(true);
		controller.onKey(key('Escape', { repeat: true }));
		expect(pause.open).toBe(true);
		press('Escape');
		expect(pause.open).toBe(false);
		controller.onKey(key('Escape', { repeat: true }));
		expect(pause.open).toBe(false);

		// Down past the team lands on the menu items; Enter on "Keep playing" closes.
		press('Escape', 'ArrowUp');
		expect(pause.cursor).toBe(game.party.length + MENU_ITEMS.length - 1);
		press('Enter');
		expect(pause.open).toBe(false);
	});

	it('walks the list with arrows and W / S, wrapping, and never on auto-repeat', () => {
		const { controller, press } = setup();
		press('Escape');
		const rows = game.party.length + MENU_ITEMS.length;
		press('s', 's', 'ArrowDown');
		expect(pause.cursor).toBe(3);
		press(...Array<string>(rows - 3).fill('ArrowDown'));
		expect(pause.cursor).toBe(0);
		press('w');
		expect(pause.cursor).toBe(rows - 1);
		controller.onKey(key('ArrowUp', { repeat: true }));
		expect(pause.cursor).toBe(rows - 1);
		// With Caps Lock on, W and S come in capitals and steer the same.
		press('S');
		expect(pause.cursor).toBe(0);
		press('W');
		expect(pause.cursor).toBe(rows - 1);
	});

	it('the Language row switches every word at once: Enter, or left and right on the row', () => {
		const { press } = setup();
		language.set('en');
		const row = game.party.length + MENU_ITEMS.indexOf('language');
		press('Escape', ...Array<string>(row).fill('s'));
		expect(pause.cursor).toBe(row);
		press('Enter');
		expect(language.current).toBe('da');
		expect(pause.open).toBe(true); // the menu stays, now in Danish
		press('Enter');
		expect(language.current).toBe('en');
		press('ArrowRight', 'd');
		expect(language.current).toBe('en'); // two languages: right twice is back where it began
		expect(press('ArrowLeft').prevented).toBe(true);
		expect(language.current).toBe('da');
		press('a');
		expect(language.current).toBe('en');
		// Left and right mean nothing on a team row: they are not the menu's.
		press('w');
		expect(press('ArrowRight').prevented).toBe(false);
		expect(language.current).toBe('en');
	});

	it('"Go first" sends select-lead and comes back to the list on the animal, now first', () => {
		const { press, sent, species } = setup();
		const fox = game.party[2]!;
		press('Escape', 's', 's', 'Enter');
		expect(pause.screen).toBe('options');
		expect(pause.option).toBe(0); // "Go first", the first option that can be done
		press('Enter');
		expect(sent.at(-1)).toEqual({
			type: 'party',
			intent: { type: 'select-lead', animalId: fox.id }
		});
		expect(species()).toEqual(['fox', 'squirrel', 'rabbit']);
		expect(pause.screen).toBe('list');
		expect(pause.cursor).toBe(0);
	});

	it('moves an animal up one step at a time, and a mashed Enter stops at the top', () => {
		const { press, species } = setup();
		// Up past every menu item to the fox.
		press('Escape', ...Array<string>(MENU_ITEMS.length + 1).fill('ArrowUp'), 'Enter');
		press('s'); // from "Go first" down to "Move up"
		expect(pause.option).toBe(1);
		press('Enter');
		expect(species()).toEqual(['squirrel', 'fox', 'rabbit']);
		press('Enter', 'Enter', 'Enter');
		expect(species()).toEqual(['fox', 'squirrel', 'rabbit']);
		expect(pause.screen).toBe('options'); // still the fox's options, cursor on a greyed "Move up"
		press('Escape');
		expect(pause.cursor).toBe(0);
	});

	it('skips options that cannot be done, and "Go first" on a tired animal is one of them', () => {
		const { press, sent } = setup('squirrel,rabbit:0');
		press('Escape', 's', 'Enter'); // the tired rabbit
		// "Go first" (tired) and "Move down" (last) are greyed: the cursor starts on "Move up".
		expect(pause.option).toBe(1);
		press('s');
		expect(pause.option).toBe(3); // "New name", past the greyed "Move down"
		press('w', 'w');
		expect(pause.option).toBe(4); // wraps past the greyed "Go first" to "Back"
		const before = sent.length;
		press('Enter');
		expect(pause.screen).toBe('list');
		expect(sent.length).toBe(before);
	});

	it('the name box takes letters, W A S D and Space as typing, saves on Enter and cancels on Escape', () => {
		const { controller, press, sent } = setup();
		const squirrel = game.party[0]!;
		// The squirrel leads, so its options start on "Move down"; one more is "New name".
		press('Escape', 'Enter');
		expect(pause.option).toBe(2);
		press('s', 'Enter');
		expect(pause.screen).toBe('naming');
		expect(pause.draft).toBe('');
		const before = sent.length;
		for (const k of ['w', 'a', 's', 'd', ' ', 'ArrowUp', 'ArrowLeft', 'Backspace', 'P']) {
			const e = key(k);
			controller.onKey(e);
			expect(e.prevented).toBe(false); // the name box gets it
		}
		expect(pause.screen).toBe('naming');
		expect(sent.length).toBe(before);

		// An input method's Enter finishes a character, not the name.
		pause.draft = '  Pip😀 ';
		controller.onKey(key('Enter', { isComposing: true }));
		expect(pause.screen).toBe('naming');
		// Safari's committing Enter: no longer composing, but keyCode 229.
		controller.onKey(key('Enter', { keyCode: 229 }));
		expect(pause.screen).toBe('naming');
		// A held Enter does not save.
		controller.onKey(key('Enter', { repeat: true }));
		expect(pause.screen).toBe('naming');

		press('Enter');
		expect(sent.at(-1)).toEqual({
			type: 'party',
			intent: { type: 'rename', animalId: squirrel.id, nickname: '  Pip😀 ' }
		});
		expect(game.party[0]!.nickname).toBe('Pip');
		expect(pause.screen).toBe('list');
		expect(pause.cursor).toBe(0);

		// Escape leaves the box without a word sent; an empty name clears the nickname.
		press('Enter', 's', 'Enter');
		expect(pause.draft).toBe('Pip');
		pause.draft = 'Rex';
		press('Escape');
		expect(pause.screen).toBe('options');
		expect(game.party[0]!.nickname).toBe('Pip');
		press('Enter');
		pause.draft = '   ';
		press('Enter');
		expect(game.party[0]!.nickname).toBeUndefined();
	});

	it('closes when a battle takes the screen', () => {
		const { controller, press } = setup();
		press('Escape');
		controller.handle({ type: 'battle-started' } as GameEvent);
		expect(pause.open).toBe(false);
	});
});
