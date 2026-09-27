import type { AttackLevel, Busy, RosterEntry } from '@mathgame/engine';
import type { PresenceStatus } from '../presence/connection';
import type { Note } from '../presence/notes';

/**
 * What the page shows of the other players, written only by
 * `PresenceController` (`presence/controller.ts`): the pause menu's list of
 * who is here, the names over the heads of the players on screen with what
 * they are busy with (a thought bubble while they think in a battle), the
 * HP bars and damage numbers of their battles, the arrows at the edge of the
 * screen for those off it, and the note at the top of the screen.
 */

/** A name over a player on screen, where it goes on the canvas (CSS pixels), and how faded in. */
export interface Label {
	pid: string;
	name: string;
	busy: Busy;
	x: number;
	y: number;
	opacity: number;
	/** Their thought bubble while they think in a battle, drawn over their name instead of the busy sign; else null. */
	thought: Thought | null;
}

/**
 * A thought bubble over a player in a battle: the sum they are working out,
 * as the engine writes it (null while they choose what to do), and how their
 * last answer went while its pop (right) or wobble (wrong) plays; `beat`
 * counts the answers, so each one plays anew.
 */
export interface Thought {
	sum: string | null;
	mood: 'right' | 'wrong' | null;
	beat: number;
}

/** A small HP bar over an animal in someone's battle: whose it is, its HP, and where it goes. */
export interface Bar {
	key: string;
	species: string;
	nickname: string | null;
	hp: number;
	maxHp: number;
	x: number;
	y: number;
	opacity: number;
}

/** A damage number floating up from an animal hit in someone's battle, from where it was hit. */
export interface Pop {
	id: number;
	damage: number;
	level: AttackLevel;
	x: number;
	y: number;
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
	/** The HP bars over the animals in the battles on screen. */
	bars = $state.raw<Bar[]>([]);
	/** The damage numbers floating up in the battles on screen. */
	pops = $state.raw<Pop[]>([]);
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
		this.bars = [];
		this.pops = [];
		this.note = null;
	}
}

export const presence = new PresenceView();
