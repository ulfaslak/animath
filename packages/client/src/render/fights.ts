import {
	getAnimal,
	isWalkable,
	isWater,
	step,
	tileAtWorld,
	type AttackLevel,
	type Busy,
	type Direction,
	type FightAnimal,
	type FightEvent,
	type FightMessage,
	type FightView,
	type GridPos,
	type MatchSide,
	type PuzzleFace,
	type Realm
} from '@mathgame/engine';
import * as THREE from 'three';
import { motion } from '../motion';
import { animateFlight, buildAnimalMesh, disposeFigure } from './animals';
import { appearScale, recallScale, smoothstep } from './ease';
import { SWIM_DEPTH, type FigureHost } from './follower';
import type { OtherPlayers, OtherSpot } from './others';
import { COLORS, SPARKLE_COLORS } from './palette';
import type { Poofs } from './poof';
import { WATER_TOP, groundTop } from './tiles';
import { FACING_ANGLE } from './trainer';

/**
 * The battles of the players in view, drawn beside them in the world
 * ([[UI_SPEC]] § Explore mode, "Playing together"): a friend's wild battle
 * becomes a little scene next to them, and a friendly match one between its
 * two players, from what the server says of it (`fight`, the engine's
 * `FightView` and `FightEvent`s).
 *
 * - **The scene.** The wild animal pops out in front of its fighter, facing
 *   them, and their animal steps out between them: the lead that followed
 *   them shrinks away, and the one fighting grows in, the battle's own
 *   send-out. They stand in a line across the screen where they can
 *   (left or right of the fighter reads best at the camera's angle), on
 *   tiles an animal could stand on, water out at sea: decoration, which
 *   blocks nobody. A match's two animals face each other in front of its
 *   two players. Someone who comes near mid-battle sees it at once, both
 *   animals and the puzzle.
 * - **What happens.** Each step's events play in order, a beat each: the
 *   attacker lunges, the one hit shakes and its damage floats up from it
 *   ("−10", `marks`), and the player whose animal landed it does a little
 *   double jump (`OtherPlayers.cheer`); a miss is a small puff by the target;
 *   the leash's rope arcs from the fighter's hand to the wild animal and
 *   holds, with sparkles, or is shaken off; a switch is a poof, the new
 *   animal growing in; a tired animal lies down, z's over it. The end shows
 *   (a cheer with a spin for the winner, a caught animal going with a
 *   sparkle, a runaway's animal back to them), and then the scene clears
 *   and the lead follows its player again.
 * - **What the page shows over it** (`marks`, placed by the presence
 *   controller): the thought bubble over the player thinking now, with the
 *   puzzle as the engine writes it (a small happy pop on a right answer, a
 *   wobble on a wrong one), small HP bars over the two animals, and the
 *   damage numbers.
 * - **Pace.** A page behind plays its beats faster, and one far behind skips
 *   to how the battle stands. With reduced motion every movement is smaller
 *   and the puffs the calm ones; what happened still shows.
 * - **Many at once.** At most `MAX_FIGHTS` scenes are drawn, the nearest the
 *   middle of the screen within `FIGHT_NEAR` tiles; the others wait, known,
 *   and are drawn when they come near. Animal figures are lent from a pool
 *   (`FigurePool`) and given back, the rope, the loop and the sparkles are
 *   shared shapes, and the damage numbers are capped (`MAX_POPS`), so a
 *   crowd of battles costs no more than a few.
 *
 * A scene whose players are not drawn, or no longer say they are in it
 * (back to exploring, up in the air, gone to the doctor), clears; so does
 * one whose player jumped elsewhere. Nothing is left behind
 * ([[INVARIANTS]] § Rendering).
 */

/** How many battles are drawn at once, the nearest the middle of the screen. */
export const MAX_FIGHTS = 6;
/** How far from the middle of the screen (tiles) a battle is drawn. */
export const FIGHT_NEAR = 16;
/** How many damage numbers float at once, over all battles. */
export const MAX_POPS = 12;
/** Seconds a damage number floats before it is gone. */
export const POP_SECONDS = 1.2;
/** Seconds the end is shown before the scene clears. */
export const END_SECONDS = 1.8;
/**
 * Seconds a scene waits for its players to say they are in it: a match
 * starts on the server a moment before its pages say so, and a battle's end
 * a moment before its page is back to exploring.
 */
export const GRACE_SECONDS = 1.5;
/** Seconds an animal takes to grow in, or to shrink away. */
const APPEAR_SECONDS = 0.4;
const RECALL_SECONDS = 0.3;
const LUNGE_SECONDS = 0.35;
const SHAKE_SECONDS = 0.45;
const FAINT_SECONDS = 0.6;
const HOP_SECONDS = 0.5;
/** The leash's flight from the hand to the animal, and how long it holds or drops after. */
export const LEASH_FLIGHT_SECONDS = 0.55;
const LEASH_AFTER_SECONDS = 0.7;
const SPARKLE_SECONDS = 0.8;
/**
 * How far out (tiles) a fighter's animal stands in front of them, and the
 * wild one: each on its own tile, the next two in front, with room between
 * the fighter's name and their animal's, and between the two animals'.
 */
const NEAR_OUT = 1.2;
const FAR_OUT = 2.45;
/**
 * Up in the air (#91), how high over the ground (or the water) the two birds
 * fly beside their player, in tiles: about the height of the fighter's head.
 */
export const AIR_HOVER = 0.7;
/**
 * How tall (tiles) an animal in a battle beside its player stands at least:
 * a small one is drawn bigger, up to `MAX_GROW` times its size, so a shrew
 * and a rat still read from across the screen; a big one stays its size.
 */
