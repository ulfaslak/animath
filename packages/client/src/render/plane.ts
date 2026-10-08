import type { Direction } from '@mathgame/engine';
import * as THREE from 'three';
import { appearScale, smoothstep } from './ease';
import { instantiate, markJoint, release, takeShape } from './merge';
import { PLANE_COLORS } from './palette';
import { FACING_ANGLE } from './trainer';

/**
 * The little plane between lands ([[UI_SPEC]] § Explore mode, "The plane";
 * #191): a cheerful high-winged bush plane on skis, cream with orange wings
 * and a blue stripe, its propeller turning. Built from primitives and drawn
 * as one merged figure per piece that moves ([[DECISIONS]] § Client): the
 * plane itself, and its propeller, which spins.
 *
 * It comes down beside a kid, waits while they get on, and flies off screen
 * with them; in the land reached it flies in, lands, waits while they get
 * off and flies away. The same for the player's own trainer and for another
 * player's (`others.ts`), so `posePlane` is one function of where the plane
 * stands parked (`spot`), the way it points and how far along it is.
 *
 * Units are tiles, like the figures: the plane is about 1.9 long and 2.3
 * across its wings, its nose towards +z before it is turned.
 */

/** How far off the plane comes in from, and flies off to, along its way: well off the screen. */
export const FLY_DISTANCE = 16;
/** How high it is out there. */
export const FLY_HEIGHT = 9;
/** How far from its middle the door is, on the side a kid gets on at, and how high its sill. */
const DOOR_OUT = 0.3;
const DOOR_UP = 0.35;

function part(geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
	const m = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color, flatShading: true }));
	m.castShadow = true;
	return m;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number) {
	const g = new THREE.BoxGeometry(w, h, d);
	g.translate(x, y, z);
	return part(g, color);
}

/** The plane part by part, as built: what `buildPlaneMesh` merges, and what the tests measure. */
export function buildPlaneParts(): THREE.Group {
	const c = PLANE_COLORS;
	const plane = new THREE.Group();
	plane.name = 'plane';
	const body = markJoint(new THREE.Group());
	body.name = 'body';
	// The fuselage: a box tapering to the tail, with a blue stripe and windows along it.
	body.add(box(0.5, 0.48, 1.1, 0, 0.5, 0.15, c.body));
	const tail = new THREE.CylinderGeometry(0.12, 0.25, 0.75, 4, 1);
	tail.rotateY(Math.PI / 4);
	tail.rotateX(-Math.PI / 2);
	tail.scale(1.35, 1, 1);
	tail.translate(0, 0.58, -0.75);
	body.add(part(tail, c.body));
	body.add(box(0.52, 0.08, 1.12, 0, 0.42, 0.15, c.stripe));
	for (const side of [-1, 1]) {
		body.add(box(0.02, 0.15, 0.22, side * 0.255, 0.62, 0.38, c.window));
		body.add(box(0.02, 0.15, 0.2, side * 0.255, 0.62, 0.05, c.window));
	}
	// The windscreen, the nose and the engine cowling.
	const screen = new THREE.BoxGeometry(0.46, 0.2, 0.06);
	screen.rotateX(-0.6);
	screen.translate(0, 0.7, 0.63);
	body.add(part(screen, c.window));
	body.add(box(0.44, 0.4, 0.2, 0, 0.5, 0.78, c.wing));
	const spinner = new THREE.ConeGeometry(0.1, 0.18, 6);
	spinner.rotateX(Math.PI / 2);
	spinner.translate(0, 0.5, 0.97);
	body.add(part(spinner, c.dark));
	// The wing over the cabin, and its struts down to the body.
	body.add(box(2.3, 0.07, 0.42, 0, 0.78, 0.3, c.wing));
	for (const side of [-1, 1]) {
		body.add(box(0.12, 0.072, 0.42, side * 1.06, 0.785, 0.3, c.stripe));
		const strut = new THREE.BoxGeometry(0.03, 0.42, 0.03);
		strut.rotateZ(side * 0.95);
		strut.translate(side * 0.42, 0.6, 0.3);
		body.add(part(strut, c.dark));
	}
	// The tail's fin and its little wings.
	body.add(box(0.05, 0.36, 0.28, 0, 0.84, -1.0, c.wing));
	body.add(box(0.85, 0.05, 0.24, 0, 0.62, -1.02, c.wing));
	// Skis under it on struts, for the snow and the grass alike.
	for (const side of [-1, 1]) {
		body.add(box(0.03, 0.26, 0.03, side * 0.3, 0.2, 0.32, c.dark));
		body.add(box(0.03, 0.26, 0.03, side * 0.3, 0.2, 0.0, c.dark));
		body.add(box(0.1, 0.05, 0.75, side * 0.3, 0.05, 0.18, c.ski));
		const tip = new THREE.BoxGeometry(0.1, 0.05, 0.14);
		tip.rotateX(-0.6);
		tip.translate(side * 0.3, 0.09, 0.6);
		body.add(part(tip, c.ski));
	}
	plane.add(body);
	// The propeller, which spins about the nose.
	const propeller = markJoint(new THREE.Group());
	propeller.name = 'propeller';
	propeller.position.set(0, 0.5, 0.92);
	propeller.add(box(0.06, 0.7, 0.03, 0, 0, 0, c.dark));
	propeller.add(box(0.7, 0.06, 0.03, 0, 0, 0, c.dark));
	plane.add(propeller);
	return plane;
}

