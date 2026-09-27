import * as THREE from 'three';
import { motion } from '../motion';
import { ANIMAL_COLORS, COLORS, PLAYER_LOOK, TILE_COLORS, type TrainerLook } from './palette';

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
 *
 * Two measures read the parts, and both are rough on purpose. A figure's
 * bounds (its feet on y = 0, its size) are three.js's `Box3.setFromObject`,
 * which turns each part's own bounding box, not its vertices: a part that
 * touches the ground and is turned must be turned in its geometry (see
 * `starArm`, `tentacle`), or its box dips under the ground though no vertex
 * does. And resting reads which parts stand on the ground by their bottoms
 * being within 0.005 of it (`ON_GROUND`): a part meant to stand on it sits
 * exactly on 0, and one meant to be raised clears it well (the octopus's
 * suckers once sat on the edge).
 *
 * The sea animals are met only at sea, where they swim with the lower 40% of
 * their height under the water (`SWIM_DEPTH`), so each one's tell stands in
 * its top 60%, and reads from the explore camera whichever way it swims: the
 * octopus's arms curl up round its head, the starfish stands upright.
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

/** One coordinate of a Catmull-Rom curve through b and c, `t` of the way from b to c. */
function catmull(a: number, b: number, c: number, d: number, t: number): number {
	return (
		0.5 *
		(2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t ** 3)
	);
}

/** A curve in an upright plane: points `[out, up]`, out from where it starts and up. */
type Path = readonly (readonly [number, number])[];

/**
 * A tube tapering from `root` thick to a point, along a smooth curve through
 * `path`, turned about y by `yaw` (0 is out along +z). Built by hand, as the
 * z's are: three.js's `TubeGeometry` would bring its curve classes into the
 * bundle.
 */