const MIN_HEIGHT = 0.42;
const MAX_GROW = 1.6;
/** A match's two animals: how far in front of the pair, and how far apart. */
const MATCH_OUT = 1.25;
const MATCH_APART = 1.25;
/** How far a lunge reaches towards the other animal (tiles). */
const LUNGE_REACH = 0.35;
/** How high the leash's throw arcs over its line (tiles). */
const LEASH_ARC = 0.9;
/** A queue longer than this plays twice as fast; one longer than `SKIP_AFTER` goes straight to how it stands. */
const HURRY_AFTER = 5;
const SKIP_AFTER = 14;

const SIDES: readonly MatchSide[] = ['a', 'b'];
const OPPOSITE: Record<Direction, Direction> = {
	up: 'down',
	down: 'up',
	left: 'right',
	right: 'left'
};
const AHEAD: Record<Direction, { x: number; z: number }> = {
	up: { x: 0, z: -1 },
	down: { x: 0, z: 1 },
	left: { x: -1, z: 0 },
	right: { x: 1, z: 0 }
};

// Shared shapes and materials, built once and never freed: every scene draws them.
/** The leash's loop and rope: chunky enough to see from across the screen. */
const LOOP_GEOMETRY = new THREE.TorusGeometry(0.2, 0.05, 6, 16);
/** A unit-length rope along +y from the origin; stretched and turned per frame. */
const ROPE_GEOMETRY = new THREE.CylinderGeometry(0.032, 0.032, 1, 5).translate(0, 0.5, 0);
const leashMaterial = new THREE.MeshLambertMaterial({ color: COLORS.fire, flatShading: true });
/** A four-pointed star one unit across, point to point, facing +z. */
const STAR_GEOMETRY = (() => {
	const rim = [
		[0, 0.5],
		[0.13, 0.13],
		[0.5, 0],
		[0.13, -0.13],
		[0, -0.5],
		[-0.13, -0.13],
		[-0.5, 0],
		[-0.13, 0.13]
	] as const;
	const positions: number[] = [];
	rim.forEach(([ax, ay], i) => {
		const [bx, by] = rim[(i + 1) % rim.length]!;
		positions.push(0, 0, 0, bx, by, 0, ax, ay, 0);
	});
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	return geometry;
})();
const sparkleMaterials = SPARKLE_COLORS.map(
	(hex) => new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide })
);
/** The shapes every scene shares, which nothing frees: for the memory test. */
export const FIGHT_GEOMETRIES: readonly THREE.BufferGeometry[] = [
	LOOP_GEOMETRY,
	ROPE_GEOMETRY,
	STAR_GEOMETRY
];

/** The thought bubble over a player thinking now: the puzzle as numbers (null: choosing), and how their last answer went. */
export interface ThoughtMark {
	puzzle: PuzzleFace | null;
	/** Right or wrong, while its little pop or wobble plays; `beat` counts them, so each one plays anew. */
	mood: 'right' | 'wrong' | null;
	beat: number;
	/** The middle of the two animals: the bubble leans away from it, off their names. */
	scene: THREE.Vector3;
}

/**
 * A small HP bar over an animal in a battle: where its head is (`at`, as it
 * moves; `rest`, standing on its spot, fully grown), who it is, how much HP
 * it has left.
 */
export interface BarMark {
	key: string;
	at: THREE.Vector3;
	rest: THREE.Vector3;
	animal: FightAnimal;
	maxHp: number;
	/** How much of it is there: it grows in and shrinks away with its animal. */
	opacity: number;
}

/** A damage number floating up from the animal hit: `id` is its own, for the page to play it once; `key` its animal's bar's. */
export interface PopMark {
	id: number;
	key: string;
	at: THREE.Vector3;
	damage: number;
	level: AttackLevel;
}

/** What the page draws over the battles this frame (`PresenceController.overlay`). */
export interface FightMarks {
	thoughts: Map<string, ThoughtMark>;
	bars: BarMark[];
	pops: PopMark[];
}

type MotionKind = 'appear' | 'recall' | 'lunge' | 'shake' | 'hop';

/** One side's animal, as drawn. */
interface Slot {
	animal: FightAnimal;
	figure: THREE.Group | null;
	/** Where it stands and which way it faces. */
	spot: THREE.Vector3;
	facing: Direction;
	/** The movement it is making, if any: seconds into it. */
	motion: { kind: MotionKind; t: number } | null;
	/** Lying down: 0 standing to 1 down, easing to `restTo`. */
	rest: number;
	restTo: number;
	/** Its size: a small animal drawn bigger (`MIN_HEIGHT`), else 1. */
	size: number;
	/** Recalled: its figure is shrinking away for good (a switch brings another in). */
	leaving: boolean;
}

interface Layout {
	/** Where each side's animal stands, and which way it faces. */
	spots: Record<MatchSide, { at: THREE.Vector3; facing: Direction }>;
	/** The player of each side (the wild side has none), the tile they stand on and the way they face it. */
	owners: Record<MatchSide, { pid: string; tile: GridPos; facing: Direction } | null>;
}

interface Leash {
	loop: THREE.Mesh;
	rope: THREE.Mesh;
	from: THREE.Vector3;
	t: number;
	caught: boolean;
}

interface Sparkle {
	mesh: THREE.Mesh;
	from: THREE.Vector3;
	drift: THREE.Vector3;
	delay: number;
	t: number;
}

interface Fight {
	readonly pid: string;
	readonly vs: string | null;
	/** How the battle stands, as last said: where the events still to play end. */
	target: FightView;
	/** Whose turn it is and their puzzle, as drawn now. */
	turn: MatchSide | null;
	puzzle: PuzzleFace | null;
	mood: { kind: 'right' | 'wrong'; beat: number } | null;
	slots: Record<MatchSide, Slot>;
	queue: FightEvent[];
	/** The event playing now: seconds into its beat, and the moments of it already played. */
	beat: { event: FightEvent; t: number; length: number; done: Set<string> } | null;
	/** Where it is laid out; null while it is not drawn. */
	layout: Layout | null;
	/** It ended: its end is to play, or is playing; a new battle of the same player is a new scene. */
	over: boolean;
	/** The scene is clearing: its animals shrinking away, `closingT` seconds in. */
	closing: boolean;
	closingT: number;
	/** Seconds its players have not said they are in it. */
	unsaid: number;
	leash: Leash | null;
	sparkles: Sparkle[];
}

