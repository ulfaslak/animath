import type { GridPos } from '@mathgame/engine';

/**
 * The way to a doctor while the team needs one ([[UI_SPEC]] § Explore mode,
 * "The way to the doctor"): the nearest tent, and the arrow at the edge of
 * the screen that points to it until it is in plain sight. Written only by
 * `DoctorWay` (`explore/doctor-way.ts`), every frame the world is drawn.
 */

/**
 * The arrow at the edge of the screen: where it sits (CSS pixels) and which
 * way it points (radians, clockwise from up on the screen), as a friend's
 * arrow does (`edgeSpot`).
 */
export interface DoctorArrow {
	x: number;
	y: number;
	angle: number;
}

class DoctorWayView {
	/**
	 * The tent the way leads to: the nearest one the player could walk (or
	 * sail) to, the engine's `nearestTent`, while the team needs the doctor;
	 * else null, and null too when none is within reach.
	 */
	tent = $state.raw<GridPos | null>(null);
	/** The arrow to that tent until it is in plain sight, over the explore screen only; else null. */
	arrow = $state.raw<DoctorArrow | null>(null);

	reset(): void {
		this.tent = null;
		this.arrow = null;
	}
}

export const doctorWay = new DoctorWayView();
