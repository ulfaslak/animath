import * as THREE from 'three';
import { motion } from '../motion';
import { ANIMAL_COLORS, COLORS } from './palette';

/**
 * Crude but recognisable figures built from primitives: one per species in
 * the engine catalog, plus the trainer. The bar is recognisability at the
 * game's real on-screen size (a bear is about 40 px tall), not beauty, so
 * every species leans on one exaggerated tell — the squirrel's curled tail,
 * the rabbit's ears, the deer's antlers.
 *
 * Every figure shares one convention so battle and world placement need no
 * per-species fixes:
 *   - units are tiles (1 = one grid cell);
 *   - the feet stand on y = 0, the figure is centred on x = 0;
 *   - the face points toward +z, which is grid "down" and the side the
 *     explore camera sees. Rotate about y to face elsewhere.
 * The returned group's single child is the "rig" that holds the parts;
 * `animateIdle` scales the rig, so callers may scale or move the outer group
 * freely.
 */
type SpeciesColors = { fur: number; accent: number };
type Builder = (c: SpeciesColors) => THREE.Object3D[];

const materials = new Map<number, THREE.MeshLambertMaterial>();
function mat(hex: number): THREE.MeshLambertMaterial {
	let m = materials.get(hex);
	if (!m) {
		m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
		materials.set(hex, m);
	}
	return m;
}

function part(geo: THREE.BufferGeometry, hex: number, x: number, y: number, z: number): THREE.Mesh {
	const mesh = new THREE.Mesh(geo, mat(hex));
	mesh.position.set(x, y, z);
	mesh.castShadow = true;
	return mesh;
}
const box = (w: number, h: number, d: number, hex: number, x: number, y: number, z: number) =>
	part(new THREE.BoxGeometry(w, h, d), hex, x, y, z);
const cone = (r: number, h: number, hex: number, x: number, y: number, z: number) =>
	part(new THREE.ConeGeometry(r, h, 5), hex, x, y, z);
const tube = (r: number, h: number, hex: number, x: number, y: number, z: number) =>
	part(new THREE.CylinderGeometry(r, r * 1.1, h, 6), hex, x, y, z);
/** A low-poly sphere, optionally stretched into an egg or a paddle. */
function ball(
	r: number,
	hex: number,
	x: number,
	y: number,
	z: number,
	sx = 1,
	sy = 1,
	sz = 1
): THREE.Mesh {
	const m = part(new THREE.SphereGeometry(r, 8, 5), hex, x, y, z);
	m.scale.set(sx, sy, sz);
	return m;
}
function rot<T extends THREE.Object3D>(obj: T, x: number, y: number, z: number): T {
	obj.rotation.set(x, y, z);
	return obj;
}
/** Four legs of height `h` at (±dx, ±dz). */
function legs(w: number, h: number, hex: number, dx: number, dz: number): THREE.Mesh[] {
	const out: THREE.Mesh[] = [];
	for (const sx of [-1, 1])
		for (const sz of [-1, 1]) out.push(box(w, h, w, hex, sx * dx, h / 2, sz * dz));
	return out;
}
/** A tail that rises from the rump, curls over the back and ends above it. */
function curledTail(radius: number, thick: number, hex: number, x: number, y: number, z: number) {
	const geo = new THREE.TorusGeometry(radius, thick, 6, 10, Math.PI * 1.5);
	geo.rotateZ(-Math.PI / 2); // start the arc at the bottom of the ring
	geo.rotateY(Math.PI / 2); // stand the ring in the x = 0 plane, arc going back then up
	return part(geo, hex, x, y, z);
}
/** A flat tail pointing back (-z): a cone laid down and squashed to a paddle. */
function paddleTail(hex: number, x: number, y: number, z: number): THREE.Mesh {
	const tail = rot(cone(0.12, 0.34, hex, x, y, z), -Math.PI / 2, 0, 0);
	tail.scale.z = 0.4; // local z is world y after the rotation
	return tail;
}
/** One antler: a stem leaning outward with a prong forward and one back. */
function antler(hex: number, side: -1 | 1): THREE.Mesh[] {
	return [
		rot(tube(0.025, 0.36, hex, side * 0.07, 1.28, 0.44), 0, 0, -side * 0.35),
		rot(tube(0.018, 0.18, hex, side * 0.1, 1.3, 0.5), 0.9, 0, 0),
		rot(tube(0.018, 0.18, hex, side * 0.14, 1.42, 0.4), -0.8, 0, 0)
	];
}

