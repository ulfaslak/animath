import {
	WorldEdits,
	editedTileAt,
	getAnimal,
	isWalkable,
	isWater,
	step,
	tileAtWorld,
	type Direction,
	type GridPos
} from '@mathgame/engine';
import * as THREE from 'three';
import { motion } from '../motion';
import { buildAnimalMesh, disposeFigure } from './animals';
import { BOAT_DECK, BOAT_STAND } from './boat';
import { appearScale, recallScale, smoothstep } from './ease';
import { WATER_TOP, groundTop } from './tiles';

/**
 * The lead animal walking one tile behind the trainer, as in the Game Boy
 * Color games' sequels ([[UI_SPEC]] § Explore mode). It is a view and nothing
 * more: it shows the party's lead and steps onto the tile the trainer just
 * left, so it never needs a rule of its own. It blocks nothing, meets
 * nothing, and the authority never hears of it.
 *
 * Where it stands: the trainer's last tile, which the trainer stood on, so
 * never rock, a tree or a tent (a stump where the trainer chopped a tree down
 * is ground, and it follows through). Out on the water, in the boat, the
 * trainer's last tile is water: an animal that swims swims behind the boat,
 * low in the water, and one that can't swim never stands there — it rides in
 * the boat instead, standing on its deck at the bow facing forward, a big one
 * made smaller to fit (`lead(…, riding)`), turning with the boat when the
 * trainer bumps into something (`face`), and whoever comes out on a tile comes out beside
 * the trainer. When the trainer is put somewhere without walking (a new game,
 * a game picked up, the trip to the tent after a lost battle), it is put
 * beside them at once — behind, else to a side, else in front, on the first
 * of those it could stand on, in the trainer's realm first (the water behind
 * the boat, the ground beside a trainer on land) — and never walks across the
 * map. When the trainer steps back onto its tile, the two swap, and it steps
 * round the trainer rather than through them.
 *
 * Who it is: the lead, the first animal that isn't tired (out on the water,
 * the first one that swims; with none standing, the lead on land rides in the
 * boat). When that changes (a number key, the menu, a knock-out, the doctor,
 * a catch, the trainer stepping onto the water or back onto land, or into the
 * boat), the one following shrinks away and the new one grows in with a
 * little bounce, the battle's own recall and appearance (with reduced motion,
 * as there: a lower rise and no bounce). When every animal is tired, nobody
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
/** A unit step for each way the trainer faces, in world x and z. */
const AHEAD: Record<Direction, { x: number; z: number }> = {
	up: { x: 0, z: -1 },
	down: { x: 0, z: 1 },
	left: { x: -1, z: 0 },
	right: { x: 1, z: 0 }
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
	bear: 0.04,
	// The wood mouse jumps like a tiny kangaroo and the toad hops like the frog; the robin
	// hops a little less. Every other animal keeps the 0.08 default.
	'wood-mouse': 0.16,
	'common-toad': 0.14,
	robin: 0.1
};
/** How far it steps aside, in tiles, to pass the trainer when the two swap tiles. */
const DODGE = 0.38;
/** How fast it turns to face where it walks: most of the way in a tenth of a second. */
const TURN_RATE = 16;
/** Swimming, how much of its height is under the water. */
export const SWIM_DEPTH = 0.4;
/**
 * Riding in the boat, standing on its little deck at the bow (`BOAT_DECK`):
 * how far its middle sits ahead of the middle of the boat, whose trainer
 * stands back towards the stern (`BOAT_ASTERN`), and how long (nose to tail,
 * or across) and how tall it may be. Nose to tail it stays between the
 * trainer and the bow, inside its own tile, so it never reaches into a shore
 * the boat faces. A small animal rides near its own size, a big one made
 * smaller, all big enough to know.
 */