/** A new plane: its shape, merged, shared by every plane on screen until `disposePlane` lets the last go. */
export function buildPlaneMesh(): THREE.Group {
	return instantiate(takeShape('plane', 'grouped', () => ({ root: buildPlaneParts() })));
}

/** Let a plane go: its shape is freed with the last plane. */
export function disposePlane(plane: THREE.Object3D): void {
	release(plane);
}

/**
 * Where a plane is on its way: coming `in` to land, `parked` where it stands,
 * or going `out`, `p` along it (0..1).
 */
export interface PlanePose {
	way: 'in' | 'parked' | 'out';
	p: number;
}

/**
 * Put `plane` where `pose` has it: parked on `spot` (a point on the ground),
 * its nose `heading`. Coming in it glides down from far back along its way
 * and high up, nose a little down, and flattens out as it touches down;
 * going out it runs on along its way and climbs away, nose up. The propeller
 * spins at clock `t` (seconds), slowly while parked. With `calm` (reduced
 * motion) it never flies: it grows in where it stands, and shrinks away.
 */
export function posePlane(
	plane: THREE.Object3D,
	spot: THREE.Vector3,
	heading: Direction,
	pose: PlanePose,
	t: number,
	calm: boolean
): void {
	const angle = FACING_ANGLE[heading];
	const ahead = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
	const p = Math.min(1, Math.max(0, pose.p));
	plane.position.copy(spot);
	plane.rotation.set(0, angle, 0, 'YXZ');
	plane.scale.setScalar(1);
	plane.visible = true;
	let spin = 6;
	if (calm) {
		if (pose.way === 'in') plane.scale.setScalar(appearScale(p, true));
		if (pose.way === 'out') {
			plane.scale.setScalar(Math.max(0.001, 1 - smoothstep(p)));
			plane.visible = p < 1;
		}
	} else if (pose.way === 'in') {
		// From far back and high up, slowing: out there it is off the screen.
		const left = 1 - smoothstep(p);
		plane.position.addScaledVector(ahead, -FLY_DISTANCE * left);
		plane.position.y += FLY_HEIGHT * left * left;
		plane.rotation.x = 0.25 * left - 0.08 * Math.sin(Math.PI * p);
		spin = 30;
	} else if (pose.way === 'out') {
		// Running on, then climbing away, faster and faster.
		const gone = p * p;
		plane.position.addScaledVector(ahead, FLY_DISTANCE * gone);
		plane.position.y += FLY_HEIGHT * Math.pow(p, 3);
		plane.rotation.x = -0.35 * smoothstep(Math.min(1, p * 2));
		plane.visible = p < 1;
		spin = 30;
	}
	const propeller = plane.getObjectByName('propeller');
	if (propeller) propeller.rotation.z = calm ? 0 : t * spin;
}

/**
 * Where a plane parks beside a kid on `pos` facing `facing` (the witch
 * doctor's tent, at a flight's start and end): a step and a half behind
 * them, away from the tent, broadside to them, so they walk to its door; its
 * nose across their way. In grid units (x, then the grid's y as the world's z).
 */
export function planeSpot(
	pos: { x: number; y: number },
	facing: Direction
): { x: number; z: number; heading: Direction } {
	const back = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] }[facing];
	return {
		x: pos.x + back[0]! * 1.5,
		z: pos.y + back[1]! * 1.5,
		heading: facing === 'up' || facing === 'down' ? 'right' : 'up'
	};
}