const BUILDERS: Record<string, Builder> = {
	// Small and round, with a curled tail taller than the animal itself.
	squirrel: ({ fur, accent }) => [
		ball(0.13, fur, 0, 0.17, 0, 1, 0.9, 1.3),
		ball(0.07, accent, 0, 0.14, 0.1, 1, 0.7, 1),
		ball(0.1, fur, 0, 0.3, 0.17),
		cone(0.03, 0.08, fur, -0.05, 0.4, 0.16),
		cone(0.03, 0.08, fur, 0.05, 0.4, 0.16),
		curledTail(0.16, 0.08, fur, 0, 0.33, -0.2),
		box(0.06, 0.05, 0.08, fur, -0.07, 0.025, 0.02),
		box(0.06, 0.05, 0.08, fur, 0.07, 0.025, 0.02)
	],
	// Round body, big back feet, a bob of a tail — and ears twice the head's height.
	rabbit: ({ fur, accent }) => [
		ball(0.16, fur, 0, 0.18, 0, 1, 0.85, 1.2),
		ball(0.12, fur, 0, 0.34, 0.16),
		rot(ball(0.045, fur, -0.06, 0.6, 0.13, 1, 4, 0.6), 0, 0, 0.14),
		rot(ball(0.045, fur, 0.06, 0.6, 0.13, 1, 4, 0.6), 0, 0, -0.14),
		rot(ball(0.03, accent, -0.065, 0.6, 0.155, 0.7, 3.5, 0.4), 0, 0, 0.14),
		rot(ball(0.03, accent, 0.065, 0.6, 0.155, 0.7, 3.5, 0.4), 0, 0, -0.14),
		ball(0.065, COLORS.white, 0, 0.22, -0.2),
		box(0.09, 0.05, 0.16, fur, -0.1, 0.025, 0.03),
		box(0.09, 0.05, 0.16, fur, 0.1, 0.025, 0.03)
	],
	// Squat and wide, big eyes on top of the head, a mouth right across it, and
	// back legs folded along its sides.
	frog: ({ fur, accent }) => [
		ball(0.185, fur, 0, 0.142, -0.044, 1.3, 0.72, 1.15),
		ball(0.142, fur, 0, 0.196, 0.109, 1.3, 0.75, 1),
		ball(0.109, accent, 0, 0.142, 0.164, 1.3, 0.6, 0.8),
		box(0.26, 0.018, 0.022, COLORS.dark, 0, 0.18, 0.245),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.076, fur, side * 0.104, 0.294, 0.109),
			ball(0.061, COLORS.white, side * 0.104, 0.311, 0.136),
			ball(0.031, COLORS.dark, side * 0.104, 0.316, 0.187),
			ball(0.093, fur, side * 0.207, 0.098, -0.109, 0.75, 0.95, 1.55),
			box(0.109, 0.026, 0.185, fur, side * 0.24, 0.013, 0.044),
			box(0.049, 0.098, 0.049, fur, side * 0.109, 0.049, 0.196),
			box(0.076, 0.022, 0.065, fur, side * 0.12, 0.011, 0.218)
		])
	],
	// Slim, pointed ears, dark legs, and a long tail with a white tip.
	fox: ({ fur, accent }) => [
		box(0.2, 0.18, 0.42, fur, 0, 0.3, 0),
		box(0.16, 0.12, 0.1, accent, 0, 0.26, 0.19),
		box(0.18, 0.16, 0.18, fur, 0, 0.42, 0.28),
		rot(cone(0.06, 0.16, accent, 0, 0.38, 0.43), Math.PI / 2, 0, 0),
		ball(0.03, COLORS.dark, 0, 0.38, 0.51),
		cone(0.05, 0.14, fur, -0.07, 0.56, 0.26),
		cone(0.05, 0.14, fur, 0.07, 0.56, 0.26),
		...legs(0.06, 0.22, COLORS.dark, 0.07, 0.15),
		ball(0.09, fur, 0, 0.32, -0.36, 1, 1, 2.2),
		ball(0.075, accent, 0, 0.34, -0.53)
	],
	// Long and low, a small round head, and a flat paddle of a tail.
	otter: ({ fur, accent }) => [
		ball(0.15, fur, 0, 0.15, 0, 1, 0.9, 2.5),
		ball(0.1, accent, 0, 0.13, 0.26, 1, 0.7, 1.2),
		ball(0.11, fur, 0, 0.25, 0.4),
		ball(0.065, accent, 0, 0.21, 0.49, 1, 0.8, 1),
		ball(0.028, COLORS.dark, 0, 0.23, 0.54),
		ball(0.04, fur, -0.1, 0.34, 0.38),
		ball(0.04, fur, 0.1, 0.34, 0.38),
		paddleTail(fur, 0, 0.06, -0.52),
		box(0.08, 0.06, 0.09, fur, -0.13, 0.03, 0.2),
		box(0.08, 0.06, 0.09, fur, 0.13, 0.03, 0.2),
		box(0.08, 0.06, 0.09, fur, -0.13, 0.03, -0.2),
		box(0.08, 0.06, 0.09, fur, 0.13, 0.03, -0.2)
	],
	// Tall thin legs, a raised neck, and antlers on top of everything.
	deer: ({ fur, accent }) => [
		box(0.26, 0.28, 0.58, fur, 0, 0.62, 0),
		...legs(0.07, 0.5, fur, 0.09, 0.2),
		rot(box(0.13, 0.13, 0.36, fur, 0, 0.86, 0.32), -0.9, 0, 0),
		box(0.14, 0.14, 0.26, fur, 0, 1.06, 0.5),
		ball(0.03, COLORS.dark, 0, 1.04, 0.64),
		ball(0.035, fur, -0.1, 1.14, 0.44, 1, 1.6, 0.6),
		ball(0.035, fur, 0.1, 1.14, 0.44, 1, 1.6, 0.6),
		...antler(accent, -1),
		...antler(accent, 1),
		ball(0.05, COLORS.white, 0, 0.66, -0.3)
	],
	// A bigger, greyer fox with a light chest and a tail held straight up.
	wolf: ({ fur, accent }) => [
		box(0.3, 0.28, 0.62, fur, 0, 0.44, 0),
		box(0.26, 0.12, 0.14, accent, 0, 0.38, 0.28),
		...legs(0.09, 0.3, fur, 0.1, 0.22),
		box(0.24, 0.22, 0.26, fur, 0, 0.62, 0.38),
		box(0.12, 0.1, 0.16, accent, 0, 0.57, 0.54),
		ball(0.035, COLORS.dark, 0, 0.6, 0.63),
		cone(0.06, 0.15, fur, -0.09, 0.79, 0.34),
		cone(0.06, 0.15, fur, 0.09, 0.79, 0.34),
		rot(ball(0.08, fur, 0, 0.66, -0.36, 1, 3.2, 1), -0.35, 0, 0),
		ball(0.07, accent, 0, 0.9, -0.45)
	],
	// Big and round on thick legs, a tan muzzle, ears too small for its head.
	bear: ({ fur, accent }) => [
		ball(0.4, fur, 0, 0.52, 0, 1, 0.95, 1.2),
		tube(0.1, 0.32, fur, -0.2, 0.16, -0.26),
		tube(0.1, 0.32, fur, 0.2, 0.16, -0.26),
		tube(0.1, 0.32, fur, -0.2, 0.16, 0.26),
		tube(0.1, 0.32, fur, 0.2, 0.16, 0.26),
		ball(0.24, fur, 0, 0.8, 0.44),
		ball(0.12, accent, 0, 0.73, 0.62, 1, 0.8, 1),
		ball(0.05, COLORS.dark, 0, 0.78, 0.72),
		ball(0.07, fur, -0.17, 0.98, 0.4),
		ball(0.07, fur, 0.17, 0.98, 0.4)
	]
};