function curvedTube(path: Path, root: number, yaw: number): THREE.BufferGeometry {
	const SIDES = 5;
	const PER_SPAN = 3;
	const at = (i: number) => path[Math.min(path.length - 1, Math.max(0, i))]!;
	const curve: [number, number][] = [];
	for (let i = 0; i < path.length - 1; i++) {
		const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
		for (let s = 0; s < PER_SPAN; s++) {
			const t = s / PER_SPAN;
			curve.push([catmull(a[0], b[0], c[0], d[0], t), catmull(a[1], b[1], c[1], d[1], t)]);
		}
	}
	curve.push([...at(path.length - 1)]);
	// How far along the arm each point is, for the taper.
	const along = [0];
	for (let i = 1; i < curve.length; i++) {
		const [o0, u0] = curve[i - 1]!;
		const [o1, u1] = curve[i]!;
		along.push(along[i - 1]! + Math.hypot(o1 - o0, u1 - u0));
	}
	const length = along[along.length - 1]!;
	const positions: number[] = [];
	curve.forEach(([out, up], i) => {
		// Along the arm (up and out), and the arm's own plane's normal across it: a ring round it.
		const [o0, u0] = curve[Math.max(0, i - 1)]!;
		const [o1, u1] = curve[Math.min(curve.length - 1, i + 1)]!;
		const d = Math.hypot(o1 - o0, u1 - u0) || 1;
		const r = root * (1 - along[i]! / length) ** 0.75;
		for (let k = 0; k < SIDES; k++) {
			const angle = (k / SIDES) * Math.PI * 2;
			const across = Math.cos(angle) * r;
			const inPlane = Math.sin(angle) * r;
			// The plane's normal in it, square to the arm: (up, -out) of the step along it.
			positions.push(across, up + ((o1 - o0) / d) * inPlane, out - ((u1 - u0) / d) * inPlane);
		}
	});
	const index: number[] = [];
	for (let i = 0; i < curve.length - 1; i++) {
		for (let k = 0; k < SIDES; k++) {
			const a = i * SIDES + k;
			const b = i * SIDES + ((k + 1) % SIDES);
			const c = b + SIDES;
			const d = a + SIDES;
			index.push(a, b, c, a, c, d);
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geo.setIndex(index);
	geo.rotateY(yaw);
	geo.computeVertexNormals();
	return geo;
}
/**
 * An octopus's arm along `path` from the middle, `yaw` the way it reaches:
 * its lowest point stands exactly on the ground.
 */
function tentacle(path: Path, root: number, hex: number, yaw: number): THREE.Mesh {
	const geo = curvedTube(path, root, yaw);
	geo.computeBoundingBox();
	geo.translate(0, -geo.boundingBox!.min.y, 0);
	return part(geo, hex, 0, 0, 0);
}
/**
 * A starfish's arm, standing up: a cone from the middle at (0, `cy`) to its
 * tip the way `angle` points in the x–y plane (0 is +x, π/2 straight up),
 * flat front to back. The turn is in the shape itself, so its bounds are its
 * own: the arm it stands on ends exactly on the ground.
 */
function starArm(r: number, length: number, hex: number, angle: number, cy: number): THREE.Mesh {
	const geo = new THREE.ConeGeometry(r, length, 5);
	geo.translate(0, length / 2, 0); // its base in the middle, its tip up
	geo.scale(1, 1, 0.45);
	geo.rotateZ(angle - Math.PI / 2);
	geo.translate(0, cy, 0);
	return part(geo, hex, 0, 0, 0);
}
/**
 * An octopus's arm, `[out, up]`: from under its head, down to the ground, then
 * up round the head, curling out and over at the top. The two in front stay
 * lower, clear of its eyes.
 */
const OCTOPUS_ARM = [
	[0.08, 0.14],
	[0.17, 0.035],
	[0.26, 0.1],
	[0.3, 0.25],
	[0.31, 0.4],
	[0.35, 0.5],
	[0.42, 0.52],
	[0.46, 0.47],
	[0.44, 0.41],
	[0.4, 0.41]
] as const;
const OCTOPUS_ARM_LOW = [
	[0.08, 0.13],
	[0.18, 0.035],
	[0.28, 0.07],
	[0.33, 0.17],
	[0.35, 0.29],
	[0.4, 0.36],
	[0.46, 0.35],
	[0.47, 0.3],
	[0.43, 0.28]
] as const;
/** One stream of a whale's spout, from the blowhole: up, arcing out, and falling. */
const SPOUT_STREAM = [
	[0, 0],
	[0.015, 0.12],
	[0.05, 0.2],
	[0.11, 0.22],
	[0.16, 0.18],
	[0.19, 0.11]
] as const;
/**
 * A whale's spout from the blowhole at (x, y, z): four streams of the
 * shallows' blue rising together and arcing out and down, a white drop
 * falling from each: a fountain from every side, never a cap on a stalk (a
 * mushroom).
 */
function spout(x: number, y: number, z: number): THREE.Mesh[] {
	const [end] = SPOUT_STREAM.slice(-1);
	return Array.from({ length: 4 }, (_, i) => {
		const yaw = ((i + 0.5) * Math.PI) / 2;
		const out = end![0] + 0.02;
		return [
			part(curvedTube(SPOUT_STREAM, 0.045, yaw), TILE_COLORS.water, x, y, z),
			ball(
				0.036,
				COLORS.white,
				x + Math.sin(yaw) * out,
				y + end![1] - 0.045,
				z + Math.cos(yaw) * out
			)
		];
	}).flat();
}
/**
 * A hedgehog's spines: small cones standing out of a dome of radius `r`
 * centred at (0, `y`, `z`), each along the dome's surface, over its top and
 * sides and never across its face (+z), in rows staggered so they bristle.
 */
function spines(hex: number, r: number, y: number, z: number): THREE.Mesh[] {
	const up = new THREE.Vector3(0, 1, 0);
	const out: THREE.Mesh[] = [];
	// Rows down from the top (`phi` from straight up), each spread over one side and
	// mirrored onto the other, so the dome is the same on both sides.
	for (const [phi, count, shift] of [
		[0.35, 2, 0.5],
		[0.8, 4, 0],
		[1.2, 5, 0.5],
		[1.5, 5, 0]
	] as const) {
		for (let i = 0; i < count; i++) {
			const theta = (Math.PI * (i + 0.25 + shift * 0.5)) / count;
			const n = new THREE.Vector3(
				Math.sin(phi) * Math.sin(theta),
				Math.cos(phi),
				Math.sin(phi) * Math.cos(theta)
			);
			if (n.z > 0.7) continue; // the face
			for (const side of [-1, 1]) {
				const dir = new THREE.Vector3(side * n.x, n.y, n.z);
				const at = r + 0.01;
				const spine = cone(0.022, 0.08, hex, dir.x * at, y + dir.y * at, z + dir.z * at);
				spine.quaternion.setFromUnitVectors(up, dir);
				out.push(spine);
			}
		}
	}
	return out;
}

/**
 * A bird's wings, hanging from shoulder joints at (±`x`, `y`, 0), named
 * `wingL` and `wingR` (`limb`), each holding what `parts` builds for its side
 * (-1 is left), placed as if the joint were not there. Turning a joint about
 * z lifts its wing out from the body; about x, it sweeps forward or back.
 */
function wings(x: number, y: number, parts: (side: -1 | 1) => THREE.Mesh[]): THREE.Group[] {
	return ([-1, 1] as const).map((side) =>
		limb(side < 0 ? 'wingL' : 'wingR', side * x, y, parts(side))
	);
}

/**
 * A stag beetle's two jaws: the deer's antlers (`antler`), in `hex`, laid
 * forward from the front of its head and shrunk to a beetle's size.
 */
function jaws(hex: number): THREE.Group {
	const pair = limb('jaws', 0, 1.28, [...antler(hex, -1), ...antler(hex, 1)], 0.44);
	pair.position.set(0, 0.1, 0.17);
	pair.rotation.x = 1.2;
	pair.scale.setScalar(0.6);
	return pair;
}

/**
 * An adder's zigzag: `count` short dark bars along the top of a coil of
 * radius `r` round (0, `z`), at the height `y` of its back, each turned a
 * little off the coil's line, the other way from the one before, so together
 * they zigzag round it.
 */
function zigzag(hex: number, r: number, y: number, z: number, count: number): THREE.Mesh[] {
	const length = ((2 * Math.PI * r) / count) * 1.25;
	return Array.from({ length: count }, (_, i) => {
		const a = (i / count) * Math.PI * 2;
		const bar = box(0.014, 0.012, length, hex, Math.sin(a) * r, y, z + Math.cos(a) * r);
		bar.rotation.y = a + Math.PI / 2 + (i % 2 ? 0.55 : -0.55);
		return bar;
	});
}

/** A starfish's arms, and where its middle is: an arm's length up, on the arm it stands on. */
const STAR_ARM = 0.3;
const STAR_MIDDLE = STAR_ARM;

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
	// A bigger, greyer fox with a light chest and a tail held straight up (it
	// lays it down behind when it rests: the `tail` joint, see `liePose`).
	wolf: ({ fur, accent }) => [
		box(0.3, 0.28, 0.62, fur, 0, 0.44, 0),
		box(0.26, 0.12, 0.14, accent, 0, 0.38, 0.28),
		...legs(0.09, 0.3, fur, 0.1, 0.22),
		box(0.24, 0.22, 0.26, fur, 0, 0.62, 0.38),
		box(0.12, 0.1, 0.16, accent, 0, 0.57, 0.54),
		ball(0.035, COLORS.dark, 0, 0.6, 0.63),
		cone(0.06, 0.15, fur, -0.09, 0.79, 0.34),
		cone(0.06, 0.15, fur, 0.09, 0.79, 0.34),
		limb(
			'tail',
			0,
			0.42,
			[
				rot(ball(0.08, fur, 0, 0.66, -0.36, 1, 3.2, 1), -0.35, 0, 0),
				ball(0.07, accent, 0, 0.9, -0.45)
			],
			-0.27
		)
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
	],
	// The small animals of the Nordic countryside (#89 wave 1), each sized as in
	// nature within its tier: the shrew, the beetle and the robin are smaller than
	// the squirrel. The birds' wings hang from joints (`wingL`, `wingR`, at the
	// shoulder), so a bird can beat them in the air.
	//
	// Tiny, low and long, with a long pointed snout that twitches ahead of it.
	shrew: ({ fur, accent }) => [
		ball(0.1, fur, 0, 0.115, -0.02, 1, 0.85, 1.7),
		ball(0.072, accent, 0, 0.09, 0, 1, 0.55, 1.45),
		ball(0.07, fur, 0, 0.135, 0.14),
		rot(cone(0.034, 0.19, fur, 0, 0.125, 0.28), Math.PI / 2 - 0.1, 0, 0),
		ball(0.017, COLORS.dark, 0, 0.135, 0.375),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.011, COLORS.dark, side * 0.042, 0.165, 0.18),
			ball(0.024, fur, side * 0.05, 0.19, 0.09, 1, 1, 0.5),
			box(0.04, 0.03, 0.05, accent, side * 0.055, 0.015, 0.09),
			box(0.04, 0.03, 0.05, accent, side * 0.055, 0.015, -0.1)
		]),
		rot(tube(0.012, 0.17, fur, 0, 0.08, -0.25), Math.PI / 2 + 0.2, 0, 0)
	],
	// Sitting up, a tail as long as its body behind it: huge round ears and big black eyes.
	'wood-mouse': ({ fur, accent }) => [
		ball(0.095, fur, 0, 0.13, -0.02, 1, 1.25, 1.1),
		ball(0.07, accent, 0, 0.12, 0.05, 0.9, 1.1, 0.7),
		ball(0.075, fur, 0, 0.28, 0.06),
		ball(0.035, fur, 0, 0.26, 0.13, 1, 0.8, 1.3),
		ball(0.012, COLORS.dark, 0, 0.26, 0.175),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.06, fur, side * 0.075, 0.38, 0.02, 1, 1, 0.35),
			ball(0.045, accent, side * 0.075, 0.38, 0.035, 1, 1, 0.3),
			ball(0.027, COLORS.dark, side * 0.048, 0.3, 0.115),
			box(0.05, 0.03, 0.08, fur, side * 0.06, 0.015, 0.05)
		]),
		part(
			curvedTube(
				[
					[0, 0.05],
					[0.12, 0.025],
					[0.26, 0.03],
					[0.36, 0.07]
				],
				0.018,
				Math.PI
			),
			fur,
			0,
			0,
			-0.1
		)
	],
	// Chunkier than the mouse, on pink feet, with pink ears and a long bare pink tail.
	'brown-rat': ({ fur, accent }) => [
		ball(0.12, fur, 0, 0.13, -0.02, 1, 0.85, 1.6),
		ball(0.08, fur, 0, 0.15, 0.2, 1, 0.9, 1.2),
		rot(cone(0.045, 0.1, fur, 0, 0.14, 0.3), Math.PI / 2, 0, 0),
		ball(0.016, accent, 0, 0.14, 0.355),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.015, COLORS.dark, side * 0.045, 0.18, 0.26),
			ball(0.038, accent, side * 0.06, 0.23, 0.16, 1, 1, 0.4),
			box(0.05, 0.03, 0.07, accent, side * 0.08, 0.015, 0.11),
			box(0.05, 0.03, 0.07, accent, side * 0.08, 0.015, -0.14)
		]),
		part(
			curvedTube(
				[
					[0, 0.1],
					[0.15, 0.05],
					[0.32, 0.035],
					[0.46, 0.07]
				],
				0.024,
				Math.PI
			),
			accent,
			0,
			0,
			-0.18
		)
	],
	// A dome of spines bristling over a pointed pale face with a black nose.
	hedgehog: ({ fur, accent }) => [
		part(new THREE.SphereGeometry(0.17, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), fur, 0, 0.04, -0.02),
		...spines(fur, 0.17, 0.04, -0.02),
		rot(cone(0.07, 0.16, accent, 0, 0.1, 0.18), Math.PI / 2, 0, 0),
		ball(0.022, COLORS.dark, 0, 0.1, 0.265),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.014, COLORS.dark, side * 0.04, 0.13, 0.17),
			box(0.04, 0.04, 0.05, accent, side * 0.08, 0.02, 0.08),
			box(0.04, 0.04, 0.05, accent, side * 0.08, 0.02, -0.1)
		])
	],
	// A dark velvet barrel with no eyes to see: two huge pink digging hands turned
	// outward, and a pink nose.
	mole: ({ fur, accent }) => [
		ball(0.13, fur, 0, 0.16, -0.02, 1, 0.9, 1.35),
		ball(0.085, fur, 0, 0.16, 0.15),
		rot(cone(0.035, 0.08, fur, 0, 0.15, 0.24), Math.PI / 2, 0, 0),
		ball(0.026, accent, 0, 0.15, 0.285),
		...([-1, 1] as const).flatMap((side) => [
			rot(ball(0.075, accent, side * 0.16, 0.075, 0.12, 0.45, 1, 1.1), 0, side * 0.5, 0),
			...[-0.04, 0, 0.04].map((dz) =>
				rot(cone(0.012, 0.05, COLORS.white, side * 0.2, 0.05, 0.16 + dz), Math.PI / 2, 0, 0)
			),
			box(0.05, 0.05, 0.06, accent, side * 0.08, 0.025, -0.14)
		]),
		rot(cone(0.02, 0.06, accent, 0, 0.14, -0.2), -Math.PI / 2, 0, 0)
	],
	// Low and sprawled, basking with its head up on straight front legs, and a
	// long tail tapering to a point along the ground.
	'common-lizard': ({ fur, accent }) => {
		const tail = tentacle(
			[
				[0, 0.06],
				[0.2, 0.04],
				[0.4, 0.035],
				[0.58, 0.05]
			],
			0.045,
			fur,
			Math.PI
		);
		tail.position.z = -0.1;
		return [
			rot(ball(0.075, fur, 0, 0.105, 0.02, 1, 0.7, 2.1), -0.2, 0, 0),
			rot(ball(0.06, accent, 0, 0.09, 0.03, 1, 0.5, 1.9), -0.2, 0, 0),
			ball(0.06, fur, 0, 0.155, 0.2, 1, 0.8, 1.3),
			...([-1, 1] as const).flatMap((side) => [
				ball(0.012, COLORS.dark, side * 0.038, 0.175, 0.23),
				box(0.03, 0.1, 0.03, fur, side * 0.07, 0.05, 0.12),
				box(0.05, 0.02, 0.05, fur, side * 0.09, 0.01, 0.14),
				rot(box(0.12, 0.025, 0.035, fur, side * 0.09, 0.03, -0.07), 0, -side * 0.35, 0),
				box(0.04, 0.03, 0.05, fur, side * 0.14, 0.015, -0.09)
			]),
			tail
		];
	},
	// Squat and wide like the frog, but browner and bumpier: warts all over its
	// back, and copper-orange eyes.
	'common-toad': ({ fur, accent }) => [
		ball(0.19, fur, 0, 0.14, -0.04, 1.3, 0.7, 1.15),
		ball(0.14, fur, 0, 0.19, 0.11, 1.3, 0.72, 1),
		box(0.25, 0.016, 0.02, COLORS.dark, 0, 0.17, 0.24),
		...[
			[0, 0.25, -0.02],
			[0.11, 0.23, -0.08],
			[-0.11, 0.23, -0.08],
			[0.06, 0.22, -0.16],
			[-0.06, 0.22, -0.16],
			[0.17, 0.18, 0.02],
			[-0.17, 0.18, 0.02],
			[0, 0.2, -0.2],
			[0.07, 0.25, 0.06],
			[-0.07, 0.25, 0.06]
		].map(([x, y, z]) => ball(0.032, fur, x!, y!, z!)),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.07, fur, side * 0.1, 0.27, 0.11),
			ball(0.052, accent, side * 0.1, 0.285, 0.14),
			ball(0.024, COLORS.dark, side * 0.1, 0.29, 0.185),
			ball(0.09, fur, side * 0.2, 0.095, -0.1, 0.75, 0.95, 1.5),
			box(0.1, 0.026, 0.17, fur, side * 0.235, 0.013, 0.04),
			box(0.05, 0.095, 0.05, fur, side * 0.105, 0.048, 0.19),
			box(0.075, 0.022, 0.065, fur, side * 0.115, 0.011, 0.21)
		])
	],
	// A round little bird on thin legs, with a big round orange-red breast.
	robin: ({ fur, accent }) => [
		ball(0.1, fur, 0, 0.19, -0.02, 1, 1, 1.15),
		ball(0.085, accent, 0, 0.19, 0.05, 1, 1, 0.8),
		ball(0.07, fur, 0, 0.3, 0.04),
		ball(0.052, accent, 0, 0.29, 0.08, 1, 1, 0.6),
		rot(cone(0.018, 0.05, COLORS.dark, 0, 0.3, 0.13), Math.PI / 2, 0, 0),
		rot(box(0.08, 0.02, 0.13, fur, 0, 0.2, -0.16), -0.45, 0, 0),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.013, COLORS.dark, side * 0.04, 0.32, 0.09),
			tube(0.008, 0.1, COLORS.dark, side * 0.035, 0.05, 0),
			box(0.03, 0.01, 0.05, COLORS.dark, side * 0.035, 0.005, 0.02)
		]),
		...wings(0.09, 0.23, (side) => [
			ball(0.06, fur, side * 0.1, 0.19, -0.03, 0.35, 0.9, 1.4)
		])
	],
	// A shiny dark oval on six short legs, and two giant antler jaws.
	'stag-beetle': ({ fur, accent }) => [
		ball(0.1, fur, 0, 0.08, -0.04, 1, 0.55, 1.5),
		ball(0.065, fur, 0, 0.085, 0.12, 1.2, 0.6, 0.9),
		ball(0.03, COLORS.white, 0.03, 0.12, -0.08, 1, 0.4, 1.4),
		...([-1, 1] as const).flatMap((side) =>
			[0.09, -0.02, -0.12].flatMap((z) => [
				box(0.1, 0.02, 0.02, fur, side * 0.12, 0.035, z),
				box(0.02, 0.035, 0.02, fur, side * 0.17, 0.0175, z)
			])
		),
		...([-1, 1] as const).map((side) => ball(0.012, COLORS.dark, side * 0.05, 0.11, 0.18)),
		jaws(accent)
	],
	// Slim, on long legs, smaller than the red deer, with short three-point
	// antlers and a white heart-shaped patch on its rump.
	'roe-deer': ({ fur, accent }) => [
		box(0.2, 0.2, 0.44, fur, 0, 0.45, 0),
		...legs(0.05, 0.36, fur, 0.065, 0.15),
		rot(box(0.1, 0.1, 0.26, fur, 0, 0.62, 0.24), -0.9, 0, 0),
		box(0.1, 0.1, 0.19, fur, 0, 0.76, 0.36),
		ball(0.022, COLORS.dark, 0, 0.75, 0.46),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.013, COLORS.dark, side * 0.05, 0.79, 0.4),
			ball(0.025, fur, side * 0.075, 0.84, 0.31, 1, 1.6, 0.6),
			rot(tube(0.013, 0.14, COLORS.dark, side * 0.035, 0.89, 0.33), 0, 0, -side * 0.2),
			rot(tube(0.01, 0.07, COLORS.dark, side * 0.045, 0.9, 0.37), 0.8, 0, 0),
			rot(tube(0.01, 0.06, COLORS.dark, side * 0.05, 0.93, 0.3), -0.8, 0, 0),
			ball(0.05, accent, side * 0.035, 0.5, -0.215, 1, 1, 0.35)
		]),
		ball(0.042, accent, 0, 0.455, -0.215, 1, 1, 0.35)
	],
	// Low, wide and stocky on short dark legs: a white face with two black stripes
	// running back over the eyes.
	badger: ({ fur, accent }) => [
		ball(0.2, fur, 0, 0.21, -0.03, 1.1, 0.75, 1.5),
		...legs(0.07, 0.11, COLORS.dark, 0.13, 0.17),
		ball(0.11, accent, 0, 0.2, 0.3, 1, 0.9, 1.3),
		ball(0.028, COLORS.dark, 0, 0.19, 0.44),
		...([-1, 1] as const).flatMap((side) => [
			rot(box(0.035, 0.02, 0.22, COLORS.dark, side * 0.045, 0.285, 0.29), -0.2, 0, 0),
			ball(0.013, COLORS.white, side * 0.045, 0.27, 0.38),
			ball(0.032, accent, side * 0.1, 0.29, 0.21)
		]),
		rot(cone(0.05, 0.12, fur, 0, 0.2, -0.36), -Math.PI / 2, 0, 0)
	],
	// Long and slim with a bushy tail, and a creamy-yellow bib on its throat.
	'pine-marten': ({ fur, accent }) => [
		ball(0.1, fur, 0, 0.21, -0.02, 1, 0.85, 2.3),
		...legs(0.05, 0.17, fur, 0.06, 0.15),
		ball(0.08, fur, 0, 0.31, 0.25),
		rot(cone(0.04, 0.09, fur, 0, 0.3, 0.34), Math.PI / 2, 0, 0),
		ball(0.015, COLORS.dark, 0, 0.3, 0.39),
		ball(0.07, accent, 0, 0.24, 0.26, 1, 1.1, 0.6),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.013, COLORS.dark, side * 0.035, 0.33, 0.31),
			ball(0.032, fur, side * 0.06, 0.39, 0.22),
			ball(0.02, accent, side * 0.06, 0.39, 0.235, 1, 1, 0.5)
		]),
		rot(ball(0.07, fur, 0, 0.21, -0.42, 1, 1, 2.6), 0.3, 0, 0)
	],
	// Long and slinky, sitting up on short legs, a white belly, and a black tip
	// on the end of its tail.
	stoat: ({ fur, accent }) => [
		rot(ball(0.075, fur, 0, 0.2, -0.02, 1, 2.3, 1), -0.25, 0, 0),
		rot(ball(0.055, accent, 0, 0.19, 0.03, 0.9, 2, 0.7), -0.25, 0, 0),
		ball(0.065, fur, 0, 0.39, 0.03),
		ball(0.036, fur, 0, 0.375, 0.09, 1, 0.8, 1.2),
		ball(0.034, accent, 0, 0.35, 0.07),
		ball(0.013, COLORS.dark, 0, 0.375, 0.13),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.013, COLORS.dark, side * 0.03, 0.4, 0.08),
			ball(0.024, fur, side * 0.045, 0.445, 0.01),
			ball(0.02, accent, side * 0.035, 0.25, 0.08),
			box(0.045, 0.03, 0.08, fur, side * 0.05, 0.015, 0.02)
		]),
		part(
			curvedTube(
				[
					[0, 0.06],
					[0.12, 0.06],
					[0.2, 0.1],
					[0.24, 0.16]
				],
				0.028,
				Math.PI
			),
			fur,
			0,
			0,
			-0.08
		),
		ball(0.032, COLORS.dark, 0, 0.16, -0.32)
	],
	// No legs: a coil of body on the ground, its head raised, and a dark zigzag
	// along its back.
	adder: ({ fur, accent }) => [
		part(new THREE.TorusGeometry(0.13, 0.042, 8, 14).rotateX(Math.PI / 2), fur, 0, 0.042, 0),
		part(new THREE.TorusGeometry(0.085, 0.038, 8, 12).rotateX(Math.PI / 2), fur, 0, 0.115, -0.01),
		...zigzag(accent, 0.13, 0.084, 0, 14),
		...zigzag(accent, 0.085, 0.153, -0.01, 10),
		part(
			curvedTube(
				[
					[0, 0.07],
					[0.08, 0.14],
					[0.12, 0.22],
					[0.17, 0.27]
				],
				0.04,
				0
			),
			fur,
			0,
			0,
			0.08
		),
		ball(0.052, fur, 0, 0.275, 0.27, 1, 0.7, 1.35),
		rot(box(0.02, 0.012, 0.09, accent, 0, 0.312, 0.255), 0, 0.3, 0),
		...([-1, 1] as const).map((side) => ball(0.012, COLORS.dark, side * 0.035, 0.29, 0.31))
	],
	// Grey on very long legs, an S-shaped neck, a dagger beak and a black crest stripe.
	'grey-heron': ({ fur, accent }) => [
		...([-1, 1] as const).flatMap((side) => [
			tube(0.012, 0.36, accent, side * 0.04, 0.18, 0),
			box(0.025, 0.01, 0.09, accent, side * 0.04, 0.005, 0.03)
		]),
		ball(0.11, fur, 0, 0.44, -0.03, 1, 0.85, 1.6),
		box(0.08, 0.02, 0.07, fur, 0, 0.42, -0.2),
		part(
			curvedTube(
				[
					[0, 0.47],
					[0.08, 0.58],
					[0.02, 0.69],
					[0.07, 0.8]
				],
				0.042,
				0
			),
			fur,
			0,
			0,
			0.1
		),
		ball(0.045, fur, 0, 0.81, 0.17),
		rot(cone(0.018, 0.17, accent, 0, 0.8, 0.29), Math.PI / 2, 0, 0),
		box(0.022, 0.016, 0.1, COLORS.dark, 0, 0.845, 0.15),
		rot(box(0.012, 0.012, 0.1, COLORS.dark, 0, 0.835, 0.08), 0.35, 0, 0),
		...([-1, 1] as const).map((side) => ball(0.01, COLORS.dark, side * 0.032, 0.82, 0.19)),
		...wings(0.08, 0.49, (side) => [
			ball(0.08, fur, side * 0.09, 0.44, -0.06, 0.4, 0.8, 1.7),
			ball(0.04, COLORS.dark, side * 0.095, 0.42, -0.19, 0.35, 0.6, 1.2)
		])
	],
	// Round and upright, with no ear tufts: a round pale face disc and big black eyes.
	'tawny-owl': ({ fur, accent }) => [
		ball(0.16, fur, 0, 0.24, 0, 1, 1.25, 1),
		ball(0.14, fur, 0, 0.5, 0.01),
		ball(0.115, accent, 0, 0.5, 0.1, 1, 1, 0.35),
		rot(cone(0.016, 0.045, COLORS.dark, 0, 0.47, 0.145), Math.PI * 0.6, 0, 0),
		rot(box(0.1, 0.02, 0.1, fur, 0, 0.1, -0.15), -0.3, 0, 0),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.04, COLORS.dark, side * 0.05, 0.52, 0.13),
			box(0.06, 0.04, 0.06, accent, side * 0.06, 0.02, 0.06)
		]),
		...wings(0.14, 0.34, (side) => [
			ball(0.1, fur, side * 0.15, 0.25, -0.01, 0.35, 1.1, 0.9)
		])
	],
	// A black bandit mask under white brows, and a ringed tail.
	raccoon: ({ fur, accent }) => [
		ball(0.16, fur, 0, 0.28, -0.02, 1, 0.9, 1.35),
		...legs(0.06, 0.17, COLORS.dark, 0.09, 0.14),
		ball(0.11, fur, 0, 0.37, 0.25),
		ball(0.05, COLORS.white, 0, 0.33, 0.35, 1, 0.8, 1.1),
		ball(0.018, COLORS.dark, 0, 0.34, 0.405),
		box(0.2, 0.055, 0.03, accent, 0, 0.385, 0.34),
		box(0.18, 0.025, 0.02, COLORS.white, 0, 0.42, 0.33),
		...([-1, 1] as const).map((side) =>
			rot(cone(0.035, 0.07, fur, side * 0.07, 0.47, 0.22), 0, 0, -side * 0.2)
		),
		...[0, 1, 2, 3, 4].map((i) =>
			ball(0.06, i % 2 ? accent : fur, 0, 0.26 + i * 0.025, -0.25 - i * 0.075, 1, 1, 0.75)
		)
	],
	// Round and heavy, a flat paddle of a tail, and orange front teeth.
	beaver: ({ fur, accent }) => {
		// Flat on the ground behind it (its five-sided edge's lowest corner on y = 0).
		const tail = paddleTail(COLORS.dark, 0, 0.039, -0.38);
		tail.scale.x = 1.6;
		return [
			ball(0.2, fur, 0, 0.26, -0.03, 1, 0.9, 1.3),
			ball(0.12, fur, 0, 0.32, 0.23),
			ball(0.06, fur, 0, 0.28, 0.32, 1, 0.8, 1),
			ball(0.02, COLORS.dark, 0, 0.31, 0.375),
			...([-1, 1] as const).flatMap((side) => [
				box(0.022, 0.05, 0.015, accent, side * 0.013, 0.235, 0.365),
				ball(0.014, COLORS.dark, side * 0.06, 0.36, 0.31),
				ball(0.026, fur, side * 0.08, 0.42, 0.2),
				box(0.08, 0.09, 0.1, fur, side * 0.12, 0.045, 0.12),
				box(0.1, 0.03, 0.14, COLORS.dark, side * 0.13, 0.015, -0.12),
				box(0.07, 0.08, 0.08, fur, side * 0.12, 0.04, -0.1)
			]),
			tail
		];
	},
	// The sea animals: in the world they swim low in the water, so each one's
	// tell is in its top half. Wide and flat on six thin legs, two big claws
	// held up in front, and eyes on stalks.
	crab: ({ fur, accent }) => [
		ball(0.15, fur, 0, 0.12, 0, 1.35, 0.55, 1),
		ball(0.1, accent, 0, 0.09, 0.03, 1.3, 0.4, 1),
		...([-1, 1] as const).flatMap((side) => [
			tube(0.012, 0.09, fur, side * 0.06, 0.22, 0.09),
			ball(0.027, COLORS.white, side * 0.06, 0.27, 0.09),
			ball(0.014, COLORS.dark, side * 0.06, 0.275, 0.113),
			box(0.035, 0.035, 0.11, fur, side * 0.13, 0.14, 0.15),
			ball(0.065, fur, side * 0.16, 0.17, 0.25, 1, 0.8, 1.2),
			ball(0.04, accent, side * 0.17, 0.2, 0.31, 0.8, 0.5, 1),
			...[-0.08, 0, 0.08].flatMap((z) => [
				box(0.1, 0.025, 0.025, fur, side * 0.24, 0.07, z),
				box(0.025, 0.07, 0.025, fur, side * 0.3, 0.035, z)
			])
		])
	],
	// A five-armed star standing upright on one of its arms, a face in the
	// middle: at sea the other four and the face stay over the water, and
	// upright it is never edge-on to a camera above, whichever way it swims.
	starfish: ({ fur, accent }) => [
		...[-90, -18, 54, 126, 198].map((deg) =>
			starArm(0.1, STAR_ARM, fur, (deg * Math.PI) / 180, STAR_MIDDLE)
		),
		ball(0.12, fur, 0, STAR_MIDDLE, 0, 1, 1, 0.5),
		ball(0.07, accent, 0, STAR_MIDDLE - 0.02, 0.045, 1, 0.8, 0.45),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.036, COLORS.white, side * 0.05, STAR_MIDDLE + 0.04, 0.055),
			ball(0.018, COLORS.dark, side * 0.05, STAR_MIDDLE + 0.04, 0.085)
		]),
		box(0.06, 0.015, 0.015, COLORS.dark, 0, STAR_MIDDLE - 0.035, 0.075)
	],
	// A domed shell over four wide flippers, and a round head poking out in front.
	turtle: ({ fur, accent }) => [
		ball(0.26, accent, 0, 0.2, 0, 1, 0.55, 1.2),
		ball(0.2, fur, 0, 0.12, 0.02, 1.05, 0.3, 1.15),
		ball(0.085, fur, 0, 0.2, 0.37, 1, 0.9, 1.2),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.018, COLORS.dark, side * 0.05, 0.235, 0.44),
			rot(box(0.24, 0.03, 0.09, fur, side * 0.27, 0.015, 0.15), 0, side * 0.45, 0),
			rot(box(0.12, 0.03, 0.07, fur, side * 0.19, 0.015, -0.25), 0, -side * 0.5, 0)
		]),
		rot(cone(0.03, 0.09, fur, 0, 0.1, -0.36), -Math.PI / 2, 0, 0)
	],
	// Sleek and long, a pale belly, a beak of a nose and a fin standing up on
	// its back; it rests on its side fins and its tail.
	dolphin: ({ fur, accent }) => [
		ball(0.16, fur, 0, 0.26, 0, 1, 1, 2.4),
		ball(0.13, accent, 0, 0.21, 0.08, 0.9, 0.8, 2),
		ball(0.13, fur, 0, 0.3, 0.38, 1, 0.95, 1.1),
		rot(tube(0.045, 0.16, accent, 0, 0.25, 0.56), Math.PI / 2, 0, 0),
		rot(cone(0.07, 0.18, fur, 0, 0.47, -0.04), -0.45, 0, 0),
		ball(0.08, fur, 0, 0.13, -0.5, 1, 1, 2),
		box(0.34, 0.025, 0.13, fur, 0, 0.0125, -0.7),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.025, COLORS.dark, side * 0.1, 0.34, 0.45),
			rot(box(0.18, 0.025, 0.09, fur, side * 0.16, 0.0125, 0.16), 0, side * 0.5, 0)
		])
	],
	// A big round head with big eyes, and eight arms that stand on the ground
	// and curl up round it, so at sea, where only its top shows, the arms do too.
	// Resting, they flop down (the `arms` joint, see `liePose`).
	octopus: ({ fur }) => [
		ball(0.2, fur, 0, 0.42, -0.04, 1, 1.25, 1),
		ball(0.17, fur, 0, 0.14, 0, 1, 0.45, 1),
		limb(
			'arms',
			0,
			0,
			Array.from({ length: 8 }, (_, i) => {
				const yaw = ((i + 0.5) * Math.PI) / 4;
				const front = Math.cos(yaw) > 0.9;
				return tentacle(front ? OCTOPUS_ARM_LOW : OCTOPUS_ARM, 0.07, fur, yaw);
			})
		),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.07, COLORS.white, side * 0.095, 0.42, 0.13),
			ball(0.035, COLORS.dark, side * 0.095, 0.42, 0.195)
		])
	],
	// Huge and long, a pale throat, a tail fluke flat on the water, and a
	// spout of water drops fountaining out of the blowhole on top.
	whale: ({ fur, accent }) => [
		ball(0.3, fur, 0, 0.36, 0, 1, 0.95, 2),
		ball(0.25, accent, 0, 0.26, 0.2, 0.95, 0.65, 1.55),
		ball(0.14, fur, 0, 0.22, -0.72, 1, 0.8, 1.5),
		box(0.3, 0.035, 0.2, fur, -0.15, 0.0175, -0.98),
		box(0.3, 0.035, 0.2, fur, 0.15, 0.0175, -0.98),
		...spout(0, 0.62, 0.25),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.035, COLORS.white, side * 0.265, 0.38, 0.38),
			ball(0.018, COLORS.dark, side * 0.285, 0.38, 0.4),
			rot(box(0.3, 0.035, 0.12, fur, side * 0.32, 0.0175, 0.2), 0, side * 0.4, 0)
		])
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
 * A limb hung from a joint at `(x, y, z)`: a group named `name` at the joint,
 * holding `parts` placed as if the group were not there. Turning the group
 * about x swings the limb from the joint.
 */
