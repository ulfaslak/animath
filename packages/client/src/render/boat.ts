import * as THREE from 'three';
import { smoothstep } from './ease';
import { BOAT_COLORS } from './palette';

/**
 * The boat ([[UI_SPEC]] § Explore mode): a little rowboat built from
 * primitives, in the shop picture's colours, that the trainer carries upside
 * down on their back once they own it and that swings under them as they step
 * onto the water, the human's picture: "it appears as a small upside down
 * boat on your back and you simply walk into the water and a boat animates
 * (rotates, translates and scales) to sit under you, smooth like that".
 *
 * It is a child of the trainer's figure, so it walks and turns with them.
 * `poseBoat` puts it anywhere between its two poses: on the back (0), small,
 * standing on its bow against the trainer's back like a shell, its bottom
 * turned out, and afloat (1), right side up and full size under their feet,
 * its bow the way they face, a pennant standing at the stern. Between the two
 * it swings out to the trainer's right, tipping over as it grows, and drops
 * under them.
 *
 * Units are tiles, like the figures: the hull is 0.9 long and 0.48 across at
 * the stern, narrowing to its bow. The trainer stands on its floor.
 */

/** How deep the hull is, keel to rim. */
const DEPTH = 0.18;
/** The hull's half-width at the stern and at the bow, and its length. */
const STERN_R = 0.24;
const BOW_R = 0.08;
const LENGTH = 0.9;
/** How far under the rim the hull's bottom sinks, for a half-width: a flat, beamy rowboat. */
const FLATTEN = 0.75;

/** The floor the trainer stands on, above the keel. */
const FLOOR = 0.1;
/** How far the keel sits under the water's surface: only a sliver of the hull is below it. */
const KEEL_SINK = 0.06;
/** How far over the water's surface the trainer's feet are, standing in the boat. */
export const BOAT_STAND = FLOOR - KEEL_SINK;

/** On the back: how small, and where its middle sits, from the trainer's feet: against their back. */
const BACK_SCALE = 0.62;
const BACK = new THREE.Vector3(0, 0.4, -0.17);
/**
 * On the back it stands on its bow like a shell, its open side against the
 * trainer's back and its bottom out, leaning back a little at the top.
 */
const BACK_TURN = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.3, 0, 0));

/**
 * Afloat: its middle, from the trainer's feet, so the floor is under them,
 * and a little ahead of them: the trainer stands towards the stern, and the
 * bow has room for an animal riding along (`follower.ts`).
 */
export const AFLOAT_AHEAD = 0.18;
const AFLOAT = new THREE.Vector3(0, DEPTH / 2 - FLOOR, AFLOAT_AHEAD);
const AFLOAT_TURN = new THREE.Quaternion();
/** A little rocking on the water, reused. */
const ROCK = new THREE.Quaternion();
const ROCK_EULER = new THREE.Euler();
/** How far to the trainer's right it swings on its way from one to the other, and how high. */
const SWING_OUT = 0.5;
const SWING_UP = 0.12;

/** Seconds the boat takes to swing under the trainer, or back onto their back. */
export const BOAT_SWING_SECONDS = 0.55;

const materials = {
	hull: new THREE.MeshLambertMaterial({
		color: BOAT_COLORS.hull,
		flatShading: true,
		side: THREE.FrontSide
	}),
	inside: new THREE.MeshLambertMaterial({
		color: BOAT_COLORS.inside,
		flatShading: true,
		side: THREE.BackSide
	}),
	trim: new THREE.MeshLambertMaterial({ color: BOAT_COLORS.trim, flatShading: true }),
	pennant: new THREE.MeshLambertMaterial({
		color: BOAT_COLORS.pennant,
		flatShading: true,
		side: THREE.DoubleSide
	})
};

/** The hull: the lower half of a cone lying along z, wide at the stern, open at the top. */
function hullGeometry(): THREE.BufferGeometry {
	// A cylinder's axis is y: lay it along z with its top (the narrow end) forward,
	// then keep the half below the axis (`thetaStart` −π/2, `thetaLength` π).
	const geometry = new THREE.CylinderGeometry(
		BOW_R,
		STERN_R,
		LENGTH,
		8,
		1,
		true,
		-Math.PI / 2,
		Math.PI
	);
	geometry.rotateX(Math.PI / 2);
	geometry.scale(1, FLATTEN, 1);
	// The rim at the top, the middle of the hull at the origin.
	geometry.translate(0, DEPTH / 2, 0);
	return geometry;
}