function wrap(parts: THREE.Object3D[]): THREE.Group {
	const group = new THREE.Group();
	const rig = new THREE.Group();
	rig.name = 'rig';
	rig.add(...parts);
	group.add(rig);
	return group;
}

/** The figure for a species in the engine catalog. Throws for an unknown id. */
export function buildAnimalMesh(speciesId: string): THREE.Group {
	const build = BUILDERS[speciesId];
	const colors = ANIMAL_COLORS[speciesId];
	if (!build || !colors) throw new Error(`No mesh for species: ${speciesId}`);
	const group = wrap(build(colors));
	group.name = speciesId;
	group.userData.restShape = restShape(group.children[0]!);
	return group;
}

/**
 * What lying down needs to know about a figure, measured once as it is
 * built: `belly`, the height of its lowest part that does not stand on the
 * ground (the body over the legs), so lowering the figure by it puts the body
 * on the ground and sinks the legs out of sight; `height`, its full height;
 * `front`, how far forward it reaches (its nose), where the z's rise.
 */
interface RestShape {
	belly: number;
	height: number;
	front: number;
}

/** A part whose bottom is this close to the ground stands on it: a leg, a foot. */
const ON_GROUND = 0.005;

function restShape(rig: THREE.Object3D): RestShape {
	rig.updateMatrixWorld(true);
	const box = new THREE.Box3();
	let belly = Infinity;
	let height = 0;
	let front = 0;
	for (const part of rig.children) {
		box.setFromObject(part);
		height = Math.max(height, box.max.y);
		front = Math.max(front, box.max.z);
		if (box.min.y > ON_GROUND) belly = Math.min(belly, box.min.y);
	}
	return { belly: Number.isFinite(belly) ? belly : 0, height, front };
}

