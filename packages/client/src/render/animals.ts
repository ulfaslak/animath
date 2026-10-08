import * as THREE from 'three';
import { motion } from '../motion';
import { markJoint, instantiate, release, takeShape } from './merge';
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
 * A figure is drawn as one mesh (#152): its parts, as the builders below make
 * them (`buildAnimalParts`, `buildPlayerParts`), are merged into one shape
 * with their colours on its vertices, shared by every figure of the kind
 * (`merge.ts`), and the parts that move on their own hang from joints (`limb`:
 * a trainer's arms and legs, a bird's wings, the wolf's tail) that are bones
 * of that mesh, named as the joints were, so the animations below move them
 * by name as they always did. One draw call, and one more in the sun's
 * shadow, where a hedgehog took thirty-three.
 *
 * Two measures read the parts, and both are rough on purpose. A figure's
 * bounds (its feet on y = 0, its size) are three.js's `Box3.setFromObject`,
 * which turns each part's own bounding box, not its vertices: a part that
 * touches the ground and is turned must be turned in its geometry (see
 * `starArm`, `tentacle`), or its box dips under the ground though no vertex
 * does. The merged figure keeps the box its parts made, as it was built. And
 * resting reads which parts stand on the ground by their bottoms being within
 * 0.005 of it (`ON_GROUND`): a part meant to stand on it sits exactly on 0,
 * and one meant to be raised clears it well (the octopus's suckers once sat
 * on the edge). Both are measured from the parts, before they are merged.
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
 * A tube tapering from `root` thick to a point (or to `tip` thick), along a
 * smooth curve through `path`, turned about y by `yaw` (0 is out along +z).
 * Built by hand, as the z's are: three.js's `TubeGeometry` would bring its
 * curve classes into the bundle.
 */
function curvedTube(path: Path, root: number, yaw: number, tip = 0): THREE.BufferGeometry {
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
		const r = tip + (root - tip) * (1 - along[i]! / length) ** 0.75;
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

/** What sets one eagle apart from the other (`eagle`). */
interface EagleLook {
	/** How much bigger than the golden eagle: every length times this. */
	size: number;
	body: number;
	/** The head and the neck. */
	head: number;
	/** The hooked beak, and how much bigger than the golden eagle's it is. */
	beak: number;
	bill: number;
	feet: number;
	/** The tail, spread square behind it, or narrowing to a point: a wedge. */
	tail: number;
	wedge: boolean;
}

/**
 * An eagle, standing with its wings half open: from shoulder joints (`wings`)
 * they reach out from its sides and a little up, to dark tips. Its body leans
 * forward over short legs, and a hooked beak juts from its head.
 */
function eagle(look: EagleLook): THREE.Object3D[] {
	const { size: s, body, head, beak, bill, feet, tail } = look;
	const tailPart = look.wedge
		? rot(cone(0.11 * s, 0.3 * s, tail, 0, 0.2 * s, -0.3 * s), -2.2, 0, 0)
		: rot(box(0.17 * s, 0.025 * s, 0.26 * s, tail, 0, 0.19 * s, -0.3 * s), -0.6, 0, 0);
	// A wedge is a cone laid back and down, flattened into a fan.
	if (look.wedge) tailPart.scale.z = 0.25;
	return [
		...([-1, 1] as const).flatMap((side) => [
			tube(0.035 * s, 0.14 * s, body, side * 0.07 * s, 0.07 * s, 0.02 * s),
			box(0.07 * s, 0.02 * s, 0.1 * s, feet, side * 0.07 * s, 0.01 * s, 0.06 * s),
			ball(0.018 * s, COLORS.dark, side * 0.065 * s, 0.71 * s, 0.24 * s)
		]),
		rot(ball(0.19 * s, body, 0, 0.36 * s, -0.02 * s, 1, 1.2, 1.1), 0.35, 0, 0),
		tailPart,
		ball(0.12 * s, head, 0, 0.58 * s, 0.09 * s, 1, 1.1, 1),
		ball(0.115 * s, head, 0, 0.68 * s, 0.15 * s),
		rot(
			cone(0.035 * s * bill, 0.1 * s * bill, beak, 0, 0.665 * s, (0.25 + 0.05 * bill) * s),
			Math.PI / 2,
			0,
			0
		),
		rot(
			cone(
				0.02 * s * bill,
				0.05 * s * bill,
				beak,
				0,
				(0.665 - 0.025 * bill) * s,
				(0.25 + 0.095 * bill) * s
			),
			Math.PI,
			0,
			0
		),
		...wings(0.15 * s, 0.52 * s, (side) => [
			rot(
				ball(0.18 * s, body, side * 0.24 * s, 0.54 * s, -0.05 * s, 1, 0.2, 0.8),
				0,
				0,
				side * 0.25
			),
			rot(
				ball(0.12 * s, body, side * 0.39 * s, 0.62 * s, -0.08 * s, 1, 0.2, 0.7),
				0,
				0,
				side * 0.55
			),
			rot(
				ball(0.065 * s, COLORS.dark, side * 0.47 * s, 0.7 * s, -0.1 * s, 1, 0.25, 0.8),
				0,
				0,
				side * 0.7
			)
		])
	];
}

/**
 * A moose's antler, on `side`: a short beam out and up from the back of its
 * head to a broad flat palm, a shovel tipped up at its outer edge and forward,
 * with points all round its rim.
 */
function shovel(hex: number, side: -1 | 1): THREE.Object3D[] {
	const up = new THREE.Vector3(0, 1, 0);
	const plate = part(new THREE.CylinderGeometry(0.2, 0.2, 0.035, 7), hex, 0, 0, 0);
	plate.scale.set(1.25, 1, 0.8);
	const palm = new THREE.Group();
	palm.add(
		plate,
		...[-1, -0.5, 0, 0.5, 1].map((a) => {
			const out = new THREE.Vector3(side * Math.cos(a), 0, Math.sin(a));
			const tine = cone(0.028, 0.12, hex, side * 0.31 * Math.cos(a), 0, 0.22 * Math.sin(a));
			tine.quaternion.setFromUnitVectors(up, out);
			return tine;
		})
	);
	palm.position.set(side * 0.37, 1.34, 0.5);
	palm.rotation.set(0.5, 0, side * 0.28);
	return [rot(tube(0.03, 0.2, hex, side * 0.11, 1.23, 0.5), -0.5, 0, -side * 0.9), palm];
}

/** A bison's horn, `[out, up]` from the side of its head: out sideways, then curving up. */
const BISON_HORN = [
	[0, 0],
	[0.07, 0.01],
	[0.11, 0.06],
	[0.115, 0.13]
] as const;

/** A starfish's arms, and where its middle is: an arm's length up, on the arm it stands on. */
const STAR_ARM = 0.3;
const STAR_MIDDLE = STAR_ARM;

/**
 * A jellyfish's bell: a dome `r` wide round and `r · squash` tall over a flat
 * underside, its rim at height `y`.
 */
function jellyBell(r: number, squash: number, hex: number, y: number): THREE.Mesh[] {
	const dome = part(
		new THREE.SphereGeometry(r, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2),
		hex,
		0,
		y,
		0
	);
	dome.scale.y = squash;
	return [dome, part(new THREE.CylinderGeometry(r, r * 0.92, 0.03, 12), hex, 0, y - 0.015, 0)];
}

/**
 * `count` threads hanging from a jellyfish's rim `r` round, down to the
 * ground from `y`: thin cones, point down, a little inside the rim.
 */
function threads(count: number, r: number, y: number, width: number, hex: number): THREE.Mesh[] {
	return Array.from({ length: count }, (_, i) => {
		const a = ((i + 0.5) / count) * Math.PI * 2;
		return rot(cone(width, y, hex, Math.sin(a) * r, y / 2, Math.cos(a) * r), Math.PI, 0, 0);
	});
}

/**
 * A fin standing up out of a back: a flat triangle `h` tall over a foot `w`
 * long, its middle at (0, `y`, `z`) and its point leaning `lean` back.
 */
function backFin(
	w: number,
	h: number,
	hex: number,
	y: number,
	z: number,
	lean: number
): THREE.Mesh {
	const geo = new THREE.ConeGeometry(w / 1.5, h, 3);
	geo.scale(0.22, 1, 1);
	geo.rotateX(-lean);
	return part(geo, hex, 0, y + (h / 2) * Math.cos(lean), z - (h / 2) * Math.sin(lean));
}

/**
 * A seal's whiskers: three pale bristles fanning out on each side of a muzzle
 * whose sides are `x` out at (`y`, `z`).
 */
function whiskers(x: number, y: number, z: number): THREE.Mesh[] {
	return ([-1, 1] as const).flatMap((side) =>
		[-0.25, 0, 0.25].map((tilt) =>
			rot(box(0.13, 0.006, 0.006, COLORS.white, side * (x + 0.06), y, z), 0, -side * 0.35, tilt)
		)
	);
}

/**
 * Spots on a round back: `count` flat dots in `hex` over the upper part of an
 * egg of radii (rx, ry, rz) round (0, y, z), spread by the golden angle so
 * they never line up, each `size` wide.
 */
function spots(
	count: number,
	size: number,
	hex: number,
	[rx, ry, rz]: readonly [number, number, number],
	y: number,
	z: number,
	lowest = 0.15
): THREE.Mesh[] {
	const golden = Math.PI * (3 - Math.sqrt(5));
	return Array.from({ length: count }, (_, i) => {
		// From near the top of the egg down to `lowest` of its height above the middle.
		const up = 1 - (i + 0.5) / count;
		const h = lowest + (1 - lowest) * up;
		const ring = Math.sqrt(1 - h * h);
		const a = i * golden;
		const dot = ball(
			size,
			hex,
			Math.sin(a) * ring * rx,
			y + h * ry,
			z + Math.cos(a) * ring * rz,
			1,
			0.35,
			1
		);
		// Lying on the surface: its flat side along the egg's normal there.
		dot.lookAt(
			new THREE.Vector3((Math.sin(a) * ring) / rx, h / ry, (Math.cos(a) * ring) / rz).add(
				dot.position
			)
		);
		dot.rotateX(Math.PI / 2);
		return dot;
	});
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
		...wings(0.09, 0.23, (side) => [ball(0.06, fur, side * 0.1, 0.19, -0.03, 0.35, 0.9, 1.4)])
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
		...wings(0.14, 0.34, (side) => [ball(0.1, fur, side * 0.15, 0.25, -0.01, 0.35, 1.1, 0.9)])
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
		// A broad oval paddle, flat on the ground behind it (its underside on y = 0): the
		// otter's pointed tail, widened, read from behind as a dark arrowhead.
		const tail = ball(0.12, COLORS.dark, 0, 0.024, -0.42, 0.95, 0.2, 1.45);
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
	// The big animals of the Nordic countryside (#89 wave 2), each bigger than every
	// animal two tiers below it, and sized as in nature within its tier: the moose
	// is the tallest on land. The birds' wings hang from shoulder joints, as the
	// small birds' do.
	//
	// A dark wedge of a head on short legs, a bristly ridge along its back, and
	// curved white tusks either side of a flat snout disc.
	'wild-boar': ({ fur, accent }) => {
		// The head: a blunt cone from the shoulders down to the snout.
		const head = part(new THREE.CylinderGeometry(0.07, 0.17, 0.36, 6), fur, 0, 0.4, 0.46);
		const snout = part(
			new THREE.CylinderGeometry(0.075, 0.075, 0.03, 8),
			COLORS.dark,
			0,
			0.352,
			0.648
		);
		return [
			ball(0.25, fur, 0, 0.4, -0.08, 0.85, 0.85, 1.45),
			ball(0.22, fur, 0, 0.44, 0.14, 0.95, 1, 1),
			...legs(0.075, 0.24, fur, 0.1, 0.22),
			rot(head, Math.PI / 2 + 0.25, 0, 0),
			rot(snout, Math.PI / 2 + 0.25, 0, 0),
			...[
				[-0.3, 0.57],
				[-0.2, 0.6],
				[-0.1, 0.61],
				[0, 0.61],
				[0.1, 0.65],
				[0.2, 0.65]
			].map(([z, y]) => rot(cone(0.035, 0.1, COLORS.dark, 0, y! + 0.03, z!), -0.3, 0, 0)),
			...([-1, 1] as const).flatMap((side) => [
				part(
					curvedTube(
						[
							[0, 0],
							[0.045, 0.05],
							[0.045, 0.11],
							[0, 0.16]
						],
						0.03,
						side * 0.5
					),
					accent,
					side * 0.075,
					0.3,
					0.6
				),
				ball(0.018, COLORS.white, side * 0.1, 0.49, 0.4),
				rot(cone(0.05, 0.12, fur, side * 0.1, 0.6, 0.3), 0.2, 0, -side * 0.4)
			]),
			rot(tube(0.014, 0.16, fur, 0, 0.44, -0.46), 0.25, 0, 0),
			ball(0.03, COLORS.dark, 0, 0.37, -0.48)
		];
	},
	// A big white body on short dark legs, a long neck curved like an S, and an
	// orange beak with a black knob at its base.
	'mute-swan': ({ fur, accent }) => [
		...([-1, 1] as const).flatMap((side) => [
			tube(0.02, 0.2, COLORS.dark, side * 0.07, 0.1, -0.02),
			box(0.08, 0.016, 0.1, COLORS.dark, side * 0.07, 0.008, 0.03),
			ball(0.014, COLORS.dark, side * 0.06, 0.925, 0.3)
		]),
		ball(0.22, fur, 0, 0.33, -0.04, 0.95, 0.68, 1.55),
		rot(cone(0.07, 0.14, fur, 0, 0.4, -0.42), -1.0, 0, 0),
		part(
			curvedTube(
				[
					[0, 0],
					[0.09, 0.14],
					[0.03, 0.29],
					[0, 0.42],
					[0.06, 0.54]
				],
				0.08,
				0,
				0.055
			),
			fur,
			0,
			0.36,
			0.2
		),
		ball(0.075, fur, 0, 0.91, 0.27, 0.9, 0.9, 1.3),
		rot(cone(0.038, 0.14, accent, 0, 0.88, 0.41), Math.PI / 2 + 0.3, 0, 0),
		ball(0.03, COLORS.dark, 0, 0.918, 0.355),
		...wings(0.17, 0.4, (side) => [
			rot(ball(0.19, fur, side * 0.17, 0.4, -0.08, 0.32, 0.62, 1.35), 0.12, 0, 0)
		])
	],
	// Big, round and upright: two ear tufts standing up like horns, and huge
	// orange eyes.
	'eagle-owl': ({ fur, accent }) => [
		ball(0.21, fur, 0, 0.31, 0, 1, 1.25, 0.95),
		ball(0.18, fur, 0, 0.66, 0.01),
		rot(cone(0.022, 0.07, COLORS.dark, 0, 0.62, 0.18), Math.PI * 0.6, 0, 0),
		rot(box(0.14, 0.025, 0.14, fur, 0, 0.12, -0.2), -0.3, 0, 0),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.062, accent, side * 0.078, 0.68, 0.14),
			ball(0.026, COLORS.dark, side * 0.078, 0.68, 0.195),
			rot(cone(0.05, 0.17, fur, side * 0.1, 0.86, 0.02), -0.15, 0, -side * 0.3),
			box(0.08, 0.05, 0.08, fur, side * 0.08, 0.025, 0.07)
		]),
		...wings(0.19, 0.44, (side) => [ball(0.13, fur, side * 0.2, 0.31, -0.02, 0.35, 1.2, 0.95)])
	],
	// A big cat on long legs and big paws, a ruff on its cheeks, a short tail
	// with a black tip, and black tufts standing up from the tips of its ears.
	lynx: ({ fur, accent }) => [
		ball(0.19, fur, 0, 0.52, -0.04, 0.85, 0.8, 1.7),
		...legs(0.075, 0.42, fur, 0.09, 0.2),
		ball(0.15, fur, 0, 0.74, 0.3),
		ball(0.075, COLORS.white, 0, 0.69, 0.42, 1.1, 0.8, 0.8),
		ball(0.022, COLORS.dark, 0, 0.72, 0.48),
		...([-1, 1] as const).flatMap((side) => [
			box(0.11, 0.05, 0.13, fur, side * 0.09, 0.025, 0.22),
			box(0.11, 0.05, 0.13, fur, side * 0.09, 0.025, -0.18),
			ball(0.022, COLORS.dark, side * 0.06, 0.78, 0.43),
			rot(cone(0.075, 0.2, fur, side * 0.15, 0.64, 0.3), 0, 0, -side * 2.5),
			rot(cone(0.055, 0.15, fur, side * 0.085, 0.93, 0.28), 0, 0, -side * 0.15),
			rot(cone(0.018, 0.13, accent, side * 0.106, 1.068, 0.28), 0, 0, -side * 0.15)
		]),
		rot(ball(0.05, fur, 0, 0.6, -0.42, 1, 1, 1.8), 0.6, 0, 0),
		ball(0.042, accent, 0, 0.65, -0.49)
	],
	// Low and bear-like on short dark legs, a bushy tail, and a pale golden band
	// along each side from its shoulder to its tail.
	wolverine: ({ fur, accent }) => [
		ball(0.24, fur, 0, 0.36, -0.03, 1, 0.8, 1.45),
		...legs(0.09, 0.2, COLORS.dark, 0.14, 0.22),
		ball(0.14, fur, 0, 0.44, 0.34, 1, 0.9, 1.1),
		ball(0.07, COLORS.dark, 0, 0.4, 0.46, 1, 0.85, 1),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.016, COLORS.white, side * 0.06, 0.49, 0.45),
			ball(0.045, fur, side * 0.1, 0.56, 0.3, 1, 0.8, 0.6),
			rot(ball(0.15, accent, side * 0.21, 0.4, -0.06, 0.28, 0.35, 1.55), -0.12, 0, 0)
		]),
		rot(ball(0.09, fur, 0, 0.38, -0.46, 1, 1, 2), -0.35, 0, 0)
	],
	// Standing with its wings half open: a golden head and neck, and a hooked beak.
	'golden-eagle': ({ fur, accent }) =>
		eagle({
			size: 1,
			body: fur,
			head: accent,
			beak: COLORS.dark,
			bill: 1,
			feet: accent,
			tail: fur,
			wedge: false
		}),
	// Bigger than the golden eagle, with a pale head: a white wedge of a tail, and
	// a big yellow beak.
	'white-tailed-eagle': ({ fur, accent }) =>
		eagle({
			size: 1.12,
			body: fur,
			head: COLORS.white,
			beak: accent,
			bill: 1.45,
			feet: accent,
			tail: COLORS.white,
			wedge: true
		}),
	// A bird of prey smaller than the eagles, leaning forward on short legs: brown,
	// with a pale band across its chest and a small dark hooked beak, and broad
	// rounded wings folded at its sides, dark at their fingered tips, that spread
	// wide in the air (#91).
	buzzard: ({ fur, accent }) => [
		...([-1, 1] as const).flatMap((side) => [
			tube(0.018, 0.12, COLORS.dark, side * 0.05, 0.06, 0.02),
			box(0.05, 0.015, 0.07, COLORS.dark, side * 0.05, 0.0075, 0.05),
			ball(0.016, COLORS.dark, side * 0.045, 0.55, 0.135)
		]),
		rot(ball(0.16, fur, 0, 0.3, 0, 1, 1.2, 1.05), 0.2, 0, 0),
		rot(ball(0.13, accent, 0, 0.3, 0.1, 1.02, 0.42, 0.72), 0.2, 0, 0),
		ball(0.1, fur, 0, 0.52, 0.05, 1, 1.05, 1),
		rot(cone(0.026, 0.07, COLORS.dark, 0, 0.51, 0.17), Math.PI / 2 + 0.25, 0, 0),
		rot(box(0.15, 0.025, 0.2, fur, 0, 0.17, -0.25), -0.55, 0, 0),
		...wings(0.14, 0.43, (side) => [
			rot(ball(0.15, fur, side * 0.16, 0.33, -0.04, 0.38, 1, 1.25), 0, 0, side * 0.12),
			ball(0.07, COLORS.dark, side * 0.16, 0.2, -0.12, 0.3, 0.6, 0.9)
		])
	],
	// The tallest on land: long legs, a hump at the shoulders, a long drooping
	// nose with a "bell" of skin under its chin, and huge flat antlers held out
	// like shovels.
	moose: ({ fur, accent }) => [
		...legs(0.09, 0.68, fur, 0.12, 0.3),
		ball(0.3, fur, 0, 0.88, -0.06, 0.95, 0.78, 1.5),
		ball(0.24, fur, 0, 1.08, 0.24, 0.9, 1.05, 1),
		rot(box(0.18, 0.22, 0.3, fur, 0, 1.02, 0.47), -0.45, 0, 0),
		rot(box(0.2, 0.22, 0.4, fur, 0, 1.07, 0.68), 0.3, 0, 0),
		ball(0.12, fur, 0, 0.95, 0.88, 1, 0.95, 1.2),
		rot(cone(0.055, 0.2, fur, 0, 0.82, 0.66), Math.PI, 0, 0),
		ball(0.06, fur, 0, 0.93, -0.5),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.022, COLORS.dark, side * 0.055, 0.94, 1.0),
			ball(0.022, COLORS.dark, side * 0.1, 1.16, 0.64),
			ball(0.05, fur, side * 0.16, 1.2, 0.46, 1, 1.7, 0.6),
			...shovel(accent, side)
		])
	],
	// Massive, with a high shaggy hump over its shoulders, a head hung low with a
	// dark beard under its chin, and short dark horns curving up.
	'european-bison': ({ fur, accent }) => [
		...legs(0.1, 0.44, fur, 0.14, 0.3),
		ball(0.28, fur, 0, 0.64, -0.28, 0.95, 0.85, 1.1),
		ball(0.4, fur, 0, 0.8, 0.1, 0.9, 1.05, 1),
		...[
			[0, 1.2, -0.02],
			[0, 1.16, 0.14],
			[0, 1.06, 0.28],
			[0.14, 1.12, 0.05],
			[-0.14, 1.12, 0.05],
			[0.2, 1.02, 0.22],
			[-0.2, 1.02, 0.22]
		].map(([x, y, z]) => rot(cone(0.06, 0.13, fur, x!, y!, z!), -0.5, 0, -x! * 2)),
		ball(0.17, fur, 0, 0.6, 0.52, 1, 1.05, 1.05),
		ball(0.1, fur, 0, 0.53, 0.66),
		ball(0.03, COLORS.dark, 0, 0.53, 0.76),
		rot(cone(0.1, 0.24, accent, 0, 0.36, 0.55), Math.PI, 0, 0),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.02, COLORS.white, side * 0.1, 0.66, 0.64),
			part(curvedTube(BISON_HORN, 0.035, (side * Math.PI) / 2), accent, side * 0.12, 0.72, 0.5),
			ball(0.05, fur, side * 0.17, 0.68, 0.46, 0.6, 1, 1)
		]),
		rot(tube(0.016, 0.3, fur, 0, 0.62, -0.6), 0.2, 0, 0),
		ball(0.04, accent, 0, 0.47, -0.63)
	],
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
	],
	// #89's third wave: the sea of the Nordic countryside. A pale dome of a
	// bell on a short frill of threads, and on top of it four violet rings.
	'moon-jellyfish': ({ fur, accent }) => [
		...jellyBell(0.2, 0.85, fur, 0.1),
		...threads(10, 0.16, 0.1, 0.022, fur),
		...[0, 1, 2, 3].map((i) => {
			const a = (i * Math.PI) / 2 + Math.PI / 4;
			const ring = part(
				new THREE.TorusGeometry(0.045, 0.013, 5, 12),
				accent,
				Math.sin(a) * 0.075,
				0.26,
				Math.cos(a) * 0.075
			);
			ring.rotation.set(-Math.PI / 2 + Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45);
			return ring;
		}),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.026, COLORS.white, side * 0.06, 0.17, 0.17),
			ball(0.013, COLORS.dark, side * 0.06, 0.17, 0.192)
		])
	],
	// A flatfish leaping up out of the water on its tail, its flat side to
	// the front: both eyes on that side, up by its head, and bright orange
	// spots all over it.
	plaice: ({ fur, accent }) => [
		ball(0.19, fur, 0, 0.31, 0, 0.95, 1.25, 0.26),
		ball(0.21, fur, 0, 0.3, -0.006, 1.02, 1.28, 0.1),
		(() => {
			const tail = cone(0.11, 0.12, fur, 0, 0.06, 0);
			tail.scale.z = 0.25;
			return tail;
		})(),
		...[
			[-0.09, 0.4],
			[0.07, 0.34],
			[-0.03, 0.27],
			[0.1, 0.23],
			[-0.1, 0.2],
			[0.02, 0.15]
		].flatMap(([x, y]) => [
			ball(0.028, accent, x!, y!, 0.045, 1, 1, 0.4),
			ball(0.028, accent, x!, y!, -0.045, 1, 1, 0.4)
		]),
		ball(0.03, COLORS.white, 0.02, 0.51, 0.042),
		ball(0.015, COLORS.dark, 0.02, 0.51, 0.068),
		ball(0.03, COLORS.white, 0.085, 0.47, 0.042),
		ball(0.015, COLORS.dark, 0.085, 0.47, 0.068),
		rot(box(0.05, 0.012, 0.012, COLORS.dark, -0.05, 0.5, 0.045), 0, 0, 0.5)
	],
	// A bigger bell than the moon jellyfish's, and round its rim a shaggy
	// golden mane of frills, some flaring out and some hanging, over short
	// golden threads.
	'lions-mane-jellyfish': ({ fur, accent }) => [
		...jellyBell(0.25, 0.95, fur, 0.18),
		...threads(12, 0.19, 0.18, 0.024, accent),
		...Array.from({ length: 22 }, (_, i) => {
			const a = ((i + 0.5) / 22) * Math.PI * 2;
			// The same frill on both sides of the middle, so the mane is centred.
			const k = Math.min(i, 21 - i);
			const out = [1, 0.45, 0.75][k % 3]!;
			const long = 0.13 + 0.05 * ((k * 7) % 3);
			const r = 0.25 + 0.04 * out;
			const frill = cone(
				0.042,
				long,
				accent,
				Math.sin(a) * r,
				0.16 - 0.03 * (1 - out),
				Math.cos(a) * r
			);
			// Point away from the rim, out and down: `out` 1 flares widest, less hangs lower.
			frill.rotation.set(
				Math.cos(a) * (Math.PI / 2 + 0.35 + 0.6 * (1 - out)),
				0,
				-Math.sin(a) * (Math.PI / 2 + 0.35 + 0.6 * (1 - out)),
				'YXZ'
			);
			return frill;
		}),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.03, COLORS.white, side * 0.075, 0.29, 0.215),
			ball(0.015, COLORS.dark, side * 0.075, 0.29, 0.242)
		])
	],
	// Blue-black, as a live one is (red only once it is cooked), on four
	// pairs of thin legs: two big claws held up in front, the crusher bigger
	// than the other, and long feelers sweeping up and back.
	lobster: ({ fur, accent }) => [
		ball(0.11, fur, 0, 0.14, 0.04, 1, 0.8, 1.4),
		ball(0.095, fur, 0, 0.12, -0.14, 1, 0.65, 0.7),
		ball(0.08, fur, 0, 0.11, -0.23, 1, 0.6, 0.65),
		ball(0.066, fur, 0, 0.095, -0.31, 1, 0.55, 0.65),
		(() => {
			// The tail fan, lying back on the ground: turned in its shape, so its bounds are its own.
			const fan = new THREE.ConeGeometry(0.09, 0.09, 5);
			fan.rotateX(-Math.PI / 2 - 0.25);
			fan.computeBoundingBox();
			fan.translate(0, -fan.boundingBox!.min.y, 0);
			return part(fan, fur, 0, 0, -0.38);
		})(),
		...([-1, 1] as const).flatMap((side) => {
			// The crusher, on the right, is the bigger claw: it stands a little further in, so
			// the two reach out as far each side.
			const size = side > 0 ? 1.3 : 1;
			const x = side * (0.16 + 0.03 * size - 0.012 * side);
			const [y, z] = [0.34 + 0.02 * size, 0.24];
			return [
				...[0.1, 0.02, -0.06, -0.14].flatMap((legZ) => [
					box(0.1, 0.02, 0.02, fur, side * 0.11, 0.075, legZ),
					box(0.02, 0.075, 0.02, fur, side * 0.16, 0.0375, legZ)
				]),
				tube(0.012, 0.08, fur, side * 0.045, 0.24, 0.17),
				ball(0.028, COLORS.white, side * 0.045, 0.3, 0.17),
				ball(0.014, COLORS.dark, side * 0.045, 0.305, 0.194),
				rot(tube(0.026, 0.2, fur, side * 0.12, 0.23, 0.16), -0.3, 0, -side * 0.55),
				// The hand held up, and its two fingers open in a V over it.
				rot(ball(0.07 * size, fur, x, y, z, 1.05, 1.5, 0.85), 0.25, 0, 0),
				rot(
					cone(0.036 * size, 0.13 * size, fur, x - 0.035 * size, y + 0.14 * size, z + 0.03),
					0.25,
					0,
					0.35
				),
				rot(
					cone(0.03 * size, 0.11 * size, fur, x + 0.035 * size, y + 0.13 * size, z + 0.03),
					0.25,
					0,
					-0.35
				),
				ball(0.022 * size, accent, x - 0.058 * size, y + 0.2 * size, z + 0.045),
				ball(0.019 * size, accent, x + 0.055 * size, y + 0.18 * size, z + 0.045),
				part(
					curvedTube(
						[
							[0, 0],
							[0.04, 0.1],
							[0.01, 0.2],
							[-0.08, 0.26],
							[-0.18, 0.27]
						],
						0.012,
						side * 0.3
					),
					fur,
					side * 0.03,
					0.19,
					0.2
				)
			];
		})
	],
	// A round head like a puppy's, with big dark eyes and whiskers, held up
	// in front of a plump body; dark spots all over it (spættet, spotted).
	'harbour-seal': ({ fur, accent }) => [
		ball(0.2, fur, 0, 0.18, -0.14, 1, 0.85, 1.9),
		ball(0.165, fur, 0, 0.25, 0.14, 1, 1, 1.05),
		ball(0.145, fur, 0, 0.4, 0.3, 1, 0.95, 1.05),
		ball(0.07, fur, 0, 0.36, 0.44, 1.15, 0.78, 0.8),
		ball(0.026, COLORS.dark, 0, 0.38, 0.495),
		...whiskers(0.05, 0.35, 0.47),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.042, COLORS.dark, side * 0.068, 0.44, 0.41),
			ball(0.013, COLORS.white, side * 0.058, 0.455, 0.447),
			rot(ball(0.1, fur, side * 0.2, 0.03, 0.1, 0.35, 0.3, 1), 0, side * 0.5, 0),
			rot(ball(0.09, fur, side * 0.06, 0.0225, -0.6, 0.45, 0.25, 1.1), 0, side * 0.35, 0)
		]),
		...spots(15, 0.03, accent, [0.2, 0.17, 0.38], 0.18, -0.14),
		...spots(6, 0.026, accent, [0.165, 0.165, 0.17], 0.25, 0.14, 0.2),
		...spots(4, 0.022, accent, [0.145, 0.14, 0.15], 0.4, 0.26, 0.55)
	],
	// Small and blunt, with no beak (the dolphin has one), a pale belly and a
	// small triangle of a fin.
	'harbour-porpoise': ({ fur, accent }) => [
		ball(0.16, fur, 0, 0.24, 0, 1, 1, 2),
		ball(0.13, accent, 0, 0.19, 0.06, 0.92, 0.75, 1.75),
		ball(0.14, fur, 0, 0.27, 0.27, 1, 0.95, 1.05),
		backFin(0.16, 0.13, fur, 0.37, -0.04, 0.35),
		ball(0.07, fur, 0, 0.13, -0.42, 1, 1, 1.8),
		box(0.3, 0.025, 0.12, fur, 0, 0.0125, -0.58),
		box(0.06, 0.012, 0.012, COLORS.dark, 0, 0.23, 0.41),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.028, COLORS.white, side * 0.098, 0.3, 0.345),
			ball(0.018, COLORS.dark, side * 0.104, 0.3, 0.36),
			rot(box(0.16, 0.025, 0.08, fur, side * 0.15, 0.0125, 0.14), 0, side * 0.5, 0)
		])
	],
	// Bigger than the harbour seal, grey with pale blotches, and a long
	// straight "Roman" nose.
	'grey-seal': ({ fur, accent }) => [
		ball(0.26, fur, 0, 0.24, -0.18, 1, 0.88, 1.9),
		ball(0.21, fur, 0, 0.32, 0.18, 1, 1, 1.05),
		ball(0.16, fur, 0, 0.54, 0.34, 0.95, 0.9, 1.05),
		// The long straight nose, sloping down from the brow to the tip.
		rot(
			part(new THREE.CylinderGeometry(0.07, 0.1, 0.3, 7), fur, 0, 0.48, 0.52),
			Math.PI / 2 + 0.45,
			0,
			0
		),
		ball(0.036, COLORS.dark, 0, 0.405, 0.655),
		...whiskers(0.06, 0.41, 0.6),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.035, COLORS.dark, side * 0.085, 0.6, 0.44),
			ball(0.011, COLORS.white, side * 0.077, 0.612, 0.472),
			rot(ball(0.13, fur, side * 0.25, 0.039, 0.14, 0.35, 0.3, 1), 0, side * 0.5, 0),
			rot(ball(0.12, fur, side * 0.08, 0.03, -0.74, 0.45, 0.25, 1.1), 0, side * 0.35, 0)
		]),
		...spots(9, 0.05, accent, [0.26, 0.23, 0.49], 0.24, -0.18),
		...spots(3, 0.042, accent, [0.21, 0.21, 0.22], 0.32, 0.18, 0.3)
	],
	// Black and sleek, a white belly and a white patch behind each eye, and a
	// tall black fin standing straight up out of its back.
	orca: ({ fur, accent }) => [
		ball(0.25, fur, 0, 0.3, 0, 1, 1, 2.1),
		ball(0.2, accent, 0, 0.22, 0.14, 0.95, 0.72, 1.65),
		ball(0.19, fur, 0, 0.33, 0.38, 1, 0.95, 1.15),
		backFin(0.26, 0.42, fur, 0.51, -0.06, 0.12),
		ball(0.11, fur, 0, 0.17, -0.58, 1, 1, 1.6),
		box(0.3, 0.035, 0.18, fur, -0.15, 0.0175, -0.8),
		box(0.3, 0.035, 0.18, fur, 0.15, 0.0175, -0.8),
		...([-1, 1] as const).flatMap((side) => [
			rot(ball(0.095, accent, side * 0.15, 0.45, 0.25, 0.4, 0.55, 1.4), 0, side * 0.2, 0),
			ball(0.025, COLORS.dark, side * 0.17, 0.35, 0.47),
			rot(ball(0.1, fur, side * 0.26, 0.02, 0.22, 1.4, 0.2, 0.8), 0, side * 0.5, 0)
		])
	],
	// The Arctic's small land animals (#192 wave 1), each sized as in nature within its tier:
	// the lemming and the snow bunting the smallest, the penguins the tallest. Its birds' wings
	// hang from joints as Nordland's do; a penguin's flippers are no wings: it never flies.
	//
	// Round and white, a short muzzle, small round ears, and a tail as big as its body: the
	// fox Nordland has is red, long and square.
	'arctic-fox': ({ fur, accent }) => [
		ball(0.14, fur, 0, 0.22, -0.02, 1, 0.9, 1.4),
		ball(0.1, accent, 0, 0.17, 0.08, 0.9, 0.6, 1),
		...legs(0.05, 0.12, fur, 0.07, 0.11),
		ball(0.1, fur, 0, 0.34, 0.2),
		ball(0.07, fur, 0, 0.3, 0.27, 1.1, 0.8, 1),
		rot(cone(0.04, 0.07, fur, 0, 0.31, 0.33), Math.PI / 2, 0, 0),
		ball(0.02, COLORS.dark, 0, 0.315, 0.37),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.016, COLORS.dark, side * 0.045, 0.37, 0.29),
			ball(0.04, fur, side * 0.075, 0.43, 0.17, 1, 1, 0.5),
			ball(0.025, accent, side * 0.075, 0.43, 0.185, 1, 1, 0.4)
		]),
		ball(0.11, fur, 0, 0.25, -0.33, 1, 1, 1.8),
		ball(0.08, fur, 0, 0.28, -0.5)
	],
	// Snow white, sitting up on its haunches, big back feet, and ears tipped with black.
	'arctic-hare': ({ fur, accent }) => [
		ball(0.17, fur, 0, 0.21, -0.03, 1, 1.1, 1.15),
		ball(0.12, fur, 0, 0.41, 0.09),
		ball(0.05, fur, 0, 0.37, 0.18, 1.2, 0.8, 0.8),
		ball(0.017, accent, 0, 0.39, 0.215),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.017, COLORS.dark, side * 0.055, 0.45, 0.18),
			rot(ball(0.04, fur, side * 0.055, 0.6, 0.06, 1, 2.8, 0.55), 0, 0, -side * 0.18),
			rot(ball(0.03, COLORS.dark, side * 0.08, 0.7, 0.06, 0.9, 1, 0.5), 0, 0, -side * 0.18),
			box(0.1, 0.05, 0.24, fur, side * 0.11, 0.025, 0.03),
			box(0.05, 0.12, 0.05, fur, side * 0.06, 0.06, 0.15)
		]),
		ball(0.05, fur, 0, 0.18, -0.21)
	],
	// Upright in black and white, a white face, orange feet and a big striped orange beak.
	puffin: ({ fur, accent }) => [
		ball(0.1, fur, 0, 0.2, -0.01, 1, 1.25, 1),
		ball(0.085, COLORS.white, 0, 0.19, 0.04, 0.95, 1.15, 0.85),
		ball(0.075, fur, 0, 0.35, 0.02),
		ball(0.065, COLORS.white, 0, 0.345, 0.05, 1.05, 0.85, 0.8),
		ball(0.014, COLORS.dark, -0.04, 0.36, 0.1),
		ball(0.014, COLORS.dark, 0.04, 0.36, 0.1),
		rot(cone(0.045, 0.1, accent, 0, 0.335, 0.15), Math.PI / 2, 0, 0),
		box(0.03, 0.08, 0.012, 0xf2c94c, 0, 0.335, 0.115),
		box(0.012, 0.06, 0.014, 0x8a8f99, 0, 0.335, 0.165),
		rot(box(0.07, 0.015, 0.08, fur, 0, 0.11, -0.12), -0.6, 0, 0),
		...([-1, 1] as const).flatMap((side) => [
			box(0.04, 0.03, 0.03, accent, side * 0.04, 0.05, 0.0),
			box(0.05, 0.012, 0.07, accent, side * 0.04, 0.006, 0.03)
		]),
		...wings(0.09, 0.24, (side) => [ball(0.06, fur, side * 0.1, 0.2, -0.02, 0.35, 1, 1.3)])
	],
	// A round ball of a rodent, no ears to see, a rusty collar and a dark stripe down its back.
	'arctic-lemming': ({ fur, accent }) => [
		ball(0.105, fur, 0, 0.12, -0.01, 1.1, 0.9, 1.25),
		ball(0.08, fur, 0, 0.125, 0.1, 1.05, 0.9, 1),
		ball(0.072, accent, 0, 0.115, 0.06, 1.2, 0.9, 0.5),
		box(0.025, 0.012, 0.2, COLORS.dark, 0, 0.212, -0.01),
		ball(0.015, COLORS.dark, 0, 0.125, 0.18),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.012, COLORS.dark, side * 0.04, 0.155, 0.16),
			box(0.035, 0.035, 0.04, accent, side * 0.06, 0.0175, 0.08),
			box(0.035, 0.035, 0.04, accent, side * 0.06, 0.0175, -0.08)
		])
	],
	// A tiny white songbird with black-and-white wings and a black tail.
	'snow-bunting': ({ fur, accent }) => [
		ball(0.085, fur, 0, 0.17, -0.02, 1, 0.95, 1.2),
		ball(0.06, fur, 0, 0.26, 0.05),
		rot(cone(0.016, 0.04, 0xe0b050, 0, 0.255, 0.115), Math.PI / 2, 0, 0),
		rot(box(0.06, 0.016, 0.12, accent, 0, 0.17, -0.14), -0.4, 0, 0),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.011, COLORS.dark, side * 0.035, 0.275, 0.09),
			tube(0.007, 0.09, COLORS.dark, side * 0.03, 0.045, 0),
			box(0.025, 0.008, 0.04, COLORS.dark, side * 0.03, 0.004, 0.02)
		]),
		...wings(0.08, 0.2, (side) => [
			ball(0.055, accent, side * 0.09, 0.17, -0.04, 0.35, 0.85, 1.4),
			ball(0.03, fur, side * 0.095, 0.19, 0.0, 0.3, 0.7, 1)
		])
	],
	// Plump and white as snow, a red eyebrow over a black eye stripe, a black tail and feet
	// feathered like snowshoes.
	'rock-ptarmigan': ({ fur, accent }) => [
		ball(0.14, fur, 0, 0.17, -0.02, 1, 0.9, 1.2),
		ball(0.075, fur, 0, 0.3, 0.1),
		rot(cone(0.018, 0.04, COLORS.dark, 0, 0.29, 0.18), Math.PI / 2, 0, 0),
		rot(box(0.12, 0.02, 0.09, COLORS.dark, 0, 0.16, -0.18), -0.3, 0, 0),
		...([-1, 1] as const).flatMap((side) => [
			box(0.012, 0.016, 0.07, COLORS.dark, side * 0.055, 0.3, 0.13),
			ball(0.013, COLORS.dark, side * 0.058, 0.31, 0.14),
			ball(0.024, accent, side * 0.045, 0.34, 0.135, 1.4, 0.55, 0.9),
			ball(0.045, fur, side * 0.05, 0.036, 0.03, 1, 0.8, 1.2)
		]),
		...wings(0.12, 0.2, (side) => [ball(0.08, fur, side * 0.12, 0.18, -0.03, 0.35, 0.8, 1.3)])
	],
	// A pinkish-brown bird with a crest swept back, a black mask, a yellow tip on its tail
	// and drops of red wax on its wings.
	waxwing: ({ fur, accent }) => [
		ball(0.09, fur, 0, 0.18, -0.02, 1, 1, 1.25),
		ball(0.065, fur, 0, 0.28, 0.05),
		rot(cone(0.035, 0.12, fur, 0, 0.35, -0.01), -0.9, 0, 0),
		box(0.11, 0.022, 0.03, COLORS.dark, 0, 0.29, 0.09),
		box(0.035, 0.03, 0.02, COLORS.dark, 0, 0.24, 0.1),
		rot(cone(0.015, 0.04, COLORS.dark, 0, 0.275, 0.125), Math.PI / 2, 0, 0),
		rot(box(0.06, 0.016, 0.12, 0x8a8f99, 0, 0.17, -0.14), -0.45, 0, 0),
		rot(box(0.062, 0.018, 0.035, accent, 0, 0.135, -0.205), -0.45, 0, 0),
		...([-1, 1] as const).flatMap((side) => [
			tube(0.007, 0.09, COLORS.dark, side * 0.03, 0.045, 0),
			box(0.025, 0.008, 0.04, COLORS.dark, side * 0.03, 0.004, 0.02)
		]),
		...wings(0.08, 0.21, (side) => [
			ball(0.06, 0x6f6f78, side * 0.09, 0.18, -0.04, 0.35, 0.85, 1.4),
			ball(0.012, 0xd23a2a, side * 0.11, 0.18, 0.01),
			ball(0.012, 0xd23a2a, side * 0.11, 0.165, -0.03)
		])
	],
	// Upright in black and white, an all-black head, a white ring round each eye, a stubby beak.
	'adelie-penguin': ({ fur, accent }) => [
		...penguin(0.9, fur, accent),
		ball(0.09, fur, 0, 0.5, 0.02),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.024, COLORS.white, side * 0.045, 0.52, 0.085),
			ball(0.012, COLORS.dark, side * 0.047, 0.522, 0.1)
		]),
		rot(cone(0.022, 0.06, COLORS.dark, 0, 0.49, 0.12), Math.PI / 2 + 0.1, 0, 0)
	],
	// All white, a pigeon of the south with long white wings, a black eye and a black bill.
	'snow-petrel': ({ fur, accent }) => [
		ball(0.1, fur, 0, 0.17, -0.02, 1, 0.9, 1.4),
		ball(0.068, fur, 0, 0.27, 0.1),
		rot(cone(0.016, 0.06, accent, 0, 0.265, 0.18), Math.PI / 2, 0, 0),
		rot(box(0.08, 0.016, 0.1, fur, 0, 0.17, -0.18), -0.3, 0, 0),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.019, accent, side * 0.043, 0.285, 0.14),
			tube(0.008, 0.08, 0x5b6370, side * 0.035, 0.04, 0.01),
			box(0.03, 0.008, 0.05, 0x5b6370, side * 0.035, 0.004, 0.03)
		]),
		...wings(0.09, 0.21, (side) => [ball(0.075, fur, side * 0.12, 0.2, -0.04, 0.3, 0.6, 1.8)])
	],
	// Slim and pale grey, a black cap, a blood-red bill and short red legs, a deeply forked
	// tail and long narrow wings: built for the longest trip of any animal.
	'arctic-tern': ({ fur, accent }) => [
		ball(0.09, fur, 0, 0.17, -0.03, 1, 0.85, 1.6),
		ball(0.075, COLORS.white, 0, 0.15, 0.04, 0.85, 0.7, 1.2),
		ball(0.06, COLORS.white, 0, 0.26, 0.11),
		ball(0.062, COLORS.dark, 0, 0.275, 0.1, 1, 0.7, 1.05),
		rot(cone(0.016, 0.11, accent, 0, 0.255, 0.21), Math.PI / 2, 0, 0),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.012, COLORS.dark, side * 0.04, 0.265, 0.15),
			tube(0.008, 0.07, accent, side * 0.035, 0.035, 0.0),
			box(0.03, 0.008, 0.045, accent, side * 0.035, 0.004, 0.02),
			rot(cone(0.018, 0.22, fur, side * 0.05, 0.16, -0.28), -Math.PI / 2 - 0.25, side * 0.25, 0)
		]),
		...wings(0.08, 0.21, (side) => [
			ball(0.08, fur, side * 0.11, 0.21, -0.06, 0.25, 0.5, 2.2),
			ball(0.03, COLORS.dark, side * 0.115, 0.205, -0.22, 0.25, 0.45, 1.2)
		])
	],
	// A sea duck: a black body, a pale pink breast, a pale blue head with green cheeks, and on
	// its red bill a big orange shield, its crown.
	'king-eider': ({ fur, accent }) => [
		ball(0.17, fur, 0, 0.2, -0.04, 1, 0.82, 1.45),
		ball(0.13, 0xf3e3d2, 0, 0.21, 0.12, 0.95, 0.85, 0.75),
		ball(0.1, 0xa9c4e0, 0, 0.36, 0.17),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.04, 0x7fbf8a, side * 0.055, 0.34, 0.19, 0.5, 0.9, 1.2),
			ball(0.014, COLORS.dark, side * 0.06, 0.375, 0.23),
			box(0.04, 0.05, 0.03, COLORS.dark, side * 0.07, 0.025, 0.03),
			box(0.07, 0.01, 0.09, accent, side * 0.07, 0.005, 0.06)
		]),
		ball(0.05, accent, 0, 0.38, 0.25, 1, 1, 0.8),
		rot(cone(0.03, 0.08, 0xd8322a, 0, 0.33, 0.28), Math.PI / 2 + 0.2, 0, 0),
		rot(cone(0.06, 0.12, fur, 0, 0.24, -0.27), -Math.PI / 2 + 0.6, 0, 0),
		...wings(0.15, 0.27, (side) => [
			ball(0.1, fur, side * 0.15, 0.25, -0.05, 0.3, 0.6, 1.4),
			ball(0.035, COLORS.white, side * 0.16, 0.27, 0.04, 0.3, 0.6, 1)
		])
	],
	// A big black bird all over, a heavy beak, a shaggy throat and a tail cut like a wedge.
	raven: ({ fur, accent }) => {
		const tail = rot(cone(0.08, 0.2, fur, 0, 0.2, -0.27), -2.2, 0, 0);
		tail.scale.z = 0.3;
		return [
			ball(0.15, fur, 0, 0.3, -0.03, 1, 0.95, 1.4),
			ball(0.08, accent, 0, 0.36, 0.1, 0.9, 0.9, 0.8),
			ball(0.095, fur, 0, 0.47, 0.13),
			rot(cone(0.035, 0.15, fur, 0, 0.45, 0.27), Math.PI / 2 + 0.1, 0, 0),
			tail,
			...([-1, 1] as const).flatMap((side) => [
				ball(0.016, 0x8a8f99, side * 0.055, 0.49, 0.19),
				tube(0.014, 0.16, fur, side * 0.06, 0.08, 0.0),
				box(0.05, 0.012, 0.08, fur, side * 0.06, 0.006, 0.03)
			]),
			...wings(0.13, 0.36, (side) => [
				ball(0.11, fur, side * 0.14, 0.32, -0.06, 0.3, 0.75, 1.5)
			])
		];
	},
	// A grey goose with a black neck and breast, a white face and a white belly.
	'barnacle-goose': ({ fur, accent }) => [
		ball(0.16, fur, 0, 0.25, -0.05, 1, 0.82, 1.45),
		ball(0.13, COLORS.white, 0, 0.2, 0.0, 0.9, 0.6, 1.2),
		ball(0.09, accent, 0, 0.3, 0.13, 0.95, 0.95, 0.85),
		part(
			curvedTube(
				[
					[0, 0],
					[0.06, 0.1],
					[0.03, 0.2],
					[0, 0.28]
				],
				0.045,
				0,
				0.04
			),
			accent,
			0,
			0.33,
			0.16
		),
		ball(0.065, accent, 0, 0.64, 0.2, 0.95, 0.95, 1.2),
		ball(0.055, COLORS.white, 0, 0.635, 0.24, 1.08, 0.85, 0.9),
		rot(cone(0.022, 0.06, COLORS.dark, 0, 0.62, 0.3), Math.PI / 2 + 0.2, 0, 0),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.013, COLORS.dark, side * 0.045, 0.655, 0.26),
			tube(0.015, 0.12, COLORS.dark, side * 0.06, 0.06, 0.02),
			box(0.06, 0.012, 0.08, COLORS.dark, side * 0.06, 0.006, 0.05)
		]),
		rot(cone(0.05, 0.1, COLORS.dark, 0, 0.28, -0.28), -Math.PI / 2 + 0.5, 0, 0),
		...wings(0.14, 0.32, (side) => [
			ball(0.1, fur, side * 0.15, 0.3, -0.06, 0.3, 0.6, 1.5),
			ball(0.04, COLORS.dark, side * 0.155, 0.3, -0.2, 0.3, 0.5, 1)
		])
	],
	// The biggest of its three penguins here: a long orange beak, orange feet, and a white
	// band over its head from eye to eye.
	'gentoo-penguin': ({ fur, accent }) => [
		...penguin(1.1, fur, accent),
		ball(0.1, fur, 0, 0.61, 0.02),
		ball(0.04, COLORS.white, 0, 0.69, 0.02, 2.5, 0.45, 0.9),
		...([-1, 1] as const).flatMap((side) => [
			ball(0.03, COLORS.white, side * 0.07, 0.65, 0.05, 0.6, 0.8, 1),
			ball(0.013, COLORS.dark, side * 0.055, 0.63, 0.09)
		]),
		rot(cone(0.026, 0.1, accent, 0, 0.59, 0.14), Math.PI / 2 + 0.1, 0, 0)
	],
	// A white face under a black cap, and a thin black strap under its chin, ear to ear.
	chinstrap: ({ fur, accent }) => {
		const strap = part(new THREE.TorusGeometry(0.075, 0.009, 4, 12, Math.PI), COLORS.dark, 0, 0.6, 0.04);
		strap.rotation.set(0.2, 0, Math.PI);
		return [
			...penguin(1.05, fur, accent),
			ball(0.095, COLORS.white, 0, 0.6, 0.03),
			ball(0.096, fur, 0, 0.645, 0.0, 1, 0.65, 0.95),
			strap,
			...([-1, 1] as const).map((side) => ball(0.013, COLORS.dark, side * 0.045, 0.62, 0.11)),
			rot(cone(0.02, 0.06, COLORS.dark, 0, 0.6, 0.135), Math.PI / 2 + 0.1, 0, 0)
		];
	}
};