let beats = 0;
let pops = 0;

export class WatchedFights {
	private readonly fights = new Map<string, Fight>();
	private readonly pool: FigurePool;
	private seed = 0;
	private centre: GridPos = { x: 0, y: 0 };
	private popping: (PopMark & { t: number })[] = [];

	constructor(
		private readonly scene: THREE.Scene,
		private readonly host: FigureHost,
		private readonly poofs: Poofs,
		private readonly others: Pick<OtherPlayers, 'spotOf' | 'stand' | 'cheer'>
	) {
		this.pool = new FigurePool(host);
	}

	/** How many battles are known, drawn or not: for tests. */
	get count(): number {
		return this.fights.size;
	}

	/** How many are drawn now: for tests. */
	get drawn(): number {
		return [...this.fights.values()].filter((f) => f.layout !== null).length;
	}

	/** The figures lent out and kept in the pool: for tests. */
	get figures(): { lent: number; kept: number } {
		return this.pool.counts();
	}

	/** The world on screen: another world's battles all go at once. */
	setWorld(seed: number): void {
		if (seed === this.seed) return;
		this.clear();
		this.seed = seed;
	}

	/** Where the middle of the screen is (the player's tile): the battles nearest it are drawn. */
	setCentre(pos: GridPos): void {
		this.centre = { x: pos.x, y: pos.y };
	}

	/**
	 * A battle near the player, as the server says it stands (`fight`): a new
	 * one pops in beside its players; a known one plays `events` on its way
	 * to `view`. A battle whose end is showing gives way at once to a new
	 * one of the same player.
	 */
	show(message: FightMessage): void {
		let fight = this.fights.get(message.pid);
		if (fight && (fight.over || fight.closing || fight.vs !== message.vs)) {
			this.drop(fight);
			fight = undefined;
		}
		if (!fight) {
			fight = newFight(message);
			this.fights.set(message.pid, fight);
			return;
		}
		fight.target = message.view;
		fight.queue.push(...message.events);
		if (message.events.some((e) => e.type === 'ended')) fight.over = true;
		if (fight.queue.length > SKIP_AFTER) {
			// Far behind (a page that was away): straight to how it stands, and its end if it ended.
			const end = fight.queue.find((e) => e.type === 'ended');
			fight.queue = end ? [end] : [];
			fight.beat = null;
			this.settle(fight);
		}
	}

	/** Every battle goes at once: another world, the title, the socket gone. */
	clear(): void {
		for (const fight of this.fights.values()) this.drop(fight);
		this.fights.clear();
		this.popping = [];
		this.pool.clear();
	}

	/** Play every battle on by `dt` seconds (`t` is the renderer's clock, for the sparkles' turn). */
	update(t: number, dt: number): void {
		this.popping = this.popping.filter((p) => (p.t += dt) < POP_SECONDS);
		const near = this.nearest();
		for (const fight of [...this.fights.values()]) {
			const spots = this.spotsOf(fight);
			if (!fight.closing && !this.stillOn(fight, spots, dt)) this.close(fight);
			if (fight.closing) {
				// Its animals shrink away where they stand; then it is gone.
				fight.closingT += dt;
				if (!fight.layout || fight.closingT >= RECALL_SECONDS) {
					this.drop(fight);
					this.fights.delete(fight.pid);
				} else this.pose(fight, t, dt);
				continue;
			}
			const drawn = near.has(fight);
			if (drawn && !fight.layout) this.lay(fight, spots);
			if (!drawn && fight.layout) this.putAway(fight);
			if (!fight.layout) {
				// Not drawn: it keeps up with how it stands and plays nothing; one that ended is gone.
				fight.beat = null;
				if (fight.over) this.close(fight);
				else {
					fight.queue = [];
					this.settle(fight);
				}
				continue;
			}
			this.play(fight, dt);
			this.pose(fight, t, dt);
		}
	}

	/** What the page draws over the battles this frame: thought bubbles, HP bars, damage numbers. */
	marks(): FightMarks {
		const thoughts = new Map<string, ThoughtMark>();
		const bars: BarMark[] = [];
		for (const fight of this.fights.values()) {
			if (!fight.layout || fight.closing) continue;
			const thinker = fight.turn === null ? null : this.ownerPid(fight, fight.turn);
			if (thinker !== null) {
				thoughts.set(thinker, {
					puzzle: fight.puzzle,
					mood: fight.mood?.kind ?? null,
					beat: fight.mood?.beat ?? 0,
					scene: fight.slots.a.spot.clone().lerp(fight.slots.b.spot, 0.5)
				});
			}
			for (const side of SIDES) {
				const slot = fight.slots[side];
				if (!slot.figure || slot.leaving) continue;
				const height = heightOf(slot.figure) * slot.figure.scale.y;
				bars.push({
					key: barKey(fight, side),
					at: slot.figure.position.clone().setY(slot.figure.position.y + height + BAR_LIFT),
					rest: slot.spot.clone().setY(slot.spot.y + tallness(slot) + BAR_LIFT),
					animal: { ...slot.animal },
					maxHp: getAnimal(slot.animal.species).maxHp,
					// A tired one's tag fades as it lies down: its z's say it, and the tag would hide them.
					opacity: Math.max(0, Math.min(1, slot.figure.scale.x / slot.size)) * (1 - slot.rest)
				});
			}
		}
		const popped = this.popping.map(({ t: _t, ...pop }) => pop);
		return { thoughts, bars, pops: popped };
	}

	// --- which are drawn ----------------------------------------------------------------

