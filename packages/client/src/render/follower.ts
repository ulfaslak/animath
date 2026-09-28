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
import { animateFlight, buildAnimalMesh, disposeFigure } from './animals';
import { BOAT_DECK, BOAT_STAND } from './boat';
import { flyingSize } from './chaser';
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
 *
 * Up in the air with the glider (#91) the one following is the lead in the
 * air, a bird (with none standing, nobody follows a kid into the air): told
 * where the trainer is each frame (`fly`), it takes off from its tile and
 * flies behind them and a little to their side and below, its wings beating
 * (held out with reduced motion); once they are down (`place`, then `fly`
 * with no trainer) it comes down onto the tile beside them, folding its
 * wings.
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
/**
 * Flying behind the glider: how far behind the trainer, to their left, and
 * below them the bird flies, in tiles; how fast it closes on that spot (most
 * of the way in a tenth of a second at 10, a fifth at 5); how far its nose
 * dips as it flies; and how long it takes to come down beside them.
 */
export const FLY_BEHIND = 1.15;
export const FLY_ASIDE = 0.6;
export const FLY_BELOW = 0.45;
const FLY_CATCH_UP = 6;
const FLY_PITCH = 0.3;
export const COME_DOWN_SECONDS = 0.35;

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
	/** Up in the air with the glider: the trainer's point in the air this frame, and the way they fly. */
	private aloft: { at: THREE.Vector3; facing: Direction } | null = null;
	/** Where the figure flies, up in the air and coming down. */
	private airAt = new THREE.Vector3();
	/**
	 * Up in the air, where it is from the trainer: it moves with them, so it
	 * never falls behind a glide, and only this closes on its spot behind them.
	 */
	private airFrom = new THREE.Vector3();
	/** Seconds since it took off: its wings open as it rises. */
	private airT = 0;
	/** Coming down beside the trainer after a flight: from where in the air, and how far down (0 to 1). */
	private landing: { from: THREE.Vector3; t: number } | null = null;

	constructor(private host: FigureHost) {}

	/** Whether the one following is up in the air, or coming down from it. */
	get flying(): boolean {
		return this.figure !== null && (this.aloft !== null || this.landing !== null);
	}

	/**
	 * Up in the air with the glider: the trainer's point in the air this
	 * frame and the way they fly, which a bird following flies behind; or,
	 * back on the ground, null: it comes down onto the tile `place` gave it
	 * (with none, it is gone until the trainer's next step).
	 */
	fly(trainer: THREE.Vector3 | null, facing: Direction = this.trainerFacing): void {
		if (trainer) {
			if (!this.aloft) {
				// Taking off from where it stands, or from where it was coming down.
				if (this.figure) this.airFrom.subVectors(this.figure.position, trainer);
				this.airT = 0;
				this.landing = null;
				this.aloft = { at: new THREE.Vector3(), facing };
			}
			this.aloft.at.copy(trainer);
			this.aloft.facing = facing;
			return;
		}
		if (!this.aloft) return;
		this.aloft = null;
		if (!this.figure || !flies(this.shown)) return;
		if (this.at && !this.riding) this.landing = { from: this.airAt.clone(), t: 0 };
		else this.dropFigure();
	}

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
		// Up in the air a bird flies behind the trainer; one that can't fly stays on its tile,
		// shrinking away (nobody else follows a kid into the air).
		if (this.aloft && flies(this.shown)) {
			this.flyBehind(figure, this.aloft, dt);
			return;
		}
		if (this.landing) {
			this.comeDown(figure, this.landing, dt);
			return;
		}
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
		this.aloft = null;
		this.landing = null;
	}

	/** Where a bird flies behind the trainer up in the air: behind them, to their left and below. */
	private flightSpot(aloft: { at: THREE.Vector3; facing: Direction }): THREE.Vector3 {
		const ahead = AHEAD[aloft.facing];
		// Left of the way they fly: a quarter turn from ahead.
		const left = { x: ahead.z, z: -ahead.x };
		return new THREE.Vector3(
			aloft.at.x - ahead.x * FLY_BEHIND + left.x * FLY_ASIDE,
			aloft.at.y - FLY_BELOW,
			aloft.at.z - ahead.z * FLY_BEHIND + left.z * FLY_ASIDE
		);
	}

	/**
	 * Up in the air: it closes on its spot behind the trainer (so it rises
	 * from its tile at take-off, and keeps up as they glide), turned the way
	 * they fly, nose a little down, bobbing a little, its wings opening as it
	 * rises and beating (held out with reduced motion).
	 */
	private flyBehind(
		figure: THREE.Group,
		aloft: { at: THREE.Vector3; facing: Direction },
		dt: number
	): void {
		this.airT += dt;
		const spot = this.flightSpot(aloft).sub(aloft.at);
		this.airFrom.lerp(spot, 1 - Math.exp(-dt * FLY_CATCH_UP));
		this.airAt.addVectors(aloft.at, this.airFrom);
		this.facing = aloft.facing;
		this.turn(dt);
		const bob = motion.reduced ? 0 : Math.sin(this.t * 3.1) * 0.04;
		const rising = Math.min(1, this.airT / 0.3);
		figure.position.copy(this.airAt);
		figure.position.y += bob + this.swapLift();
		figure.rotation.set(FLY_PITCH, this.yaw, 0, 'YXZ');
		figure.scale.setScalar(this.swapScale() * this.flyingScale(figure, rising));
		animateFlight(figure, this.t, rising);
	}

	/** How big it is drawn `up` of the way into the air: a small bird bigger up there (`flyingSize`). */
	private flyingScale(figure: THREE.Group, up: number): number {
		const height = (figure.userData.restShape as { height: number } | undefined)?.height ?? 0.5;
		return 1 + (flyingSize(height) - 1) * up;
	}

	/**
	 * Down again: from where it flew, onto its tile beside the trainer (what
	 * `place` gave it), its nose coming up and its wings folding as it lands.
	 */
	private comeDown(
		figure: THREE.Group,
		landing: { from: THREE.Vector3; t: number },
		dt: number
	): void {
		landing.t = Math.min(1, landing.t + dt / COME_DOWN_SECONDS);
		const at = this.at;
		if (!at) {
			this.landing = null;
			return;
		}
		const p = smoothstep(landing.t);
		const ground = new THREE.Vector3(at.x, this.groundAt(at), at.y);
		figure.position.lerpVectors(landing.from, ground, p);
		figure.position.y += this.swapLift();
		this.turn(dt);
		figure.rotation.set(FLY_PITCH * (1 - p), this.yaw, 0, 'YXZ');
		figure.scale.setScalar(this.swapScale() * this.flyingScale(figure, 1 - p));
		animateFlight(figure, this.t, 1 - p);
		if (landing.t < 1) return;
		this.landing = null;
		this.from = { ...at };
		this.aside = null;
	}

	/** Turn towards the way it faces, the short way round. */
	private turn(dt: number): void {
		let delta = ANGLE[this.facing] - this.yaw;
		delta = Math.atan2(Math.sin(delta), Math.cos(delta));
		this.yaw += delta * Math.min(1, dt * TURN_RATE);
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
		if (this.aloft && flies(species)) {
			// Up in the air: it comes out on its spot behind the glider, its wings open.
			this.airFrom.copy(this.flightSpot(this.aloft).sub(this.aloft.at));
			this.airAt.addVectors(this.aloft.at, this.airFrom);
			this.airT = 1;
		} else if (!this.wantRide && !stays) {
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

/** Whether an animal of `species` flies: a bird. */
function flies(species: string | null): boolean {
	return species !== null && getAnimal(species).realms.includes('air');
}

/** The way from one tile to the next, or null when they are not neighbours. */
function direction(from: GridPos, to: GridPos): Direction | null {
	if (to.x === from.x + 1 && to.y === from.y) return 'right';
	if (to.x === from.x - 1 && to.y === from.y) return 'left';
	if (to.y === from.y + 1 && to.x === from.x) return 'down';
	if (to.y === from.y - 1 && to.x === from.x) return 'up';
	return null;
}
