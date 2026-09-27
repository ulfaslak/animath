import {
	applyPartyIntent,
	bundled,
	bundles,
	type GameEvent,
	type Intent,
	type PartyIntent,
	type Realm
} from '@mathgame/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CueName } from '../src/audio/cues';
import { sfx } from '../src/audio/sfx.svelte';
import { LocalAuthority } from '../src/authority/local';
import { language } from '../src/copy';
import { parseParty } from '../src/flags';
import { languageKey, optionKey, rowKey } from '../src/input/press';
import { PauseController } from '../src/pause/controller';
import { game } from '../src/state/game.svelte';
import {
	MENU_ITEMS,
	MENU_PAIRS,
	bundleOptions,
	partyOptions,
	pause,
	whyCardNotFirst,
	whyNoGo,
	whyNotFirst,
	type NotFirst
} from '../src/state/pause.svelte';

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
	options: { repeat?: boolean; isComposing?: boolean; keyCode?: number; altKey?: boolean } = {}
): Key {
	const event = {
		key: name,
		repeat: options.repeat ?? false,
		isComposing: options.isComposing ?? false,
		keyCode: options.keyCode ?? 0,
		ctrlKey: false,
		metaKey: false,
		altKey: options.altKey ?? false,
		prevented: false,
		preventDefault() {
			event.prevented = true;
		}
	};
	return event as unknown as Key;
}

/**
 * The real authority and the menu on it. `travel`, when given, is handed the
 * trips the Worlds screen asks for (as the travel transition is); without it,
 * the menu sends `travel` itself.
 */
function setup(startingParty = 'squirrel,rabbit,fox', travel?: (world: number) => void) {
	const authority = new LocalAuthority({ party: parseParty(startingParty)! });
	const controller = new PauseController(authority, { travel });
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
	/** The cards' species, top to bottom. */
	const cards = () => bundles(game.party).map((b) => b.speciesId);
	/** Presses of ArrowDown that take the cursor from the top to a menu row. */
	const downTo = (item: (typeof MENU_ITEMS)[number]) =>
		Array<string>(bundles(game.party).length + MENU_ITEMS.indexOf(item)).fill('ArrowDown');
	return { authority, controller, events, sent, press, species, cards, downTo };
}

beforeEach(() => {
	pause.reset();
});

afterEach(() => {
	// The settings are the page's; leave them as every test found them.
	language.set('en');
	sfx.set(true);
});

