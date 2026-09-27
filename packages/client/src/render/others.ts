import {
	canFightIn,
	hashString,
	isWater,
	tileAtWorld,
	tilesApart,
	type Busy,
	type Direction,
	type GridPos,
	type PeerMessage
} from '@mathgame/engine';
import * as THREE from 'three';
import { motion } from '../motion';
import { animateIdle, animateWalk, buildPlayerMesh, disposeFigure } from './animals';
import { BOAT_SWING_SECONDS, buildBoatMesh, disposeBoat, poseBoat, standAstern } from './boat';
import { Follower, type FigureHost } from './follower';
import { TRAINER_LOOKS, type TrainerLook } from './palette';
import type { Poofs } from './poof';
import { FACING_ANGLE, STEP_SECONDS, strideOnto, trainerStep } from './trainer';

/**
 * The other players in view ([[UI_SPEC]] § Explore mode, "Playing
 * together"): each one a trainer in the shirt and cap their name gives them
 * (`trainerLook`), walking from tile to tile as the server says they do,
 * hop for hop as the player's own trainer (`trainer.ts`), their boat on
 * their back or under them out on the water, and their lead following them
 * (a `Follower` of their own, as the player's is).
 *
 * The server says where a player is each time they reach a tile (`seen`),
 * so a walk arrives as a string of tiles: each is walked in a step's time,
 * one after the other, and a player who is a few tiles behind (the network
 * held the messages back) walks faster until they have caught up. A player
 * who moved further than a step (they went to someone, or came back from
 * far away) is not walked across the map: they vanish in a poof and turn up
 * in another.
 *
 * Coming into view they fade in, leaving it they fade out (`gone`), and a
 * player who turns up out of nowhere on screen (they joined the world, came
 * back, or went to someone near) does so in a poof. Their lead grows in and
 * shrinks away, as the player's own does. With reduced motion the fades are
 * the same, and the poof is the calm one.
 *
 * What goes is freed: a trainer's geometries, its own materials (each
 * trainer has its own, to fade), its boat, its follower
 * ([[INVARIANTS]] § Rendering).
 *
 * The names over their heads and the bubbles that say what they are busy
 * with are the page's (`ui/Others.svelte`), placed where `heads` says.
 */

/** Seconds a player takes to fade in as they come into view, or out as they leave it. */
export const FADE_SECONDS = 0.45;
/** Tiles a player may be behind before they walk twice as fast to catch up. */
const CATCH_UP = 2;
/** Tiles a player may be behind at most; one further behind jumps to where they are. */
const MAX_BEHIND = 8;
/** How near the middle of the screen a player must turn up for it to be a poof: on screen. */
const POOF_NEAR = 12;
/** How high over a trainer's feet their name sits: just over the cap. */
const HEAD_HEIGHT = 0.95;

/** The shirt and cap a player's name gives them: the same on every screen, and never the player's own. */
export function trainerLook(name: string): TrainerLook {
	const key = name.normalize('NFC').toLowerCase();
	return TRAINER_LOOKS[(hashString(key) >>> 0) % TRAINER_LOOKS.length]!;
}

/** A player over whose head a name goes: where (in the world), who, and how faded in. */
export interface Head {
	pid: string;
	name: string;
	busy: Busy;
	at: THREE.Vector3;
	opacity: number;
}

interface Other {
	readonly pid: string;
	readonly name: string;
	readonly look: TrainerLook;
	readonly figure: THREE.Group;
	/** The trainer's own materials (copies of the shared ones), faded together. */
	readonly materials: THREE.Material[];
	boat: THREE.Group | null;
	boatMaterials: THREE.Material[];
	readonly follower: Follower;
	from: GridPos;
	to: GridPos;
	progress: number;
	stepSeconds: number;
	/** Tiles they reached that are still to walk, in order. */
	queue: GridPos[];
	/** The way they face, standing: as they last said. Walking, the way they walk. */
	facing: Direction;
	ownsBoat: boolean;
	lead: string | null;
	busy: Busy;
	opacity: number;
	leaving: boolean;
}

export class OtherPlayers {
	private readonly others = new Map<string, Other>();
	private seed = 0;
	/** Where the middle of the screen is: the player's tile, as the renderer last put it. */
	private centre: GridPos = { x: 0, y: 0 };

	constructor(
		private readonly scene: THREE.Scene,
		private readonly host: FigureHost,
		private readonly poofs: Poofs,
		private readonly clock: () => number = () => performance.now() / 1000
	) {}

	/** How many are on screen, fading ones included: for tests. */
	get count(): number {
		return this.others.size;
	}

	/** Who is drawn, by public id: for tests. */
	has(pid: string): boolean {
		return this.others.has(pid);
	}

	/** Who is drawn and not on their way out, by public id. */
	pids(): string[] {
		return [...this.others.values()].filter((o) => !o.leaving).map((o) => o.pid);
	}

