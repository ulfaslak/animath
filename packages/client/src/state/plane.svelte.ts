/**
 * The plane between lands as the screen plays it ([[UI_SPEC]] § Explore
 * mode, "The plane"). Written only by `PlaneController`; the renderer draws
 * it, presence says it (`busy: 'plane'`) and no key does anything while the
 * kid is with it.
 *
 * `phase`, in order: `landing` (the plane comes down beside the kid),
 * `boarding` (the kid gets on), `leaving` (it flies off screen with them),
 * then the land changes under it, `arriving` (it flies in and lands at the
 * tent of the land reached), `alighting` (the kid gets off) and
 * `departing` (it takes off and flies away; the kid is free to go). `p` is
 * how far along the phase is, 0..1. Null when there is no plane.
 */
export type PlanePhase =
	'landing' | 'boarding' | 'leaving' | 'arriving' | 'alighting' | 'departing';

export interface PlaneShow {
	phase: PlanePhase;
	p: number;
	/** Reduced motion: the plane fades in and out where it stands instead of flying. */
	calm: boolean;
}

class PlaneView {
	show = $state<PlaneShow | null>(null);

	/**
	 * The kid is with the plane, from its landing beside them to their getting
	 * off in the land reached: no key does anything. (The others see them busy
	 * with it until it has gone: `active`.)
	 */
	get busy(): boolean {
		const phase = this.show?.phase;
		return phase !== undefined && phase !== 'departing';
	}

	/** The plane is on screen at all, its take-off at the end included. */
	get active(): boolean {
		return this.show !== null;
	}

	reset(): void {
		this.show = null;
	}
}

export const plane = new PlaneView();