	/** The battles to draw: the nearest the middle of the screen, within reach, at most `MAX_FIGHTS`. */
	private nearest(): Set<Fight> {
		const within: { fight: Fight; apart: number }[] = [];
		for (const fight of this.fights.values()) {
			const spot =
				this.others.spotOf(fight.pid) ?? (fight.vs ? this.others.spotOf(fight.vs) : null);
			if (!spot) continue;
			const apart = Math.abs(spot.tile.x - this.centre.x) + Math.abs(spot.tile.y - this.centre.y);
			if (apart <= FIGHT_NEAR) within.push({ fight, apart });
		}
		within.sort((a, b) => a.apart - b.apart);
		return new Set(within.slice(0, MAX_FIGHTS).map((w) => w.fight));
	}

	/** Where each of a battle's players is drawn, if they are. */
	private spotsOf(fight: Fight): Record<MatchSide, OtherSpot | null> {
		return {
			a: this.others.spotOf(fight.pid),
			b: fight.vs ? this.others.spotOf(fight.vs) : null
		};
	}

	/**
	 * Whether a battle is still to be seen: its players drawn where it was
	 * laid out, and saying they are in it (with `GRACE_SECONDS` for the
	 * moment they have yet to say so). Any other thing they say they do (up
	 * in the air, at the doctor) ends it at once.
	 */
	private stillOn(fight: Fight, spots: Record<MatchSide, OtherSpot | null>, dt: number): boolean {
		const here = SIDES.map((side) => spots[side]).filter((s): s is OtherSpot => s !== null);
		if (here.length === 0) return false;
		const busy: Busy = fight.vs === null ? 'battle' : 'match';
		if (here.some((s) => s.busy !== busy && s.busy !== 'explore')) return false;
		if (here.some((s) => s.busy === 'explore')) {
			fight.unsaid += dt;
			if (fight.unsaid > GRACE_SECONDS) return false;
		} else fight.unsaid = 0;
		const layout = fight.layout;
		if (layout) {
			for (const side of SIDES) {
				const owner = layout.owners[side];
				const spot = spots[side];
				if (owner && (!spot || spot.tile.x !== owner.tile.x || spot.tile.y !== owner.tile.y)) {
					// Somewhere else before its end was shown (they walked on from the result card
					// while it still plays here): the end plays out where it was fought, without them.
					if (spot && fight.over) {
						this.others.stand(owner.pid, null);
						layout.owners[side] = null;
						continue;
					}
					// Gone, or put somewhere else: the scene is not where they are.
					return false;
				}
			}
		}
		return true;
	}

	// --- laying out ---------------------------------------------------------------------

	/** Lay a battle out beside its players, and send its animals out. */
	private lay(fight: Fight, spots: Record<MatchSide, OtherSpot | null>): void {
		let layout: Layout | null = null;
		if (fight.vs !== null && spots.a && spots.b) layout = this.matchLayout(fight, spots.a, spots.b);
		else if (spots.a) layout = this.lineLayout(fight, spots.a, 'a');
		// A match with only its side b's player in view: laid out round them.
		else if (spots.b && fight.vs !== null) layout = this.lineLayout(fight, spots.b, 'b');
		if (!layout) return;
		fight.layout = layout;
		for (const side of SIDES) {
			const slot = fight.slots[side];
			slot.spot.copy(layout.spots[side].at);
			slot.facing = layout.spots[side].facing;
			this.sendOut(fight, side, slot.animal);
			const owner = layout.owners[side];
			if (owner) this.others.stand(owner.pid, owner.facing);
		}
		// The wild animal pops out of the grass.
		if (fight.vs === null) this.puff(layout.spots.b.at, 0.6);
	}

	/**
	 * A wild battle (or a match with only one of its players in view, `side`):
	 * the two animals in a line in front of the player, theirs nearer, facing
	 * each other, the way across the screen first, on ground (or out at sea,
	 * water) they could stand on.
	 */
	private lineLayout(fight: Fight, spot: OtherSpot, side: MatchSide): Layout {
		const at = spot.tile;
		const realm = fight.target.realm;
		const order: Direction[] = [
			...(spot.facing === 'left' || spot.facing === 'right' ? [spot.facing] : []),
			'right',
			'left',
			spot.facing,
			'down',
			'up'
		];
		const ways = [...new Set(order)];
		const room = (d: Direction) => {
			const one = step(at, d);
			const two = step(one, d);
			return (this.canStand(one, realm) ? 1 : 0) + (this.canStand(two, realm) ? 2 : 0);
		};
		// The first way with room for both; else the one with the most, the way across first.
		const facing =
			ways.find((d) => room(d) === 3) ??
			ways.reduce((best, d) => (room(d) > room(best) ? d : best));
		const ahead = AHEAD[facing];
		const place = (out: number) => this.standAt(at.x + ahead.x * out, at.y + ahead.z * out, realm);
		const near = { at: place(NEAR_OUT), facing };
		const far = { at: place(FAR_OUT), facing: OPPOSITE[facing] };
		const owner = { pid: side === 'a' ? fight.pid : fight.vs!, tile: { ...at }, facing };
		return side === 'a'
			? { spots: { a: near, b: far }, owners: { a: owner, b: null } }
			: { spots: { a: far, b: near }, owners: { a: null, b: owner } };
	}