describe('pause menu', () => {
	it('opens on Escape, closes on Escape or "Keep playing", and ignores a held Escape', () => {
		const { controller, press, sent, downTo } = setup();
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

		// Up from the top wraps to the last menu row; down past the team and the
		// settings lands on "Keep playing", and Enter there closes.
		press('Escape', 'ArrowUp');
		expect(pause.cursor).toBe(game.party.length + MENU_ITEMS.length - 1);
		press('Escape', 'Escape', ...downTo('resume')); // closed, opened again at the top
		expect(pause.cursor).toBe(game.party.length + MENU_ITEMS.indexOf('resume'));
		press('Enter');
		expect(pause.open).toBe(false);
		expect(sent).not.toContainEqual({ type: 'leave-game' });
	});

	it('walks the list with arrows and W / S, wrapping, and never on auto-repeat', () => {
		const { controller, press } = setup();
		const last = game.party.length + MENU_ITEMS.length - 1;
		press('Escape');
		press('s', 's', 'ArrowDown');
		expect(pause.cursor).toBe(3);
		press(...Array<string>(last - 3).fill('ArrowDown'));
		expect(pause.cursor).toBe(last);
		press('ArrowDown');
		expect(pause.cursor).toBe(0);
		press('w');
		expect(pause.cursor).toBe(last);
		controller.onKey(key('ArrowUp', { repeat: true }));
		expect(pause.cursor).toBe(last);
		// With Caps Lock on, W and S come in capitals and steer the same.
		press('S');
		expect(pause.cursor).toBe(0);
		press('W');
		expect(pause.cursor).toBe(last);
	});

	it('"Start screen" closes the menu and leaves the game for the title', () => {
		const { press, sent, events } = setup();
		press('Escape', ...Array<string>(game.party.length + MENU_ITEMS.indexOf('quit')).fill('s'));
		expect(MENU_ITEMS[pause.cursor - game.party.length]).toBe('quit');
		const sound = sfx.on;
		press('Enter');
		expect(pause.open).toBe(false);
		// Only that: no setting changes on the way out.
		expect(sfx.on).toBe(sound);
		expect(sent.at(-1)).toEqual({ type: 'leave-game' });
		expect(events.at(-1)).toEqual({ type: 'game-left' });
		// No game under way: the pause menu's keys do nothing to it.
		const count = sent.length;
		press('Escape');
		expect(sent.length).toBe(count);
	});

	it('the Sound row: Enter flips it, left turns it off and right on, and the menu stays open', () => {
		const { press, sent, downTo } = setup();
		const cues: CueName[] = [];
		const stop = sfx.onCue((cue) => cues.push(cue));
		press('Escape', ...downTo('sound'));
		expect(sfx.on).toBe(true);
		press('Enter');
		expect(sfx.on).toBe(false);
		expect(pause.open).toBe(true);
		press('ArrowRight');
		expect(sfx.on).toBe(true);
		press('ArrowRight'); // already on: stays on
		expect(sfx.on).toBe(true);
		press('a');
		expect(sfx.on).toBe(false);
		press(' ');
		expect(sfx.on).toBe(true);
		// Turned on, it says so in sound; turned off, only the switch says so.
		expect(cues.slice(-4)).toEqual(['move', 'move', 'confirm', 'confirm']);
		expect(pause.screen).toBe('list');
		expect(sent).toEqual([]);
		stop();
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
		press(...Array<string>(MENU_ITEMS.indexOf('language') + 1).fill('w'));
		expect(pause.cursor).toBe(game.party.length - 1);
		expect(press('ArrowRight').prevented).toBe(false);
		expect(language.current).toBe('en');
	});

	it("rows side by side (Worlds and Who's here, Keep playing and Start screen): left and right step between them", () => {
		const at = (item: (typeof MENU_ITEMS)[number]) =>
			bundles(game.party).length + MENU_ITEMS.indexOf(item);
		for (const [left, right] of MENU_PAIRS) {
			pause.reset();
			const { press, downTo, sent } = setup();
			// Each pair is two neighbours: down walks from one to the other as any rows.
			expect(MENU_ITEMS.indexOf(right)).toBe(MENU_ITEMS.indexOf(left) + 1);
			press('Escape', ...downTo(left));
			expect(press('ArrowRight').prevented).toBe(true);
			expect(pause.cursor).toBe(at(right));
			press('d');
			expect(pause.cursor).toBe(at(right));
			press('ArrowLeft');
			expect(pause.cursor).toBe(at(left));
			press('a');
			expect([pause.open, pause.screen, pause.cursor, sent]).toEqual([true, 'list', at(left), []]);
		}
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
		// Alt+Enter and Alt+Escape are the browser's, like every shortcut.
		for (const name of ['Enter', 'Escape']) {
			const alt = key(name, { altKey: true });
			controller.onKey(alt);
			expect(alt.prevented).toBe(false);
			expect(pause.screen).toBe('naming');
		}

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

/**
 * A click or a tap reaches the menu as a key press (`input/press.ts`): a row
 * on the left is its row key and an option its option key, each done at once,
 * a language on the Language row its language key, and the name box's Save
 * and Back are Enter and Escape.
 */
describe('why "Go first" is greyed', () => {
	/** The engine's refusal of a lead, as the panel names it. */
	function refusal(party: ReturnType<typeof bundled>, intent: PartyIntent, realm: Realm) {
		const [event] = applyPartyIntent(party, intent, 'explore', realm).events;
		if (event?.type !== 'rejected') return null;
		const reasons: Record<string, NotFirst> = {
			'cannot-fight-here': realm === 'water' ? 'cantSwim' : 'inTheSea',
			tired: 'tired',
			'already-lead': 'already'
		};
		return reasons[event.reason] ?? event.reason;
	}

	it('every greyed Go first has a reason, the one the engine refuses with, for an animal and a card', () => {
		const teams = [
			'squirrel,rabbit:0,crab,otter:0,whale*2,frog',
			'otter,squirrel*3,crab:0,frog:0*2',
			'rabbit:0,starfish,turtle:0,fox',
			'squirrel'
		];
		for (const team of teams) {
			const party = bundled(parseParty(team)!);
			for (const realm of ['land', 'water'] as const) {
				party.forEach((animal, i) => {
					const why = whyNotFirst(party, i, realm);
					const at = `${team} ${realm} #${i}`;
					expect(partyOptions(party, i, realm)[0]!.enabled, at).toBe(why === null);
					const intent = { type: 'select-lead', animalId: animal.id } as const;
					expect(why, at).toBe(refusal(party, intent, realm));
				});
				for (const { speciesId } of bundles(party)) {
					const why = whyCardNotFirst(party, speciesId, realm);
					const at = `${team} ${realm} ${speciesId}`;
					expect(bundleOptions(party, speciesId, realm)[0]!.enabled, at).toBe(why === null);
					expect(why, at).toBe(refusal(party, { type: 'lead-species', speciesId }, realm));
				}
			}
		}
	});

	it('says the sea first: a tired squirrel out on the water can’t swim, a tired crab on land lives in the sea', () => {
		const party = bundled(parseParty('otter,squirrel:0,crab:0')!);
		const index = (id: string) => party.findIndex((a) => a.speciesId === id);
		expect(whyNotFirst(party, index('squirrel'), 'water')).toBe('cantSwim');
		expect(whyNotFirst(party, index('squirrel'), 'land')).toBe('tired');
		expect(whyNotFirst(party, index('crab'), 'land')).toBe('inTheSea');
		expect(whyNotFirst(party, index('crab'), 'water')).toBe('tired');
		expect(whyNotFirst(party, index('otter'), 'water')).toBe('already');
	});
});

describe('pause menu with cards of several animals', () => {
	it("opens a card's screen: its options, then its animals, the cursor skipping what can't be done", () => {
		const { press, cards } = setup('squirrel,rabbit*3,fox');
		expect(cards()).toEqual(['squirrel', 'rabbit', 'fox']);
		press('Escape', 's', 'Enter');
		expect([pause.screen, pause.species, pause.picked]).toEqual(['bundle', 'rabbit', null]);
		// Go first (no rabbit leads), Move up, Move down, Back, then three rabbits.
		expect(pause.option).toBe(0);
		press('w');
		expect(pause.option).toBe(6); // wraps round to the last rabbit
		press('s', 's', 's', 's', 's');
		expect(pause.option).toBe(4); // past the four options, on the first rabbit
		press('Escape');
		expect([pause.screen, pause.cursor]).toEqual(['list', 1]);
	});

	it("the card's Go first leads with its first rabbit standing; its moves move the whole card", () => {
		const { press, sent, cards } = setup('squirrel,rabbit:0,rabbit*2,fox');
		press('Escape', 's', 'Enter', 's'); // the rabbits' Move up
		press('Enter');
		expect(sent.at(-1)).toEqual({
			type: 'party',
			intent: { type: 'move-species', speciesId: 'rabbit', to: 0 }
		});
		expect(cards()).toEqual(['rabbit', 'squirrel', 'fox']);
		// At the top Move up is greyed: a mashed Enter stops there.
		press('Enter', 'Enter');
		expect(cards()).toEqual(['rabbit', 'squirrel', 'fox']);
		press('s', 'Enter', 'Enter');
		expect(cards()).toEqual(['squirrel', 'fox', 'rabbit']);
		expect(pause.screen).toBe('bundle');
		// Go first: its first rabbit standing leads, and the menu goes back to the list, on the top card.
		press('w', 'w', 'Enter'); // from the greyed Move down, up past Move up to Go first
		expect(sent.at(-1)).toEqual({
			type: 'party',
			intent: { type: 'lead-species', speciesId: 'rabbit' }
		});
		expect(cards()).toEqual(['rabbit', 'squirrel', 'fox']);
		expect(game.party[0]!.hp).toBeGreaterThan(0);
		expect([pause.screen, pause.cursor]).toEqual(['list', 0]);
	});

	it('an animal of a card goes first, moves within its card, and comes back to the card', () => {
		const { press, sent, species } = setup('squirrel,rabbit*3');
		const rabbits = game.party.filter((a) => a.speciesId === 'rabbit').map((a) => a.id);
		// Go first, Move up, (Move down: greyed, the last card), Back, then the second rabbit.
		press('Escape', 's', 'Enter', ...Array<string>(4).fill('s'), 'Enter');
		expect([pause.screen, pause.species, pause.picked]).toEqual(['options', 'rabbit', rabbits[1]]);
		press('s', 'Enter'); // Move up, within the card
		expect(sent.at(-1)).toEqual({
			type: 'party',
			intent: { type: 'reorder', animalId: rabbits[1], to: 1 }
		});
		expect(game.party.map((a) => a.id)).toEqual([
			game.party[0]!.id,
			rabbits[1],
			rabbits[0],
			rabbits[2]
		]);
		// At the top of its card Move up is greyed, though the squirrel's card is above it.
		press('Enter');
		expect(species()).toEqual(['squirrel', 'rabbit', 'rabbit', 'rabbit']);
		expect(game.party[1]!.id).toBe(rabbits[1]);
		// Back: the card's screen, the cursor on this rabbit, now its first.
		press('Escape');
		expect([pause.screen, pause.species, pause.option]).toEqual(['bundle', 'rabbit', 4]);
		// A new name, saved: back on the card's screen, on the rabbit.
		press('Enter', 's', 's', 'Enter'); // Go first, (Move up: greyed), Move down, New name
		expect(pause.screen).toBe('naming');
		pause.draft = 'Hop';
		press('Enter');
		expect(game.party[1]!.nickname).toBe('Hop');
		expect([pause.screen, pause.species, pause.option]).toEqual(['bundle', 'rabbit', 4]);
		// Go first: the rabbits' card to the top, Hop at its front, and back to the list.
		press('Enter', 'Enter');
		expect(game.party[0]!.id).toBe(rabbits[1]);
		expect([pause.screen, pause.cursor]).toEqual(['list', 0]);
	});

	it('a card of tired animals greys its Go first', () => {
		const { press, sent } = setup('squirrel,rabbit:0*2');
		press('Escape', 's', 'Enter');
		expect(pause.option).toBe(1); // Go first is greyed: Move up
		press(optionKey(0));
		expect(sent).toEqual([]);
	});

	it('a tap on an animal of the open card opens its options; the left still does its rows (#45)', () => {
		const teams = [
			'squirrel*2',
			'squirrel,rabbit*3',
			'squirrel*2,rabbit:0*2,fox,frog*3,otter,bear*2'
		];
		const bad: string[] = [];
		for (const team of teams) {
			pause.reset();
			const probe = setup(team);
			const list = bundles(game.party);
			probe.controller.close();
			for (const [place, card] of list.entries()) {
				if (card.animals.length < 2) continue;
				for (let row = 0; row < list.length + MENU_ITEMS.length; row++) {
					// With the card's screen open, and with one of its animals picked.
					for (const deep of [false, true]) {
						pause.reset();
						language.set('en');
						sfx.set(true);
						const { press, sent } = setup(team);
						press('Escape', rowKey(place));
						if (deep) press(optionKey(4));
						press(rowKey(row));
						const item = MENU_ITEMS[row - list.length];
						const closes = item === 'resume' || item === 'quit';
						const target = list[row];
						const opened = !target
							? [item === 'worlds' || item === 'players' ? item : 'list', null, null, row]
							: target.animals.length > 1
								? ['bundle', target.speciesId, null, row]
								: ['options', null, target.animals[0]!.id, row];
						const got = {
							at: pause.open ? [pause.screen, pause.species, pause.picked, pause.cursor] : 'closed',
							language: language.current,
							sound: sfx.on,
							sent
						};
						const want = {
							at: closes ? 'closed' : opened,
							language: item === 'language' ? 'da' : 'en',
							sound: item !== 'sound',
							sent: item === 'quit' ? [{ type: 'leave-game' }] : []
						};
						if (JSON.stringify(got) !== JSON.stringify(want)) {
							bad.push(
								`${team}, card ${place}${deep ? ' animal' : ''}, row ${row}: ${JSON.stringify(got)}`
							);
						}
					}
				}
			}
		}
		expect(bad).toEqual([]);
		// And a tap on an animal of the card opens its options.
		pause.reset();
		const { press } = setup('squirrel,rabbit*3');
		const third = game.party[3]!.id;
		press('Escape', rowKey(1), optionKey(6));
		expect([pause.screen, pause.species, pause.picked]).toEqual(['options', 'rabbit', third]);
	});
});

describe('pause menu under a pointer', () => {
	it('a tap on an animal opens its options; a tap on an option does it, and a greyed one nothing', () => {
		const { press, sent, species } = setup();
		press('Escape', rowKey(2));
		expect(pause.screen).toBe('options');
		expect(pause.picked).toBe(game.party[2]!.id);
		// The fox is at the bottom: Move down is greyed, and its tap sends nothing.
		press(optionKey(2));
		expect(sent).toEqual([]);
		expect(pause.screen).toBe('options');
		press(optionKey(1));
		expect(species()).toEqual(['squirrel', 'fox', 'rabbit']);
		expect(pause.option).toBe(1);
		// New name, typed, then Save (Enter).
		press(optionKey(3));
		expect(pause.screen).toBe('naming');
		pause.draft = 'Pip';
		press('Enter');
		expect(game.party[1]!.nickname).toBe('Pip');
		expect(pause.screen).toBe('list');
		// A tap on the last row, "Keep playing", closes the menu.
		press(rowKey(game.party.length + MENU_ITEMS.indexOf('resume')));
		expect(pause.open).toBe(false);
	});

	it('a tap on a language switches to it; on the one already on, nothing changes', () => {
		const { press } = setup();
		const row = game.party.length + MENU_ITEMS.indexOf('language');
		press('Escape', languageKey('en'));
		expect(language.current).toBe('en');
		expect(pause.cursor).toBe(row);
		press(languageKey('da'), languageKey('da'));
		expect(language.current).toBe('da');
		// A tap on the row's name, not on a language, is Enter on the row: the next one.
		press(rowKey(row));
		expect(language.current).toBe('en');
		expect(pause.open).toBe(true);
	});

	it('a tap on a row past the last does nothing', () => {
		const { press, sent } = setup();
		press('Escape', rowKey(game.party.length + MENU_ITEMS.length));
		expect(pause.screen).toBe('list');
		expect(pause.open).toBe(true);
		expect(sent).toEqual([]);
	});

	it('with any animal’s options open, a tap on the left does that row as on the list, never an option (#45)', () => {
		// Every row on the left with every animal's options open, in teams of one to six.
		// The team's rows and the options share their numbers (the first team row was Go
		// first), and so do the settings with one animal ("Start screen" was Back).
		const teams = [
			'squirrel',
			'squirrel,rabbit',
			'squirrel,rabbit,fox',
			'squirrel,rabbit:0,fox,frog,otter,bear'
		];
		const bad: string[] = [];
		for (const team of teams) {
			const size = team.split(',').length;
			for (let picked = 0; picked < size; picked++) {
				for (let row = 0; row < size + MENU_ITEMS.length; row++) {
					pause.reset();
					language.set('en');
					sfx.set(true);
					const { press, sent } = setup(team);
					const ids = game.party.map((a) => a.id);
					press('Escape', rowKey(picked));
					press(rowKey(row));
					const item = MENU_ITEMS[row - size];
					const closes = item === 'resume' || item === 'quit';
					const got = {
						at: pause.open ? [pause.screen, pause.picked, pause.cursor] : 'closed',
						language: language.current,
						sound: sfx.on,
						sent
					};
					const want = {
						// An animal opens its own options; a setting is done on the list, the cursor on it;
						// Worlds opens its screen, and Who's here the list of players on the right.
						at: closes
							? 'closed'
							: row < size
								? ['options', ids[row], row]
								: [item === 'worlds' || item === 'players' ? item : 'list', null, row],
						language: item === 'language' ? 'da' : 'en',
						sound: item !== 'sound',
						sent: item === 'quit' ? [{ type: 'leave-game' }] : []
					};
					if (JSON.stringify(got) !== JSON.stringify(want)) {
						bad.push(`${team}, options of ${picked}, tap on row ${row}: ${JSON.stringify(got)}`);
					}
				}
			}
		}
		expect(bad).toEqual([]);
	});

	it('beside the options a language is that language; beside the name box, the left does nothing', () => {
		const { press, sent } = setup();
		const rows = game.party.length + MENU_ITEMS.length;
		press('Escape', rowKey(2), languageKey('da'));
		expect(language.current).toBe('da');
		expect([pause.screen, pause.picked, pause.cursor]).toEqual([
			'list',
			null,
			game.party.length + MENU_ITEMS.indexOf('language')
		]);
		// The fox's name box: a tap on the team or a setting is neither typing nor a row.
		press(rowKey(2), optionKey(3));
		expect(pause.screen).toBe('naming');
		pause.draft = 'Pip';
		for (let row = 0; row < rows; row++) press(rowKey(row));
		press(languageKey('en'), optionKey(0));
		expect([pause.open, pause.screen, pause.draft, language.current, sfx.on]).toEqual([
			true,
			'naming',
			'Pip',
			'da',
			true
		]);
		expect(sent).toEqual([]);
	});
});

describe('the Worlds screen', () => {
	it('opens from its row with nothing typed; digits type a number of up to four, Backspace takes one back', () => {
		const { press, downTo } = setup();
		press('Escape', ...downTo('worlds'), 'Enter');
		expect([pause.screen, pause.worldDraft]).toEqual(['worlds', '']);
		// At home with nothing typed, Go and Go home are greyed: the cursor starts on Back.
		expect(pause.option).toBe(2);
		press('4', '2');
		expect([pause.worldDraft, pause.option]).toEqual(['42', 0]);
		press('1', '2', '3');
		expect(pause.worldDraft).toBe('4212');
		press('Backspace');
		expect(pause.worldDraft).toBe('421');
		press('Backspace', 'Backspace', 'Backspace', 'Backspace');
		expect([pause.screen, pause.worldDraft]).toEqual(['worlds', '']);
	});

	it('Go hands the world typed to the trip and closes the menu; the pad’s Go is the Go row', () => {
		const trips: number[] = [];
		const { press, downTo, sent } = setup(undefined, (world) => trips.push(world));
		press('Escape', ...downTo('worlds'), 'Enter', '4', '2', 'Enter');
		expect([trips, pause.open, sent]).toEqual([[42], false, []]);
		press('Escape', ...downTo('worlds'), 'Enter', '9', '9', '9', '9', optionKey(0));
		expect([trips, pause.open]).toEqual([[42, 9999], false]);
	});

	it('without a trip to hand it to, the menu sends travel itself, and the kid is there', () => {
		const { press, downTo, sent } = setup();
		press('Escape', ...downTo('worlds'), 'Enter', '7', 'Enter');
		expect(sent).toEqual([{ type: 'travel', world: 7 }]);
		expect([game.world, pause.open]).toEqual([7, false]);
	});

	it('Go waits, greyed, for a world to go to: nothing typed, 0, or the world the kid is in', () => {
		const trips: number[] = [];
		const { press, downTo } = setup(undefined, (world) => trips.push(world));
		press('Escape', ...downTo('worlds'), 'Enter', optionKey(0));
		expect(whyNoGo(pause.worldDraft, game.world)).toBe('type');
		press('0', 'Enter', optionKey(0), ' ');
		expect(whyNoGo(pause.worldDraft, game.world)).toBe('notAWorld');
		press('Backspace', '1', 'Enter', optionKey(0));
		expect(whyNoGo(pause.worldDraft, game.world)).toBe('here');
		// The cursor stays on the greyed Go: an Enter after a number never does another row.
		expect([trips, pause.open, pause.screen, pause.option]).toEqual([[], true, 'worlds', 0]);
		// A leading 0 is no harm: 07 is World 7.
		press('Backspace', '0', '7');
		expect(whyNoGo(pause.worldDraft, game.world)).toBeNull();
		press('Enter');
		expect(trips).toEqual([7]);
	});

	it('Go home takes the kid home from another world, and is greyed at home', () => {
		const { press, downTo } = setup();
		press('Escape', ...downTo('worlds'), 'Enter', optionKey(1));
		expect([pause.screen, game.world]).toEqual(['worlds', 1]);
		press('3', '0', 'Enter');
		expect(game.world).toBe(30);
		// Away from home with nothing typed, the cursor starts on Go home.
		press('Escape', ...downTo('worlds'), 'Enter');
		expect(pause.option).toBe(1);
		press('Enter');
		expect([game.world, pause.open]).toEqual([1, false]);
	});

	it('a fifth digit, or Backspace with nothing typed, does nothing: not even to the cursor', () => {
		const { press, downTo } = setup();
		press('Escape', ...downTo('worlds'), 'Enter', '1', '2', '3', '4', 'ArrowDown');
		expect([pause.worldDraft, pause.option]).toEqual(['1234', 2]);
		press('5');
		expect([pause.worldDraft, pause.option]).toEqual(['1234', 2]);
		// The Enter after it does the row the cursor is on: Back, not a trip to World 1234.
		press('Enter');
		expect([pause.screen, game.world]).toEqual(['list', 1]);
		// Away from home, the cursor starts on Go home, and a Backspace leaves it there.
		press('Enter', '3', '0', 'Enter');
		expect(game.world).toBe(30);
		press('Escape', ...downTo('worlds'), 'Enter', 'Backspace');
		expect([pause.worldDraft, pause.option]).toEqual(['', 1]);
		press('Enter');
		expect(game.world).toBe(1);
	});

	it('arrows walk the rows that can be done, wrapping', () => {
		const { press, downTo } = setup();
		press('Escape', ...downTo('worlds'), 'Enter', '5');
		expect(pause.option).toBe(0);
		// At home: Go home is greyed and skipped.
		press('ArrowDown');
		expect(pause.option).toBe(2);
		press('s');
		expect(pause.option).toBe(0);
		press('ArrowUp');
		expect(pause.option).toBe(2);
		press('w');
		expect(pause.option).toBe(0);
	});

	it('Escape and Back go back to the list, on the Worlds row, and the number is forgotten', () => {
		const { press, downTo } = setup();
		const row = bundles(game.party).length + MENU_ITEMS.indexOf('worlds');
		press('Escape', ...downTo('worlds'), 'Enter', '4', 'Escape');
		expect([pause.open, pause.screen, pause.cursor, pause.worldDraft]).toEqual([
			true,
			'list',
			row,
			''
		]);
		press('Enter', '8', optionKey(2));
		expect([pause.screen, pause.cursor, pause.worldDraft]).toEqual(['list', row, '']);
		press('Enter');
		expect([pause.screen, pause.worldDraft]).toEqual(['worlds', '']);
	});

	it("the kid's trip closes the menu, whoever asked for it; another player's leaves it open", () => {
		const { authority, controller, press, downTo } = setup();
		press('Escape', ...downTo('worlds'), 'Enter', '4');
		controller.handle({
			type: 'travelled',
			playerId: 'someone-else',
			world: 9,
			seed: 1,
			pos: { x: 0, y: 0 },
			facing: 'down',
			edits: [],
			firstVisit: true
		});
		expect([pause.open, pause.screen, pause.worldDraft]).toEqual([true, 'worlds', '4']);
		authority.dispatch({ type: 'travel', world: 12 });
		expect([pause.open, game.world]).toEqual([false, 12]);
	});
});