/** Where the trainer's legs and arms turn when it walks. */
const HIP_Y = 0.2;
const SHOULDER_Y = 0.46;

/**
 * A limb hung from a joint at `(x, y)`: a group named `name` at the joint,
 * holding `parts` placed as if the group were not there. Turning the group
 * about x swings the limb from the joint.
 */
function limb(name: string, x: number, y: number, parts: THREE.Mesh[]): THREE.Group {
	const joint = new THREE.Group();
	joint.name = name;
	joint.position.set(x, y, 0);
	for (const p of parts) {
		p.position.x -= x;
		p.position.y -= y;
		joint.add(p);
	}
	return joint;
}

/**
 * The trainer: a kid in a coral shirt and a blue cap, eyes on the +z face.
 * Its legs and arms hang from joints (`legL`, `legR`, `armL`, `armR`) that
 * `animateWalk` swings.
 */
export function buildPlayerMesh(): THREE.Group {
	const { playerShirt: shirt, playerSkin: skin, playerShorts: shorts, playerCap: cap } = COLORS;
	const dome = new THREE.SphereGeometry(0.15, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
	const group = wrap([
		limb('legL', -0.065, HIP_Y, [box(0.1, 0.2, 0.11, shorts, -0.065, 0.1, 0)]),
		limb('legR', 0.065, HIP_Y, [box(0.1, 0.2, 0.11, shorts, 0.065, 0.1, 0)]),
		box(0.28, 0.28, 0.17, shirt, 0, 0.34, 0),
		limb('armL', -0.185, SHOULDER_Y, [
			box(0.07, 0.24, 0.08, shirt, -0.185, 0.36, 0),
			box(0.06, 0.06, 0.07, skin, -0.185, 0.21, 0)
		]),
		limb('armR', 0.185, SHOULDER_Y, [
			box(0.07, 0.24, 0.08, shirt, 0.185, 0.36, 0),
			box(0.06, 0.06, 0.07, skin, 0.185, 0.21, 0)
		]),
		box(0.24, 0.22, 0.22, skin, 0, 0.6, 0),
		box(0.035, 0.05, 0.02, COLORS.dark, -0.055, 0.61, 0.11),
		box(0.035, 0.05, 0.02, COLORS.dark, 0.055, 0.61, 0.11),
		part(dome, cap, 0, 0.68, 0),
		box(0.22, 0.03, 0.14, cap, 0, 0.7, 0.16)
	]);
	group.name = 'player';
	return group;
}

const IDLE_RATE = 2.4; // radians per second: one breath every ~2.6 s
const IDLE_DEPTH = 0.03;

/**
 * A breathing scale on the figure's rig, about the feet so they stay on the
 * ground. `t` is seconds; `figure.userData.idlePhase` offsets a crowd so they
 * don't breathe in unison.
 *
 * A tired animal rests ([[UI_SPEC]] § Battle mode): `figure.userData.rest`,
 * from 0 (standing) to 1 (down), lowers it onto its belly with its legs
 * tucked under — sunk out of sight into the ground — its head a little low
 * and its breath slow and deep, and once it is down little z's drift up over
 * its head, turned to face `camera` (no camera, no z's).
 */
export function animateIdle(figure: THREE.Group, t: number, camera?: THREE.Camera): void {
	const rig = figure.children[0];
	if (!rig) return;
	const phase = (figure.userData.idlePhase as number | undefined) ?? 0;
	const rest = Math.min(1, Math.max(0, (figure.userData.rest as number | undefined) ?? 0));
	rig.scale.y = 1 + IDLE_DEPTH * (1 + rest) * Math.sin(t * IDLE_RATE + phase);
	const shape = figure.userData.restShape as RestShape | undefined;
	if (shape) liePose(rig, shape, rest);
	snooze(figure, rig, shape, rest === 1 ? t : null, camera);
}

/** Radians a resting animal's front tips down about its middle: its head goes low. */
const REST_PITCH = 0.12;
/** How far below its belly a resting animal settles, as a share of its height: nestled in the grass. */
const REST_SINK = 0.04;
/** How much flatter a resting animal is: slumped, not standing to attention. */
const REST_SQUASH = 0.07;

/**
 * Lie the rig down by `rest` (0..1): flatter, lowered until its belly is on
 * the ground (and a little into it, so no gap shows under the tipped back),
 * turned about the middle of its belly so the head goes down. Runs after the
 * breathing scale, so the belly stays put and only the back rises and falls.
 */
function liePose(rig: THREE.Object3D, shape: RestShape, rest: number): void {
	rig.scale.y *= 1 - REST_SQUASH * rest;
	const angle = REST_PITCH * rest;
	// The belly's middle (0, y, 0), scaled as the rig is, stays where it is as the rig turns.
	const y = shape.belly * rig.scale.y;
	const drop = (shape.belly + REST_SINK * shape.height) * rest;
	rig.rotation.x = angle;
	rig.position.set(0, y - y * Math.cos(angle) - drop, -y * Math.sin(angle));
}

/** Seconds from one z leaving the head to the next; each lasts until the third one after it leaves. */
const Z_EVERY = 0.9;
const Z_LIFE = Z_EVERY * 3;

/**
 * The z's of a resting animal: three at a time, each rising from above its
 * head, drifting a little aside, growing in and shrinking away, turned to the
 * camera so they always read as z's. `since` is the time now, once the animal
 * is all the way down (null while it is not): the first z leaves as it
 * settles. Built the first time they are needed, as part of the figure, so
 * `disposeFigure` frees them with it.
 */
function snooze(
	figure: THREE.Group,
	rig: THREE.Object3D,
	shape: RestShape | undefined,
	now: number | null,
	camera: THREE.Camera | undefined
): void {
	let zs = figure.getObjectByName('zs') as THREE.Group | undefined;
	if (now === null || !camera || !shape) {
		if (zs) zs.visible = false;
		figure.userData.restSince = undefined;
		return;
	}
	if (!zs) {
		zs = buildZs();
		figure.add(zs);
	}
	zs.visible = true;
	if (typeof figure.userData.restSince !== 'number') figure.userData.restSince = now;
	const elapsed = now - (figure.userData.restSince as number);
	// Over the head: the top of the figure, a little in from its nose, as it lies.
	rig.updateMatrix();
	const head = new THREE.Vector3(0, shape.height, shape.front * 0.6).applyMatrix4(rig.matrix);
	const size = shape.height;
	// The camera's up and right, in the figure's own frame: the z's rise up the
	// screen and drift to its right whichever way the animal faces, clear of it.
	const turn = figure
		.getWorldQuaternion(new THREE.Quaternion())
		.invert()
		.multiply(camera.quaternion);
	const up = new THREE.Vector3(0, 1, 0).applyQuaternion(turn);
	const right = new THREE.Vector3(1, 0, 0).applyQuaternion(turn);
	const drift = motion.reduced ? 0.25 : 1;
	zs.children.forEach((z, i) => {
		// Each z is on its own loop, a third of a loop behind the one before.
		const age = elapsed - i * Z_EVERY;
		const p = age < 0 ? -1 : (age % Z_LIFE) / Z_LIFE;
		z.visible = p >= 0 && p < 1;
		if (!z.visible) return;
		const grow = Math.min(1, p / 0.2) * Math.min(1, (1 - p) / 0.25);
		z.scale.setScalar(Math.max(0.001, size * 0.14 * (0.7 + 0.5 * p) * grow));
		z.position
			.copy(head)
			.addScaledVector(up, size * (0.2 + 0.4 * p * drift))
			.addScaledVector(right, size * (0.12 + 0.2 * p * drift));
		z.quaternion.copy(turn);
	});
}

/** A "Z" one unit tall, in the x-y plane, facing +z: a top bar, a slash and a bottom bar. */
function zShape(): THREE.Shape {
	const s = new THREE.Shape();
	s.moveTo(-0.5, 0.5);
	s.lineTo(0.5, 0.5);
	s.lineTo(0.5, 0.3);
	s.lineTo(-0.16, -0.3);
	s.lineTo(0.5, -0.3);
	s.lineTo(0.5, -0.5);
	s.lineTo(-0.5, -0.5);
	s.lineTo(-0.5, -0.3);
	s.lineTo(0.16, 0.3);
	s.lineTo(-0.5, 0.3);
	s.closePath();
	return s;
}

function buildZs(): THREE.Group {
	const zs = new THREE.Group();
	zs.name = 'zs';
	const geometry = new THREE.ShapeGeometry(zShape());
	for (let i = 0; i < 3; i++) {
		const z = new THREE.Mesh(geometry, mat(COLORS.white));
		z.visible = false;
		zs.add(z);
	}
	return zs;
}

/** Radians an arm swings forward at the middle of a step; the legs swing a little less. */
const ARM_SWING = 0.6;
const LEG_SWING = 0.45;
/** Radians the body rocks towards the foot it lands on: a little waddle. */
const WADDLE = 0.09;
/** How much taller the body gets in the air (squash and stretch). */
const STRETCH = 0.06;

/**
 * A walking step on a figure with limbs (the trainer), after `animateIdle`:
 * one arm forward and the other back, the legs the other way, the body rocking
 * onto the landing foot and stretching a little in the air. `progress` runs
 * 0..1 through one step and everything is at rest at both ends, so steps chain
 * smoothly; `stride` (1 or -1) says which foot leads, and alternates from step
 * to step. `amount` scales it all (0 is standing still). The limbs swing
 * about their joints, so the feet stay put while the figure hops.
 */
export function animateWalk(
	figure: THREE.Group,
	progress: number,
	stride: 1 | -1,
	amount = 1
): void {
	const rig = figure.children[0];
	if (!rig) return;
	const s = Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI) * amount;
	const swing = (joint: string, radians: number) => {
		const limb = rig.getObjectByName(joint);
		if (limb) limb.rotation.x = radians;
	};
	swing('armL', stride * ARM_SWING * s);
	swing('armR', -stride * ARM_SWING * s);
	swing('legL', -stride * LEG_SWING * s);
	swing('legR', stride * LEG_SWING * s);
	rig.rotation.z = stride * WADDLE * s;
	rig.scale.y *= 1 + STRETCH * s;
}

/**
 * Free a figure that leaves the screen for good: its geometries. Its
 * materials are shared by every figure (cached above) and stay.
 */
export function disposeFigure(figure: THREE.Object3D): void {
	figure.traverse((o) => {
		if (o instanceof THREE.Mesh) o.geometry.dispose();
	});
}