/**
 * A penguin's body, `s` times the Adélie's: upright, black down the back, a white belly, two
 * flippers held out a little from its sides (never wings: it does not fly), a short tail and
 * feet of `feet`. Its head is the species' own (`adelie-penguin`, `gentoo-penguin`,
 * `chinstrap`).
 */
function penguin(s: number, fur: number, feet: number): THREE.Object3D[] {
	return [
		ball(0.15 * s, fur, 0, 0.27 * s, -0.01 * s, 1, 1.45, 0.95),
		ball(0.13 * s, COLORS.white, 0, 0.26 * s, 0.04 * s, 0.9, 1.35, 0.85),
		rot(box(0.07 * s, 0.02 * s, 0.07 * s, fur, 0, 0.05 * s, -0.15 * s), -0.6, 0, 0),
		...([-1, 1] as const).flatMap((side) => [
			rot(ball(0.05 * s, fur, side * 0.15 * s, 0.27 * s, 0, 0.3, 1.5, 0.75), 0, 0, side * 0.3),
			box(0.06 * s, 0.02 * s, 0.09 * s, feet, side * 0.06 * s, 0.01 * s, 0.06 * s)
		])
	];
}

function wrap(parts: THREE.Object3D[]): THREE.Group {
	const group = new THREE.Group();
	const rig = new THREE.Group();
	rig.name = 'rig';
	rig.add(...parts);
	group.add(rig);
	return group;
}

