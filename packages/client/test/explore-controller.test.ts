import type { BattleState, GameEvent } from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { LocalAuthority } from '../src/authority/local';
import { parseParty } from '../src/flags';
import { ExploreController } from '../src/explore/controller';
import { Keyboard } from '../src/input/keyboard';
import type { GameRenderer } from '../src/render/renderer';
import { game } from '../src/state/game.svelte';

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
	const renderer = {
		setWorld() {},
		setPlayer() {},
		ensureChunksAround() {}
	} as unknown as GameRenderer;
	const authority = new LocalAuthority({ party: parseParty(startingParty)! });
	const explore = new ExploreController(authority, renderer, keyboard);
	const events: GameEvent[] = [];
	authority.subscribe((e) => {
		events.push(e);
		game.apply(e);
		explore.handle(e);
	});
	authority.start();
	const press = (key: string) =>
		listeners.get('keydown')!({
			key,
			repeat: false,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			preventDefault() {}
		});
	const release = (key: string) => listeners.get('keyup')!({ key });
	return { authority, explore, events, press, release };
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
});
