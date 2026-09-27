import {
	Rng,
	TENT_SEARCH_STEPS,
	gearOf,
	getAnimal,
	nearestTent,
	newGame,
	type AnimalInstance,
	type GameEvent,
	type GridPos,
	type SavedGame
} from '@mathgame/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalAuthority, WORLD_SEED } from '../src/authority/local';
import { DoctorWay, type DoctorWayRenderer } from '../src/explore/doctor-way';
import { edgeSpot } from '../src/presence/controller';
import { battle } from '../src/state/battle.svelte';
import { doctor } from '../src/state/doctor.svelte';
import { doctorWay } from '../src/state/doctor-way.svelte';
import { game } from '../src/state/game.svelte';
import { pause } from '../src/state/pause.svelte';

/**
 * The way to the doctor while the team is tired ([[UI_SPEC]] § Explore mode),
 * driven as the game drives it: the real authority's events into the game's
 * view, and `DoctorWay` after each frame. The renderer is a stand-in camera
 * that keeps the player in the middle of a 1024 × 768 screen, 40 px a tile.
 */
const SCREEN = { w: 1024, h: 768 };
const TILE = 40;

function camera(showingWorld = true): DoctorWayRenderer {
	return {
		showingWorld,
		screenSize: () => SCREEN,
		groundToScreen: (x: number, y: number) => ({
			x: SCREEN.w / 2 + (x - game.pos.x) * TILE,
			y: SCREEN.h / 2 + (y - game.pos.y) * TILE
		})
	} as DoctorWayRenderer;
}

const squirrel = (hp: number): AnimalInstance => ({ id: 'sq', speciesId: 'squirrel', hp });

function setup(start: SavedGame, renderer = camera()) {
	const authority = new LocalAuthority();
	const events: GameEvent[] = [];
	authority.subscribe((e) => {
		events.push(e);
		game.apply(e);
	});
	authority.start({ game: start });
	const way = new DoctorWay(renderer);
	way.overlay();
	return { authority, events, way };
}

/** The engine's own answer: the nearest tent the player could get to from where they stand. */
function nearestFromHere(): GridPos | null {
	const gear = gearOf({ items: game.items });
	return nearestTent(game.seed, game.pos, TENT_SEARCH_STEPS, game.edits, gear)?.tent ?? null;
}

afterEach(() => {
	battle.active = false;
	pause.open = false;
	doctor.reset();
	doctorWay.reset();
});

describe('the way to the doctor', () => {
	it('is there only while the team needs the doctor, and only over the explore screen', () => {
		const tired = setup({ ...newGame(1), party: [squirrel(0)] });
		// From the spawn the tent at (5, 7) is 7 steps away, on the screen: no arrow, but a way.
		expect(doctorWay.tent).toEqual({ x: 5, y: 7 });
		expect(doctorWay.arrow).toBeNull();
		// Anything over the world puts it away; back in the world it is there again.
		for (const over of ['battle', 'pause', 'doctor'] as const) {
			if (over === 'battle') battle.active = true;
			if (over === 'pause') pause.open = true;
			if (over === 'doctor') doctor.active = true;
			tired.way.overlay();
			expect(doctorWay.tent, over).toBeNull();
			battle.active = false;
			pause.open = false;
			doctor.active = false;
			tired.way.overlay();
			expect(doctorWay.tent, over).toEqual({ x: 5, y: 7 });
		}
		// A battle scene drawn instead of the world: nothing either.
		const scene = setup({ ...newGame(1), party: [squirrel(0)] }, camera(false));
		scene.way.overlay();
		expect(doctorWay.tent).toBeNull();
		// A team that can fight needs no way at all.
		setup({ ...newGame(1), party: [squirrel(3)] });
		expect(doctorWay.tent).toBeNull();
		expect(doctorWay.arrow).toBeNull();
	});

	it('leads to the engine’s nearest tent from wherever the player is: every step of a long walk, a go-to, a trip', () => {
		const s = setup({ ...newGame(1), party: [squirrel(0)] });
		const rng = new Rng(2027);
		const dirs = ['up', 'down', 'left', 'right'] as const;
		const bad: string[] = [];
		for (let n = 0; n < 400; n++) {
			s.authority.dispatch({ type: 'move', dir: rng.pick(dirs) });
			s.way.overlay();
			const want = nearestFromHere();
			if (JSON.stringify(doctorWay.tent) !== JSON.stringify(want)) {
				bad.push(`step ${n} at ${game.pos.x},${game.pos.y}: ${JSON.stringify(doctorWay.tent)}`);
			}
		}
		// Tired, nothing jumped out of the grass however the walk went.
		expect(s.events.some((e) => e.type === 'battle-started')).toBe(false);
		expect(bad.slice(0, 5)).toEqual([]);
		// Put somewhere without a step: beside a friend far off, then in another world.
		s.authority.dispatch({ type: 'go-to', near: { x: 150, y: -40 } });
		s.way.overlay();
		expect(doctorWay.tent).toEqual(nearestFromHere());
		expect(doctorWay.tent).not.toBeNull();
		s.authority.dispatch({ type: 'travel', world: 42 });
		s.way.overlay();
		expect(game.world).toBe(42);
		expect(doctorWay.tent).toEqual(nearestFromHere());
		expect(doctorWay.tent).not.toBeNull();
		// 3.9 s at a load average of 50 (400 steps, each looked for twice, the way's own
		// search and the engine's to check it, and a new world's spawn worked out).
	}, 30_000);

	it('an arrow while the tent is off the screen, at the edge, pointing at it; none once it is on the screen', () => {
		// Far from any tent on the screen: a spot of World 1 whose nearest tent is off it.
		const rng = new Rng(99);
		let start: SavedGame | null = null;
		for (let i = 0; i < 2000 && !start; i++) {
			const pos = { x: rng.int(-150, 150), y: rng.int(-150, 150) };
			const spot = nearestTent(WORLD_SEED, pos);
			if (!spot || spot.steps < 30) continue;
			start = { ...newGame(1), pos, party: [squirrel(0)] };
		}
		expect(start).not.toBeNull();
		const s = setup(start!);
		const tent = doctorWay.tent!;
		expect(tent).toEqual(nearestFromHere());
		const me = { x: SCREEN.w / 2, y: SCREEN.h / 2 };
		const there = {
			x: me.x + (tent.x - game.pos.x) * TILE,
			y: me.y + (tent.y - game.pos.y) * TILE
		};
		expect(doctorWay.arrow).toEqual(edgeSpot(me, there, SCREEN.w, SCREEN.h));
		// It points at the tent: the way from the middle to the arrow is the way to the tent.
		const arrow = doctorWay.arrow!;
		const cos =
			((arrow.x - me.x) * (there.x - me.x) + (arrow.y - me.y) * (there.y - me.y)) /
			(Math.hypot(arrow.x - me.x, arrow.y - me.y) * Math.hypot(there.x - me.x, there.y - me.y));
		expect(cos).toBeGreaterThan(0.999);
		expect(Math.sin(arrow.angle)).toBeCloseTo(
			(there.x - me.x) / Math.hypot(there.x - me.x, there.y - me.y),
			2
		);

		// Healed (a doctor, as far as the way is concerned): no way, no arrow.
		const fit = game.party.map((a) => ({ ...a, hp: getAnimal(a.speciesId).maxHp }));
		game.apply({ type: 'party-changed', party: fit });
		s.way.overlay();
		expect(doctorWay.arrow).toBeNull();
		expect(doctorWay.tent).toBeNull();
	});
});
