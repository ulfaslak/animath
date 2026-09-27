/**
 * A trip to another world as the screen plays it ([[UI_SPEC]] § Explore
 * mode, "Travelling"). Written only by `TravelController`; `Travel.svelte`
 * draws it.
 *
 * `cover`: the world closing into a circle of sky round the trainer, then
 * (the world changed under it) opening on the new one; with reduced motion
 * the sky fades in and out instead. While it is up nothing takes a key.
 * `banner`: the world's number, big, as the kid arrives, and a line for how
 * (a first visit, back where they left off, home), for `BANNER_SECONDS`.
 */
export interface TravelCover {
	/** Closing onto the trainer, or opening on the new world. */
	closing: boolean;
	/** How far along the phase is, 0..1. */
	p: number;
	/** The circle's centre on screen, in CSS pixels: the trainer. */
	x: number;
	y: number;
	/** A fade instead of a circle: the system asks for less motion. */
	calm: boolean;
}

export type Arrival = 'new' | 'back' | 'home';

export interface TravelBanner {
	world: number;
	arrival: Arrival;
	/** Seconds it has been up. */
	age: number;
	calm: boolean;
}

class TravelView {
	cover = $state<TravelCover | null>(null);
	banner = $state<TravelBanner | null>(null);

	/** The cover is up: the world is changing, and no key does anything. */
	get active(): boolean {
		return this.cover !== null;
	}

	reset(): void {
		this.cover = null;
		this.banner = null;
	}
}

export const travel = new TravelView();