/** A half-disc closing one end of the hull, facing out. */
function endGeometry(radius: number, z: number, outward: 1 | -1): THREE.BufferGeometry {
	const geometry = new THREE.CircleGeometry(radius, 4, Math.PI, Math.PI);
	geometry.scale(1, FLATTEN, 1);
	if (outward === 1) geometry.rotateY(Math.PI);
	geometry.translate(0, DEPTH / 2, z);
	return geometry;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
	const m = new THREE.Mesh(geometry, material);
	m.castShadow = true;
	return m;
}

/**
 * A new boat, on the back (`poseBoat` it). Its geometries are its own:
 * `disposeBoat` frees them. The trainer keeps one for as long as the page
 * lives.
 */
export function buildBoatMesh(): THREE.Group {
	const boat = new THREE.Group();
	boat.name = 'boat';
	const hull = hullGeometry();
	// The same shell twice: brown outside, the darker wood inside.
	boat.add(mesh(hull, materials.hull), mesh(hull, materials.inside));
	const stern = endGeometry(STERN_R, -LENGTH / 2, -1);
	const bow = endGeometry(BOW_R, LENGTH / 2, 1);
	for (const end of [stern, bow]) {
		boat.add(mesh(end, materials.hull), mesh(end, materials.inside));
	}
	// The floor, just under the trainer's feet.
	const floor = mesh(new THREE.BoxGeometry(0.2, 0.02, 0.44), materials.inside);
	floor.position.set(0, FLOOR - DEPTH / 2, -0.12);
	boat.add(floor);
	// A coral rim along both sides and across the stern.
	const slant = Math.atan2(STERN_R - BOW_R, LENGTH);
	const side = Math.hypot(LENGTH, STERN_R - BOW_R);
	for (const s of [-1, 1] as const) {
		const rim = mesh(new THREE.BoxGeometry(0.035, 0.035, side), materials.trim);
		rim.position.set((s * (STERN_R + BOW_R)) / 2, DEPTH / 2, 0);
		// From the wide stern to the narrow bow: each side slants in towards the middle.
		rim.rotation.y = -s * slant;
		rim.name = 'rim';
		boat.add(rim);
	}
	const transom = mesh(new THREE.BoxGeometry(STERN_R * 2, 0.035, 0.035), materials.trim);
	transom.position.set(0, DEPTH / 2, -LENGTH / 2);
	boat.add(transom);
	// A pennant at the stern, which stands up once the boat is afloat.
	const pennant = new THREE.Group();
	pennant.name = 'pennant';
	const pole = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 5), materials.inside);
	pole.position.y = 0.18;
	const flag = mesh(new THREE.ConeGeometry(0.06, 0.16, 3), materials.pennant);
	flag.rotation.z = -Math.PI / 2;
	flag.scale.set(1, 1, 0.25);
	flag.position.set(0.08, 0.3, 0);
	pennant.add(pole, flag);
	pennant.position.set(STERN_R * 0.5, DEPTH / 2, -LENGTH / 2 + 0.06);
	boat.add(pennant);
	poseBoat(boat, 0, false);
	return boat;
}

/**
 * Put the boat between its two poses: `afloat` 0 is on the trainer's back,
 * 1 under their feet. On the way it swings out to their right and tips over
 * as it grows; with `calm` (reduced motion) it snaps from one to the other
 * half way. `bob` rocks it gently on the water, afloat only: 0 is still.
 */
export function poseBoat(boat: THREE.Group, afloat: number, calm: boolean, bob = 0): void {
	const a = Math.min(1, Math.max(0, afloat));
	const e = calm ? (a < 0.5 ? 0 : 1) : smoothstep(a);
	const arc = Math.sin(e * Math.PI);
	boat.position.lerpVectors(BACK, AFLOAT, e);
	boat.position.x += arc * SWING_OUT;
	boat.position.y += arc * SWING_UP;
	// Standing on its bow on the back, right side up afloat: one turn between.
	boat.quaternion.slerpQuaternions(BACK_TURN, AFLOAT_TURN, e);
	if (e === 1 && bob !== 0) {
		boat.quaternion.multiply(ROCK.setFromEuler(ROCK_EULER.set(bob * 0.4, 0, bob)));
	}
	boat.scale.setScalar(BACK_SCALE + (1 - BACK_SCALE) * e);
	const pennant = boat.getObjectByName('pennant');
	if (pennant) pennant.scale.setScalar(Math.max(0.001, smoothstep((e - 0.7) / 0.3)));
}

/** Free the boat's geometries, each once (the hull's two sides share one; its materials are shared, and stay). */
export function disposeBoat(boat: THREE.Object3D): void {
	const geometries = new Set<THREE.BufferGeometry>();
	boat.traverse((o) => {
		if (o instanceof THREE.Mesh) geometries.add(o.geometry);
	});
	for (const geometry of geometries) geometry.dispose();
}
