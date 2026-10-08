import {
	canFightIn,
	canRide,
	getLand,
	landOfSeed,
	MAX_SLIDE,
	hashString,
	isIce,
	isWalkable,
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
import { doubleHop, smoothstep } from './ease';
import { Follower, type FigureHost } from './follower';
import { SIT_DROP, poseRider } from './mount';
import { WING_TOP, buildGliderMesh, disposeGlider, poseGlider } from './glider';
import { TRAINER_LOOKS, type TrainerLook } from './palette';
import type { Poofs } from './poof';
import { Skis } from './skis';
import {
	DESCEND_SECONDS,
	FACING_ANGLE,
	GLIDE_SECONDS,
	RISE_SECONDS,
	SKI_SECONDS,
	SLIDE_SECONDS,
	STEP_SECONDS,
	slidesBetween,
	strideOnto,
	trainerPose,
	trainerStep
} from './trainer';

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
 * A player up in the air with the glider (`busy: 'flight'`) is drawn as the
 * player's own is: they rise where they stand as their canopy opens, the
 * tiles they send meanwhile are glided, high and without a hop, at the
 * glider's pace, and when they say they are down they come down where they
 * are. Each tile in the queue remembers whether it was flown, so a friend
 * who glided over a lake is never seen walking on it. Nobody follows them in
 * the air; their lead is back beside them once they are down.
 *
 * What goes is freed: a trainer's geometries, its own materials (each
 * trainer has its own, to fade), its boat and its glider, its follower
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
/** Seconds after the player turns up somewhere during which the others there come without a poof. */
export const HUSH_SECONDS = 2;
/** How far from the middle of a shared tile each of a crowd stands (tiles), and how quickly they step there. */
export const CROWD_RADIUS = 0.4;
const NUDGE_RATE = 8;

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

/** Where a player on screen stands, as `spotOf` tells it. */
export interface OtherSpot {
	tile: GridPos;
	facing: Direction;
	busy: Busy;
	feet: THREE.Vector3;
}

/** A tile a player said they reached, and whether they flew there (or, on their own tile, took off or came down). */
interface Reached {
	pos: GridPos;
	flying: boolean;
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
	/** Their glider, built the first time they fly in view, with its own materials to fade. */
	glider: THREE.Group | null;
	gliderMaterials: THREE.Material[];
	readonly follower: Follower;
	from: GridPos;
	to: GridPos;
	progress: number;
	stepSeconds: number;
	/** Tiles they reached that are still to walk (or glide), in order. */
	queue: Reached[];
	/** Up in the air as drawn: the tiles now being walked were flown. */
	flying: boolean;
	/** How far up they are, 0 on the ground to 1 cruising: it follows `flying` at the rise's and the descent's pace. */
	lift: number;
	/** The way they face, standing: as they last said. Walking, the way they walk. */
	facing: Direction;
	ownsBoat: boolean;
	/** Their items as the others see them: the harness (their lead carries them) and the skis, when they own them. */
	items: readonly string[];
	/** Their skis, once they are seen to own them: on their feet on the ground. */
	skis: Skis | null;
	lead: string | null;
	busy: Busy;
	opacity: number;
	leaving: boolean;
	/** How far aside they stand from the middle of their tile (world x and z), easing to where a crowd puts them. */
	nudge: { x: number; z: number };
	/**
	 * Their battle is drawn beside them (`fights.ts`): standing, they face it,
	 * and their lead is out in it rather than following them. Null otherwise.
	 */
	stage: Direction | null;
	/** A double jump for joy under way: seconds into it, and whether it is the big one (a win) with a spin. */
	cheer: { t: number; big: boolean } | null;
}

/** Seconds a double jump for joy takes: the battle's cheer. */
export const CHEER_SECONDS = 0.9;
/** How high a trainer's first hop for joy goes, in tiles: a hit that lands, and a win. */
const CHEER_HOP = 0.38;
const WIN_HOP = 0.5;

export class OtherPlayers {
	private readonly others = new Map<string, Other>();
	private seed = 0;
	/** Whether the world on screen is The Arctic's, where trainers wear the warm hat (`TrainerLook.warm`). */
	private warm = false;
	/** Where the middle of the screen is: the player's tile, as the renderer last put it. */
	private centre: GridPos = { x: 0, y: 0 };
	/** The clock of the last frame drawn (seconds), and until when newcomers come without a poof. */
	private now = 0;
	private hushedUntil = Number.NEGATIVE_INFINITY;

