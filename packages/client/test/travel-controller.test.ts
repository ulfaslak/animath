import type { Authority, GameEvent, Intent } from '@mathgame/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sfx } from '../src/audio/sfx.svelte';
import { LocalAuthority } from '../src/authority/local';
import { parseParty } from '../src/flags';
import { motion } from '../src/motion';
import { game } from '../src/state/game.svelte';
import { travel } from '../src/state/travel.svelte';
import {
	BANNER_SECONDS,
	CLOSE_SECONDS,
	FADE_SECONDS,
	OPEN_SECONDS,
	TravelController
} from '../src/travel/controller';

/**
 * A trip to another world as the screen plays it, against the real
 * authority: the world closes on the trainer, `travel` goes only once it is
 * shut, the new world opens with its number, and whatever the authority
 * answers (or if it says nothing) the kid is never left under a closed cover.
 */

/** Where the renderer says the trainer stands on screen. */
const TRAINER = { x: 400, y: 300 };

function setup() {
	const authority = new LocalAuthority({ party: parseParty('squirrel')! });
	const controller = new TravelController(authority, { playerScreenPoint: () => TRAINER });
	const sent: Intent[] = [];
	const events: GameEvent[] = [];
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
	/** Run the frame loop for `seconds`, a tenth of a second at a time, as `main.ts` clamps it. */
	const run = (seconds: number) => {
		for (let left = seconds; left > 1e-9; left -= 0.1) controller.update(Math.min(0.1, left));
	};
	/** A whole trip to `world`: go, the cover closes, the world changes; the arrival as the banner says. */
	const trip = (world: number) => {
		controller.go(world);
		run(CLOSE_SECONDS + 0.01);
		const arrival = travel.banner?.arrival ?? null;
		run(Math.max(OPEN_SECONDS, BANNER_SECONDS) + 0.01);
		return arrival;
	};
	return { controller, sent, events, run, trip };
}

beforeEach(() => {
	travel.reset();
	motion.reduced = false;
});

afterEach(() => {
	motion.reduced = false;
});

describe('a trip to another world', () => {
	it('closes on the trainer, sends travel only once shut, and opens on the new world with its number', () => {
		const { controller, sent, run } = setup();
		controller.go(42);
		expect(travel.cover).toEqual({ closing: true, p: 0, ...TRAINER, calm: false });
		expect(sfx.recent.at(-1)).toBe('travel');
		run(CLOSE_SECONDS - 0.05);
		expect([sent, game.world, travel.cover?.closing]).toEqual([[], 1, true]);
		run(0.06);
		expect(sent).toEqual([{ type: 'travel', world: 42 }]);
		expect(game.world).toBe(42);
		expect(travel.cover).toMatchObject({ closing: false });
		expect(travel.banner).toMatchObject({ world: 42, arrival: 'new', calm: false });
		run(OPEN_SECONDS + 0.01);
		expect(travel.cover).toBeNull();
		expect(travel.banner).not.toBeNull();
		run(BANNER_SECONDS);
		expect(travel.banner).toBeNull();
		expect(sent).toHaveLength(1);
	});

	it('takes no second trip while one is under way', () => {
		const { controller, sent, run } = setup();
		controller.go(42);
		run(CLOSE_SECONDS / 2);
		controller.go(7);
		run(CLOSE_SECONDS);
		controller.go(9);
		run(OPEN_SECONDS + BANNER_SECONDS);
		expect(sent).toEqual([{ type: 'travel', world: 42 }]);
		expect(game.world).toBe(42);
	});

	it('says how the kid arrived: somewhere new, back where they left off, or home', () => {
		const { trip } = setup();
		expect([trip(42), trip(7), trip(42), trip(1), trip(7)]).toEqual([
			'new',
			'new',
			'back',
			'home',
			'back'
		]);
	});

	it('a trip the authority refuses opens on the same world, with no number', () => {
		const { controller, events, run } = setup();
		controller.go(game.world);
		run(CLOSE_SECONDS + 0.01);
		expect(events.at(-1)).toEqual({ type: 'travel-refused', reason: 'already-there' });
		expect([travel.cover?.closing, travel.banner]).toEqual([false, null]);
		run(OPEN_SECONDS + 0.01);
		expect(travel.cover).toBeNull();
	});

	it('an authority that answers nothing still never leaves the cover shut', () => {
		const sent: Intent[] = [];
		const silent = {
			dispatch: (intent: Intent) => sent.push(intent),
			subscribe: () => () => {},
			start: () => {}
		} as unknown as Authority;
		const controller = new TravelController(silent, { playerScreenPoint: () => TRAINER });
		controller.go(5);
		for (let i = 0; i < 20; i++) controller.update(0.1);
		expect(sent).toEqual([{ type: 'travel', world: 5 }]);
		expect([travel.cover, travel.banner]).toEqual([null, null]);
	});

	it('with less motion the sky fades in and out instead, as long each way', () => {
		motion.reduced = true;
		const { controller, sent, run } = setup();
		controller.go(3);
		expect(travel.cover?.calm).toBe(true);
		run(FADE_SECONDS - 0.05);
		expect(sent).toEqual([]);
		run(0.06);
		expect(sent).toEqual([{ type: 'travel', world: 3 }]);
		expect(travel.banner).toMatchObject({ world: 3, calm: true });
		run(FADE_SECONDS + 0.01);
		expect(travel.cover).toBeNull();
	});

	it('leaving for the title, a new game or a battle clears it, and no trip goes after', () => {
		for (const event of [
			{ type: 'game-left' },
			{ type: 'battle-started' }
		] as unknown as GameEvent[]) {
			travel.reset();
			const { controller, sent, run } = setup();
			controller.go(8);
			run(CLOSE_SECONDS / 2);
			controller.handle(event);
			expect([travel.cover, travel.banner]).toEqual([null, null]);
			run(CLOSE_SECONDS + OPEN_SECONDS);
			expect(sent).toEqual([]);
		}
	});
});