	/**
	 * A friendly match: the two animals side by side in front of the two
	 * players, facing each other along the way from one player to the other,
	 * each on its own player's side; in front towards the camera where there
	 * is room, so the two kids and their bubbles stay clear of them.
	 */
	private matchLayout(fight: Fight, a: OtherSpot, b: OtherSpot): Layout {
		const dx = b.tile.x - a.tile.x;
		const dz = b.tile.y - a.tile.y;
		const across = Math.abs(dx) >= Math.abs(dz);
		// From a's player towards b's, along one axis of the grid.
		const along: Direction = across ? (dx >= 0 ? 'right' : 'left') : dz >= 0 ? 'down' : 'up';
		const fronts: Direction[] = across ? ['down', 'up'] : ['right', 'left'];
		const mid = { x: (a.tile.x + b.tile.x) / 2, y: (a.tile.y + b.tile.y) / 2 };
		const u = AHEAD[along];
		const spotAt = (front: Direction, side: MatchSide) => {
			const f = AHEAD[front];
			const sign = side === 'a' ? -1 : 1;
			return {
				x: mid.x + f.x * MATCH_OUT + u.x * sign * (MATCH_APART / 2),
				y: mid.y + f.z * MATCH_OUT + u.z * sign * (MATCH_APART / 2)
			};
		};
		const tileOf = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });
		const front =
			fronts.find((f) => SIDES.every((s) => this.canStand(tileOf(spotAt(f, s)), 'land'))) ??
			fronts[0]!;
		const place = (side: MatchSide) => {
			const p = spotAt(front, side);
			return this.standAt(p.x, p.y, 'land');
		};
		return {
			spots: {
				a: { at: place('a'), facing: along },
				b: { at: place('b'), facing: OPPOSITE[along] }
			},
			owners: {
				a: { pid: fight.pid, tile: { ...a.tile }, facing: front },
				b: { pid: fight.vs!, tile: { ...b.tile }, facing: front }
			}
		};
	}

	/** The player of `side` as the scene is laid out (the wild side has none, nor one out of view). */
	private ownerPid(fight: Fight, side: MatchSide): string | null {
		return fight.layout?.owners[side]?.pid ?? null;
	}

	/**
	 * Whether an animal could be on a tile where the battle is fought: ground
	 * on land, water at sea; up in the air, over ground or water, never inside
	 * a tree, a rock or a tent.
	 */
	private canStand(p: GridPos, realm: Realm): boolean {
		const kind = tileAtWorld(this.seed, p.x, p.y).kind;
		if (realm === 'air') return isWalkable(kind) || isWater(kind);
		return realm === 'water' ? isWater(kind) : isWalkable(kind) && !isWater(kind);
	}

	/**
	 * Where an animal's feet go at a point (tiles): the ground's top; out at
	 * sea, low in the water; up in the air, `AIR_HOVER` over the ground or the
	 * water, where the birds fly.
	 */
	private standAt(x: number, z: number, realm: Realm): THREE.Vector3 {
		const tile = tileAtWorld(this.seed, Math.round(x), Math.round(z));
		const y = realm === 'water' || isWater(tile.kind) ? WATER_TOP : groundTop(tile);
		return new THREE.Vector3(x, y + (realm === 'air' ? AIR_HOVER : 0), z);
	}

	// --- playing -------------------------------------------------------------------------

	/** The events on their way: one beat at a time, faster when many wait; after the end's beat, it clears. */
	private play(fight: Fight, dt: number): void {
		const hurry = fight.queue.length > HURRY_AFTER ? 2 : 1;
		if (!fight.beat) {
			const next = fight.queue.shift();
			if (!next) {
				this.settle(fight);
				return;
			}
			fight.beat = { event: next, t: 0, length: beatLength(next), done: new Set() };
		}
		const beat = fight.beat;
		beat.t += dt * hurry;
		this.beatMoments(fight, beat);
		if (beat.t >= beat.length) {
			fight.beat = null;
			if (beat.event.type === 'ended') this.close(fight);
		}
	}

	/** What an event does, moment by moment through its beat: each moment once. */
	private beatMoments(fight: Fight, beat: NonNullable<Fight['beat']>): void {
		const at = (moment: string, when: number, run: () => void) => {
			if (beat.t >= when && !beat.done.has(moment)) {
				beat.done.add(moment);
				run();
			}
		};
		const event = beat.event;
		switch (event.type) {
			case 'puzzle':
				at('show', 0, () => {
					fight.turn = event.side;
					fight.puzzle = event.puzzle;
					fight.mood = null;
				});
				return;
			case 'judged':
				at('mood', 0, () => {
					fight.turn = event.side;
					fight.mood = { kind: event.correct ? 'right' : 'wrong', beat: ++beats };
				});
				at('done', beat.length * 0.9, () => {
					fight.puzzle = null;
					fight.mood = null;
				});
				return;
			case 'hit': {
				const target = otherSide(event.attacker);
				at('lunge', 0, () => this.move(fight, event.attacker, 'lunge'));
				at('land', LUNGE_SECONDS * 0.5, () => {
					this.move(fight, target, 'shake');
					fight.slots[target].animal = { ...fight.slots[target].animal, hp: event.hp };
					this.pop(fight, target, event.damage, event.level);
					const owner = this.ownerPid(fight, event.attacker);
					if (owner) this.others.cheer(owner);
				});
				return;
			}
			case 'missed':
				at('lunge', 0, () => this.move(fight, event.attacker, 'lunge'));
				at('puff', LUNGE_SECONDS * 0.5, () => {
					const slot = fight.slots[otherSide(event.attacker)];
					this.puff(slot.spot, 0.45);
				});
				return;
			case 'leash':
				at('throw', 0, () => this.throwLeash(fight, event.caught));
				at('after', LEASH_FLIGHT_SECONDS, () => {
					if (event.caught) this.sparkle(fight, 'b');
					else this.move(fight, 'b', 'shake');
				});
				return;
			case 'switched':
				at('out', 0, () => {
					this.puff(fight.slots[event.side].spot, 0.6);
					this.recall(fight, event.side);
				});
				at('in', RECALL_SECONDS, () => this.sendOut(fight, event.side, event.animal));
				return;
			case 'fainted':
				at('down', 0, () => {
					const slot = fight.slots[event.side];
					slot.animal = { ...slot.animal, hp: 0 };
					slot.restTo = 1;
				});
				at('dust', FAINT_SECONDS * 0.75, () => this.puff(fight.slots[event.side].spot, 0.5));
				return;
			case 'ended':
				at('end', 0, () => {
					fight.turn = null;
					fight.puzzle = null;
					fight.mood = null;
					const winner = event.winner;
					if (winner) {
						const owner = this.ownerPid(fight, winner);
						if (owner) this.others.cheer(owner, true);
						if (event.how !== 'caught') this.move(fight, winner, 'hop');
					}
					if (event.how === 'fled') this.recall(fight, 'a');
					if (event.how === 'left' && winner) this.recall(fight, otherSide(winner));
				});
				at('away', 0.6, () => {
					// Caught: it goes with the fighter, in a sparkle. Ran away: the wild one goes off too.
					if (event.how === 'caught') {
						this.sparkle(fight, 'b');
						this.recall(fight, 'b');
						this.dropLeash(fight);
					}
					if (event.how === 'fled') this.recall(fight, 'b');
				});
				return;
		}
	}

	/** Once nothing waits: drawn as it stands (`target`), quietly. */
	private settle(fight: Fight): void {
		const target = fight.target;
		fight.turn = target.turn;
		if (!fight.mood) fight.puzzle = target.puzzle;
		for (const side of SIDES) {
			const slot = fight.slots[side];
			const want = target[side];
			if (slot.animal.species !== want.species && fight.layout && !slot.leaving) {
				// Someone else is in front (a step this page never saw): they swap in a puff.
				this.puff(slot.spot, 0.6);
				this.sendOut(fight, side, want);
			}
			slot.animal = { ...want };
			if (!slot.leaving) slot.restTo = want.hp === 0 ? 1 : 0;
			if (!fight.layout) slot.rest = slot.restTo;
		}
	}

	/** Its end is shown, or it is no longer to be seen: its animals go, and its players are free again. */
	private close(fight: Fight): void {
		if (fight.closing) return;
		fight.closing = true;
		fight.closingT = 0;
		fight.beat = null;
		fight.queue = [];
		fight.turn = null;
		fight.mood = null;
		for (const side of SIDES) {
			const slot = fight.slots[side];
			if (slot.figure && !slot.leaving) {
				this.recall(fight, side);
				this.puff(slot.spot, 0.5);
			}
		}
		this.dropLeash(fight);
		this.release(fight);
	}

	// --- the figures ---------------------------------------------------------------------

	/** An animal comes out on `side`'s spot: grown in, the battle's send-out. */
	private sendOut(fight: Fight, side: MatchSide, animal: FightAnimal): void {
		const slot = fight.slots[side];
		if (slot.figure) this.pool.give(slot.figure);
		slot.animal = { ...animal };
		slot.leaving = false;
		slot.rest = animal.hp === 0 ? 1 : 0;
		slot.restTo = slot.rest;
		if (!fight.layout) {
			slot.figure = null;
			return;
		}
		const figure = this.pool.take(animal.species);
		figure.position.copy(slot.spot);
		figure.rotation.y = FACING_ANGLE[slot.facing];
		figure.scale.setScalar(0.001);
		figure.userData.rest = slot.rest;
		slot.figure = figure;
		slot.size = Math.min(MAX_GROW, Math.max(1, MIN_HEIGHT / heightOf(figure)));
		slot.motion = { kind: 'appear', t: 0 };
		// Out at sea it swims, the lower part of it under the surface.
		if (fight.target.realm === 'water') {
			slot.spot.y = WATER_TOP - heightOf(figure) * slot.size * SWIM_DEPTH;
		}
	}

	/** `side`'s animal shrinks away (a switch, the end): gone once the recall is over. */
	private recall(fight: Fight, side: MatchSide): void {
		const slot = fight.slots[side];
		if (!slot.figure || slot.leaving) return;
		slot.leaving = true;
		slot.motion = { kind: 'recall', t: 0 };
	}

	private move(fight: Fight, side: MatchSide, kind: MotionKind): void {
		const slot = fight.slots[side];
		if (slot.figure && !slot.leaving) slot.motion = { kind, t: 0 };
	}

	/** Pose both animals, the leash and the sparkles for this frame. */
	private pose(fight: Fight, t: number, dt: number): void {
		const calm = motion.reduced;
		const k = calm ? 0.35 : 1;
		for (const side of SIDES) {
			const slot = fight.slots[side];
			const figure = slot.figure;
			if (!figure) continue;
			slot.rest +=
				Math.sign(slot.restTo - slot.rest) *
				Math.min(Math.abs(slot.restTo - slot.rest), dt / FAINT_SECONDS);
			figure.userData.rest = smoothstep(slot.rest);
			figure.position.copy(slot.spot);
			// Up in the air the two birds fly, bobbing with their wingbeats (not with reduced
			// motion); a tired one comes down to rest on the ground below, folding its wings.
			if (fight.target.realm === 'air') {
				const down = smoothstep(slot.rest);
				const phase = (figure.userData.idlePhase as number | undefined) ?? 0;
				const bob = calm ? 0 : Math.sin(t * 2.4 + phase) * 0.04;
				figure.position.y += bob * (1 - down) - AIR_HOVER * down;
				animateFlight(figure, t, 1 - down, calm);
			}
			figure.rotation.y = FACING_ANGLE[slot.facing];
			figure.scale.setScalar(slot.size);
			const m = slot.motion;
			if (m) {
				m.t += dt;
				const length = motionSeconds(m.kind);
				const p = Math.min(1, m.t / length);
				const other = fight.slots[otherSide(side)].spot;
				switch (m.kind) {
					case 'appear':
						figure.scale.setScalar(slot.size * appearScale(p, calm));
						break;
					case 'recall':
						figure.scale.setScalar(slot.size * recallScale(p));
						figure.position.y += Math.sin(p * Math.PI) * 0.15 * k;
						break;
					case 'lunge': {
						const dx = other.x - slot.spot.x;
						const dz = other.z - slot.spot.z;
						const len = Math.hypot(dx, dz) || 1;
						const reach = Math.sin(p * Math.PI) * LUNGE_REACH * k;
						figure.position.x += (dx / len) * reach;
						figure.position.z += (dz / len) * reach;
						figure.position.y += Math.sin(p * Math.PI) * 0.1 * k;
						break;
					}
					case 'shake': {
						// Side to side, across the line between the two.
						const dx = other.x - slot.spot.x;
						const dz = other.z - slot.spot.z;
						const len = Math.hypot(dx, dz) || 1;
						const wobble = Math.sin(p * Math.PI * 6) * 0.1 * (1 - p) * k;
						figure.position.x += (-dz / len) * wobble;
						figure.position.z += (dx / len) * wobble;
						break;
					}
					case 'hop':
						figure.position.y += Math.abs(Math.sin(p * Math.PI * 2)) * 0.22 * (1 - p * 0.5) * k;
						break;
				}
				if (p >= 1) {
					slot.motion = null;
					if (m.kind === 'recall') {
						this.pool.give(figure);
						slot.figure = null;
					}
				}
			}
		}
		this.poseLeash(fight, dt);
		this.poseSparkles(fight, t, dt);
	}

	// --- the leash and the sparkles --------------------------------------------------------

	private throwLeash(fight: Fight, caught: boolean): void {
		this.dropLeash(fight);
		const owner = this.others.spotOf(fight.pid);
		if (!owner || !fight.slots.b.figure) return;
		const facing = fight.layout?.owners.a?.facing ?? 'down';
		const ahead = AHEAD[facing];
		const from = owner.feet.clone().add(new THREE.Vector3(ahead.x * 0.2, 0.55, ahead.z * 0.2));
		const loop = new THREE.Mesh(LOOP_GEOMETRY, leashMaterial);
		const rope = new THREE.Mesh(ROPE_GEOMETRY, leashMaterial);
		this.scene.add(loop, rope);
		fight.leash = { loop, rope, from, t: 0, caught };
	}

	private poseLeash(fight: Fight, dt: number): void {
		const leash = fight.leash;
		const slot = fight.slots.b;
		if (!leash) return;
		leash.t += dt;
		const neck = slot.spot.clone();
		neck.y += tallness(slot) * 0.7;
		const s = smoothstep(leash.t / LEASH_FLIGHT_SECONDS);
		const loopAt = leash.from.clone().lerp(neck, s);
		loopAt.y += Math.sin(s * Math.PI) * LEASH_ARC * (motion.reduced ? 0.5 : 1);
		const after = leash.t - LEASH_FLIGHT_SECONDS;
		if (after > 0 && !leash.caught) {
			// Shaken off: it drops to the ground and shrinks away.
			const q = Math.min(1, after / LEASH_AFTER_SECONDS);
			loopAt.y -= (neck.y - slot.spot.y) * q;
			leash.loop.scale.setScalar(Math.max(0.001, 1 - q));
			if (q >= 1) {
				this.dropLeash(fight);
				return;
			}
		}
		leash.loop.position.copy(loopAt);
		leash.loop.rotation.set(Math.PI / 2 - 0.6, FACING_ANGLE[fight.slots.a.facing], 0);
		const span = loopAt.clone().sub(leash.from);
		leash.rope.position.copy(leash.from);
		leash.rope.scale.set(1, Math.max(0.001, span.length()), 1);
		leash.rope.quaternion.setFromUnitVectors(UP, span.normalize());
	}

	private dropLeash(fight: Fight): void {
		if (!fight.leash) return;
		this.scene.remove(fight.leash.loop, fight.leash.rope);
		fight.leash = null;
	}

	/** A ring of the doctor's stars popping round `side`'s animal. */
	private sparkle(fight: Fight, side: MatchSide): void {
		const slot = fight.slots[side];
		const count = motion.reduced ? 4 : 8;
		const height = tallness(slot);
		for (let i = 0; i < count; i++) {
			const turn = (i / count) * Math.PI * 2;
			const mesh = new THREE.Mesh(STAR_GEOMETRY, sparkleMaterials[i % sparkleMaterials.length]!);
			mesh.scale.setScalar(0.001);
			this.scene.add(mesh);
			fight.sparkles.push({
				mesh,
				from: slot.spot
					.clone()
					.add(
						new THREE.Vector3(
							Math.cos(turn) * 0.35,
							height * (0.4 + (0.5 * ((i * 7) % 3)) / 2),
							Math.sin(turn) * 0.35
						)
					),
				drift: new THREE.Vector3(Math.cos(turn) * 0.15, 0.3, Math.sin(turn) * 0.15),
				delay: (i % 4) * 0.08,
				t: 0
			});
		}
	}

	private poseSparkles(fight: Fight, t: number, dt: number): void {
		if (!fight.sparkles.length) return;
		fight.sparkles = fight.sparkles.filter((s) => {
			s.t += dt;
			const p = (s.t - s.delay) / SPARKLE_SECONDS;
			if (p >= 1) {
				this.scene.remove(s.mesh);
				return false;
			}
			const q = Math.max(0, p);
			s.mesh.visible = p >= 0;
			s.mesh.position.copy(s.from).addScaledVector(s.drift, q * (motion.reduced ? 0.3 : 1));
			s.mesh.scale.setScalar(Math.max(0.001, Math.sin(q * Math.PI) * 0.22));
			s.mesh.rotation.set(0, 0, t * 2 + q * Math.PI);
			return true;
		});
	}

	// --- little things ------------------------------------------------------------------

	/** A damage number floating up from `side`'s animal: at most `MAX_POPS` at once, the oldest giving way. */
	private pop(fight: Fight, side: MatchSide, damage: number, level: AttackLevel): void {
		const slot = fight.slots[side];
		const at = slot.spot.clone().setY(slot.spot.y + tallness(slot) + 0.1);
		this.popping.push({ id: ++pops, key: barKey(fight, side), at, damage, level, t: 0 });
		if (this.popping.length > MAX_POPS) this.popping.shift();
	}

	private puff(at: THREE.Vector3, size: number): void {
		this.poofs.play(new THREE.Vector3(at.x, at.y, at.z), motion.reduced, size);
	}

	/** Not drawn any more (far off, or others nearer): its figures go back, its players are free. */
	private putAway(fight: Fight): void {
		for (const side of SIDES) {
			const slot = fight.slots[side];
			if (slot.figure) this.pool.give(slot.figure);
			slot.figure = null;
			slot.motion = null;
			slot.leaving = false;
		}
		this.dropLeash(fight);
		for (const s of fight.sparkles) this.scene.remove(s.mesh);
		fight.sparkles = [];
		this.release(fight);
		fight.layout = null;
	}

	/** Its players stand as they like again, and their leads follow them. */
	private release(fight: Fight): void {
		const layout = fight.layout;
		if (!layout) return;
		for (const side of SIDES) {
			const owner = layout.owners[side];
			if (owner) this.others.stand(owner.pid, null);
		}
	}

	/** Gone for good: everything it drew is given back or taken away. */
	private drop(fight: Fight): void {
		this.putAway(fight);
	}
}

