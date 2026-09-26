import { STARTERS, getAnimal, type GameEvent, type Intent, type SavedGame } from '@mathgame/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sfx } from '../src/audio/sfx.svelte';
import { LocalAuthority } from '../src/authority/local';
import { language } from '../src/copy';
import type { TitleView3D } from '../src/render/title-scenery';
import { game } from '../src/state/game.svelte';
import { title } from '../src/state/title.svelte';
import {
	CONFIRM_GUARD_SECONDS,
	PICK_GUARD_SECONDS,
	TitleController
} from '../src/title/controller';

/**
 * The title's keys against the real authority: the menu, the confirm before
 * a new game puts a saved one away, the starters and the name box — what
 * each key does, what a mashed or held key must never do (skip the confirm,
 * pick a starter or a name unseen), and that the title closes only on the
 * authority's `welcome`. The 3D scenery is a stand-in that records what it
 * was asked to show; the name box is DOM, so the typed text is set on
 * `title.draft` as the bound input would.
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
	showWorld(_seed: number, _pos: unknown, _facing: unknown, species: readonly string[]): void {
		this.shown.push(`world ${species.join(',')}`);
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
	update(): void {}
	hide(): void {
		this.shown.push('hide');
	}
}

/** A saved game with a team of two, the first called Pip. */
function savedGame(): SavedGame {
	const helper = new LocalAuthority();
	helper.dispatch({ type: 'new-game', speciesId: 'squirrel', nickname: 'Pip' });
	const saved = helper.snapshot();
	saved.party.push({ id: 'fox-1', speciesId: 'fox', hp: getAnimal('fox').maxHp });
	return saved;
}

function setup(saved: SavedGame | null = null) {
	const authority = new LocalAuthority();
	const scenery = new FakeScenery();
	const continued: SavedGame[] = [];
	const controller = new TitleController(authority, scenery, {
		continueGame(game) {
			continued.push(game);
			authority.start({ game });
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
	return { authority, controller, scenery, continued, events, sent, press, wait };
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
		const saved = savedGame();
		const { scenery, continued, events, press } = setup(saved);
		expect(title.rows).toEqual(['continue', 'new', 'language', 'sound']);
		expect(title.rows[title.cursor]).toBe('continue');
		expect(scenery.shown).toEqual(['world squirrel,fox']);
		press('Enter');
		expect(continued).toEqual([saved]);
		expect(events[0]).toMatchObject({ type: 'welcome', newGame: false });
		expect(title.open).toBe(false);
		expect(scenery.shown.at(-1)).toBe('hide');
		// The title is gone: its keys do nothing now.
		expect(press('ArrowDown').prevented).toBe(false);
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
		wait(CONFIRM_GUARD_SECONDS + 0.05);
		press('Enter');
		expect(title.screen).toBe('menu');
		expect(title.rows[title.cursor]).toBe('new');
		press('Enter');
		press('Escape');
		expect(title.screen).toBe('menu');
		expect(title.rows[title.cursor]).toBe('new');
		expect(newGames(sent)).toEqual([]);
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

	it('Yes needs an arrow and then Enter, after the confirm has been up a moment', () => {
		const { press, wait, scenery } = setup(savedGame());
		press('s', 'Enter', 'ArrowDown');
		expect(title.confirm).toBe(1);
		press('Enter');
		expect(title.screen).toBe('confirm'); // too soon: nothing
		wait(CONFIRM_GUARD_SECONDS + 0.05);
		press('ArrowDown'); // no wrap: still Yes
		press('Enter');
		expect(title.screen).toBe('starter');
		expect(scenery.shown).toContain(`starters ${STARTERS.join(',')}`);
	});
});

describe('title: the starters', () => {
	/** From a fresh title to the starter screen, past its guard. */
	function atStarters() {
		const s = setup();
		s.press('Enter');
		expect(title.screen).toBe('starter');
		s.wait(PICK_GUARD_SECONDS + 0.05);
		return s;
	}

	it('a new player goes straight from New game to the starters, the first one lit', () => {
		const { press, scenery } = setup();
		press('Enter');
		expect(title.screen).toBe('starter');
		expect(title.starter).toBe(0);
		expect(scenery.shown.slice(-2)).toEqual([`starters ${STARTERS.join(',')}`, 'select 0']);
		expect(title.spots).toHaveLength(STARTERS.length);
	});

	it('arrows light every starter in turn, wrapping; Escape goes back to New game', () => {
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
		expect(title.screen).toBe('menu');
		expect(title.rows[title.cursor]).toBe('new');
	});

	it('an Enter mashed on New game does not pick a starter unseen', () => {
		const { press, wait } = setup();
		press('Enter', 'Enter', 'Enter');
		wait(PICK_GUARD_SECONDS / 2);
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
	/** Pick the starter at `index` and wait out the name box's guard. */
	function naming(index: number) {
		const s = setup();
		s.press('Enter');
		s.wait(PICK_GUARD_SECONDS + 0.05);
		s.press(...Array<string>(index).fill('ArrowRight'), 'Enter');
		s.wait(PICK_GUARD_SECONDS + 0.05);
		return s;
	}

	it('Enter starts the game with the starter and the name as typed; the engine cleans it', () => {
		for (const [index, speciesId] of STARTERS.entries()) {
			const { press, sent, events, scenery } = naming(index);
			title.draft = '  Pip 🐿 ';
			press('Enter');
			expect(newGames(sent)).toEqual([{ type: 'new-game', speciesId, nickname: '  Pip 🐿 ' }]);
			const welcome = events.find((e) => e.type === 'welcome');
			expect(welcome).toMatchObject({ newGame: true, party: [{ speciesId, nickname: 'Pip' }] });
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
		const { press, wait, controller, sent } = setup();
		press('Enter');
		wait(PICK_GUARD_SECONDS + 0.05);
		press('Enter', 'Enter', 'Enter');
		expect(title.screen).toBe('naming');
		wait(PICK_GUARD_SECONDS + 0.05);
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
