import { needsDoctor, type AnimalInstance, type GridPos, type Realm } from '@mathgame/engine';

/**
 * The way to a doctor while the team needs one ([[UI_SPEC]] § Explore mode,
 * "The way to the doctor"): the nearest tent, and the arrow at the edge of
 * the screen that points to it until it is in plain sight. Written only by
 * `DoctorWay` (`explore/doctor-way.ts`), every frame the world is drawn.
 */

/**
 * The arrow at the edge of the screen: where it sits (CSS pixels) and which
 * way it points (radians, clockwise from up on the screen), on the track
 * a friend's arrow rides (`presence/edges.ts`).
 */
export interface DoctorArrow {
	x: number;
	y: number;
	angle: number;
}

/**
 * Whether the team needs a doctor's tent where the player is (`needsDoctor`),
 * as the screen says it: the line under the message and the arrow. A team of
 * no animal at all is waiting for its starter on a first arrival in a land
 * ([[PRODUCT]] §4 "Lands"), not tired: it is sent to no tent.
 */
export function needsTent(party: readonly AnimalInstance[], realm: Realm): boolean {
	return party.length > 0 && needsDoctor(party, realm);
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
	/**
	 * The team needs the doctor and no tent is a walk (or a sail) away from
	 * where the player stood when the way last looked: walled in, where a kid
	 * with the paraglider flies out (no doctor comes to them). Kept while the
	 * explore screen is away, so the line under the message is right the
	 * moment it is back.
	 */
	noWay = $state(false);

	reset(): void {
		this.tent = null;
		this.arrow = null;
		this.noWay = false;
	}
}

export const doctorWay = new DoctorWayView();
