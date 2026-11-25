import {
	BADGE_FAMILIES,
	BADGE_IDS,
	bookOrder,
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
import { flags, parseParty } from '../src/flags';
import { landKey, languageKey, optionKey, rowKey } from '../src/input/press';
import { PauseController, type PauseHooks } from '../src/pause/controller';
import { PICK_QUIET_SECONDS } from '../src/input/pick-guard';
import { account } from '../src/state/account.svelte';
import { book, bookLands } from '../src/state/book.svelte';
import { game } from '../src/state/game.svelte';
import {
	MENU_ITEMS,
	type MenuItem,
	MENU_LINES,
	lineOf,
	settingsRows,
	type Setting,
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

/** The menu's rows that open a screen of their own: Worlds, Who's here, "My puzzles", the book, "My badges", Settings. */
const opens = (item: MenuItem | undefined) =>
	item === 'worlds' ||
	item === 'players' ||
	item === 'puzzles' ||
	item === 'book' ||
	item === 'badges' ||
	item === 'settings';

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
function setup(
	startingParty = 'squirrel,rabbit,fox',
	travel?: (world: number) => void,
	hooks: PauseHooks = {}
) {
	const authority = new LocalAuthority({ party: parseParty(startingParty)! });
	const controller = new PauseController(authority, { travel, ...hooks });
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
	const downTo = (item: MenuItem) =>
		Array<string>(bundles(game.party).length + MENU_ITEMS.indexOf(item)).fill('ArrowDown');
	/**
	 * Presses that open the menu and Settings (up from the first card reaches its row, the
	 * last), then take the cursor down to a row of the Settings screen.
	 */
	const toSetting = (row: Setting) => [
		'Escape',
		'ArrowUp',
		'Enter',
		...Array<string>(settingsRows().indexOf(row)).fill('ArrowDown')
	];
	return { authority, controller, events, sent, press, species, cards, downTo, toSetting };
}

beforeEach(() => {
	pause.reset();
	// A server that can keep an account, unless a test says otherwise.
	account.ready = true;
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
		// tiles lands on "Keep playing", and Enter there closes.
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
		const { press, sent, events, downTo } = setup();
		press('Escape', ...downTo('quit'));
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

	it("Settings is the last row, drawn at the top: it opens in the menu's place on Language, and Escape or Back come back to it", () => {
		const { press, sent } = setup();
		const row = game.party.length + MENU_ITEMS.indexOf('settings');
		expect(MENU_ITEMS.at(-1)).toBe('settings');
		press('Escape', 'ArrowUp');
		expect(pause.cursor).toBe(row);
		// Right means nothing on it, the end of its line; left steps to "My badges" beside it.
		press('ArrowRight');
		expect(pause.cursor).toBe(row);
		press('ArrowLeft');
		expect(pause.cursor).toBe(row - 1);
		press('ArrowRight', 'Enter');
		expect([pause.screen, settingsRows()[pause.option]]).toEqual(['settings', 'language']);
		// Its rows wrap: up from Language is Back (drawn on the title line), and down from Back
		// is Language again.
		press('ArrowUp');
		expect(settingsRows()[pause.option]).toBe('back');
		press('ArrowDown');
		expect(settingsRows()[pause.option]).toBe('language');
		press('Escape');
		expect([pause.open, pause.screen, pause.cursor]).toEqual([true, 'list', row]);
		// Back, with the keys or a tap, does the same; a tap on the Settings row opens it.
		press('Enter', 'w', 'Enter');
		expect([pause.open, pause.screen, pause.cursor]).toEqual([true, 'list', row]);
		press(rowKey(0), 'Escape', rowKey(row));
		expect(pause.screen).toBe('settings');
		press(rowKey(settingsRows().indexOf('back')));
		expect([pause.open, pause.screen, pause.cursor, sent]).toEqual([true, 'list', row, []]);
		press('Escape');
		expect(pause.open).toBe(false);
	});

	it('the Sound row: Enter flips it, left turns it off and right on, and the menu stays open', () => {
		const { press, sent, toSetting } = setup();
		const cues: CueName[] = [];
		const stop = sfx.onCue((cue) => cues.push(cue));
		press(...toSetting('sound'));
		expect(sfx.on).toBe(true);
		cues.length = 0;
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
		expect(cues).toEqual(['confirm', 'confirm']);
		expect([pause.screen, settingsRows()[pause.option]]).toEqual(['settings', 'sound']);
		expect(sent).toEqual([]);
		stop();
	});

	it('the Language row switches every word at once: Enter, or left and right on the row', () => {
		const { press, toSetting } = setup();
		language.set('en');
		press(...toSetting('language'));
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
		expect([pause.screen, settingsRows()[pause.option]]).toEqual(['settings', 'language']);
		// Left and right mean nothing on the other rows: an account's, Back.
		for (const row of ['newName', 'makeAccount', 'logIn', 'back'] as const) {
			press('Escape', 'Escape', ...toSetting(row));
			expect(settingsRows()[pause.option]).toBe(row);
			expect(press('ArrowRight').prevented).toBe(false);
			expect(press('a').prevented).toBe(false);
			expect([pause.screen, settingsRows()[pause.option], language.current, sfx.on]).toEqual([
				'settings',
				row,
				'en',
				true
			]);
		}
	});

	it('on the Settings screen a tap does the row, and a tap on a language is that language', () => {
		const opened: string[] = [];
		const { press, sent } = setup('squirrel,rabbit,fox', undefined, {
			newName: () => opened.push('newName'),
			makeAccount: () => opened.push('makeAccount'),
			logIn: () => opened.push('logIn')
		});
		const at = (row: Setting) => settingsRows().indexOf(row);
		press('Escape', 'ArrowUp', 'Enter', languageKey('en'));
		expect([language.current, pause.option]).toEqual(['en', at('language')]);
		press(languageKey('da'), languageKey('da'));
		expect(language.current).toBe('da');
		// A tap on the row's name, not on a language, is Enter on the row: the next one.
		press(rowKey(at('language')));
		expect(language.current).toBe('en');
		press(rowKey(at('sound')));
		expect([sfx.on, pause.option]).toEqual([false, at('sound')]);
		// The account's rows open the account card over the menu, which stays as it is.
		press(rowKey(at('newName')), rowKey(at('makeAccount')), rowKey(at('logIn')));
		expect(opened).toEqual(['newName', 'makeAccount', 'logIn']);
		expect([pause.open, pause.screen, pause.option]).toEqual([true, 'settings', at('logIn')]);
		// A row past the last does nothing.
		press(rowKey(settingsRows().length));
		expect([pause.open, pause.screen, pause.option, sent]).toEqual([
			true,
			'settings',
			at('logIn'),
			[]
		]);
	});

	it('offers an account only while the server can keep one; Log out stays either way', () => {
		const accountRows = () =>
			settingsRows().filter((i) => i === 'makeAccount' || i === 'logIn' || i === 'logOut');
		try {
			expect(accountRows()).toEqual(['makeAccount', 'logIn']);
			account.ready = false;
			expect(accountRows()).toEqual([]);
			// A guest's new name needs no server: it is the game's alone.
			expect(settingsRows()).toEqual(['language', 'sound', 'newName', 'back']);
			account.name = 'Ida';
			account.session = 'ended';
			expect(accountRows()).toEqual(['logOut']);
			account.ready = true;
			expect(accountRows()).toEqual(['logIn', 'logOut']);
		} finally {
			account.name = null;
			account.session = 'unknown';
		}
	});

	it('offers an account a new name and a new password while logged in and the server can keep them, home or not', () => {
		const accountRows = () =>
			settingsRows().filter(
				(i) =>
					i === 'newName' ||
					i === 'makeAccount' ||
					i === 'logIn' ||
					i === 'newPassword' ||
					i === 'logOut'
			);
		try {
			account.name = 'Ida';
			account.session = 'live';
			expect(accountRows()).toEqual(['newName', 'newPassword', 'logOut']);
			account.home = true;
			expect(accountRows()).toEqual(['newName', 'newPassword', 'logOut']);
			account.ready = false;
			expect(accountRows()).toEqual(['logOut']);
			account.ready = true;
			account.session = 'unknown';
			expect(accountRows()).toEqual(['logOut']);
			account.session = 'ended';
			expect(accountRows()).toEqual(['logIn', 'logOut']);
			// A guest has no account to change, only the game's own name.
			account.name = null;
			account.session = 'unknown';
			expect(accountRows()).toEqual(['newName', 'makeAccount', 'logIn']);
			// A throwaway game keeps nothing, not even a name: Language, Sound and Back are left.
			flags.throwaway = true;
			expect(accountRows()).toEqual([]);
			expect(settingsRows()).toEqual(['language', 'sound', 'back']);
		} finally {
			flags.throwaway = false;
			account.name = null;
			account.session = 'unknown';
			account.home = false;
		}
	});

	it("rows side by side (Worlds and Who's here, Keep playing and Start screen, My puzzles, the book, My badges and Settings): left and right step between them", () => {
		const at = (item: MenuItem) => bundles(game.party).length + MENU_ITEMS.indexOf(item);
		expect(MENU_LINES.map((line) => lineOf(line[0]!))).toEqual([
			['worlds', 'players'],
			['resume', 'quit'],
			['puzzles', 'book', 'badges', 'settings']
		]);
		// Every row is on a line: none stands alone under the team.
		expect([...MENU_LINES.flat()].sort()).toEqual([...MENU_ITEMS].sort());
		for (const line of MENU_LINES) {
			pause.reset();
			const { press, downTo, sent } = setup();
			// A line is neighbours: down walks from one to the next as any rows.
			for (let i = 1; i < line.length; i++)
				expect(MENU_ITEMS.indexOf(line[i]!)).toBe(MENU_ITEMS.indexOf(line[0]!) + i);
			press('Escape', ...downTo(line[0]!));
			// Right (or D) steps along to the line's end, and stays there.
			for (let i = 1; i < line.length; i++) {
				expect(press(i % 2 ? 'ArrowRight' : 'd').prevented).toBe(true);
				expect(pause.cursor).toBe(at(line[i]!));
			}
			press('d');
			press('ArrowRight');
			expect(pause.cursor).toBe(at(line.at(-1)!));
			// Left (or A) steps back to its start, and stays there.
			for (let i = line.length - 2; i >= 0; i--) {
				press(i % 2 ? 'a' : 'ArrowLeft');
				expect(pause.cursor).toBe(at(line[i]!));
			}
			press('a');
			expect([pause.open, pause.screen, pause.cursor, sent]).toEqual([
				true,
				'list',
				at(line[0]!),
				[]
			]);
		}
	});

	it('"Make active" sends select-lead and comes back to the list on the animal, now first', () => {
		const { press, sent, species } = setup();
		const fox = game.party[2]!;
		press('Escape', 's', 's', 'Enter');
		expect(pause.screen).toBe('options');
		expect(pause.option).toBe(0); // "Make active", the first option that can be done
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
		press('s'); // from "Make active" down to "Move up"
		expect(pause.option).toBe(1);
		press('Enter');
		expect(species()).toEqual(['squirrel', 'fox', 'rabbit']);
		press('Enter', 'Enter', 'Enter');
		expect(species()).toEqual(['fox', 'squirrel', 'rabbit']);
		expect(pause.screen).toBe('options'); // still the fox's options, cursor on a greyed "Move up"
		press('Escape');
		expect(pause.cursor).toBe(0);
	});

	it('skips options that cannot be done, and "Make active" on a tired animal is one of them', () => {
		const { press, sent } = setup('squirrel,rabbit:0');
		press('Escape', 's', 'Enter'); // the tired rabbit
		// "Make active" (tired) and "Move down" (last) are greyed: the cursor starts on "Move up".
		expect(pause.option).toBe(1);
		press('s');
		expect(pause.option).toBe(3); // "New name", past the greyed "Move down"
		press('w', 'w');
		expect(pause.option).toBe(4); // wraps past the greyed "Make active" to "Back"
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
describe('why "Make active" is greyed', () => {
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

	it('every greyed Make active has a reason, the one the engine refuses with, for an animal and a card', () => {
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
		// Make active (no rabbit leads), Move up, Move down, Back, then three rabbits.
		expect(pause.option).toBe(0);
		press('w');
		expect(pause.option).toBe(6); // wraps round to the last rabbit
		press('s', 's', 's', 's', 's');
		expect(pause.option).toBe(4); // past the four options, on the first rabbit
		press('Escape');
		expect([pause.screen, pause.cursor]).toEqual(['list', 1]);
	});

	it("the card's Make active leads with its first rabbit standing; its moves move the whole card", () => {
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
		// Make active: its first rabbit standing leads, and the menu goes back to the list, on the top card.
		press('w', 'w', 'Enter'); // from the greyed Move down, up past Move up to Make active
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
		// Make active, Move up, (Move down: greyed, the last card), Back, then the second rabbit.
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
		press('Enter', 's', 's', 'Enter'); // Make active, (Move up: greyed), Move down, New name
		expect(pause.screen).toBe('naming');
		pause.draft = 'Hop';
		press('Enter');
		expect(game.party[1]!.nickname).toBe('Hop');
		expect([pause.screen, pause.species, pause.option]).toEqual(['bundle', 'rabbit', 4]);
		// Make active: the rabbits' card to the top, Hop at its front, and back to the list.
		press('Enter', 'Enter');
		expect(game.party[0]!.id).toBe(rabbits[1]);
		expect([pause.screen, pause.cursor]).toEqual(['list', 0]);
	});

	it('a card of tired animals greys its Make active', () => {
		const { press, sent } = setup('squirrel,rabbit:0*2');
		press('Escape', 's', 'Enter');
		expect(pause.option).toBe(1); // Make active is greyed: Move up
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
							? [opens(item) ? item : 'list', null, null, row]
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
							// No row of the list changes a setting: those are on the Settings screen.
							language: 'en',
							sound: true,
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
		// first), and so do the menu's rows with one animal ("Start screen" was Back).
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
						// An animal opens its own options; Worlds, My puzzles, the animal book, My
						// badges and Settings open their screens, and Who's here the list of players on
						// the right.
						at: closes
							? 'closed'
							: row < size
								? ['options', ids[row], row]
								: [opens(item) ? item : 'list', null, row],
						language: 'en',
						sound: true,
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

	it('beside the options no language is on screen to tap; beside the name box, the left does nothing', () => {
		const { press, sent } = setup();
		const rows = game.party.length + MENU_ITEMS.length;
		press('Escape', rowKey(2), languageKey('da'));
		expect(language.current).toBe('en');
		expect([pause.screen, pause.picked]).toEqual(['options', game.party[2]!.id]);
		// The fox's name box: a tap on the team or a row is neither typing nor a row.
		press(optionKey(3));
		expect(pause.screen).toBe('naming');
		pause.draft = 'Pip';
		for (let row = 0; row < rows; row++) press(rowKey(row));
		press(languageKey('da'), optionKey(0));
		expect([pause.open, pause.screen, pause.draft, language.current, sfx.on]).toEqual([
			true,
			'naming',
			'Pip',
			'en',
			true
		]);
		expect(sent).toEqual([]);
	});
});

describe('the animal book', () => {
	afterEach(() => {
		book.columns = 6;
		book.hops = 0;
		book.hopping = null;
	});

	it('is a row drawn at the top: up from the first card and left from Settings twice reach it, Enter opens it on its first card, Escape comes back to it', () => {
		const { press } = setup();
		const row = bundles(game.party).length + MENU_ITEMS.indexOf('book');
		press('Escape', 'ArrowUp', 'ArrowLeft', 'ArrowLeft');
		expect(pause.cursor).toBe(row);
		// Right steps to "My badges" beside it; left to "My puzzles" on its other side.
		press('ArrowRight');
		expect(pause.cursor).toBe(row + 1);
		press('ArrowLeft', 'ArrowLeft');
		expect(pause.cursor).toBe(row - 1);
		press('ArrowRight', 'Enter');
		expect([pause.screen, pause.option]).toEqual(['book', 0]);
		press('ArrowRight', 'ArrowRight');
		expect(pause.option).toBe(2);
		press('Escape');
		expect([pause.open, pause.screen, pause.cursor]).toEqual([true, 'list', row]);
		// Opened again, it starts on its first card; a tap on its row opens it too.
		press(rowKey(0), 'Escape', rowKey(row));
		expect([pause.screen, pause.option]).toEqual(['book', 0]);
		press('Escape', 'Escape');
		expect(pause.open).toBe(false);
	});

	it('walks the cards as the grid lays them out: one by one, a row up or down, never past an edge', () => {
		const count = bookOrder('nordland').length;
		const bad: string[] = [];
		for (const columns of [1, 5, 6, 7, count, count + 3]) {
			pause.reset();
			const { press } = setup();
			book.columns = columns;
			press('Escape', 'ArrowUp', 'ArrowLeft', 'ArrowLeft', 'Enter');
			const rows = Math.ceil(count / columns);
			for (let from = 0; from < count; from++) {
				for (const [key, want] of [
					['ArrowLeft', Math.max(0, from - 1)],
					['a', Math.max(0, from - 1)],
					['ArrowRight', Math.min(count - 1, from + 1)],
					['d', Math.min(count - 1, from + 1)],
					['ArrowUp', from >= columns ? from - columns : from],
					['w', from >= columns ? from - columns : from],
					// Down a row; above a short last row, onto its last card; on the last row, nowhere.
					[
						'ArrowDown',
						from + columns < count
							? from + columns
							: Math.floor(from / columns) < rows - 1
								? count - 1
								: from
					]
				] as const) {
					pause.option = from;
					const pressed = press(key);
					if (pause.option !== want || !pressed.prevented) {
						bad.push(`${columns} a row, ${key} from ${from}: ${pause.option}, not ${want}`);
					}
				}
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('a tap lights a card; Enter, Space or a tap on the lit card makes a met animal hop, and a "?" does nothing', () => {
		const cues: CueName[] = [];
		const stop = sfx.onCue((cue) => cues.push(cue));
		try {
			const { press } = setup('squirrel,fox');
			press('Escape', 'ArrowUp', 'ArrowLeft', 'ArrowLeft', 'Enter');
			const fox = bookOrder('nordland').findIndex((a) => a.id === 'fox');
			const bear = bookOrder('nordland').findIndex((a) => a.id === 'bear');
			cues.length = 0;
			press(optionKey(fox));
			expect([pause.option, book.hops, cues]).toEqual([fox, 0, ['move']]);
			press(optionKey(fox));
			expect([book.hopping, book.hops]).toEqual(['fox', 1]);
			press('Enter', ' ');
			expect(book.hops).toBe(3);
			// A card never seen has no animal to hop: silence, and nothing moves.
			press(optionKey(bear), optionKey(bear), 'Enter');
			expect([pause.option, book.hops, book.hopping]).toEqual([bear, 3, 'fox']);
			expect(cues).toEqual(['move', 'confirm', 'confirm', 'confirm', 'move']);
			// A tap past the last card lights nothing.
			press(optionKey(bookOrder('nordland').length));
			expect(pause.option).toBe(bear);
		} finally {
			stop();
		}
	});

	it('has a page for a land only once the kid can fly there, or is in it', () => {
		expect(bookLands('nordland', ['nordland'])).toEqual(['nordland']);
		expect(bookLands('nordland', ['nordland', 'arctic'])).toEqual(['nordland', 'arctic']);
		// Put in The Arctic some other way (a hand-made save): its page, and Nordland's.
		expect(bookLands('arctic', ['nordland'])).toEqual(['nordland', 'arctic']);
	});

	it("opens on the page of the land the kid is in; up from the top row lights the lands' tabs, where left and right open the land beside (#191)", () => {
		const cues: CueName[] = [];
		const stop = sfx.onCue((cue) => cues.push(cue));
		try {
			const { press } = setup();
			// In Nordland, with The Arctic not built, there is one page and no tab: up stays put.
			press('Escape', 'ArrowUp', 'ArrowLeft', 'ArrowLeft', 'Enter');
			expect([book.land, book.tabs]).toEqual(['nordland', false]);
			cues.length = 0;
			press('ArrowUp');
			expect([book.tabs, cues]).toEqual([false, []]);
			press('Escape');
			// Flown to The Arctic: its page opens, and Nordland's is a tab away.
			game.land = 'arctic';
			press('Enter');
			expect([pause.screen, book.land, book.tabs, pause.option]).toEqual([
				'book',
				'arctic',
				false,
				0
			]);
			press('ArrowRight', 'ArrowRight', 'ArrowUp');
			expect([book.tabs, pause.option]).toEqual([true, 2]);
			// Right from the last land stays; left opens Nordland's page, on its first card.
			press('ArrowRight');
			expect(book.land).toBe('arctic');
			press('ArrowLeft');
			expect([book.land, book.tabs, pause.option]).toEqual(['nordland', true, 0]);
			press('ArrowDown');
			expect([book.tabs, pause.option]).toEqual([false, 0]);
			// A tap on a tab opens its page; Enter goes down to its first card.
			press(landKey('arctic'));
			expect([book.land, book.tabs]).toEqual(['arctic', true]);
			press('Enter');
			expect([book.land, book.tabs, pause.option]).toEqual(['arctic', false, 0]);
			// The cards are the land's own: Enter on the first one hops an Arctic fox, if met.
			expect(bookOrder('arctic')[0]!.id).toBe('arctic-fox');
		} finally {
			stop();
			game.land = 'nordland';
		}
	});

	it('goes with the menu when something else takes the screen, and opens again on the list', () => {
		const { authority, press } = setup();
		press('Escape', 'ArrowUp', 'ArrowLeft', 'ArrowLeft', 'Enter', 'ArrowRight');
		expect([pause.screen, pause.option]).toEqual(['book', 1]);
		authority.dispatch({ type: 'leave-game' });
		expect([pause.open, pause.screen, pause.option]).toEqual([false, 'list', 0]);
	});
});

describe('My badges', () => {
	afterEach(() => {
		pause.badgeColumns = 1;
	});

	/** Presses that open the menu and "My badges": up from the first card to Settings, then left. */
	const toBadges = ['Escape', 'ArrowUp', 'ArrowLeft', 'Enter'];

	it('is a row drawn at the top, between the book and Settings: Enter or a tap opens it on its first medal, Escape comes back to it', () => {
		const cues: CueName[] = [];
		const stop = sfx.onCue((cue) => cues.push(cue));
		try {
			const { press, sent } = setup();
			const row = bundles(game.party).length + MENU_ITEMS.indexOf('badges');
			press('Escape', 'ArrowUp', 'ArrowLeft');
			expect(pause.cursor).toBe(row);
			// Right is Settings beside it; left the animal book on its other side.
			press('ArrowRight');
			expect(MENU_ITEMS[pause.cursor - bundles(game.party).length]).toBe('settings');
			press('ArrowLeft', 'ArrowLeft');
			expect(MENU_ITEMS[pause.cursor - bundles(game.party).length]).toBe('book');
			press('ArrowRight');
			cues.length = 0;
			press('Enter');
			expect([pause.screen, pause.option, cues]).toEqual(['badges', 0, ['confirm']]);
			press('ArrowRight', 'ArrowRight');
			expect(pause.option).toBe(2);
			press('Escape');
			expect([pause.open, pause.screen, pause.cursor]).toEqual([true, 'list', row]);
			// Opened again, it starts on its first medal; a tap on its row opens it too.
			press(rowKey(0), 'Escape', rowKey(row));
			expect([pause.screen, pause.option]).toEqual(['badges', 0]);
			// Enter and Space do nothing on a medal, and nothing on the page is sent anywhere.
			expect([press('Enter').prevented, press(' ').prevented]).toEqual([false, false]);
			expect([pause.screen, pause.option, sent]).toEqual(['badges', 0, []]);
			press('Escape', 'Escape');
			expect(pause.open).toBe(false);
		} finally {
			stop();
		}
	});

	it('walks the medals as the grid lays them out, each family starting a row: one by one, a row up or down to the same column, never past an edge', () => {
		const count = BADGE_IDS.length;
		const bad: string[] = [];
		for (const columns of [1, 5, 8, 9, 20, count + 3]) {
			pause.reset();
			const { press } = setup();
			pause.badgeColumns = columns;
			press(...toBadges);
			// Where each medal stands: its family's rows come after every row of the families
			// before it, and in them its place in its family goes `columns` to a row.
			const spots: { row: number; column: number }[] = [];
			let rowsBefore = 0;
			for (const family of BADGE_FAMILIES) {
				family.badges.forEach((_, k) =>
					spots.push({ row: rowsBefore + Math.floor(k / columns), column: k % columns })
				);
				rowsBefore += Math.ceil(family.badges.length / columns);
			}
			/** The medal in the same column of the row `by` away, or that row's last; none past the ends. */
			const across = (from: number, by: number): number => {
				const row = spots[from]!.row + by;
				const there = spots.flatMap((s, i) => (s.row === row ? [i] : []));
				if (there.length === 0) return from;
				return there[Math.min(spots[from]!.column, there.length - 1)]!;
			};
			for (let from = 0; from < count; from++) {
				for (const [key, want] of [
					['ArrowLeft', Math.max(0, from - 1)],
					['a', Math.max(0, from - 1)],
					['ArrowRight', Math.min(count - 1, from + 1)],
					['d', Math.min(count - 1, from + 1)],
					['ArrowUp', across(from, -1)],
					['w', across(from, -1)],
					['ArrowDown', across(from, 1)],
					['s', across(from, 1)]
				] as const) {
					pause.option = from;
					const pressed = press(key);
					if (pause.option !== want || !pressed.prevented) {
						bad.push(`${columns} a row, ${key} from ${from}: ${pause.option}, not ${want}`);
					}
				}
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('goes family to family: the first and the last medal stay put silently, and a row never mixes two families', () => {
		const cues: CueName[] = [];
		const stop = sfx.onCue((cue) => cues.push(cue));
		try {
			const { press } = setup();
			pause.badgeColumns = 8;
			press(...toBadges);
			const [first, second] = BADGE_FAMILIES;
			const lastOfFirst = first!.badges.length - 1;
			cues.length = 0;
			// The first medal: left and up go nowhere, and say nothing.
			press('ArrowLeft', 'ArrowUp', 'a', 'w');
			expect([pause.option, cues]).toEqual([0, []]);
			// Right from a family's last medal is the next family's first.
			pause.option = lastOfFirst;
			press('ArrowRight');
			expect([BADGE_IDS[pause.option], cues]).toEqual([second!.badges[0]!.id, ['move']]);
			// Down from the first family's last row (four medals of its twenty, eight to a row):
			// the next family's first row, in the same column; up comes back.
			pause.option = 16 + 2;
			press('ArrowDown');
			expect(BADGE_IDS[pause.option]).toBe(second!.badges[2]!.id);
			press('ArrowUp');
			expect(pause.option).toBe(18);
			// Up into a shorter row lands on its last medal: from the next family's sixth medal
			// (column 5) up to the first family's last row of four.
			pause.option = first!.badges.length + 5;
			press('ArrowUp');
			expect(pause.option).toBe(lastOfFirst);
			// The last medal: right and down go nowhere, and say nothing.
			pause.option = BADGE_IDS.length - 1;
			cues.length = 0;
			press('ArrowRight', 'ArrowDown', 'd', 's');
			expect([pause.option, cues]).toEqual([BADGE_IDS.length - 1, []]);
			// Left from it goes back one.
			press('ArrowLeft');
			expect([pause.option, cues]).toEqual([BADGE_IDS.length - 2, ['move']]);
		} finally {
			stop();
		}
	});

	it('a tap lights a medal, a tap on the lit one or past the last does nothing; it goes with the menu when something else takes the screen', () => {
		const cues: CueName[] = [];
		const stop = sfx.onCue((cue) => cues.push(cue));
		try {
			const { authority, press } = setup();
			press(...toBadges);
			cues.length = 0;
			expect(press(optionKey(40)).prevented).toBe(true);
			expect([pause.option, cues]).toEqual([40, ['move']]);
			press(optionKey(40), optionKey(BADGE_IDS.length));
			expect([pause.option, cues]).toEqual([40, ['move']]);
			// A tap on the last medal reaches it, as the keys do.
			press(optionKey(BADGE_IDS.length - 1));
			expect(pause.option).toBe(BADGE_IDS.length - 1);
			authority.dispatch({ type: 'leave-game' });
			expect([pause.open, pause.screen, pause.option]).toEqual([false, 'list', 0]);
		} finally {
			stop();
		}
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
			land: 'nordland',
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

describe('Log out asks first', () => {
	/** A player logged in to Ida's account, Settings open on Log out; how many times it logged out. */
	function onLogOut() {
		account.name = 'Ida';
		let logOuts = 0;
		const t = setup('squirrel,rabbit,fox', undefined, { logOut: () => logOuts++ });
		const row = settingsRows().indexOf('logOut');
		t.press(...t.toSetting('logOut'));
		expect([pause.screen, pause.option]).toEqual(['settings', row]);
		const quiet = () => t.controller.update(PICK_QUIET_SECONDS);
		return { ...t, row, quiet, logOuts: () => logOuts };
	}

	afterEach(() => {
		account.name = null;
	});

	it('asks on the right, No lit first, and logs out only on Yes', () => {
		const { press, row, quiet, logOuts } = onLogOut();
		press('Enter');
		expect([pause.screen, pause.option, logOuts()]).toEqual(['logOut', 0, 0]);
		quiet();
		press('Enter');
		expect([pause.screen, pause.option, logOuts()]).toEqual(['settings', row, 0]);

		press('Enter');
		quiet();
		press('ArrowRight');
		expect(pause.option).toBe(1);
		press('ArrowRight', 'ArrowDown', 's', 'd'); // no wrapping: Yes stays lit
		expect(pause.option).toBe(1);
		press('ArrowUp');
		expect(pause.option).toBe(0);
		press('a', 'w', 'ArrowLeft');
		expect(pause.option).toBe(0);
		press('ArrowDown', 'Enter');
		expect([pause.open, pause.screen, pause.option, logOuts()]).toEqual([true, 'settings', row, 1]);
	});

	it('Escape is No, and goes back to the Log out row', () => {
		const { press, row, logOuts } = onLogOut();
		press('Enter', 'ArrowDown');
		expect(press('Escape').prevented).toBe(true);
		expect([pause.open, pause.screen, pause.option, logOuts()]).toEqual([true, 'settings', row, 0]);
	});

	it('an Enter mashed through, or a tap too soon, never logs out', () => {
		const { press, controller, quiet, logOuts } = onLogOut();
		press('Enter', 'ArrowDown', 'Enter', 'Enter', 'Enter');
		expect([pause.screen, logOuts()]).toEqual(['logOut', 0]);
		// Each press started the quiet moment again; a moment short of it is not enough.
		controller.update(PICK_QUIET_SECONDS / 2);
		press(optionKey(1));
		expect([pause.screen, logOuts()]).toEqual(['logOut', 0]);
		quiet();
		press(optionKey(1));
		expect([pause.screen, logOuts()]).toEqual(['settings', 1]);
	});

	it('a tap on another setting does that row, and logs out nothing', () => {
		const { press, quiet, logOuts } = onLogOut();
		press('Enter');
		quiet();
		press(rowKey(settingsRows().indexOf('sound')));
		expect([pause.screen, settingsRows()[pause.option], sfx.on, logOuts()]).toEqual([
			'settings',
			'sound',
			false,
			0
		]);
		press(rowKey(settingsRows().indexOf('logOut')));
		quiet();
		press(languageKey('da'));
		expect([pause.screen, settingsRows()[pause.option], language.current, logOuts()]).toEqual([
			'settings',
			'language',
			'da',
			0
		]);
		// Back, beside the question, goes back to the team.
		press(rowKey(settingsRows().indexOf('logOut')));
		quiet();
		press(rowKey(settingsRows().indexOf('back')));
		expect([pause.open, pause.screen, logOuts()]).toEqual([true, 'list', 0]);
	});

	it('logged out in another tab meanwhile: the question goes, nothing logs out, and the cursor is on Back', () => {
		const { press, quiet, logOuts } = onLogOut();
		press('Enter', 'ArrowDown');
		quiet();
		account.name = null;
		press('Enter');
		expect([pause.screen, settingsRows()[pause.option], logOuts()]).toEqual([
			'settings',
			'back',
			0
		]);
	});
});
