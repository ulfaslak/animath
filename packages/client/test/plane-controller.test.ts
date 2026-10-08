import {
	landSeed,
	newGame,
	onTentLattice,
	tentArrival,
	tileAtWorld,
	type GameEvent
} from '@mathgame/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalAuthority } from '../src/authority/local';
import { motion } from '../src/motion';
import { PLANE_SECONDS, PlaneController } from '../src/plane/controller';
import type { PlaneOnScreen } from '../src/render/renderer';
import {
	CALM_PLANE_SECONDS,
	planeGroundOf,
	planeSpot,
	type PlaneGround
} from '../src/render/plane';
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
	const all = (): PlaneGround => 'ground';
	/** What a tile is to the plane, from a map of rows: `.` ground, `#` scenery, `~` water; off it, water. */
	const mapped =
		(rows: string[], ox: number, oy: number) =>
		(x: number, y: number): PlaneGround => {
			const c = rows[y - oy]?.[x - ox] ?? '~';
			return c === '~' ? 'water' : c === '#' ? 'scenery' : 'ground';
		};

	it('behind the kid when that is ground, else to a side that is', () => {
		expect(planeSpot({ x: 0, y: 0 }, 'up', all)).toEqual({
			x: 0,
			z: 1.5,
			heading: 'right',
			water: false
		});
		expect(planeSpot({ x: 0, y: 0 }, 'left', all)).toEqual({
			x: 1.5,
			z: 0,
			heading: 'up',
			water: false
		});
		// Water two rows behind (y > 1), under its tail: to the left.
		const dryAbove = (_x: number, y: number): PlaneGround => (y <= 1 ? 'ground' : 'water');
		expect(planeSpot({ x: 0, y: 0 }, 'up', dryAbove)).toEqual({
			x: -1.5,
			z: 0,
			heading: 'up',
			water: false
		});
	});

	it('among trees and rocks before over the water, and a step further out before that', () => {
		// The kid @ at (0, 0) facing up, the tent over them. Behind: trees; left: a tree; right: water.
		// prettier-ignore
		const trees = mapped([
			'.....~~~',
			'.....~~~',
			'..#@.~~~',
			'.#####~~',
			'.#####~~',
		], -3, -2);
		expect(planeSpot({ x: 0, y: 0 }, 'up', trees)).toMatchObject({ x: 0, z: 1.5, water: false });
		// A brook right behind, and ground past it: there, a step further.
		// prettier-ignore
		const further = mapped([
			'.....~~~',
			'..#@.~~~',
			'~~~~~~~~',
			'........',
			'........',
		], -3, -1);
		expect(planeSpot({ x: 0, y: 0 }, 'up', further)).toMatchObject({ x: 0, z: 2.5, water: false });
	});

	it('on a strip of shore, its skis on the ground and its nose over the water', () => {
		// World 4's tent at (-87, 64): the kid on a strip of ground one row deep over a lake.
		// prettier-ignore
		const shore = mapped([
			'.#####.T.#.##..',
			'~......@.......',
			'~~~~~~~~~~~..#.',
			'~~~~~~~~~~~...#',
		], -94, 64);
		const spot = planeSpot({ x: -87, y: 65 }, 'up', shore);
		expect(spot.water).toBe(false);
		for (const y of [Math.floor(spot.z), Math.ceil(spot.z)]) {
			for (const x of [Math.floor(spot.x), Math.ceil(spot.x)])
				expect(shore(x, y)).not.toBe('water');
		}
	});

	it('on the water as a seaplane only where no ground near takes it, behind the kid', () => {
		// World 5's tent at (-225, -69): the kid on a spit of land in the water.
		// prettier-ignore
		const spit = mapped([
			'~~~~~~.#...~~~~',
			'~~~~~~...~~~~~.',
			'~~~~~~.T.~~~~~.',
			'~~~~~~.@~~~~~~.',
			'~~~~~~~~~~~~~~~',
		], -232, -71);
		expect(planeSpot({ x: -225, y: -68 }, 'up', spit)).toEqual({
			x: -225,
			z: -66.5,
			heading: 'right',
			water: true
		});
		expect(planeSpot({ x: 0, y: 0 }, 'up', () => 'water')).toMatchObject({ water: true, z: 1.5 });
		expect(planeSpot({ x: 0, y: 0 }, 'up', () => 'scenery').water).toBe(false);
	});

	it('in every world of every land, its skis are never over the water unless it is a seaplane on floats', () => {
		for (const land of ['nordland', 'arctic'] as const) {
			for (let world = 1; world <= 6; world++) {
				const seed = landSeed(land, world);
				const ground = (x: number, y: number) => planeGroundOf(tileAtWorld(seed, x, y));
				for (let x = -120; x <= 120; x++) {
					for (let y = -100; y <= 100; y++) {
						if (!onTentLattice(x, y) || tileAtWorld(seed, x, y).kind !== 'tent') continue;
						const at = tentArrival(seed, { x, y });
						if (!at) continue;
						const spot = planeSpot(at.stand, at.facing, ground);
						const skis = [Math.floor(spot.x), Math.ceil(spot.x)].flatMap((sx) =>
							[Math.floor(spot.z), Math.ceil(spot.z)].map((sz) => ground(sx, sz))
						);
						expect(skis.includes('water'), `${land} ${world} ${x},${y}`).toBe(spot.water);
					}
				}
			}
		}
	});
});
