import { isWalkable, step, tileAtWorld, type Direction, type GridPos } from '@mathgame/engine';
import type * as THREE from 'three';
import { motion } from '../motion';
import { buildAnimalMesh, disposeFigure } from './animals';
import { appearScale, recallScale, smoothstep } from './ease';
import { groundTop } from './tiles';

/**
 * The lead animal walking one tile behind the trainer, as in the Game Boy
 * Color games' sequels ([[UI_SPEC]] § Explore mode). It is a view and nothing
 * more: it shows the party's lead and steps onto the tile the trainer just
 * left, so it never needs a rule of its own. It blocks nothing, meets
 * nothing, and the authority never hears of it.
 *
 * Where it stands: the trainer's last tile, which the trainer stood on, so
 * never water, rock, a tree or a tent. When the trainer is put somewhere
 * without walking (a new game, a game picked up, the trip to the tent after a
 * lost battle), it is put beside them at once — behind, else to a side, else
 * in front, on the first of those a trainer could stand on — and never walks
 * across the map. When the trainer steps back onto its tile, the two swap,
 * and it steps round the trainer rather than through them.
 *
 * Who it is: the lead, the first animal that isn't tired. When that changes
 * (a number key, the menu, a knock-out, the doctor, a catch), the one
 * following shrinks away and the new one grows in with a little bounce, the
 * battle's own recall and appearance. When every animal is tired, nobody
 * follows: the team rests until the doctor has seen one.
 */

/** What it asks of the renderer: a figure that stands in the world and idles there. */
export interface FigureHost {
	addFigure(figure: THREE.Group): void;
	removeFigure(figure: THREE.Group): void;
}

/** A figure's turn about y for each way it faces: figures face +z (grid "down") at rest. */
const ANGLE: Record<Direction, number> = {
	up: Math.PI,
	down: 0,
	left: -Math.PI / 2,
	right: Math.PI / 2
};
const BEHIND: Record<Direction, Direction> = {
	up: 'down',
	down: 'up',
	left: 'right',
	right: 'left'
};
const SIDES: Record<Direction, [Direction, Direction]> = {
	up: ['left', 'right'],
	down: ['right', 'left'],
	left: ['up', 'down'],
	right: ['down', 'up']
};

/** Seconds the one following takes to shrink away, and the new lead to grow in. */
export const SWAP_OUT_SECONDS = 0.2;
export const SWAP_IN_SECONDS = 0.35;
/** How high each species bounces on a step, in tiles: the small ones bound, the big ones plod. */
const HOP: Record<string, number> = {
	squirrel: 0.12,
	rabbit: 0.16,
	frog: 0.14,
	fox: 0.08,
	otter: 0.05,
	deer: 0.09,
	wolf: 0.07,
	bear: 0.04
};
/** How far it steps aside, in tiles, to pass the trainer when the two swap tiles. */
const DODGE = 0.38;
/** How fast it turns to face where it walks: most of the way in a tenth of a second. */
const TURN_RATE = 16;

export class Follower {
	/** The tile it stands on or walks to; null until it is placed beside the trainer. */
	private at: GridPos | null = null;
	/** The tile it walks from; the same as `at` once it arrives. */
	private from: GridPos | null = null;
	private facing: Direction = 'down';
	private yaw = 0;
	/** Which way it steps aside this step (a unit vector in x, z), when the trainer takes its tile. */
	private aside: { x: number; z: number } | null = null;
	private seed = 0;
	/** The lead's species: who should be following. Null when every animal is tired. */
	private wanted: string | null = null;
	private figure: THREE.Group | null = null;
	/** The species of the figure on screen. */
	private shown: string | null = null;
	/**
	 * A change of lead under way: the old one shrinking away (from the size it
	 * had, `from`), then the new one growing in.
	 */
	private swap: { phase: 'out' | 'in'; t: number; from: number } | null = null;

	constructor(private host: FigureHost) {}

	/** Where it stands (or is walking to), for tests and anything that asks. */
	get tile(): GridPos | null {
		return this.at;
	}

	/** The species on screen, or null when nobody follows. */
	get species(): string | null {
		return this.figure ? this.shown : null;
	}

	/** Which way it faces. */
	get direction(): Direction {
		return this.facing;
	}

	/**
	 * The trainer was put at `trainer` without walking, facing `facing`: stand
	 * beside them at once, on the first tile a trainer could stand on behind
	 * them, to a side, or in front. With none, it waits for the trainer's first step.
	 */
	place(seed: number, trainer: GridPos, facing: Direction): void {
		this.seed = seed;
		const order: Direction[] = [BEHIND[facing], ...SIDES[facing], facing];
		const spot = order.map((d) => step(trainer, d)).find((p) => this.standable(p)) ?? null;
		this.at = spot;
		this.from = spot;
		this.aside = null;
		this.facing = facing;
		this.yaw = ANGLE[facing];
	}

	/**
	 * The trainer starts a step from `from` to `to`: it walks onto `from`, the
	 * tile the trainer is leaving, as the trainer walks on.
	 */
	follow(from: GridPos, to: GridPos): void {
		const at = this.at;
		if (!at || !adjacent(at, from)) {
			// Not beside the trainer (nowhere to stand when it was placed): it turns up on
			// the tile the trainer leaves, which a trainer stood on.
			this.at = { ...from };
			this.from = { ...from };
			this.aside = null;
			this.facing = direction(from, to) ?? this.facing;
			this.yaw = ANGLE[this.facing];
			return;
		}
		this.from = { ...at };
		this.at = { ...from };
		this.facing = direction(at, from) ?? this.facing;
		// The trainer steps onto its tile: the two swap, and it steps round them,
		// on the camera's side, so neither walks through the other.
		const swapping = to.x === at.x && to.y === at.y;
		this.aside = swapping ? (from.x === at.x ? { x: 1, z: 0 } : { x: 0, z: 1 }) : null;
	}