function newFight(message: FightMessage): Fight {
	const view = message.view;
	const slot = (animal: FightAnimal): Slot => ({
		animal: { ...animal },
		figure: null,
		spot: new THREE.Vector3(),
		facing: 'down',
		motion: null,
		rest: animal.hp === 0 ? 1 : 0,
		restTo: animal.hp === 0 ? 1 : 0,
		size: 1,
		leaving: false
	});
	return {
		pid: message.pid,
		vs: message.vs,
		target: view,
		turn: view.turn,
		puzzle: view.puzzle,
		mood: null,
		slots: { a: slot(view.a), b: slot(view.b) },
		// A battle that ended as it came into view is only its end.
		queue: message.events.filter((e) => e.type === 'ended'),
		beat: null,
		layout: null,
		over: message.events.some((e) => e.type === 'ended'),
		closing: false,
		closingT: 0,
		unsaid: 0,
		leash: null,
		sparkles: []
	};
}

const UP = new THREE.Vector3(0, 1, 0);

function otherSide(side: MatchSide): MatchSide {
	return side === 'a' ? 'b' : 'a';
}

/** How long each event's beat is: what it shows, and a breath after. */
function beatLength(event: FightEvent): number {
	switch (event.type) {
		case 'puzzle':
			return 0.35;
		case 'judged':
			return 0.8;
		case 'hit':
			return 0.95;
		case 'missed':
			return 0.8;
		case 'leash':
			return LEASH_FLIGHT_SECONDS + LEASH_AFTER_SECONDS;
		case 'switched':
			return RECALL_SECONDS + APPEAR_SECONDS + 0.1;
		case 'fainted':
			return FAINT_SECONDS + 0.3;
		case 'ended':
			return END_SECONDS;
	}
}