	constructor(
		private readonly scene: THREE.Scene,
		private readonly host: FigureHost,
		private readonly poofs: Poofs
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
		this.warm = getLand(landOfSeed(seed)).look === 'warm-hat';
	}

	/** Where the middle of the screen is now (the player's tile), for telling on screen from off. */
	setCentre(pos: GridPos): void {
		this.centre = { x: pos.x, y: pos.y };
	}

	/**
	 * It is the player who just turned up (they went to someone, came into
	 * this world, or their socket came back): for `HUSH_SECONDS` everyone
	 * already there fades in without a poof, since none of them moved.
	 */
	hush(): void {
		this.hushedUntil = this.now + HUSH_SECONDS;
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
			const hushed = this.now < this.hushedUntil;
			if (!hushed && tilesApart(target, this.centre) <= POOF_NEAR) this.poof(target, peer.boat);
			return;
		}
		other.busy = peer.busy;
		other.lead = peer.lead;
		other.items = itemsOf(peer);
		if (peer.skis && !other.skis) this.addSkis(other);
		other.facing = peer.facing;
		if (peer.boat !== other.ownsBoat) this.setBoat(other, peer.boat);
		const flying = peer.busy === 'flight';
		const lastReached = other.queue[other.queue.length - 1];
		const last = lastReached?.pos ?? other.to;
		if (last.x === target.x && last.y === target.y) {
			// Up into the air, or down, where they stand: that is the next thing to draw.
			if (flying !== (lastReached?.flying ?? other.flying))
				other.queue.push({ pos: target, flying });
			return;
		}
		if (adjacent(last, target) && other.queue.length < MAX_BEHIND) {
			// A tile walked right after tiles flown is where they came down (its flight was
			// never said, two messages in one): they glide onto it, then come down there.
			const wasFlying = lastReached?.flying ?? other.flying;
			if (wasFlying && !flying) other.queue.push({ pos: target, flying: true });
			other.queue.push({ pos: target, flying });
			return;
		}
		const slid = flying ? null : this.slide(last, target, other.skis !== null);
		if (slid && other.queue.length < MAX_BEHIND) {
			// A slide on the ice: its page stands at the end at once (`moveFrom`), and here
			// they slide there over every tile of ice between, as they did.
			for (const pos of slid) other.queue.push({ pos, flying: false });
			return;
		}
		// Further than a step: gone from there in a poof, and here in another.
		const now = this.whereNow(other);
		if (tilesApart(now, this.centre) <= POOF_NEAR) this.poof(now, other.ownsBoat);
		other.from = target;
		other.to = target;
		other.progress = 1;
		other.queue = [];
		other.flying = flying;
		other.lift = flying ? 1 : 0;
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
		this.now = t;
		const calm = motion.reduced;
		const aside = this.standingAside();
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
			this.rise(other, dt);
			const lift = smoothstep(other.lift);
			// On their lead's back, as the player's own trainer sits (`renderer.ts`).
			const seat = other.follower.seat(other.progress);
			const sitting = seat.weight * (1 - lift);
			const { x, y, z, afloat } = trainerPose(
				this.seed,
				other.from,
				other.to,
				other.progress,
				other.ownsBoat,
				calm,
				lift,
				sitting
			);
			const astride = (seat.height - SIT_DROP * seat.weight) * (1 - lift);
			const moving =
				(other.from.x !== other.to.x || other.from.y !== other.to.y) && other.lift === 0;
			// On the ice they slide, feet together, as the player's own trainer does.
			const walking = moving && !slidesBetween(this.seed, other.from, other.to);
			const standing = other.stage ?? other.facing;
			const way = moving ? (direction(other.from, other.to) ?? other.facing) : standing;
			const rocking = afloat === 1 && !calm;
			// Standing where someone else stands, they stand a little aside, easing there.
			const want = aside.get(other) ?? { x: 0, z: 0 };
			const ease = Math.min(1, dt * NUDGE_RATE);
			other.nudge.x += (want.x - other.nudge.x) * ease;
			other.nudge.z += (want.z - other.nudge.z) * ease;
			const joy = this.jump(other, dt, calm);
			other.figure.position.set(
				x + other.nudge.x,
				y + astride + joy.lift + (rocking ? Math.sin(t * 2.1 + phaseOf(other)) * 0.012 : 0),
				z + other.nudge.z
			);
			other.figure.rotation.y = FACING_ANGLE[way] + joy.turn;
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
			// Up in the air: the canopy open over them, as wide as they are high.
			if (other.lift > 0 && !other.glider) this.buildGlider(other);
			if (other.glider) {
				poseGlider(other.glider, lift, calm, other.ownsBoat && afloat < 0.5, false);
			}
			// On skis on the ground they glide, feet together, a spray of snow behind when quick.
			const skiing = other.skis !== null && afloat === 0 && lift === 0 && sitting === 0;
			const gliding = skiing && walking && other.stepSeconds < STEP_SECONDS;
			other.skis?.update(skiing && other.opacity >= 1, gliding ? 0.7 : 0, t, calm);
			animateIdle(other.figure, t);
			animateWalk(
				other.figure,
				walking && !gliding ? other.progress : 1,
				strideOnto(other.to),
				afloat === 1 ? 0 : 1 - sitting
			);
			if (rig) poseRider(rig, sitting);
			this.fade(other);
			// Their lead: on land who they say, carrying them with the harness when it can; out on
			// the water one that swims swims, and one that can't rides in the boat once they have
			// stepped into it. Nobody follows a friend up into the air.
			const onWater = this.waterAt(other.to);
			const boarding = walking && other.progress < 1 && !this.waterAt(other.from);
			const ride =
				other.lead === null
					? 'follows'
					: onWater
						? !canFightIn(other.lead, 'water') && !boarding
							? 'boat'
							: 'follows'
						: canRide(other, other.lead)
							? 'mount'
							: 'follows';
			// Nobody follows them in the air, nor while their lead is out in a battle beside them.
			const away = other.flying || other.lift > 0 || other.stage !== null;
			if (!other.leaving) other.follower.lead(away ? null : other.lead, ride);
			other.follower.update(other.progress, dt);
		}
	}

	/**
	 * A player's battle is drawn beside them (`fights.ts`): while it is, they
	 * stand facing `facing`, towards it, and their lead is out in it, so it
	 * shrinks away from behind them; `null` when it is over, and it comes back.
	 */
	stand(pid: string, facing: Direction | null): void {
		const other = this.others.get(pid);
		if (other) other.stage = facing;
	}

	/** A little double jump for joy: their animal landed a hit, or (`big`, with a spin) they won. */
	cheer(pid: string, big = false): void {
		const other = this.others.get(pid);
		if (!other || other.leaving) return;
		// A win's jump is never cut short by a hit's.
		if (other.cheer?.big && !big) return;
		other.cheer = { t: 0, big };
	}

	/**
	 * A player on screen, for laying their battle out beside them: the tile
	 * they stand on (or walk to), the way they last said they face, what they
	 * are busy with, and where their feet are drawn this frame. Null when they
	 * are not drawn, or on their way out.
	 */
	spotOf(pid: string): OtherSpot | null {
		const other = this.others.get(pid);
		if (!other || other.leaving) return null;
		return {
			tile: { ...other.to },
			facing: other.facing,
			busy: other.busy,
			feet: other.figure.position.clone()
		};
	}

	/** How far through a double jump a trainer is: how high this frame, and how far round. */
	private jump(other: Other, dt: number, calm: boolean): { lift: number; turn: number } {
		const cheer = other.cheer;
		if (!cheer) return { lift: 0, turn: 0 };
		cheer.t += dt;
		if (cheer.t >= CHEER_SECONDS) {
			other.cheer = null;
			return { lift: 0, turn: 0 };
		}
		return doubleHop(cheer.t / CHEER_SECONDS, {
			high: cheer.big ? WIN_HOP : CHEER_HOP,
			spin: cheer.big,
			calm
		});
	}

	/**
	 * Up or down towards where they are: `flying`'s lift, at the rise's pace
	 * going up and the descent's coming down. Down, their lead comes back
	 * beside them, wherever they came down.
	 */
	private rise(other: Other, dt: number): void {
		const want = other.flying ? 1 : 0;
		if (other.lift === want) return;
		other.lift = other.flying
			? Math.min(1, other.lift + dt / RISE_SECONDS)
			: Math.max(0, other.lift - dt / DESCEND_SECONDS);
		if (other.lift === 0) other.follower.place(this.seed, other.to, other.facing);
	}

	private buildGlider(other: Other): void {
		other.glider = buildGliderMesh(other.look.shirt);
		other.gliderMaterials = ownMaterials(other.glider);
		other.figure.add(other.glider);
		this.fade(other, true);
	}

	/**
	 * Players standing on one tile (two friends who came to a world's spawn,
	 * say) stand round it, a little apart, so nobody hides inside another and
	 * each name sits over its own head; the player's own trainer keeps the
	 * middle of their tile, so the others step aside from it. Everyone else
	 * stands in the middle of their tile, as a walker does.
	 */
	private standingAside(): Map<Other, { x: number; z: number }> {
		const crowds = new Map<string, Other[]>();
		for (const other of this.others.values()) {
			const walking = other.from.x !== other.to.x || other.from.y !== other.to.y;
			if (other.leaving || (walking && other.progress < 1)) continue;
			const key = `${other.to.x},${other.to.y}`;
			const crowd = crowds.get(key);
			if (crowd) crowd.push(other);
			else crowds.set(key, [other]);
		}
		const aside = new Map<Other, { x: number; z: number }>();
		for (const [key, crowd] of crowds) {
			const mine = key === `${this.centre.x},${this.centre.y}`;
			const n = crowd.length + (mine ? 1 : 0);
			if (n < 2) continue;
			// In a steady order, so nobody swaps places as the crowd changes.
			crowd.sort((a, b) => (a.pid < b.pid ? -1 : 1));
			crowd.forEach((other, i) => {
				const slot = i + (mine ? 1 : 0);
				const turn = (slot / n) * Math.PI * 2 + Math.PI / 4;
				aside.set(other, { x: Math.cos(turn) * CROWD_RADIUS, z: Math.sin(turn) * CROWD_RADIUS });
			});
		}
		return aside;
	}

	/**
	 * Everyone's head, where their name goes, as drawn this frame: over the
	 * cap, and up in the air over the top of their glider, so the name never
	 * hides the wing.
	 */
	heads(): Head[] {
		return [...this.others.values()].map((other) => {
			const over = HEAD_HEIGHT + (WING_TOP + 0.12 - HEAD_HEIGHT) * smoothstep(other.lift);
			return {
				pid: other.pid,
				name: other.name,
				busy: other.busy,
				at: other.figure.position.clone().setY(other.figure.position.y + over),
				opacity: Math.max(0, Math.min(1, other.opacity))
			};
		});
	}

	/** Where a player's figure is drawn to be, on the grid: the tile they are walking to. */
	tileOf(pid: string): GridPos | null {
		const other = this.others.get(pid);
		return other && !other.leaving ? { ...other.to } : null;
	}

	// --- one player ---------------------------------------------------------------

	private create(peer: PeerMessage): Other {
		// In The Arctic everyone wears the warm hat, in the colour of their own cap.
		const look = { ...trainerLook(peer.name), warm: this.warm };
		const figure = buildPlayerMesh(look);
		figure.name = `other:${peer.pid}`;
		figure.userData.idlePhase = (hashString(peer.pid) % 628) / 100;
		const materials = ownMaterials(figure);
		this.scene.add(figure);
		const at = { x: peer.x, y: peer.y };
		// One who comes into view in the air is up there already.
		const flying = peer.busy === 'flight';
		const other: Other = {
			pid: peer.pid,
			name: peer.name,
			look,
			figure,
			materials,
			boat: null,
			boatMaterials: [],
			glider: null,
			gliderMaterials: [],
			follower: new Follower(this.host),
			from: at,
			to: at,
			progress: 1,
			stepSeconds: STEP_SECONDS,
			queue: [],
			flying,
			lift: flying ? 1 : 0,
			facing: peer.facing,
			ownsBoat: false,
			items: itemsOf(peer),
			skis: null,
			lead: peer.lead,
			busy: peer.busy,
			opacity: 0,
			leaving: false,
			nudge: { x: 0, z: 0 },
			stage: null,
			cheer: null
		};
		if (peer.boat) this.setBoat(other, true);
		if (peer.skis) this.addSkis(other);
		other.follower.place(this.seed, at, peer.facing);
		this.fade(other);
		return other;
	}

	/**
	 * Start the next tile of their walk, or glide, once the last one is done.
	 * Between walking and flying they first rise, or come down, where they
	 * are: a tile flown is glided only up in the air, and a tile walked only on
	 * the ground.
	 */
	private walk(other: Other, dt: number): void {
		if (other.progress < 1) other.progress = Math.min(1, other.progress + dt / other.stepSeconds);
		const next = other.queue[0];
		if (other.progress < 1 || !next) return;
		if (next.flying !== other.flying) other.flying = next.flying;
		if (other.lift !== (other.flying ? 1 : 0)) return;
		other.queue.shift();
		// A take-off or a landing where they stand: the rise or the descent was all of it.
		if (next.pos.x === other.to.x && next.pos.y === other.to.y) return;
		other.from = other.to;
		other.to = next.pos;
		other.progress = 0;
		if (next.flying) {
			other.stepSeconds = other.queue.length >= CATCH_UP ? GLIDE_SECONDS / 2 : GLIDE_SECONDS;
			return;
		}
		// Into the boat or out of it takes the boat's swing, as the player's own step does; a
		// tile of a slide on the ice goes at the slide's even pace, never hurried.
		if (slidesBetween(this.seed, other.from, next.pos)) {
			other.stepSeconds = SLIDE_SECONDS;
			other.follower.follow(other.from, other.to);
			return;
		}
		const swing =
			other.ownsBoat && this.waterAt(other.from) !== this.waterAt(next.pos) && !motion.reduced;
		// On skis they come quickly, as fast as a skier at speed, while more tiles wait.
		const skiing = other.skis !== null && !this.waterAt(next.pos) && other.queue.length > 0;
		const base = swing ? BOAT_SWING_SECONDS : skiing ? SKI_SECONDS[2]! : STEP_SECONDS;
		other.stepSeconds = other.queue.length >= CATCH_UP ? base / 2 : base;
		other.follower.follow(other.from, other.to);
	}

	/**
	 * The tiles of a slide from `from` to `to`, in order, the last `to`: when
	 * they are in one row or column, at most `MAX_SLIDE` apart, and every tile
	 * before the last is ice in the seeded world (no edit ever makes or takes
	 * ice). Null for anything else, which is no slide.
	 */
	private slide(from: GridPos, to: GridPos, skis = false): GridPos[] | null {
		const dx = Math.sign(to.x - from.x);
		const dy = Math.sign(to.y - from.y);
		const n = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
		if ((dx !== 0 && dy !== 0) || n < 2 || n > MAX_SLIDE) return null;
		const path: GridPos[] = [];
		for (let k = 1; k <= n; k++) {
			const pos = { x: from.x + dx * k, y: from.y + dy * k };
			const kind = tileAtWorld(this.seed, pos.x, pos.y).kind;
			// A slide crosses ice; a skier at speed (or coasting, or skimming) crosses any open
			// tiles in a straight line, a few at a time as their page says where they are.
			const open = isIce(kind) || (skis && n <= SKI_RUN && (isWalkable(kind) || isWater(kind)));
			if (k < n && !open) return null;
			path.push(pos);
		}
		return path;
	}

	private addSkis(other: Other): void {
		other.skis = new Skis();
		other.figure.add(other.skis.group);
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

	/**
	 * Fade the trainer (and their boat and glider) to their opacity; a trainer
	 * nearly gone casts no shadow. `fresh`: something was just added to them,
	 * whose shadows are set again.
	 */
	private fade(other: Other, fresh = false): void {
		const opacity = Math.max(0, Math.min(1, other.opacity));
		for (const material of [...other.materials, ...other.boatMaterials, ...other.gliderMaterials]) {
			material.opacity = opacity;
			// Fully there, a figure draws as a solid one does, with the rest of the world.
			const see = opacity < 1;
			if (material.transparent !== see) {
				material.transparent = see;
				material.needsUpdate = true;
			}
		}
		const cast = opacity > 0.5;
		if (fresh) other.figure.userData.casting = undefined;
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
		this.poofs.play(new THREE.Vector3(at.x, y, at.y), motion.reduced);
	}

	/** The tile a player is nearest to right now, mid-step or standing. */
	private whereNow(other: Other): GridPos {
		return other.progress < 0.5 ? other.from : other.to;
	}

	private drop(other: Other): void {
		other.figure.removeFromParent();
		// The skis' boxes and colours are shared by every pair: taken off, never freed.
		other.skis?.group.removeFromParent();
		if (other.boat) {
			other.boat.removeFromParent();
			disposeBoat(other.boat);
		}
		if (other.glider) {
			other.glider.removeFromParent();
			disposeGlider(other.glider);
		}
		disposeFigure(other.figure);
		for (const material of [...other.materials, ...other.boatMaterials, ...other.gliderMaterials]) {
			material.dispose();
		}
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

/**
 * The longest straight run between two tiles another player stood on that is
 * drawn as skied, not poofed: a coast and a skim (3 and 6 tiles) and the
 * tiles a quick skier covers between two of their page's reports.
 */
const SKI_RUN = 9;

/** What another player owns, as the others see it: the harness and the skis. */
function itemsOf(peer: PeerMessage): string[] {
	return [...(peer.harness ? ['harness'] : []), ...(peer.skis ? ['skis'] : [])];
}
