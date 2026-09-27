import {
	STARTERS,
	WorldEdits,
	getAnimal,
	type GameEvent,
	type Intent,
	type SavedGame
} from '@mathgame/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sfx } from '../src/audio/sfx.svelte';
import { LocalAuthority } from '../src/authority/local';
import { language } from '../src/copy';
import { parseParty } from '../src/flags';
import { PICK_QUIET_SECONDS } from '../src/input/pick-guard';
import { languageKey, rowKey } from '../src/input/press';
import type { TitleView3D } from '../src/render/title-scenery';
import { game } from '../src/state/game.svelte';
import { title } from '../src/state/title.svelte';
import { TitleController } from '../src/title/controller';
import { everyMash } from './mash';

/**
 * The title's keys against the real authority: the menu, the confirm before
 * a new game puts a saved one away, the player's name box, the starters and
 * the starter's name box — what each key does, what a mashed or held key
 * must never do (skip the confirm, pick a starter or a name unseen), and that
 * the title closes only on the authority's `welcome`. The 3D scenery is a
 * stand-in that records what it was asked to show; the name boxes are DOM, so
 * the typed text is set on `title.nameDraft` and `title.draft` as the bound
 * inputs would.
 */
interface Key extends KeyboardEvent {
	prevented: boolean;
}