function motionSeconds(kind: MotionKind): number {
	switch (kind) {
		case 'appear':
			return APPEAR_SECONDS;
		case 'recall':
			return RECALL_SECONDS;
		case 'lunge':
			return LUNGE_SECONDS;
		case 'shake':
			return SHAKE_SECONDS;
		case 'hop':
			return HOP_SECONDS;
	}
}

/** How far over an animal's head (tiles) its bar's tag sits. */
const BAR_LIFT = 0.18;

/** The key of a side's bar, and of the damage floating up from it. */
function barKey(fight: Fight, side: MatchSide): string {
	return `${fight.pid}:${side}`;
}

/** How tall a figure stands at its own size (`animals.ts` measures it as it is built). */
function heightOf(figure: THREE.Group): number {
	return (figure.userData.restShape as { height: number } | undefined)?.height ?? 0.4;
}

/** How tall a side's animal stands as drawn in its battle (a small one drawn bigger). */
function tallness(slot: Slot): number {
	return slot.figure ? heightOf(slot.figure) * slot.size : 0.4;
}

/**
 * The animals' figures, lent to the scenes and given back: a battle's end
 * and a switch give one back, the next battle takes it, so a crowd of
 * battles builds few. Up to `PER_SPECIES` of a kind are kept, `KEPT` in
 * all; the rest are freed as they come back ([[INVARIANTS]] § Rendering).
 */