export const RIDE_AHEAD = 0.22;
export const RIDE_LENGTH = 0.5;
export const RIDE_HEIGHT = 0.6;

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
	/** The trainer's step: from, to, and which way they face; where a rider sits, and where to put it down. */
	private trainerFrom: GridPos | null = null;
	private trainerTo: GridPos | null = null;
	private trainerFacing: Direction = 'down';
	/** The tiles the player has cleared: ground to stand on. */
	private edits = WorldEdits.none;
	/** The lead's species: who should be following. Null when every animal is tired. */
	private wanted: string | null = null;
	/** Whether the lead should ride in the boat rather than follow on foot or swimming. */
	private wantRide = false;
	private figure: THREE.Group | null = null;
	/** The species of the figure on screen, and whether it rides. */
	private shown: string | null = null;
	private riding = false;
	/** A rider's size, to fit in the boat, and at its own size how far forward of its origin its middle is, nose to tail. */
	private rideScale = 1;
	private rideMiddle = 0;
	/** Seconds of frame time, for the swimmers' bob. */
	private t = 0;
	/**
	 * A change of lead under way: the old one shrinking away (from the size it
	 * had, `from`), then the new one growing in.
	 */
	private swap: { phase: 'out' | 'in'; t: number; from: number } | null = null;

	constructor(private host: FigureHost) {}

	/** Where it stands (or is walking to), for tests and anything that asks; null while riding. */
	get tile(): GridPos | null {
		return this.riding ? null : this.at;
	}

	/** The species on screen, or null when nobody follows. */
	get species(): string | null {
		return this.figure ? this.shown : null;
	}

	/** Whether the one on screen rides in the boat. */
	get inBoat(): boolean {
		return this.figure !== null && this.riding;
	}

	/** Which way it faces. */
	get direction(): Direction {
		return this.facing;
	}

	/**
	 * The trainer was put at `trainer` without walking, facing `facing`: stand
	 * beside them at once, on the first tile it could stand on behind them, to
	 * a side, or in front, in the world as `edits` leave it (`spotBeside`).
	 * With none, it waits for the trainer's first step. With nobody on screen
	 * yet (a game picked up), the lead picks its spot as it comes out
	 * (`growIn`): where an otter goes is not where a squirrel would.
	 */
	place(
		seed: number,
		trainer: GridPos,
		facing: Direction,
		edits: WorldEdits = WorldEdits.none
	): void {
		this.seed = seed;
		this.edits = edits;
		this.trainerFrom = { ...trainer };
		this.trainerTo = { ...trainer };
		this.trainerFacing = facing;
		const spot = this.shown === null ? null : this.spotBeside(this.shown);
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
		this.trainerFrom = { ...from };
		this.trainerTo = { ...to };
		this.trainerFacing = direction(from, to) ?? this.trainerFacing;
		// One that can't go where the trainer leaves (the land lead, as the trainer
		// sails on from the shore) stays where it is: it is on its way out.
		if (this.figure && !this.riding && !this.canStand(from, this.shown)) return;
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
		// on the side away from the camera, so neither walks through the other and
		// a big animal never hides the trainer.
		const swapping = to.x === at.x && to.y === at.y;
		this.aside = swapping ? (from.x === at.x ? { x: -1, z: 0 } : { x: 0, z: -1 }) : null;
	}

	/**
	 * The trainer turned without a step (they bumped into something): a rider
	 * turns with the boat, to its bow; one following on a tile stays as it is.
	 */
	face(facing: Direction): void {
		this.trainerFacing = facing;
	}

	/**
	 * Who follows: the lead's species, or null when every animal is tired;
	 * `riding` when it rides in the trainer's boat rather than following behind.
	 */
	lead(speciesId: string | null, riding = false): void {
		this.wanted = speciesId;
		this.wantRide = speciesId !== null && riding;
	}

	/**
	 * Draw it: `progress` is how far the trainer is through its step (1 when
	 * standing), which it keeps pace with; `dt` is seconds, for the swap and
	 * the turn.
	 */
	update(progress: number, dt: number): void {
		this.t += dt;
		this.updateSwap(dt);
		const figure = this.figure;
		if (!figure) return;
		if (this.riding) {
			this.ride(figure, progress);
			return;
		}
		if (!this.at || !this.from) return;
		const walking = this.from.x !== this.at.x || this.from.y !== this.at.y;
		const p = walking ? Math.min(1, Math.max(0, progress)) : 1;
		const t = smoothstep(p);
		const x = this.from.x + (this.at.x - this.from.x) * t;
		const z = this.from.y + (this.at.y - this.from.y) * t;
		const yFrom = this.groundAt(this.from);
		const y = yFrom + (this.groundAt(this.at) - yFrom) * t;
		// Out on the water it swims: no bounce from tile to tile, a gentle bob.
		const swimming = this.waterAt(this.from) && this.waterAt(this.at);
		const lift = Math.sin(p * Math.PI);
		const hop =
			walking && !swimming
				? lift * (HOP[this.shown ?? ''] ?? 0.08) * (motion.reduced ? 0.35 : 1)
				: 0;
		const bob = swimming && !motion.reduced ? Math.sin(this.t * 2.4) * 0.02 : 0;
		const aside = this.aside && walking ? lift * DODGE : 0;
		figure.position.set(
			x + (this.aside?.x ?? 0) * aside,
			y + hop + bob + this.swapLift(),
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
		this.wantRide = false;
		this.at = null;
		this.from = null;
		this.aside = null;
	}

	/**
	 * In the boat, standing on its deck at the bow, looking where the trainer
	 * looks, as the trainer glides. Its middle stays put as it grows in or
	 * shrinks away.
	 */
	private ride(figure: THREE.Group, progress: number): void {
		const from = this.trainerFrom;
		const to = this.trainerTo;
		if (!from || !to) return;
		const t = smoothstep(progress);
		const ahead = AHEAD[this.trainerFacing];
		const scale = this.rideScale * this.swapScale();
		const reach = RIDE_AHEAD - this.rideMiddle * scale;
		const yFrom = this.standAt(from);
		figure.position.set(
			from.x + (to.x - from.x) * t + ahead.x * reach,
			yFrom + (this.standAt(to) - yFrom) * t + BOAT_DECK + this.swapLift(),
			from.y + (to.y - from.y) * t + ahead.z * reach
		);
		this.yaw = ANGLE[this.trainerFacing];
		figure.rotation.y = this.yaw;
		figure.scale.setScalar(scale);
	}

	/** Swap the figure when the lead changed: shrink the old one away, grow the new one in. */
	private updateSwap(dt: number): void {
		if (this.swap) this.swap.t += dt;
		const changed =
			this.shown !== this.wanted ||
			this.riding !== this.wantRide ||
			(this.figure === null && this.wanted !== null);
		if (!this.swap) {
			if (!changed || !this.trainerTo) return;
			if (this.figure) this.swap = { phase: 'out', t: 0, from: 1 };
			else this.growIn();
			return;
		}
		if (this.swap.phase === 'in') {
			// A new lead while one was still growing in: it goes again at once, from the size it got to.
			if (this.shown !== this.wanted || this.riding !== this.wantRide)
				this.swap = { phase: 'out', t: 0, from: this.swapScale() };
			else if (this.swap.t >= SWAP_IN_SECONDS) this.swap = null;
			return;
		}
		if (this.swap.t < SWAP_OUT_SECONDS) return;
		this.dropFigure();
		this.swap = null;
		if (this.wanted !== null) this.growIn();
	}

	/**
	 * The lead comes out: in the boat when it rides, else on the tile it stands
	 * on, or, when it can't stand there (one that can't swim, and the trainer's
	 * last tile was water) or that tile is no longer beside the trainer (they
	 * stepped back onto it while the lead was hopping into the boat), beside
	 * the trainer. With nowhere beside them it waits for the trainer's next step.
	 */
	private growIn(): void {
		const species = this.wanted;
		if (species === null) return;
		const stays = this.at && this.besideTrainer(this.at) && this.canStand(this.at, species);
		if (!this.wantRide && !stays) {
			const spot = this.spotBeside(species);
			if (!spot) return;
			this.at = spot;
			this.from = spot;
			this.aside = null;
		}
		const figure = buildAnimalMesh(species);
		figure.userData.idlePhase = 0.6;
		this.riding = this.wantRide;
		if (this.riding) {
			// Measured at its own size, before it starts growing in from nothing.
			const box = new THREE.Box3().setFromObject(figure);
			const size = box.getSize(new THREE.Vector3());
			this.rideScale = Math.min(1, RIDE_LENGTH / Math.max(size.x, size.z), RIDE_HEIGHT / size.y);
			this.rideMiddle = (box.min.z + box.max.z) / 2;
		}
		figure.scale.setScalar(0.001);
		this.figure = figure;
		this.shown = species;
		this.swap = { phase: 'in', t: 0, from: 0 };
		this.host.addFigure(figure);
	}

	private dropFigure(): void {
		if (!this.figure) return;
		this.host.removeFigure(this.figure);
		disposeFigure(this.figure);
		this.figure = null;
		this.shown = null;
		this.riding = false;
	}

	/** With reduced motion the new one grows in without its bounce, as in a battle. */
	private swapScale(): number {
		if (!this.swap) return 1;
		return this.swap.phase === 'out'
			? this.swap.from * recallScale(this.swap.t / SWAP_OUT_SECONDS)
			: appearScale(this.swap.t / SWAP_IN_SECONDS, motion.reduced);
	}

	/** Going away, it rises a little as it shrinks, as a battle's recall does (a third as high with reduced motion). */
	private swapLift(): number {
		if (this.swap?.phase !== 'out') return 0;
		const rise = motion.reduced ? 0.05 : 0.15;
		return Math.sin(Math.min(1, this.swap.t / SWAP_OUT_SECONDS) * Math.PI) * rise;
	}

	/**
	 * The first tile beside the trainer, behind them, to a side, then in front,
	 * that `species` could stand on, where the trainer is first: out on the
	 * water, the water (an otter swims behind the boat rather than wait on the
	 * beach beside it), on land, the ground. Null when there is none.
	 */
	private spotBeside(species: string): GridPos | null {
		const trainer = this.trainerTo;
		if (!trainer) return null;
		const facing = this.trainerFacing;
		const spots = [BEHIND[facing], ...SIDES[facing], facing].map((d) => step(trainer, d));
		const wet = this.waterAt(trainer);
		return (
			spots.find((p) => this.canStand(p, species) && this.waterAt(p) === wet) ??
			spots.find((p) => this.canStand(p, species)) ??
			null
		);
	}

	/** Whether a tile is next to the one the trainer stands on or walks to: not that tile itself. */
	private besideTrainer(p: GridPos): boolean {
		return !!this.trainerTo && adjacent(p, this.trainerTo);
	}

	/**
	 * Whether an animal of `species` could stand on a tile: ground a trainer
	 * could walk on, for one that goes on land, and water, for one that swims.
	 * Without a species yet, ground.
	 */
	private canStand(p: GridPos, species: string | null): boolean {
		const kind = editedTileAt(this.seed, this.edits, p.x, p.y).kind;
		const realms = species ? getAnimal(species).realms : (['land'] as const);
		return (
			(isWalkable(kind) && realms.includes('land')) || (isWater(kind) && realms.includes('water'))
		);
	}

	/** The player cleared a tile: the world it stands in is as `edits` leave it. */
	setEdits(edits: WorldEdits): void {
		this.edits = edits;
	}

	private waterAt(p: GridPos): boolean {
		return isWater(tileAtWorld(this.seed, p.x, p.y).kind);
	}

	/** Where its feet go on a tile: the ground's top, or swimming, low in the water. */
	private groundAt(p: GridPos): number {
		const tile = tileAtWorld(this.seed, p.x, p.y);
		if (!isWater(tile.kind)) return groundTop(tile);
		const height =
			(this.figure?.userData.restShape as { height: number } | undefined)?.height ?? 0.4;
		return WATER_TOP - height * SWIM_DEPTH;
	}

	/** Where the trainer's feet are on a tile: its top, or out on the water, the boat's floor. */
	private standAt(p: GridPos): number {
		const tile = tileAtWorld(this.seed, p.x, p.y);
		return groundTop(tile) + (isWater(tile.kind) ? BOAT_STAND : 0);
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