/**
 * The figure for a species in the engine catalog, drawn as one mesh, its
 * shape shared with every other figure of the species until the last of them
 * goes (`disposeFigure`). Throws for an unknown id.
 */
export function buildAnimalMesh(speciesId: string): THREE.Group {
	return merged(`animal:${speciesId}`, () => buildAnimalParts(speciesId));
}

/**
 * The same figure part by part, as its builder makes it: a mesh per part in
 * the part's colour, the moving ones on joint groups. What `buildAnimalMesh`
 * merges, and what the tests measure the builders by.
 */
export function buildAnimalParts(speciesId: string): THREE.Group {
	const build = BUILDERS[speciesId];
	const colors = ANIMAL_COLORS[speciesId];
	if (!build || !colors) throw new Error(`No mesh for species: ${speciesId}`);
	const group = wrap(build(colors));
	group.name = speciesId;
	group.userData.restShape = restShape(group.children[0]!);
	// How its wings lie, measured from their parts while there are parts to measure.
	for (const [name, side] of [
		['wingL', -1],
		['wingR', 1]
	] as const) {
		const wing = group.getObjectByName(name);
		if (wing) wing.userData.rest = wingRest(wing, side);
	}
	return group;
}

/**
 * A figure drawn as one mesh (`merge.ts`): the kind `key`'s shape, merged
 * from `parts` the first time, with what was measured of the parts (how it
 * lies down) on the figure, as the parts had it.
 */
