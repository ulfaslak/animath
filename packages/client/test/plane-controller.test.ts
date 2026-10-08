import { newGame, type GameEvent } from '@mathgame/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalAuthority } from '../src/authority/local';
import { motion } from '../src/motion';
import { PLANE_SECONDS, PlaneController } from '../src/plane/controller';
import type { PlaneOnScreen } from '../src/render/renderer';
import { CALM_PLANE_SECONDS, planeSpot } from '../src/render/plane';
import { game } from '../src/state/game.svelte';
import { plane } from '../src/state/plane.svelte';
import { testStarter } from './minted';

/**
 * The plane between lands on the page: the authority flies the kid at once
 * (and the save with it), while the screens hear of the land reached only
 * once the plane is off screen; no key, and presence says `plane`, until the
 * kid is off it in the land reached.
 */
function setup() {
	const authority = new LocalAuthority({ lands: true });
	const drawn: (PlaneOnScreen | null)[] = [];
	const delivered: GameEvent[] = [];
	const saved: GameEvent[] = [];
	const controller = new PlaneController({ setPlane: (show) => drawn.push(show) }, (event) => {
		delivered.push(event);
		game.apply(event);
	});
	authority.subscribe((event) => {
		saved.push(event);
		if (!controller.intercept(event)) {
			delivered.push(event);
			game.apply(event);
		}
	});
	authority.start({ game: { ...newGame(1, testStarter()), unlocked: ['nordland', 'arctic'] } });
	/** Walk to the tent by the spawn and pay the fare to The Arctic. */
	const fly = () => {
		for (let i = 0; i < 7; i++) authority.dispatch({ type: 'move', dir: 'right' });
		authority.dispatch({ type: 'move', dir: 'down' });
		authority.dispatch({ type: 'interact' });
		authority.dispatch({ type: 'doctor', intent: { type: 'fly', land: 'arctic' } });
		const fare = [...saved].reverse().find((e) => e.type === 'doctor-visit-updated');
		if (fare?.type !== 'doctor-visit-updated' || fare.state.phase.kind !== 'paying-fare')
			throw new Error('no fare');
		const answer = fare.state.phase.puzzle;
		const text =
			answer.kind === 'clock'
				? `${Math.floor(answer.answer / 60) || 12}:${String(answer.answer % 60).padStart(2, '0')}`
				: String(answer.answer);
		authority.dispatch({ type: 'doctor', intent: { type: 'answer', input: text } });
	};
	/** `seconds` of frames, and one more: a part ends on the frame that takes it past its end. */
	const run = (seconds: number) => {
		for (let t = 0; t < seconds + 1 / 60; t += 1 / 60) controller.update(1 / 60);
	};
	return { authority, controller, drawn, delivered, saved, fly, run };
}

afterEach(() => {
	plane.reset();
	motion.reduced = false;
});