	/** The world on screen: another world's players all go at once. */
	setWorld(seed: number): void {
		if (seed === this.seed) return;
		this.clear();
		this.seed = seed;
	}

	/** Where the middle of the screen is now (the player's tile), for telling on screen from off. */
	setCentre(pos: GridPos): void {
		this.centre = { x: pos.x, y: pos.y };
	}

	/** A player as they are now (`peer`): drawn if new, walked on to their tile, or put there with a poof. */
	seen(peer: PeerMessage): void {
		const target = { x: peer.x, y: peer.y };
		let other = this.others.get(peer.pid);
		if (other?.leaving) {
			// Gone and back before they had faded: they start again where they are.
			this.drop(other);
			other = undefined;
		}
		if (!other) {
			other = this.create(peer);
			this.others.set(peer.pid, other);
			if (tilesApart(target, this.centre) <= POOF_NEAR) this.poof(target, peer.boat);
			return;
		}
		other.busy = peer.busy;
		other.lead = peer.lead;
		other.facing = peer.facing;
		if (peer.boat !== other.ownsBoat) this.setBoat(other, peer.boat);
		const last = other.queue.at(-1) ?? other.to;
		if (last.x === target.x && last.y === target.y) return;
		if (adjacent(last, target) && other.queue.length < MAX_BEHIND) {
			other.queue.push(target);
			return;
		}
		// Further than a step: gone from there in a poof, and here in another.
		const now = this.whereNow(other);
		if (tilesApart(now, this.centre) <= POOF_NEAR) this.poof(now, other.ownsBoat);
		other.from = target;
		other.to = target;
		other.progress = 1;
		other.queue = [];
		other.follower.place(this.seed, target, other.facing);
		if (tilesApart(target, this.centre) <= POOF_NEAR) this.poof(target, other.ownsBoat);
	}

	/** That player left the view (or the world, or the game): they fade away. */
	gone(pid: string): void {
		const other = this.others.get(pid);
		if (!other || other.leaving) return;
		other.leaving = true;
		other.follower.lead(null);
	}

	/** Everyone goes at once: another world, the title, the socket gone. */
	clear(): void {
		for (const other of this.others.values()) this.drop(other);
		this.others.clear();
	}

	/** Walk, fade and pose everyone for this frame: `t` is the renderer's clock, `dt` the frame's seconds. */
	update(t: number, dt: number): void {
		const calm = motion.reduced;
		for (const other of [...this.others.values()]) {
			if (other.leaving) {
				other.opacity -= dt / FADE_SECONDS;
				if (other.opacity <= 0) {
					this.drop(other);
					this.others.delete(other.pid);
					continue;
				}
			} else if (other.opacity < 1) {
				other.opacity = Math.min(1, other.opacity + dt / FADE_SECONDS);
			}
			this.walk(other, dt);
			const { x, y, z, afloat } = trainerStep(
				this.seed,
				other.from,
				other.to,
				other.progress,
				other.ownsBoat,
				calm
			);
			const walking = other.from.x !== other.to.x || other.from.y !== other.to.y;
			const way = walking ? (direction(other.from, other.to) ?? other.facing) : other.facing;
			const rocking = afloat === 1 && !calm;
			other.figure.position.set(
				x,
				y + (rocking ? Math.sin(t * 2.1 + phaseOf(other)) * 0.012 : 0),
				z
			);
			other.figure.rotation.y = FACING_ANGLE[way];
			const rig = other.figure.children[0];
			if (other.boat) {
				poseBoat(
					other.boat,
					afloat,
					calm,
					rocking ? Math.sin(t * 1.6 + phaseOf(other)) * 0.035 : 0
				);
				if (rig) rig.position.z = -standAstern(afloat, calm);
			} else if (rig) rig.position.z = 0;
			animateIdle(other.figure, t);
			animateWalk(
				other.figure,
				walking ? other.progress : 1,
				strideOnto(other.to),
				afloat === 1 ? 0 : 1
			);
			this.fade(other);
			// Their lead: on land who they say; out on the water one that swims swims, and one
			// that can't rides in the boat once they have stepped into it.
			const onWater = this.waterAt(other.to);
			const boarding = walking && other.progress < 1 && !this.waterAt(other.from);
			const riding =
				onWater && other.lead !== null && !canFightIn(other.lead, 'water') && !boarding;
			if (!other.leaving) other.follower.lead(other.lead, riding);
			other.follower.update(other.progress, dt);
		}
	}

	/** Everyone's head, where their name goes, as drawn this frame. */
	heads(): Head[] {
		return [...this.others.values()].map((other) => ({
			pid: other.pid,
			name: other.name,
			busy: other.busy,
			at: other.figure.position.clone().setY(other.figure.position.y + HEAD_HEIGHT),
			opacity: Math.max(0, Math.min(1, other.opacity))
		}));
	}