function merged(key: string, parts: () => THREE.Group): THREE.Group {
	const shape = takeShape(key, 'skinned', () => {
		const figure = parts();
		return {
			root: figure.children[0]!,
			measures: { name: figure.name, restShape: figure.userData.restShape }
		};
	});
	const group = new THREE.Group();
	group.name = shape.measures.name as string;
	if (shape.measures.restShape) group.userData.restShape = shape.measures.restShape;
	group.add(instantiate(shape));
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
 * about x swings the limb from the joint. Merged, the joint is a bone of the
 * figure's mesh, named and placed as the group was (`merge.ts`).
 */
function limb(name: string, x: number, y: number, parts: THREE.Mesh[], z = 0): THREE.Group {
	const joint = markJoint(new THREE.Group());
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
 * `animateWalk` swings. Drawn as one mesh, shared by every trainer in the
 * same look, as an animal's is.
 */
export function buildPlayerMesh(look: TrainerLook = PLAYER_LOOK): THREE.Group {
	return merged(`trainer:${look.shirt}:${look.cap}`, () => buildPlayerParts(look));
}

/** The trainer part by part, as `buildAnimalParts` is an animal: what `buildPlayerMesh` merges. */
export function buildPlayerParts(look: TrainerLook = PLAYER_LOOK): THREE.Group {
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

/**
 * A resting animal's z's on their own, never shown: the battle keeps a set
 * hidden in its scene, since nothing else draws with their shader program
 * (a Lambert on a shape without normals), so it is compiled with the
 * battle's first frame and not as the first animal lies down (#159).
 */
export function restingZs(): THREE.Group {
	return buildZs();
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

/** Radians a spread wing stands up from level at the middle of its beat: a shallow V. */
const WING_LIFT = 0.18;
/** Radians a wing beats either way of that, and how fast: radians of the beat a second. */
export const WING_BEAT = 0.6;
const FLAP_RATE = 10;
/** How much longer a wing folded down a bird's side grows as it spreads: to a span. */
export const WING_STRETCH = 1.8;
/** How much longer a wing laid back along a bird's side grows as it spreads, already long. */
export const WING_REACH = 1.4;

/**
 * How a bird's wing lies at rest, measured once from its parts in its
 * joint's own frame. `lie`: `out`, built spread (an eagle's half-open wing,
 * wider than it is tall); `down`, folded down the bird's side, reaching
 * further below the shoulder than behind it (an owl's, the buzzard's), which
 * spreads by turning out; or `back`, laid back along the bird's side,
 * reaching further behind the shoulder than below it (the robin's, the
 * heron's, the swan's), which spreads by swinging out and lying flat about
 * its front edge, `front` (z in the joint's frame), so the long way along the
 * body becomes the span and nothing of it swings in across the back.
 * `angle`: the way its middle points from the shoulder once spread, up from
 * level and out (an eagle's reaches out and a little up).
 */
interface WingRest {
	lie: 'out' | 'down' | 'back';
	angle: number;
	front: number;
}

function wingRest(wing: THREE.Object3D, side: -1 | 1): WingRest {
	const box = new THREE.Box3();
	const part = new THREE.Box3();
	for (const child of wing.children) {
		if (!(child instanceof THREE.Mesh)) continue;
		child.geometry.computeBoundingBox();
		child.updateMatrix();
		box.union(part.copy(child.geometry.boundingBox!).applyMatrix4(child.matrix));
	}
	const size = box.getSize(new THREE.Vector3());
	const middle = box.getCenter(new THREE.Vector3());
	const front = box.max.z;
	if (size.y <= size.x)
		return { lie: 'out', angle: Math.atan2(middle.y, Math.abs(middle.x)), front };
	if (-box.min.y >= -box.min.z) return { lie: 'down', angle: -Math.PI / 2, front };
	// Swung out about its front edge and laid flat, the middle is as far out as it was behind
	// that edge, stretched, and as high as it was out from the side (that side faces down).
	return {
		lie: 'back',
		angle: Math.atan2(-side * middle.x, (front - middle.z) * WING_REACH),
		front
	};
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const swing = new THREE.Quaternion();
const turn = new THREE.Quaternion();
const edge = new THREE.Vector3();

/**
 * A bird in the air ([[UI_SPEC]] § Explore mode, § Battle mode): its wings,
 * hanging from `wingL` and `wingR`, spread out from its sides, `spread` of the
 * way (0 as it stands, wings folded; 1 wide open), and beating at `t` seconds
 * (`figure.userData.idlePhase` puts a pair out of step); with reduced motion
 * (`calm`) held out still, gliding. A folded wing grows longer as it spreads,
 * to a bird's span (`WingRest`: turned out if it folds down the side, swung
 * out and laid flat if it lies back along it). A figure without wings is left
 * as it is. Runs after `animateIdle`, which touches no wing.
 */
export function animateFlight(
	figure: THREE.Object3D,
	t: number,
	spread = 1,
	calm = motion.reduced
): void {
	const rig = figure.children[0];
	if (!rig) return;
	const open = Math.min(1, Math.max(0, spread));
	const phase = (figure.userData.idlePhase as number | undefined) ?? 0;
	const beat = calm ? 0 : Math.sin(t * FLAP_RATE + phase * 2.3) * WING_BEAT;
	for (const [name, side] of [
		['wingL', -1],
		['wingR', 1]
	] as const) {
		const wing = rig.getObjectByName(name);
		if (!wing) continue;
		const rest = (wing.userData.rest ??= wingRest(wing, side)) as WingRest;
		const lift = side * open * (WING_LIFT + beat - rest.angle);
		if (rest.lie === 'back') {
			const stretch = 1 + open * (WING_REACH - 1);
			// Turned a quarter about the body's length, so it lies flat; swung a quarter about
			// the upright, so what reached back reaches out; then lifted as any wing is. All of
			// it about the wing's front edge on the shoulder's line, which stays where it was.
			wing.quaternion
				.setFromAxisAngle(Z_AXIS, lift)
				.multiply(swing.setFromAxisAngle(Y_AXIS, (-side * open * Math.PI) / 2))
				.multiply(turn.setFromAxisAngle(Z_AXIS, (-side * open * Math.PI) / 2));
			wing.scale.set(1, 1, stretch);
			const home = (wing.userData.home ??= wing.position.clone()) as THREE.Vector3;
			wing.position.copy(home);
			if (open > 0)
				wing.position
					.add(edge.set(0, 0, rest.front))
					.sub(edge.set(0, 0, rest.front * stretch).applyQuaternion(wing.quaternion));
		} else {
			const stretch = 1 + open * (rest.lie === 'out' ? 0 : WING_STRETCH - 1);
			wing.rotation.set(0, 0, lift);
			wing.scale.set(1, stretch, 1);
		}
	}
}

/**
 * Free a figure that leaves the screen for good: its shape once no other
 * figure of its kind is drawn with it, its bones, and its z's. The materials
 * are shared by every figure and stay. A figure part by part
 * (`buildAnimalParts`) frees each part's geometry.
 */
export function disposeFigure(figure: THREE.Object3D): void {
	release(figure);
}
