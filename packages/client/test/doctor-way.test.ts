import {
	Rng,
	gearOf,
	getAnimal,
	isWalkable,
	nearestTent,
	newGame,
	tileAtWorld,
	type AnimalInstance,
	type GameEvent,
	type GridPos,
	type SavedGame
} from '@mathgame/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalAuthority, WORLD_SEED } from '../src/authority/local';
import { t } from '../src/copy';
import {
	ARROW_REACH,
	DOCTOR_WAY_STEPS,
	DoctorWay,
	TENT_CLEARANCE,
	type DoctorWayRenderer
} from '../src/explore/doctor-way';
import { edgeSpot } from '../src/presence/controller';
import type { Rect } from '../src/presence/labels';
import { battle } from '../src/state/battle.svelte';
import { doctor } from '../src/state/doctor.svelte';
import { doctorWay } from '../src/state/doctor-way.svelte';
import { game } from '../src/state/game.svelte';
import { hud } from '../src/state/hud.svelte';
import { pause } from '../src/state/pause.svelte';
import { testStarter } from './minted';

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

function setup(start: SavedGame, renderer = camera(), hud: readonly Rect[] = []) {
	const authority = new LocalAuthority();
	const events: GameEvent[] = [];
	authority.subscribe((e) => {
		events.push(e);
		game.apply(e);
	});
	authority.start({ game: start });
	const way = new DoctorWay(renderer, () => hud);
	way.overlay();
	return { authority, events, way };
}

/** The engine's own answer: the nearest tent the player could get to from where they stand. */
function nearestFromHere(): GridPos | null {
	const gear = gearOf({ items: game.items });
	return nearestTent(game.seed, game.pos, DOCTOR_WAY_STEPS, game.edits, gear)?.tent ?? null;
}

afterEach(() => {
	battle.active = false;
	pause.open = false;
	doctor.reset();
	doctorWay.reset();
});