	/** Where a player's figure is drawn to be, on the grid: the tile they are walking to. */
	tileOf(pid: string): GridPos | null {
		const other = this.others.get(pid);
		return other && !other.leaving ? { ...other.to } : null;
	}

	// --- one player ---------------------------------------------------------------

	private create(peer: PeerMessage): Other {
		const look = trainerLook(peer.name);
		const figure = buildPlayerMesh(look);
		figure.name = `other:${peer.pid}`;
		figure.userData.idlePhase = (hashString(peer.pid) % 628) / 100;
		const materials = ownMaterials(figure);
		this.scene.add(figure);
		const at = { x: peer.x, y: peer.y };
		const other: Other = {
			pid: peer.pid,
			name: peer.name,
			look,
			figure,
			materials,
			boat: null,
			boatMaterials: [],
			follower: new Follower(this.host),
			from: at,
			to: at,
			progress: 1,
			stepSeconds: STEP_SECONDS,
			queue: [],
			facing: peer.facing,
			ownsBoat: false,
			lead: peer.lead,
			busy: peer.busy,
			opacity: 0,
			leaving: false
		};
		if (peer.boat) this.setBoat(other, true);
		other.follower.place(this.seed, at, peer.facing);
		this.fade(other);
		return other;
	}

	/** Start the next tile of their walk once the last one is walked. */
	private walk(other: Other, dt: number): void {
		if (other.progress < 1) other.progress = Math.min(1, other.progress + dt / other.stepSeconds);
		if (other.progress < 1 || other.queue.length === 0) return;
		const next = other.queue.shift()!;
		other.from = other.to;
		other.to = next;
		other.progress = 0;
		// Into the boat or out of it takes the boat's swing, as the player's own step does.
		const swing =
			other.ownsBoat && this.waterAt(other.from) !== this.waterAt(next) && !motion.reduced;
		const base = swing ? BOAT_SWING_SECONDS : STEP_SECONDS;
		other.stepSeconds = other.queue.length >= CATCH_UP ? base / 2 : base;
		other.follower.follow(other.from, other.to);
	}

	private setBoat(other: Other, owns: boolean): void {
		other.ownsBoat = owns;
		if (owns && !other.boat) {
			other.boat = buildBoatMesh(other.look.shirt);
			other.boatMaterials = ownMaterials(other.boat);
			other.figure.add(other.boat);
		}
		if (other.boat) other.boat.visible = owns;
	}

	/** Fade the trainer (and their boat) to their opacity; a trainer nearly gone casts no shadow. */
	private fade(other: Other): void {
		const opacity = Math.max(0, Math.min(1, other.opacity));
		for (const material of [...other.materials, ...other.boatMaterials]) {
			material.opacity = opacity;
			// Fully there, a figure draws as a solid one does, with the rest of the world.
			const see = opacity < 1;
			if (material.transparent !== see) {
				material.transparent = see;
				material.needsUpdate = true;
			}
		}
		const cast = opacity > 0.5;
		if (other.figure.userData.casting !== cast) {
			other.figure.userData.casting = cast;
			other.figure.traverse((o) => {
				if (o instanceof THREE.Mesh) o.castShadow = cast;
			});
		}
	}

	/** A poof round a trainer's feet on tile `at` (in the boat's floor, out on the water). */
	private poof(at: GridPos, boat: boolean): void {
		const { y } = trainerStep(this.seed, at, at, 1, boat, motion.reduced);
		this.poofs.play(new THREE.Vector3(at.x, y, at.y), this.clock(), motion.reduced);
	}

	/** The tile a player is nearest to right now, mid-step or standing. */
	private whereNow(other: Other): GridPos {
		return other.progress < 0.5 ? other.from : other.to;
	}

	private drop(other: Other): void {
		other.figure.removeFromParent();
		if (other.boat) {
			other.boat.removeFromParent();
			disposeBoat(other.boat);
		}
		disposeFigure(other.figure);
		for (const material of [...other.materials, ...other.boatMaterials]) material.dispose();
		other.follower.hide();
	}

	private waterAt(p: GridPos): boolean {
		return isWater(tileAtWorld(this.seed, p.x, p.y).kind);
	}
}

/** Give a figure copies of its materials, which are shared by every figure, so it can fade alone. */
function ownMaterials(root: THREE.Object3D): THREE.Material[] {
	const copies = new Map<THREE.Material, THREE.Material>();
	root.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const shared = o.material as THREE.Material;
		let copy = copies.get(shared);
		if (!copy) {
			copy = shared.clone();
			copies.set(shared, copy);
		}
		o.material = copy;
	});
	return [...copies.values()];
}

/** A little offset in time per player, so two friends side by side don't rock in step. */
function phaseOf(other: Other): number {
	return (other.figure.userData.idlePhase as number | undefined) ?? 0;
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