	/** Who follows: the lead's species, or null when every animal is tired. */
	lead(speciesId: string | null): void {
		this.wanted = speciesId;
	}

	/**
	 * Draw it: `progress` is how far the trainer is through its step (1 when
	 * standing), which it keeps pace with; `dt` is seconds, for the swap and
	 * the turn.
	 */
	update(progress: number, dt: number): void {
		this.updateSwap(dt);
		const figure = this.figure;
		if (!figure || !this.at || !this.from) return;
		const walking = this.from.x !== this.at.x || this.from.y !== this.at.y;
		const p = walking ? Math.min(1, Math.max(0, progress)) : 1;
		const t = smoothstep(p);
		const x = this.from.x + (this.at.x - this.from.x) * t;
		const z = this.from.y + (this.at.y - this.from.y) * t;
		const yFrom = this.groundAt(this.from);
		const y = yFrom + (this.groundAt(this.at) - yFrom) * t;
		const lift = Math.sin(p * Math.PI);
		const hop = walking ? lift * (HOP[this.shown ?? ''] ?? 0.08) * (motion.reduced ? 0.35 : 1) : 0;
		const aside = this.aside && walking ? lift * DODGE : 0;
		figure.position.set(
			x + (this.aside?.x ?? 0) * aside,
			y + hop + this.swapLift(),
			z + (this.aside?.z ?? 0) * aside
		);
		// Turn towards where it walks, the short way round.
		const target = ANGLE[this.facing];
		let delta = target - this.yaw;
		delta = Math.atan2(Math.sin(delta), Math.cos(delta));
		this.yaw += delta * Math.min(1, dt * TURN_RATE);
		figure.rotation.y = this.yaw;
		figure.scale.setScalar(this.swapScale());
		// Arrived: it stands on its tile until the trainer's next step.
		if (walking && progress >= 1) {
			this.from = { ...this.at };
			this.aside = null;
		}
	}

	/** Quit to the title: the figure goes, and the next game places it again. */
	hide(): void {
		this.dropFigure();
		this.swap = null;
		this.wanted = null;
		this.at = null;
		this.from = null;
		this.aside = null;
	}

	/** Swap the figure when the lead changed: shrink the old one away, grow the new one in. */
	private updateSwap(dt: number): void {
		if (this.swap) this.swap.t += dt;
		const changed = this.shown !== this.wanted || (this.figure === null && this.wanted !== null);
		if (!this.swap) {
			if (!changed || !this.at) return;
			if (this.figure) this.swap = { phase: 'out', t: 0, from: 1 };
			else this.growIn();
			return;
		}
		if (this.swap.phase === 'in') {
			// A new lead while one was still growing in: it goes again at once, from the size it got to.
			if (this.shown !== this.wanted) this.swap = { phase: 'out', t: 0, from: this.swapScale() };
			else if (this.swap.t >= SWAP_IN_SECONDS) this.swap = null;
			return;
		}
		if (this.swap.t < SWAP_OUT_SECONDS) return;
		this.dropFigure();
		this.swap = null;
		if (this.wanted !== null && this.at) this.growIn();
	}

	private growIn(): void {
		if (this.wanted === null) return;
		const figure = buildAnimalMesh(this.wanted);
		figure.userData.idlePhase = 0.6;
		figure.scale.setScalar(0.001);
		this.figure = figure;
		this.shown = this.wanted;
		this.swap = { phase: 'in', t: 0, from: 0 };
		this.host.addFigure(figure);
	}

	private dropFigure(): void {
		if (!this.figure) return;
		this.host.removeFigure(this.figure);
		disposeFigure(this.figure);
		this.figure = null;
		this.shown = null;
	}

	private swapScale(): number {
		if (!this.swap) return 1;
		return this.swap.phase === 'out'
			? this.swap.from * recallScale(this.swap.t / SWAP_OUT_SECONDS)
			: appearScale(this.swap.t / SWAP_IN_SECONDS);
	}

	/** Going away, it rises a little as it shrinks, as a battle's recall does. */
	private swapLift(): number {
		if (this.swap?.phase !== 'out') return 0;
		return Math.sin(Math.min(1, this.swap.t / SWAP_OUT_SECONDS) * Math.PI) * 0.15;
	}

	private standable(p: GridPos): boolean {
		return isWalkable(tileAtWorld(this.seed, p.x, p.y).kind);
	}

	private groundAt(p: GridPos): number {
		return groundTop(tileAtWorld(this.seed, p.x, p.y));
	}
}

function adjacent(a: GridPos, b: GridPos): boolean {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

/** The way from one tile to the next, or null when they are not neighbours. */
function direction(from: GridPos, to: GridPos): Direction | null {
	if (to.x === from.x + 1 && to.y === from.y) return 'right';
	if (to.x === from.x - 1 && to.y === from.y) return 'left';
	if (to.y === from.y + 1 && to.x === from.x) return 'down';
	if (to.y === from.y - 1 && to.x === from.x) return 'up';
	return null;
}