export class FigurePool {
	static readonly PER_SPECIES = 2;
	static readonly KEPT = 12;
	private readonly free = new Map<string, THREE.Group[]>();
	private kept = 0;
	private lent = 0;

	constructor(private readonly host: FigureHost) {}

	counts(): { lent: number; kept: number } {
		return { lent: this.lent, kept: this.kept };
	}

	take(species: string): THREE.Group {
		const figure = this.free.get(species)?.pop() ?? buildAnimalMesh(species);
		if (this.free.get(species)?.length === 0) this.free.delete(species);
		if (figure.parent === null) {
			// From the pool (or new): fresh as built, a bird's wings folded again.
			figure.scale.setScalar(1);
			figure.rotation.set(0, 0, 0);
			figure.userData.rest = 0;
			figure.userData.restSince = undefined;
			figure.userData.idlePhase = Math.random() * 6.28;
			animateFlight(figure, 0, 0);
		}
		if (this.kept > 0 && figure.userData.pooled) this.kept--;
		figure.userData.pooled = false;
		this.lent++;
		this.host.addFigure(figure);
		return figure;
	}

	give(figure: THREE.Group): void {
		if (figure.userData.pooled) return;
		this.host.removeFigure(figure);
		this.lent = Math.max(0, this.lent - 1);
		const species = figure.name;
		const list = this.free.get(species) ?? [];
		if (list.length >= FigurePool.PER_SPECIES || this.kept >= FigurePool.KEPT) {
			disposeFigure(figure);
			return;
		}
		figure.userData.pooled = true;
		list.push(figure);
		this.free.set(species, list);
		this.kept++;
	}

	/** Every figure kept is freed. */
	clear(): void {
		for (const list of this.free.values()) for (const figure of list) disposeFigure(figure);
		this.free.clear();
		this.kept = 0;
	}
}
