import { tileAtWorld, type GameEvent } from '@mathgame/engine';
import { sfx } from '../audio/sfx.svelte';
import { motion } from '../motion';
import type { GameRenderer } from '../render/renderer';
import {
	CALM_PLANE_SECONDS,
	PLANE_BOARD_SECONDS,
	PLANE_IN_SECONDS,
	PLANE_OUT_SECONDS,
	planeGroundOf,
	planeSpot,
	type PlaneGround,
	type PlanePose
} from '../render/plane';
import { game } from '../state/game.svelte';
import { plane, type PlanePhase } from '../state/plane.svelte';

/** Seconds each part of a flight takes on screen (`render/plane.ts` has the numbers). */
export const PLANE_SECONDS: Readonly<Record<PlanePhase, number>> = {
	landing: PLANE_IN_SECONDS,
	boarding: PLANE_BOARD_SECONDS,
	leaving: PLANE_OUT_SECONDS,
	arriving: PLANE_IN_SECONDS,
	alighting: PLANE_BOARD_SECONDS,
	departing: PLANE_OUT_SECONDS
};

const NEXT: Readonly<Record<PlanePhase, PlanePhase | null>> = {
	landing: 'boarding',
	boarding: 'leaving',
	leaving: 'arriving',
	arriving: 'alighting',
	alighting: 'departing',
	departing: null
};

/** Where the plane is on its way, and how far the kid is into it, in each part of a flight. */
function poseOf(phase: PlanePhase, p: number): { pose: PlanePose; ride: number } {
	switch (phase) {
		case 'landing':
			return { pose: { way: 'in', p }, ride: 0 };
		case 'boarding':
			return { pose: { way: 'parked', p }, ride: p };
		case 'leaving':
			return { pose: { way: 'out', p }, ride: 1 };
		case 'arriving':
			return { pose: { way: 'in', p }, ride: 1 };
		case 'alighting':
			return { pose: { way: 'parked', p }, ride: 1 - p };
		case 'departing':
			return { pose: { way: 'out', p }, ride: 0 };
	}
}

/**
 * A flight to another land, as the screen plays it ([[UI_SPEC]] § Explore
 * mode, "The plane"; #191): a plane lands beside the kid, the kid gets on,
 * it flies off screen, the land changes, it flies in and lands at the tent
 * the flight comes down at, the kid gets off, and it takes off.
 *
 * The authority has flown the kid already when the show begins: the fare's
 * right answer moves the game to the land reached at once (`travelled`, then
 * the land's party and belongings, and `starter-wanted` on a first arrival),
 * and the autosave writes that game straight away, so a save is never "in
 * the plane" and a reload mid-flight comes back beside the tent reached. The
 * screen holds those events back (`intercept`) while the plane comes and
 * goes in the land left, so the world, the HUD and presence change only once
 * it is off screen (`deliver` hands them on then). No key does anything
 * until the kid is off the plane, and presence says `plane` meanwhile.
 */
export class PlaneController {
	/** The events held back while the plane is in the land left, in order. */
	private held: GameEvent[] = [];
	/** Where the plane parks this time, in grid units, and the way its nose points. */
	private spot: ReturnType<typeof planeSpot> | null = null;

	constructor(
		private readonly renderer: Pick<GameRenderer, 'setPlane'>,
		/** Hand an event held back to every screen (all but the autosave, which had it). */
		private readonly deliver: (event: GameEvent) => void
	) {}

	/**
	 * Whether `event` waits for the plane: a flight to another land starts
	 * the show and waits, and so does everything after it until the plane is
	 * off screen. Everything else goes on as ever.
	 */
	intercept(event: GameEvent): boolean {
		const show = plane.show;
		if (
			show &&
			(show.phase === 'landing' || show.phase === 'boarding' || show.phase === 'leaving')
		) {
			this.held.push(event);
			return true;
		}
		if (
			event.type === 'travelled' &&
			event.playerId === game.playerId &&
			event.land !== game.land &&
			game.mode === 'explore'
		) {
			this.held = [event];
			this.spot = planeSpot(game.pos, game.facing, groundAt(game.seed));
			plane.show = { phase: 'landing', p: 0, calm: motion.reduced };
			sfx.play('plane');
			this.draw();
			return true;
		}
		// A game picked up or left mid-show (nothing the kid can do then, but a page can): no plane.
		if (event.type === 'welcome' || event.type === 'game-left') this.stop();
		return false;
	}

	update(dt: number): void {
		const show = plane.show;
		if (!show) return;
		const seconds = show.calm ? CALM_PLANE_SECONDS : PLANE_SECONDS[show.phase];
		const p = Math.min(1, show.p + dt / seconds);
		if (p < 1) {
			plane.show = { ...show, p };
			this.draw();
			return;
		}
		const next = NEXT[show.phase];
		if (next === null) {
			this.stop();
			return;
		}
		if (show.phase === 'leaving') {
			// Off screen: the land changes under it, and it comes in to the tent reached.
			const held = this.held;
			this.held = [];
			plane.show = { ...show, phase: next, p: 0 };
			for (const event of held) this.deliver(event);
			this.spot = planeSpot(game.pos, game.facing, groundAt(game.seed));
			sfx.play('plane');
		} else {
			plane.show = { ...show, phase: next, p: 0 };
			if (next === 'departing') sfx.play('plane');
		}
		this.draw();
	}

	/** No plane: anything held goes on at once. */
	private stop(): void {
		const held = this.held;
		this.held = [];
		plane.reset();
		this.spot = null;
		this.renderer.setPlane(null);
		for (const event of held) this.deliver(event);
	}

	private draw(): void {
		const show = plane.show;
		const spot = this.spot;
		if (!show || !spot) return;
		const { pose, ride } = poseOf(show.phase, show.p);
		this.renderer.setPlane({
			at: { x: spot.x, y: spot.z },
			heading: spot.heading,
			water: spot.water,
			pose,
			ride
		});
	}
}

/**
 * What a tile of the world of `seed`, as it was made, is to a plane parking
 * on it (`planeGroundOf`).
 */
function groundAt(seed: number): (x: number, y: number) => PlaneGround {
	return (x, y) => planeGroundOf(tileAtWorld(seed, x, y));
}
