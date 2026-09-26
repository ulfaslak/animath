import { bundles, type BattleState, type GameEvent } from '@mathgame/engine';
import { describe, expect, it, vi } from 'vitest';
import { LocalAuthority } from '../src/authority/local';
import { t } from '../src/copy';
import { parseParty } from '../src/flags';
import { ExploreController } from '../src/explore/controller';
import { Keyboard } from '../src/input/keyboard';
import { animalKey, bundleKey, moveKey, openKey } from '../src/input/press';
import { PauseController } from '../src/pause/controller';
import type { GameRenderer } from '../src/render/renderer';
import { game } from '../src/state/game.svelte';
import { hud } from '../src/state/hud.svelte';
import { team } from '../src/state/team.svelte';

/**
 * Explore input against the real authority: what a frame sends, and in which
 * order. The window and the renderer are stand-ins; the keyboard, the
 * controller and the authority are the real ones.
 */
function setup(startingParty: string) {
	const listeners = new Map<string, (e: unknown) => void>();
	const target = {
		addEventListener: (type: string, listener: (e: unknown) => void) =>
			listeners.set(type, listener)
	} as unknown as Window;
	const keyboard = new Keyboard(target);
	keyboard.setEnabled(true); // explore has the screen, as main.ts says each frame
	const renderer = {
		setWorld() {},
		setBoat() {},
		setPlayer() {},
		ensureChunksAround() {}
	} as unknown as GameRenderer;
	const authority = new LocalAuthority({ party: parseParty(startingParty)! });
	const explore = new ExploreController(authority, renderer, keyboard);
	// Every party-edited reaches the pause menu too, open or not, as in main.ts.
	const pauseMenu = new PauseController(authority);
	const events: GameEvent[] = [];
	authority.subscribe((e) => {
		events.push(e);
		game.apply(e);
		hud.apply(e);
		explore.handle(e);
		pauseMenu.handle(e);
	});
	authority.start();
	team.close();
	/** A key pressed in explore, handed over as main.ts hands it. */
	const press = (key: string) =>
		keyboard.keydown({
			key,
			repeat: false,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			preventDefault() {}
		} as unknown as KeyboardEvent);
	const release = (key: string) => listeners.get('keyup')!({ key });
	/** A key, then the frame that takes it. */
	const frame = (key: string) => {
		press(key);
		explore.update(1 / 60);
		hud.tick(1 / 60);
	};
	/** The species of the cards, top to bottom. */
	const cards = () => bundles(game.party).map((b) => b.speciesId);
	return { authority, explore, events, press, release, frame, cards };
}

describe('explore input', () => {
	it('a number pressed on the frame a step starts a battle picks the animal that fights', () => {
		const { authority, explore, events, press, release } = setup('squirrel,rabbit');
		const rabbit = game.party[1]!;
		// Left, right, … from the spawn tile: the 11th step meets a wild animal.
		// Take the first ten straight from the authority, then let the tween land.
		for (let i = 0; i < 10; i++)
			authority.dispatch({ type: 'move', dir: i % 2 === 0 ? 'left' : 'right' });
		explore.update(1);
		expect(events.some((e) => e.type === 'battle-started')).toBe(false);

		// The 11th step and the number 2 arrive in the same frame.
		press('ArrowLeft');
		press('2');
		explore.update(1 / 60);
		release('ArrowLeft');

		const started = events.find((e) => e.type === 'battle-started');
		expect(started).toBeDefined();
		const state = (started as { state: BattleState }).state;
		expect(state.party[state.active]!.id).toBe(rabbit.id);
	});

	it('a number key picks the card in that place, whose first animal standing goes first', () => {
		const { frame, cards } = setup('squirrel,rabbit:0,rabbit*2,fox');
		expect(cards()).toEqual(['squirrel', 'rabbit', 'fox']);
		frame('2');
		// The rabbits' card goes to the top; its first rabbit is tired, so the next one leads.
		expect(cards()).toEqual(['rabbit', 'squirrel', 'fox']);
		expect(game.party.map((a) => a.hp > 0)).toEqual([true, false, true, true, true]);
		expect(hud.message).toBe(t('party.leadChosen', { animal: 'Rabbit' }));
		frame('3');
		expect(cards()).toEqual(['fox', 'rabbit', 'squirrel']);
		// A number past the last card does nothing.
		const before = game.party.map((a) => a.id);
		frame('9');
		expect(game.party.map((a) => a.id)).toEqual(before);
	});

	it('a number key for the lead, or for a card of tired animals, is answered on the HUD, and logs no warning (#59)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const { frame } = setup('squirrel,rabbit:0,fox:0*2');
			frame('1');
			expect(hud.message).toBe(t('party.leadAlready', { animal: 'Squirrel' }));
			frame('2');
			expect(hud.message).toBe(t('party.leadTired', { animal: 'Rabbit' }));
			frame('3');
			expect(hud.message).toBe(t('party.leadAllTired'));
			expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([]);
		} finally {
			warn.mockRestore();
		}
	});

	it("turns the party column's pointer keys into party intents, and opens a card", () => {
		const { frame, cards, press, release, explore } = setup('squirrel,rabbit*3,fox');
		const hop = game.party.filter((a) => a.speciesId === 'rabbit')[1]!;
		// A card of several opens, and closes again.
		frame(openKey('rabbit'));
		expect(team.open).toBe('rabbit');
		frame(openKey('rabbit'));
		expect(team.open).toBeNull();
		// An animal on an open card goes first, and the card closes.
		frame(openKey('rabbit'));
		frame(animalKey(hop.id));
		expect(game.party[0]!.id).toBe(hop.id);
		expect(team.open).toBeNull();
		// A card of one animal goes first as a whole.
		frame(bundleKey('fox'));
		expect(cards()).toEqual(['fox', 'rabbit', 'squirrel']);
		// A card dropped at another place moves there.
		frame(moveKey('squirrel', 0));
		expect(cards()).toEqual(['squirrel', 'fox', 'rabbit']);
		// A step puts an open card away.
		frame(openKey('rabbit'));
		expect(team.open).toBe('rabbit');
		press('ArrowRight');
		explore.update(1 / 60);
		release('ArrowRight');
		expect(team.open).toBeNull();
	});
});
