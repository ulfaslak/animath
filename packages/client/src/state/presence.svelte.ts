import type { Busy, RosterEntry } from '@mathgame/engine';
import type { PresenceStatus } from '../presence/connection';
import type { Note } from '../presence/notes';

/**
 * What the page shows of the other players, written only by
 * `PresenceController` (`presence/controller.ts`): the pause menu's list of
 * who is here, the names over the heads of the players on screen with what
 * they are busy with, the arrows at the edge of the screen for those off it,
 * and the note at the top of the screen.
 */

/** A name over a player on screen, where it goes on the canvas (CSS pixels), and how faded in. */
export interface Label {
	pid: string;
	name: string;
	busy: Busy;
	x: number;
	y: number;
	opacity: number;
}

/**
 * An arrow at the edge of the screen for a player off it: where it sits
 * (CSS pixels), which way it points (radians, clockwise from up on the
 * screen), and whose it is.
 */
export interface Arrow {
	pid: string;
	name: string;
	x: number;
	y: number;
	angle: number;
}

class PresenceView {
	/** How the socket is doing ([[UI_SPEC]]: the list says so when it isn't on). */
	status = $state<PresenceStatus>('off');
	/** Everyone else in the player's world, nearest first: the pause menu's list. */
	roster = $state.raw<RosterEntry[]>([]);
	/** The names over the players on screen. */
	labels = $state.raw<Label[]>([]);
	/** The arrows for the players off screen, the nearest few. */
	arrows = $state.raw<Arrow[]>([]);
	/** The note at the top of the screen, or null. */
	note = $state.raw<Note | null>(null);
	/**
	 * Which way each of a roster's bearings points on the screen (radians,
	 * clockwise from up), for the list's little arrows: the camera never
	 * turns, so this is measured once.
	 */
	compass = $state.raw<number[]>([]);

	reset(): void {
		this.status = 'off';
		this.roster = [];
		this.labels = [];
		this.arrows = [];
		this.note = null;
	}
}

export const presence = new PresenceView();