/**
 * Where a kid standing at `from` gets on a plane parked on `spot`: its door,
 * on their side of it, up on its sill.
 */
export function doorOf(spot: THREE.Vector3, from: THREE.Vector3): THREE.Vector3 {
	const way = new THREE.Vector3(from.x - spot.x, 0, from.z - spot.z);
	if (way.lengthSq() > 0) way.setLength(DOOR_OUT);
	return spot
		.clone()
		.add(way)
		.setY(spot.y + DOOR_UP);
}

/** Seconds each part of a flight takes on screen: the plane coming in, a kid getting on or off, the plane going. */
export const PLANE_IN_SECONDS = 1.8;
export const PLANE_BOARD_SECONDS = 0.6;
export const PLANE_OUT_SECONDS = 1.6;
/** With reduced motion every part is this quick: the plane only grows in and shrinks away. */
export const CALM_PLANE_SECONDS = 0.5;

/**
 * One part of a plane's trip as another player's page sees it: the plane's
 * `way`, and the kid's `ride` into it (0 on their tile, 1 inside) from its
 * first number to its second. `hold`: it stays, parked, until the next part
 * is said (`PlaneTrip.then`).
 */
export interface PlaneLeg {
	way: PlanePose['way'];
	ride: readonly [number, number];
	seconds: number;
	hold?: true;
}

/** The plane comes down beside them, and they get on: it waits for them to go. */
export const BOARD_LEGS: readonly PlaneLeg[] = [
	{ way: 'in', ride: [0, 0], seconds: PLANE_IN_SECONDS },
	{ way: 'parked', ride: [0, 1], seconds: PLANE_BOARD_SECONDS, hold: true }
];
/** The plane comes down with them in it: it waits for them to get off. */
export const ARRIVE_LEGS: readonly PlaneLeg[] = [
	{ way: 'in', ride: [1, 1], seconds: PLANE_IN_SECONDS, hold: true }
];
/** They get off, and it flies away. */
export const ALIGHT_LEGS: readonly PlaneLeg[] = [
	{ way: 'parked', ride: [1, 0], seconds: PLANE_BOARD_SECONDS },
	{ way: 'out', ride: [0, 0], seconds: PLANE_OUT_SECONDS }
];
/** It flies off with them in it. */
export const LEAVE_LEGS: readonly PlaneLeg[] = [
	{ way: 'out', ride: [1, 1], seconds: PLANE_OUT_SECONDS }
];

/**
 * Another player's plane (`others.ts`): its figure, where it parks, and the
 * parts of its trip still to play, one after the other. A part that holds
 * stays parked at its end until `then` says what comes next.
 */
export class PlaneTrip {
	readonly figure: THREE.Group = buildPlaneMesh();
	private legs: PlaneLeg[];
	private p = 0;

	constructor(
		readonly spot: { x: number; z: number; heading: Direction },
		legs: readonly PlaneLeg[]
	) {
		this.legs = [...legs];
	}

	/** What comes after the part playing now (or held): it goes on as soon as that part is done. */
	then(legs: readonly PlaneLeg[]): void {
		const now = this.legs[0];
		this.legs = now ? [{ ...now, hold: undefined }, ...legs] : [...legs];
		if (now?.hold && this.p >= 1) {
			this.legs.shift();
			this.p = 0;
		}
	}

	/** The trip is over: the plane has gone. */
	get done(): boolean {
		return this.legs.length === 0;
	}

	/** On `dt` seconds: where the plane is on its way, and how far the kid is into it. */
	advance(dt: number, calm: boolean): { pose: PlanePose; ride: number } {
		let leg = this.legs[0];
		if (!leg) return { pose: { way: 'out', p: 1 }, ride: 0 };
		this.p = Math.min(1, this.p + dt / (calm ? CALM_PLANE_SECONDS : leg.seconds));
		if (this.p >= 1 && !leg.hold) {
			this.legs.shift();
			const next = this.legs[0];
			if (!next) return { pose: { way: leg.way, p: 1 }, ride: leg.ride[1] };
			this.p = 0;
			leg = next;
		}
		const p = this.p;
		const pose: PlanePose = { way: leg.hold && leg.way === 'in' && p >= 1 ? 'parked' : leg.way, p };
		return { pose, ride: leg.ride[0] + (leg.ride[1] - leg.ride[0]) * smoothstep(p) };
	}

	dispose(): void {
		this.figure.removeFromParent();
		disposePlane(this.figure);
	}
}