describe('the plane between lands', () => {
	it('holds the land reached back from the screens until the plane is off screen; the save has it at once', () => {
		const t = setup();
		t.fly();
		// The authority flew: the game it would save is in The Arctic already.
		expect(t.authority.snapshot().land).toBe('arctic');
		expect(t.saved.some((e) => e.type === 'travelled' && e.land === 'arctic')).toBe(true);
		// The screens are still in Nordland, by the tent, with the plane coming down beside the kid.
		expect(game.land).toBe('nordland');
		// Not one event from the flight on has reached a screen.
		const heard = t.delivered.length;
		const flown = t.saved.findIndex((e) => e.type === 'travelled');
		expect(t.delivered).toEqual(t.saved.slice(0, flown));
		expect(plane.show?.phase).toBe('landing');
		expect(plane.busy).toBe(true);
		t.run(PLANE_SECONDS.landing);
		expect(plane.show?.phase).toBe('boarding');
		t.run(PLANE_SECONDS.boarding);
		expect(plane.show?.phase).toBe('leaving');
		expect(game.land).toBe('nordland');
		t.run(PLANE_SECONDS.leaving);
		// Off screen: everything held goes on, in order, and the plane comes in to the tent reached.
		expect(plane.show?.phase).toBe('arriving');
		expect(game.land).toBe('arctic');
		const after = t.saved.slice(flown);
		expect(t.delivered).toEqual([...t.saved.slice(0, heard), ...after]);
		expect(after.map((e) => e.type)).toEqual([
			'travelled',
			'party-changed',
			'belongings-changed',
			'starter-wanted'
		]);
		t.run(PLANE_SECONDS.arriving);
		expect(plane.show?.phase).toBe('alighting');
		expect(plane.busy).toBe(true);
		t.run(PLANE_SECONDS.alighting);
		// Off the plane: the kid is free, and it takes off.
		expect(plane.show?.phase).toBe('departing');
		expect(plane.busy).toBe(false);
		t.run(PLANE_SECONDS.departing);
		expect(plane.show).toBeNull();
		expect(t.drawn.at(-1)).toBeNull();
	});

	it('parks beside the kid, the kid riding into it and out of it, in both lands', () => {
		const t = setup();
		t.fly();
		const at = () => t.drawn.at(-1)!;
		// Facing the tent below them at (5, 7) from (5, 6): behind them is the reeds' water, so
		// parked a step and a half to their side, on the grass.
		expect(at().at).toEqual({ x: 3.5, y: 6 });
		expect(at().ride).toBe(0);
		t.run(PLANE_SECONDS.landing + PLANE_SECONDS.boarding / 2);
		expect(at().ride).toBeGreaterThan(0);
		expect(at().ride).toBeLessThan(1);
		t.run(PLANE_SECONDS.boarding / 2 + PLANE_SECONDS.leaving / 2);
		expect(at().ride).toBe(1);
		expect(at().pose.way).toBe('out');
		t.run(PLANE_SECONDS.leaving / 2 + PLANE_SECONDS.arriving / 2);
		// In The Arctic, beside the kid at the tent the flight came down at.
		const pos = game.pos;
		const spot = at().at;
		expect(Math.abs(spot.x - pos.x) + Math.abs(spot.y - pos.y)).toBeCloseTo(1.5);
		expect(at().ride).toBe(1);
		t.run(PLANE_SECONDS.arriving / 2 + PLANE_SECONDS.alighting);
		expect(at().ride).toBe(0);
	});

	it('with reduced motion, every part is short', () => {
		motion.reduced = true;
		const t = setup();
		t.fly();
		expect(plane.show?.calm).toBe(true);
		for (let i = 0; i < 6; i++) t.run(CALM_PLANE_SECONDS);
		expect(plane.show).toBeNull();
		expect(game.land).toBe('arctic');
	});

	it('a trip to another world of the same land is no flight', () => {
		const t = setup();
		t.authority.dispatch({ type: 'travel', world: 42 });
		expect(plane.show).toBeNull();
		expect(t.delivered.some((e) => e.type === 'travelled')).toBe(true);
		expect(game.world).toBe(42);
	});
});

describe('where the plane parks', () => {
	it('behind the kid when that is ground, else to a side that is, else behind all the same', () => {
		const all = () => true;
		expect(planeSpot({ x: 0, y: 0 }, 'up', all)).toEqual({ x: 0, z: 1.5, heading: 'right' });
		expect(planeSpot({ x: 0, y: 0 }, 'left', all)).toEqual({ x: 1.5, z: 0, heading: 'up' });
		// Water two rows behind (y > 1), under its tail: to the left.
		const dryAbove = (_x: number, y: number) => y <= 1;
		expect(planeSpot({ x: 0, y: 0 }, 'up', dryAbove)).toEqual({ x: -1.5, z: 0, heading: 'up' });
		// Nowhere: behind.
		expect(planeSpot({ x: 0, y: 0 }, 'up', () => false)).toEqual({
			x: 0,
			z: 1.5,
			heading: 'right'
		});
	});
});