function limb(name: string, x: number, y: number, parts: THREE.Mesh[], z = 0): THREE.Group {
	const joint = new THREE.Group();
	joint.name = name;
	joint.position.set(x, y, z);
	for (const p of parts) {
		p.position.x -= x;
		p.position.y -= y;
		p.position.z -= z;
		joint.add(p);
	}
	return joint;
}

/**
 * The trainer: a kid in a coral shirt and a blue cap, eyes on the +z face;
 * another player's trainer wears their own `look` (`TRAINER_LOOKS`).
 * Its legs and arms hang from joints (`legL`, `legR`, `armL`, `armR`) that
 * `animateWalk` swings.
 */
export function buildPlayerMesh(look: TrainerLook = PLAYER_LOOK): THREE.Group {
	const { playerSkin: skin, playerShorts: shorts } = COLORS;
	const { shirt, cap } = look;
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
/** How much taller a figure stands at the top of a breath, as a share of its height. */
export const IDLE_DEPTH = 0.03;

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
/** Radians a tail held up (a `tail` joint: the wolf's) swings back to lie behind a resting animal. */
const REST_TAIL = 1.2;
/** How much lower arms held up (an `arms` joint: the octopus's) flop as it rests. */
const REST_ARMS = 0.6;

/**
 * Lie the rig down by `rest` (0..1): flatter, lowered until its belly is on
 * the ground (and a little into it, so no gap shows under the tipped back),
 * turned about the middle of its belly so the head goes down, a tail held up
 * laid down behind, and arms held up flopped down round it. Runs after the
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
	const tail = rig.getObjectByName('tail');
	if (tail) tail.rotation.x = -REST_TAIL * rest;
	const arms = rig.getObjectByName('arms');
	if (arms) arms.scale.y = 1 - REST_ARMS * rest;
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

/**
 * A bold "Z" one unit tall, in the x-y plane, facing +z: a top bar, a slash
 * and a bottom bar, each a quad, counter-clockwise. Built by hand: a `Shape`
 * would bring its triangulator into the bundle for three quads.
 */
const Z_QUADS = [
	[-0.5, 0.24, 0.5, 0.24, 0.5, 0.5, -0.5, 0.5],
	[-0.5, -0.24, -0.1, -0.24, 0.5, 0.24, 0.1, 0.24],
	[-0.5, -0.5, 0.5, -0.5, 0.5, -0.24, -0.5, -0.24]
] as const;

function zGeometry(): THREE.BufferGeometry {
	const positions: number[] = [];
	for (const [ax, ay, bx, by, cx, cy, dx, dy] of Z_QUADS) {
		positions.push(ax, ay, 0, bx, by, 0, cx, cy, 0, ax, ay, 0, cx, cy, 0, dx, dy, 0);
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	return geometry;
}

function buildZs(): THREE.Group {
	const zs = new THREE.Group();
	zs.name = 'zs';
	const geometry = zGeometry();
	for (let i = 0; i < 3; i++) {
		const z = new THREE.Mesh(geometry, mat(COLORS.dark));
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
/** With reduced motion, how far the limbs swing and the body stretches, of the full step. */
const CALM_STEP = 0.4;

/**
 * A walking step on a figure with limbs (the trainer), after `animateIdle`:
 * one arm forward and the other back, the legs the other way, the body rocking
 * onto the landing foot and stretching a little in the air. `progress` runs
 * 0..1 through one step and everything is at rest at both ends, so steps chain
 * smoothly; `stride` (1 or -1) says which foot leads, and alternates from step
 * to step. `amount` scales it all (0 is standing still). The limbs swing
 * about their joints, so the feet stay put while the figure hops. With
 * reduced motion the limbs swing less and the body never rocks.
 */
export function animateWalk(
	figure: THREE.Group,
	progress: number,
	stride: 1 | -1,
	amount = 1
): void {
	const rig = figure.children[0];
	if (!rig) return;
	const calm = motion.reduced;
	const s =
		Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI) * amount * (calm ? CALM_STEP : 1);
	const swing = (joint: string, radians: number) => {
		const limb = rig.getObjectByName(joint);
		if (limb) limb.rotation.x = radians;
	};
	swing('armL', stride * ARM_SWING * s);
	swing('armR', -stride * ARM_SWING * s);
	swing('legL', -stride * LEG_SWING * s);
	swing('legR', stride * LEG_SWING * s);
	rig.rotation.z = calm ? 0 : stride * WADDLE * s;
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