function key(name: string, options: { repeat?: boolean; isComposing?: boolean } = {}): Key {
	const event = {
		key: name,
		repeat: options.repeat ?? false,
		isComposing: options.isComposing ?? false,
		keyCode: 0,
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

class FakeScenery implements TitleView3D {
	shown: string[] = [];
	/** The tiles cleared in the world last shown, as text. */
	cleared: readonly string[] = [];
	showWorld(
		_seed: number,
		_pos: unknown,
		_facing: unknown,
		species: readonly string[],
		edits = WorldEdits.none
	): void {
		this.shown.push(`world ${species.join(',')}`);
		this.cleared = edits.encode();
	}
	showStarters(species: readonly string[]): void {
		this.shown.push(`starters ${species.join(',')}`);
	}
	select(index: number): void {
		this.shown.push(`select ${index}`);
	}
	cheer(index: number): void {
		this.shown.push(`cheer ${index}`);
	}
	spots(): { x: number; y: number }[] {
		return STARTERS.map((_, i) => ({ x: (i + 1) / (STARTERS.length + 1), y: 0.5 }));
	}
	setRoom(): void {}
	update(): void {}
	hide(): void {
		this.shown.push('hide');
	}
}

/** A saved game in World 1 with a team of two, the first called Pip, played by Ida. */
function savedGame(): SavedGame {
	const helper = new LocalAuthority({ homeWorld: () => 1 });
	helper.dispatch({ type: 'new-game', speciesId: 'squirrel', nickname: 'Pip', name: 'Ida' });
	const saved = helper.snapshot();
	saved.party.push({ id: 'fox-1', speciesId: 'fox', hp: getAnimal('fox').maxHp });
	return saved;
}

/** A game saved before players had names: the same, with no name. */
function namelessGame(): SavedGame {
	return { ...savedGame(), name: null };
}

function setup(saved: SavedGame | null = null) {
	const authority = new LocalAuthority({ homeWorld: () => 1 });
	const scenery = new FakeScenery();
	const continued: SavedGame[] = [];
	const controller = new TitleController(authority, scenery, {
		// As main.ts does: the game is picked up, then the name given for it goes on.
		continueGame(game, name) {
			continued.push(game);
			authority.start({ game });
			if (name !== undefined) authority.dispatch({ type: 'choose-name', name });
		}
	});
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
	controller.open(saved);
	/** Press keys in order; the last key event, to look at. */
	const press = (...names: string[]) => {
		let last = key('');
		for (const n of names) controller.onKey((last = key(n)));
		return last;
	};
	/** Let `seconds` of frame time pass, a frame at a time as main.ts clamps them. */
	const wait = (seconds: number) => {
		for (let t = 0; t < seconds - 1e-9; t += 0.1) controller.update(Math.min(0.1, seconds - t));
	};
	/** Type `name` in the player's name box, wait out its quiet moment, and press Enter. */
	const giveName = (name = 'Ida') => {
		expect(title.screen).toBe('player');
		title.nameDraft = name;
		wait(PICK_QUIET_SECONDS + 0.05);
		return press('Enter');
	};
	return { authority, controller, scenery, continued, events, sent, press, wait, giveName };
}

const newGames = (sent: readonly Intent[]) => sent.filter((i) => i.type === 'new-game');

let startLanguage = language.current;
beforeEach(() => {
	startLanguage = language.current;
	title.open = false;
});
afterEach(() => {
	language.set(startLanguage);
	vi.restoreAllMocks();
});

describe('title: the menu', () => {
	it('with no saved game: New game and the settings, the cursor on New game, the starters behind', () => {
		const { scenery } = setup();
		expect(title.open).toBe(true);
		expect(title.rows).toEqual(['new', 'language', 'sound']);
		expect(title.cursor).toBe(0);
		expect(scenery.shown).toEqual([`world ${STARTERS.join(',')}`]);
	});

	it('with a saved game: Continue first, lit, and the team behind; Enter picks it up at once', () => {
		// The game chopped two trees: the world behind the title shows it as the kid left it.
		const saved = { ...savedGame(), edits: ['-1,0:9091'] };
		const { scenery, continued, events, press } = setup(saved);
		expect(title.rows).toEqual(['continue', 'new', 'language', 'sound']);
		expect(title.rows[title.cursor]).toBe('continue');
		expect(scenery.shown).toEqual(['world squirrel,fox']);
		expect(scenery.cleared).toEqual(['-1,0:9091']);
		press('Enter');
		expect(continued).toEqual([saved]);
		expect(events[0]).toMatchObject({ type: 'welcome', newGame: false });
		expect(title.open).toBe(false);
		expect(scenery.shown.at(-1)).toBe('hide');
		// The title is gone: its keys do nothing now.
		expect(press('ArrowDown').prevented).toBe(false);
	});

	it('Continue names the one that goes first where the game stands: out on the water one that swims, else the one in the boat', () => {
		const at = (pos: { x: number; y: number }, party: string): SavedGame => ({
			...savedGame(),
			items: ['boat'],
			pos,
			party: parseParty(party)!
		});
		const deep = { x: -2, y: 2 };
		const lead = (saved: SavedGame) => {
			setup(saved);
			return title.lead?.speciesId;
		};
		expect(lead(at(deep, 'squirrel,otter'))).toBe('otter');
		// Nobody standing who swims: the first standing rides in the boat, not a tired one.
		expect(lead(at(deep, 'squirrel:0,rabbit'))).toBe('rabbit');
		expect(lead(at({ x: -2, y: 6 }, 'squirrel:0,otter,rabbit'))).toBe('otter');
		// Everyone tired: the first of the team, as on land.
		expect(lead(at(deep, 'squirrel:0,rabbit:0'))).toBe('squirrel');
	});

	it('walks the rows with arrows and W / S, wrapping, and never on auto-repeat', () => {
		const { controller, press } = setup(savedGame());
		press('s', 'ArrowDown', 'ArrowDown');
		expect(title.rows[title.cursor]).toBe('sound');
		press('ArrowDown');
		expect(title.cursor).toBe(0);
		press('w');
		expect(title.rows[title.cursor]).toBe('sound');
		const held = key('ArrowUp', { repeat: true });
		controller.onKey(held);
		expect(title.rows[title.cursor]).toBe('sound');
		expect(held.prevented).toBe(true);
		// A held Enter never picks anything either.
		press('w', 'w', 'w');
		controller.onKey(key('Enter', { repeat: true }));
		expect(title.open).toBe(true);
	});

	it('W A S D steer the same in capitals, and a shortcut is the browser’s', () => {
		const { press, controller } = setup(savedGame());
		press('S', 'S');
		expect(title.rows[title.cursor]).toBe('language');
		const first = language.current;
		press('D');
		expect(language.current).not.toBe(first);
		press('A', 'W');
		expect(language.current).toBe(first);
		expect(title.rows[title.cursor]).toBe('new');
		// Ctrl+Enter, Cmd+W: never the title's.
		const shortcut = { ...key('Enter'), ctrlKey: true } as KeyboardEvent;
		controller.onKey(shortcut);
		expect(title.screen).toBe('menu');
	});

	it('left and right switch the language on its row, and do nothing on the others', () => {
		const { press } = setup();
		const first = language.current;
		expect(press('ArrowRight').prevented).toBe(false); // on New game
		expect(language.current).toBe(first);
		press('ArrowDown', 'ArrowRight');
		const second = language.current;
		expect(second).not.toBe(first);
		press('a');
		expect(language.current).toBe(first);
		press('Enter');
		expect(language.current).toBe(second);
		expect(title.screen).toBe('menu');
	});

	it('the Sound row: Enter switches the sound, left turns it off and right on', () => {
		const { press } = setup();
		const was = sfx.on;
		press('ArrowDown', 'ArrowDown');
		expect(title.rows[title.cursor]).toBe('sound');
		press('Enter');
		expect(sfx.on).toBe(!was);
		press('ArrowLeft');
		expect(sfx.on).toBe(false);
		press('a');
		expect(sfx.on).toBe(false);
		press('ArrowRight');
		expect(sfx.on).toBe(true);
		press('d');
		expect(sfx.on).toBe(true);
		expect(title.screen).toBe('menu');
		sfx.set(was);
	});

	it('Escape on the menu does nothing', () => {
		const { press } = setup(savedGame());
		expect(press('Escape').prevented).toBe(false);
		expect(title.open).toBe(true);
		expect(title.screen).toBe('menu');
	});
});

describe('title: a new game over a saved one', () => {
	it('asks first, starting on "No, go back"; Escape or Enter on it go back to New game', () => {
		const { press, wait, sent } = setup(savedGame());
		press('s', 'Enter');
		expect(title.screen).toBe('confirm');
		expect(title.confirm).toBe(0);
		wait(PICK_QUIET_SECONDS + 0.05);
		press('Enter');
		expect(title.screen).toBe('menu');
		expect(title.rows[title.cursor]).toBe('new');
		press('Enter');
		press('Escape');
		expect(title.screen).toBe('menu');
		expect(title.rows[title.cursor]).toBe('new');
		expect(newGames(sent)).toEqual([]);
	});

	it('on a page that keeps nothing, every title says so and the confirm knows it; the next title forgets it (#61)', () => {
		const { controller, press } = setup(savedGame());
		controller.open(savedGame(), 'save.cannotSave', false);
		expect([title.notice, title.keeps]).toEqual(['save.cannotSave', false]);
		press('s', 'Enter');
		expect(title.screen).toBe('confirm');
		expect(title.keeps).toBe(false);
		controller.open(savedGame());
		expect([title.notice, title.keeps]).toEqual([null, true]);
	});

	it('Enter mashed through the confirm never starts a new game', () => {
		const { press, wait, sent } = setup(savedGame());
		press('s');
		for (let i = 0; i < 60; i++) {
			press('Enter');
			wait(0.1);
		}
		expect(title.screen === 'menu' || title.screen === 'confirm').toBe(true);
		expect(newGames(sent)).toEqual([]);
		// Space the same.
		for (let i = 0; i < 30; i++) {
			press(' ');
			wait(0.3);
		}
		expect(title.screen === 'menu' || title.screen === 'confirm').toBe(true);
	});

	it('Yes needs an arrow and then Enter, after the confirm has been up a moment; then the name, then the starters', () => {
		const { press, wait, scenery, giveName } = setup(savedGame());
		press('s', 'Enter', 'ArrowDown');
		expect(title.confirm).toBe(1);
		press('Enter');
		expect(title.screen).toBe('confirm'); // too soon: nothing
		wait(PICK_QUIET_SECONDS + 0.05);
		press('ArrowDown'); // no wrap: still Yes
		press('Enter');
		expect(title.screen).toBe('player');
		// The name box holds the saved game's name, to keep or change.
		expect(title.nameDraft).toBe('Ida');
		giveName('Bo');
		expect(title.screen).toBe('starter');
		expect(scenery.shown).toContain(`starters ${STARTERS.join(',')}`);
	});
});

/**
 * An Enter mashed at 2, 4 or 8 presses a second, unevenly or late every
 * fourth (#37): each screen that chooses something for the game takes a pick
 * only after a quiet moment, so the mash never answers the confirm, picks a
 * starter or names one; a pause and one press do.
 */
describe('title: a mash at any pace', () => {
	it('an Enter mashed from New game on never answers the confirm', () => {
		for (const { name, gaps } of everyMash(3)) {
			const { press, wait, sent } = setup(savedGame());
			press('s');
			for (const gap of gaps) {
				press('Enter');
				wait(gap);
			}
			expect(title.screen, name).toBe('confirm');
			expect(newGames(sent), name).toEqual([]);
		}
	});

	it('an Enter mashed on a new player’s title takes no name, picks no starter and names none', () => {
		for (const { name, gaps } of everyMash(3)) {
			const { press, wait, sent } = setup();
			const mash = () =>
				gaps.forEach((gap) => {
					press('Enter');
					wait(gap);
				});
			// The name box comes up and takes none of the mash, even with a name typed.
			press('Enter');
			expect(title.screen, name).toBe('player');
			title.nameDraft = 'Ida';
			mash();
			expect(title.screen, name).toBe('player');
			wait(PICK_QUIET_SECONDS);
			press('Enter');
			expect(title.screen, name).toBe('starter');
			mash();
			expect(title.screen, name).toBe('starter');
			wait(PICK_QUIET_SECONDS);
			press('Enter');
			expect(title.screen, name).toBe('naming');
			mash();
			expect(title.screen, name).toBe('naming');
			expect(newGames(sent), name).toEqual([]);
			wait(PICK_QUIET_SECONDS);
			press('Enter');
			expect(newGames(sent), name).toHaveLength(1);
		}
	});
});

describe('title: the starters', () => {
	/** From a fresh title to the starter screen, past its guard. */
	function atStarters() {
		const s = setup();
		s.press('Enter');
		s.giveName();
		expect(title.screen).toBe('starter');
		s.wait(PICK_QUIET_SECONDS + 0.05);
		return s;
	}

	it('a new player goes from New game to their name, then to the starters, the first one lit', () => {
		const { press, scenery, giveName } = setup();
		press('Enter');
		expect(title.screen).toBe('player');
		expect(title.nameDraft).toBe('');
		giveName();
		expect(title.screen).toBe('starter');
		expect(title.starter).toBe(0);
		expect(scenery.shown.slice(-2)).toEqual([`starters ${STARTERS.join(',')}`, 'select 0']);
		expect(title.spots).toHaveLength(STARTERS.length);
	});

	it('arrows light every starter in turn, wrapping; Escape goes back to the name, as typed', () => {
		const { press } = atStarters();
		const seen: number[] = [];
		for (let i = 0; i < STARTERS.length; i++) {
			seen.push(title.starter);
			press('ArrowRight');
		}
		expect(seen).toEqual(STARTERS.map((_, i) => i));
		expect(title.starter).toBe(0);
		press('ArrowLeft');
		expect(title.starter).toBe(STARTERS.length - 1);
		press('d');
		expect(title.starter).toBe(0);
		press('Escape');
		expect(title.screen).toBe('player');
		expect(title.nameDraft).toBe('Ida');
		// And from there back to the menu, on New game.
		press('Escape');
		expect(title.screen).toBe('menu');
		expect(title.rows[title.cursor]).toBe('new');
	});

	it('an Enter mashed on the name does not pick a starter unseen', () => {
		const { press, wait, giveName } = setup();
		press('Enter');
		giveName();
		press('Enter', 'Enter', 'Enter');
		wait(PICK_QUIET_SECONDS / 2);
		press('Enter');
		expect(title.screen).toBe('starter');
	});

	it('Enter picks the lit starter, which cheers, and the name box opens empty', () => {
		const { press, scenery } = atStarters();
		press('ArrowRight', 'Enter');
		expect(title.screen).toBe('naming');
		expect(title.draft).toBe('');
		expect(scenery.shown.at(-1)).toBe('cheer 1');
	});
});

describe('title: the name box', () => {
	/** Give the player's name, pick the starter at `index`, and wait out the name box's guard. */
	function naming(index: number) {
		const s = setup();
		s.press('Enter');
		s.giveName();
		s.wait(PICK_QUIET_SECONDS + 0.05);
		s.press(...Array<string>(index).fill('ArrowRight'), 'Enter');
		s.wait(PICK_QUIET_SECONDS + 0.05);
		return s;
	}

	it("Enter starts the game with the starter, its name as typed and the player's name; the engine cleans it", () => {
		for (const [index, speciesId] of STARTERS.entries()) {
			const { press, sent, events, scenery } = naming(index);
			title.draft = '  Pip 🐿 ';
			press('Enter');
			expect(newGames(sent)).toEqual([
				{ type: 'new-game', speciesId, nickname: '  Pip 🐿 ', name: 'Ida' }
			]);
			const welcome = events.find((e) => e.type === 'welcome');
			expect(welcome).toMatchObject({
				newGame: true,
				name: 'Ida',
				party: [{ speciesId, nickname: 'Pip' }]
			});
			expect(game.name).toBe('Ida');
			expect(title.open).toBe(false);
			expect(scenery.shown.at(-1)).toBe('hide');
		}
	});

	it('an empty name skips it: the starter goes by its species', () => {
		const { press, events } = naming(0);
		press('Enter');
		const welcome = events.find((e) => e.type === 'welcome');
		expect(welcome?.type === 'welcome' && welcome.party[0]).not.toHaveProperty('nickname');
	});

	it('an Enter mashed through the pick, or held, does not name the animal unseen', () => {
		const { press, wait, controller, sent, giveName } = setup();
		press('Enter');
		giveName();
		wait(PICK_QUIET_SECONDS + 0.05);
		press('Enter', 'Enter', 'Enter');
		expect(title.screen).toBe('naming');
		wait(PICK_QUIET_SECONDS + 0.05);
		controller.onKey(key('Enter', { repeat: true }));
		expect(newGames(sent)).toEqual([]);
		expect(title.screen).toBe('naming');
	});

	it('letters, W A S D and Space are typing; Escape goes back to the starters, the same one lit', () => {
		const { press, sent } = naming(1);
		for (const letter of ['w', 'a', 's', 'd', ' ', 'P', 'ArrowLeft']) {
			expect(press(letter).prevented).toBe(false);
		}
		expect(title.screen).toBe('naming');
		expect(press('Tab').prevented).toBe(true);
		press('Escape');
		expect(title.screen).toBe('starter');
		expect(title.starter).toBe(1);
		expect(newGames(sent)).toEqual([]);
	});

	it("an input method's Enter is its own", () => {
		const { controller, sent } = naming(0);
		controller.onKey(key('Enter', { isComposing: true }));
		expect(newGames(sent)).toEqual([]);
		expect(title.screen).toBe('naming');
	});

	it('a refused new game leaves the name box up, and says so to developers', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { authority, press, sent } = naming(0);
		// A game already under way: the authority refuses a second one.
		authority.start();
		title.open = true;
		title.screen = 'naming';
		press('Enter');
		expect(newGames(sent)).toHaveLength(1);
		expect(warn).toHaveBeenCalledWith('new game refused: game-in-progress');
		expect(title.screen).toBe('naming');
		// Keys work again.
		press('Escape');
		expect(title.screen).toBe('starter');
	});
});

describe("title: the player's name", () => {
	it('goes on only with a name the engine takes, and says kindly why not, until the kid types again', () => {
		const { press, wait, sent } = setup();
		press('Enter');
		expect(title.screen).toBe('player');
		expect(title.nameFor).toBe('new');
		wait(PICK_QUIET_SECONDS + 0.05);
		for (const [typed, reason] of [
			['', 'empty'],
			['   ', 'empty'],
			['A', 'short'],
			['Pip!', 'chars'],
			['Fuck', 'rude'],
			['a'.repeat(17), 'long']
		] as const) {
			title.nameDraft = typed;
			wait(PICK_QUIET_SECONDS + 0.05);
			press('Enter');
			expect(title.screen, typed).toBe('player');
			expect(title.nameRefused, typed).toBe(reason);
			// The box keeps what was typed, to fix.
			expect(title.nameDraft).toBe(typed);
		}
		press('x');
		expect(title.nameRefused).toBeNull();
		// A name that only needs tidying goes, tidied.
		title.nameDraft = '  Ida   Marie ';
		wait(PICK_QUIET_SECONDS + 0.05);
		press('Enter');
		expect(title.screen).toBe('starter');
		expect(title.playerName).toBe('Ida Marie');
		expect(newGames(sent)).toEqual([]);
	});

	it('letters, W A S D, Space and digits are typing; a held Enter or an input method’s is not a pick', () => {
		const { press, wait, controller } = setup();
		press('Enter');
		for (const letter of ['w', 'a', 's', 'd', ' ', '7', 'P', 'ArrowLeft']) {
			expect(press(letter).prevented, letter).toBe(false);
		}
		expect(press('Tab').prevented).toBe(true);
		title.nameDraft = 'Ida';
		wait(PICK_QUIET_SECONDS + 0.05);
		controller.onKey(key('Enter', { repeat: true }));
		controller.onKey(key('Enter', { isComposing: true }));
		expect(title.screen).toBe('player');
		press('Enter');
		expect(title.screen).toBe('starter');
	});

	it('a game saved before names asks once on Continue, then picks the game up with the name', () => {
		const saved = namelessGame();
		const { press, continued, sent, events, giveName } = setup(saved);
		expect(title.rows[title.cursor]).toBe('continue');
		press('Enter');
		expect(title.screen).toBe('player');
		expect(title.nameFor).toBe('continue');
		expect(continued).toEqual([]);
		// Escape goes back to the menu, on Continue, and nothing started.
		press('Escape');
		expect(title.screen).toBe('menu');
		expect(title.rows[title.cursor]).toBe('continue');
		press('Enter');
		giveName('Nini');
		expect(continued).toEqual([saved]);
		expect(sent.filter((i) => i.type === 'choose-name')).toEqual([
			{ type: 'choose-name', name: 'Nini' }
		]);
		expect(events.map((e) => e.type)).toEqual(['welcome', 'name-chosen']);
		expect(game.name).toBe('Nini');
		expect(title.open).toBe(false);
	});

	it('a game with a name goes on at once, and a new game over it offers that name', () => {
		const { press, continued, sent } = setup(savedGame());
		press('Enter');
		expect(continued).toHaveLength(1);
		expect(sent.filter((i) => i.type === 'choose-name')).toEqual([]);
	});
});

/**
 * A click or a tap reaches the title as a key press (`input/press.ts`): a
 * menu or confirm row does its thing at once, behind the same guards; a
 * language is its language key; a starter's tag only lights it, and the
 * card's button (Enter) picks.
 */
describe('title: a pointer', () => {
	it('a tap on a menu row does it; on a language, that language; on the sound, it flips', () => {
		const { press, continued } = setup(savedGame());
		const rows = title.rows;
		press(languageKey('da'));
		expect(language.current).toBe('da');
		expect(title.cursor).toBe(rows.indexOf('language'));
		press(languageKey('da'));
		expect(language.current).toBe('da');
		const on = sfx.on;
		press(rowKey(rows.indexOf('sound')));
		expect(sfx.on).toBe(!on);
		press(rowKey(rows.indexOf('sound')));
		expect(sfx.on).toBe(on);
		press(rowKey(rows.length));
		expect(title.screen).toBe('menu');
		press(rowKey(rows.indexOf('continue')));
		expect(continued).toHaveLength(1);
	});

	it('the confirm: a tap on Yes starts over, but not before its quiet moment; a tap on No goes back', () => {
		const { press, wait } = setup(savedGame());
		press(rowKey(title.rows.indexOf('new')));
		expect(title.screen).toBe('confirm');
		// A second tap straight away, wherever it lands, waits the quiet moment as Enter does.
		press(rowKey(1));
		expect(title.screen).toBe('confirm');
		wait(PICK_QUIET_SECONDS + 0.05);
		press(rowKey(0));
		expect(title.screen).toBe('menu');
		press(rowKey(title.rows.indexOf('new')));
		wait(PICK_QUIET_SECONDS + 0.05);
		press(rowKey(1));
		expect(title.screen).toBe('player');
	});

	it('a tap on a starter only lights it; the button (Enter) picks it, after the screen’s quiet moment', () => {
		const { press, wait, scenery, sent, giveName } = setup();
		press(rowKey(title.rows.indexOf('new')));
		// The name box's Next is its Enter.
		giveName();
		expect(title.screen).toBe('starter');
		press(rowKey(2), rowKey(2));
		expect(title.starter).toBe(2);
		expect(title.screen).toBe('starter');
		press('Enter');
		expect(title.screen).toBe('starter'); // too soon
		wait(PICK_QUIET_SECONDS + 0.05);
		press(rowKey(STARTERS.length), 'Enter');
		expect(title.screen).toBe('naming');
		expect(scenery.shown.at(-1)).toBe('cheer 2');
		// In the name box a tag's tap is not typing and does nothing; Let's go (Enter) starts.
		press(rowKey(0));
		expect(title.starter).toBe(2);
		wait(PICK_QUIET_SECONDS + 0.05);
		press('Enter');
		expect(newGames(sent)).toEqual([
			{ type: 'new-game', speciesId: STARTERS[2], nickname: '', name: 'Ida' }
		]);
	});
});