describe('the way to the doctor', () => {
	it('is there only while the team needs the doctor, and only over the explore screen', () => {
		const tired = setup({ ...newGame(1, testStarter()), party: [squirrel(0)] });
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
		const scene = setup({ ...newGame(1, testStarter()), party: [squirrel(0)] }, camera(false));
		scene.way.overlay();
		expect(doctorWay.tent).toBeNull();
		// A team that can fight needs no way at all.
		setup({ ...newGame(1, testStarter()), party: [squirrel(3)] });
		expect(doctorWay.tent).toBeNull();
		expect(doctorWay.arrow).toBeNull();
		// Nor does no team at all: a first arrival in a land waits for its starter there.
		setup({ ...newGame(1, testStarter()), land: 'arctic', pos: { x: 5, y: 9 }, party: [] });
		expect(game.party).toEqual([]);
		expect(doctorWay.tent).toBeNull();
		expect(doctorWay.arrow).toBeNull();
	});

	it('leads to the engine’s nearest tent from wherever the player is: every step of a long walk, a go-to, a trip', () => {
		const s = setup({ ...newGame(1, testStarter()), party: [squirrel(0)] });
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

	it('up on the glider it keeps the tent found where the kid took off, over the lake too, and looks again once they are down', () => {
		// From the start of World 1, facing up over the lake: its far shore 14 tiles up.
		const s = setup({
			...newGame(1, testStarter()),
			party: [squirrel(0)],
			items: ['glider'],
			pos: { x: -2, y: 6 },
			facing: 'up'
		});
		expect(doctorWay.tent).toEqual({ x: 5, y: 7 });
		s.authority.dispatch({ type: 'take-off' });
		let overWater = 0;
		for (let flown = 1; flown <= 12; flown++) {
			s.authority.dispatch({ type: 'glide' });
			s.way.overlay();
			expect(game.flying).toBe(true);
			if (tileAtWorld(WORLD_SEED, game.pos.x, game.pos.y).kind === 'deepwater') overWater++;
			// No walk begins in the middle of the lake: the way holds the tent it had.
			expect(doctorWay.tent, `flown ${flown}`).toEqual({ x: 5, y: 7 });
		}
		expect(overWater).toBeGreaterThan(3);
		s.authority.dispatch({ type: 'land' });
		s.way.overlay();
		expect(game.flying).toBe(false);
		expect(doctorWay.tent).toEqual(nearestFromHere());
		expect(doctorWay.tent).not.toBeNull();

		// Taken off where no tent is walked to from (a grass tile walled in by trees): nothing
		// up in the air either, however near a tent the ground under the glider is, until down.
		const pocket = { x: -2, y: 32 };
		const out = setup({
			...newGame(1, testStarter()),
			party: [squirrel(0)],
			items: ['glider'],
			pos: pocket,
			facing: 'up'
		});
		expect(doctorWay.tent).toBeNull();
		out.authority.dispatch({ type: 'take-off' });
		for (let flown = 1; flown <= 6; flown++) {
			out.authority.dispatch({ type: 'glide' });
			out.way.overlay();
			expect(doctorWay.tent, `flown ${flown}`).toBeNull();
		}
		out.authority.dispatch({ type: 'land' });
		out.way.overlay();
		expect(doctorWay.tent).toEqual(nearestFromHere());
		expect(doctorWay.tent).not.toBeNull();
	});

	it('an arrow while the tent is off the screen, at the edge, pointing at it; none once it is on the screen', () => {
		// Far from any tent on the screen: a spot of World 1 whose nearest tent is off it, as the
		// stand-in camera draws it (13 tiles or more across, 10 or more up or down).
		const rng = new Rng(99);
		let start: SavedGame | null = null;
		for (let i = 0; i < 4000 && !start; i++) {
			const pos = { x: rng.int(-150, 150), y: rng.int(-150, 150) };
			const spot = nearestTent(WORLD_SEED, pos);
			if (!spot || spot.steps < 30) continue;
			if (Math.abs(spot.tent.x - pos.x) < 13 && Math.abs(spot.tent.y - pos.y) < 10) continue;
			start = { ...newGame(1, testStarter()), pos, party: [squirrel(0)] };
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

	/** A tired game on walkable ground whose nearest tent is `dx` across and `dy` down from it. */
	function besideTent(dx: number, dy: number): SavedGame {
		// The tents' lattice runs every 23 columns and 19 rows through (5, 7).
		for (let tx = 5 - 23 * 4; tx <= 5 + 23 * 4; tx += 23)
			for (let ty = 7 - 19 * 4; ty <= 7 + 19 * 4; ty += 19) {
				if (tileAtWorld(WORLD_SEED, tx, ty).kind !== 'tent') continue;
				const pos = { x: tx - dx, y: ty - dy };
				if (!isWalkable(tileAtWorld(WORLD_SEED, pos.x, pos.y).kind)) continue;
				const spot = nearestTent(WORLD_SEED, pos);
				if (spot?.tent.x !== tx || spot.tent.y !== ty) continue;
				return { ...newGame(1, testStarter()), pos, party: [squirrel(0)] };
			}
		throw new Error(`no tent ${dx} across and ${dy} down from walkable ground`);
	}

	it('a tent in the strip at the edge, half off the screen or behind the message line, has its arrow a little way before it, never on it', () => {
		const me = { x: SCREEN.w / 2, y: SCREEN.h / 2 };
		// 12 tiles across: 480 px right of the middle, past where an arrow sits (44 px in from
		// the right edge); 8 down: 320 px below it, behind the message line (96 px from the bottom).
		for (const [dx, dy] of [
			[12, 0],
			[12, 1],
			[-12, 0],
			[0, 8],
			[1, 8]
		] as const) {
			setup(besideTent(dx, dy));
			const there = { x: me.x + dx * TILE, y: me.y + dy * TILE };
			const arrow = doctorWay.arrow;
			expect(arrow, `${dx}, ${dy}`).not.toBeNull();
			// Never on the tent: its whole disc and tip keep clear of the tent's ground.
			expect(Math.hypot(there.x - arrow!.x, there.y - arrow!.y)).toBeGreaterThanOrEqual(
				TENT_CLEARANCE - 1
			);
			// And it points at it, from where a friend's arrow would sit or nearer the middle.
			const spot = edgeSpot(me, there, SCREEN.w, SCREEN.h)!;
			expect(arrow!.angle).toBe(spot.angle);
			expect(Math.hypot(arrow!.x - me.x, arrow!.y - me.y)).toBeLessThanOrEqual(
				Math.hypot(spot.x - me.x, spot.y - me.y)
			);
		}
		// 11 across is inside the frame the arrows keep to: in plain sight, no arrow.
		setup(besideTent(11, 0));
		expect(doctorWay.tent).not.toBeNull();
		expect(doctorWay.arrow).toBeNull();
	});

	it('walled in where no tent is a walk away, with the paraglider: no way, and the line says to fly out', () => {
		// No druid comes to a kid who can fly, so the line must not send them walking.
		setup({
			...newGame(1, testStarter()),
			party: [squirrel(0)],
			items: ['glider'],
			pos: { x: -2, y: 32 },
			facing: 'up'
		});
		expect(doctorWay.tent).toBeNull();
		expect(doctorWay.noWay).toBe(true);
		expect(hud.hint).toBe(t('explore.tiredFly'));
		// A walk from a tent, the glider or not: the walk's line.
		setup({ ...newGame(1, testStarter()), party: [squirrel(0)], items: ['glider'] });
		expect(doctorWay.noWay).toBe(false);
		expect(hud.hint).toBe(t('explore.tired'));
	});

	/** How far `p` is from the box `r`, in CSS pixels: 0 inside it. */
	function distance(p: { x: number; y: number }, r: Rect): number {
		return Math.hypot(Math.max(r.x0 - p.x, 0, p.x - r.x1), Math.max(r.y0 - p.y, 0, p.y - r.y1));
	}

	it('never goes under the HUD: back along its line until nothing there covers it, pointing the same way; a tent under the HUD keeps its arrow', () => {
		const me = { x: SCREEN.w / 2, y: SCREEN.h / 2 };
		// As a tablet held sideways lays them out at 1024 × 768: the message line of two lines
		// (the closing line over "Your animals are tired…"), the D-pad and the team's cards.
		const hud: Rect[] = [
			{ x0: 288, y0: 690, x1: 736, y1: 752 },
			{ x0: 20, y0: 556, x1: 212, y1: 748 },
			{ x0: 16, y0: 16, x1: 276, y1: 180 }
		];
		let moved = 0;
		// Tents below the screen (11 down), past its bottom-left corner, and past its bottom-right.
		for (const [dx, dy] of [
			[0, 11],
			[2, 11],
			[-2, 11],
			[-9, 8],
			[-12, 8],
			[-12, 6],
			[12, 8]
		] as const) {
			const at = `${dx}, ${dy}`;
			// Where it stands with nothing over the world...
			setup(besideTent(dx, dy));
			const bare = doctorWay.arrow;
			expect(bare, at).not.toBeNull();
			// ...and with the HUD: never within reach of any of it,
			setup(besideTent(dx, dy), camera(), hud);
			const arrow = doctorWay.arrow;
			expect(arrow, at).not.toBeNull();
			for (const r of hud) expect(distance(arrow!, r), at).toBeGreaterThanOrEqual(ARROW_REACH);
			// on the same line from the player, no further out, pointing the same way.
			expect(arrow!.angle, at).toBe(bare!.angle);
			const out = Math.hypot(arrow!.x - me.x, arrow!.y - me.y);
			const cos =
				((arrow!.x - me.x) * (bare!.x - me.x) + (arrow!.y - me.y) * (bare!.y - me.y)) /
				(out * Math.hypot(bare!.x - me.x, bare!.y - me.y));
			expect(cos, at).toBeGreaterThan(0.999);
			expect(out, at).toBeLessThanOrEqual(Math.hypot(bare!.x - me.x, bare!.y - me.y));
			if (arrow!.x !== bare!.x || arrow!.y !== bare!.y) moved++;
		}
		// Up from the message line, and in from the D-pad; past the bottom-right, nothing there.
		expect(moved).toBe(6);
		// 11 across on the left is in plain sight but for the team's cards over it: it keeps its
		// arrow, clear of the cards, pointing at it.
		const column: Rect = { x0: 16, y0: 16, x1: 276, y1: 500 };
		setup(besideTent(-11, 0), camera(), [column]);
		expect(doctorWay.arrow).not.toBeNull();
		expect(distance(doctorWay.arrow!, column)).toBeGreaterThanOrEqual(ARROW_REACH);
		expect(doctorWay.arrow!.x).toBeLessThan(me.x);
		// With nothing over it, none.
		setup(besideTent(-11, 0));
		expect(doctorWay.arrow).toBeNull();
	});
});
