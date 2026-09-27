import * as THREE from 'three';
import { smoothstep } from './ease';
import { GLIDER_COLORS } from './palette';

/**
 * The paraglider ([[UI_SPEC]] § Explore mode): built from primitives, a
 * child of the trainer's figure like the boat, so it turns and moves with
 * them. Folded, it is a little rolled-up canopy strapped high on the
 * trainer's back, peeking out past both shoulders (above the boat's shell
 * when they carry the boat too). Open, it is a bright arched wing over their
 * head, its cells in their shirt's colour and cream, with four lines down to
 * their shoulders.
 *
 * `poseGlider` puts it anywhere between the two: 0 folded on the back, 1 open
 * overhead. On the way the roll grows and lifts off the back as the wing
 * unfolds out of it, spreading as it rises; with `calm` (reduced motion) it
 * snaps from one to the other half way.
 *
 * Units are tiles, like the figures: the trainer is about 0.8 tall, the wing
 * about 1.3 across.
 */

/** The wing: the radius of the arc it is cut from, the half-angle of the arc, and its depth front to back. */
const WING_RADIUS = 0.75;
const WING_HALF_ANGLE = Math.PI / 3;
const WING_CHORD = 0.42;
/** How many cells the wing is sewn from, alternating colours. */
const CELLS = 6;
/** How high over the trainer's feet the top of the open wing is. */
const WING_TOP = 1.72;
/** Where the lines meet the trainer: over the shoulders, a little out. */
const HARNESS_Y = 0.46;
const HARNESS_X = 0.15;

/** The folded roll: its radius and length, and where it sits on the back, without and with the boat there. */
const ROLL_RADIUS = 0.065;
const ROLL_LENGTH = 0.38;
const ON_BACK = new THREE.Vector3(0, 0.56, -0.15);
const ON_BOAT = new THREE.Vector3(0, 0.8, -0.22);

/** Seconds the glider takes to open over the trainer, or to fold away again. */
export const GLIDER_OPEN_SECONDS = 0.35;

const creamMaterial = new THREE.MeshLambertMaterial({
	color: GLIDER_COLORS.cream,
	flatShading: true,
	side: THREE.DoubleSide
});
const lineMaterial = new THREE.MeshLambertMaterial({ color: GLIDER_COLORS.line, flatShading: true });

/** The canopy's colour, per trainer (their shirt), shared like the rest. */
const cells = new Map<number, THREE.Material>();
function cellMaterial(color: number): THREE.Material {
	let m = cells.get(color);
	if (!m) {
		m = new THREE.MeshLambertMaterial({ color, flatShading: true, side: THREE.DoubleSide });
		cells.set(color, m);
	}
	return m;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
	const m = new THREE.Mesh(geometry, material);
	m.castShadow = true;
	return m;
}

/**
 * One cell of the wing: a strip of the arc, from `a0` to `a1` radians round
 * its top, `WING_CHORD` deep along the way the trainer faces. The top of the
 * arc is at 0; its tips hang lower, out to the sides.
 */
function cellGeometry(a0: number, a1: number): THREE.BufferGeometry {
	// A cylinder's axis is y: lay it along z; its angle 0 is then straight down, π up.
	const geometry = new THREE.CylinderGeometry(
		WING_RADIUS,
		WING_RADIUS,
		WING_CHORD,
		2,
		1,
		true,
		Math.PI + a0,
		a1 - a0
	);
	geometry.rotateX(Math.PI / 2);
	geometry.translate(0, -WING_RADIUS, 0);
	return geometry;
}

/** A line from `a` to `b` (both in the glider's space): a thin stick. */
function line(a: THREE.Vector3, b: THREE.Vector3): THREE.Mesh {
	const length = a.distanceTo(b);
	const stick = mesh(new THREE.BoxGeometry(0.012, length, 0.012), lineMaterial);
	stick.castShadow = false;
	stick.position.copy(a).add(b).multiplyScalar(0.5);
	stick.quaternion.setFromUnitVectors(
		new THREE.Vector3(0, 1, 0),
		b.clone().sub(a).normalize()
	);
	return stick;
}

/**
 * A new glider, folded on the back (`poseGlider` it), its canopy in `color`
 * (the trainer's shirt) and cream. Its geometries are its own:
 * `disposeGlider` frees them. The player's trainer keeps one for as long as
 * the page lives; another player's goes when they do.
 */
export function buildGliderMesh(color: number = GLIDER_COLORS.canopy): THREE.Group {
	const glider = new THREE.Group();
	glider.name = 'glider';

	// Folded: a roll across the back, in the canopy's colour with two cream bands.
	const roll = new THREE.Group();
	roll.name = 'roll';
	const body = new THREE.CylinderGeometry(ROLL_RADIUS, ROLL_RADIUS, ROLL_LENGTH, 8);
	body.rotateZ(Math.PI / 2);
	roll.add(mesh(body, cellMaterial(color)));
	for (const x of [-0.11, 0.11]) {
		const band = new THREE.CylinderGeometry(ROLL_RADIUS * 1.08, ROLL_RADIUS * 1.08, 0.035, 8);
		band.rotateZ(Math.PI / 2);
		band.translate(x, 0, 0);
		roll.add(mesh(band, creamMaterial));
	}
	glider.add(roll);

	// Open: the wing's cells, alternating colours, and the lines to the shoulders.
	const wing = new THREE.Group();
	wing.name = 'wing';
	const step = (2 * WING_HALF_ANGLE) / CELLS;
	for (let i = 0; i < CELLS; i++) {
		const a0 = -WING_HALF_ANGLE + i * step;
		wing.add(mesh(cellGeometry(a0, a0 + step), i % 2 === 0 ? cellMaterial(color) : creamMaterial));
	}
	const lines = new THREE.Group();
	lines.name = 'lines';
	for (const side of [-1, 1] as const) {
		for (const angle of [WING_HALF_ANGLE * 0.9, WING_HALF_ANGLE * 0.35]) {
			const top = new THREE.Vector3(
				side * WING_RADIUS * Math.sin(angle),
				-WING_RADIUS * (1 - Math.cos(angle)),
				0
			);
			// The shoulders, in the wing's space: it hangs `WING_TOP` over the feet.
			const shoulder = new THREE.Vector3(side * HARNESS_X, HARNESS_Y - WING_TOP, 0);
			lines.add(line(top, shoulder));
		}
	}
	wing.add(lines);
	glider.add(wing);
	poseGlider(glider, 0, false, false);
	return glider;
}

/**
 * Put the glider between folded (`open` 0) and open overhead (1). The roll
 * sits on the back, or above the boat's shell when `boatOnBack`; opening, it
 * grows and lifts away as the wing unfolds out of it, rising and spreading to
 * its full span. With `calm` it snaps from one to the other half way.
 * `folded`: whether the roll shows at all when it is folded (another
 * player's glider is drawn only while they fly).
 */
export function poseGlider(
	glider: THREE.Group,
	open: number,
	calm: boolean,
	boatOnBack: boolean,
	folded = true
): void {
	const a = Math.min(1, Math.max(0, open));
	const e = calm ? (a < 0.5 ? 0 : 1) : smoothstep(a);
	const back = boatOnBack ? ON_BOAT : ON_BACK;
	const roll = glider.getObjectByName('roll');
	if (roll) {
		// The roll swells a little and lifts as the canopy starts to come out of it, then is gone.
		roll.visible = folded && e < 0.6;
		roll.position.copy(back);
		roll.position.y += e * 0.3;
		roll.scale.setScalar(1 + e * 0.4);
	}
	const wing = glider.getObjectByName('wing');
	if (!wing) return;
	wing.visible = e > 0.02;
	// From the roll on the back up over the head, spreading from narrow to its full span.
	wing.position.set(0, back.y + (WING_TOP - back.y) * e, back.z * (1 - e));
	wing.scale.set(0.15 + 0.85 * e, 0.3 + 0.7 * e, 0.3 + 0.7 * e);
	const lines = wing.getObjectByName('lines');
	if (lines) lines.visible = e > 0.85;
}

/** Free the glider's geometries, each once (its materials are shared, and stay). */
export function disposeGlider(glider: THREE.Object3D): void {
	const geometries = new Set<THREE.BufferGeometry>();
	glider.traverse((o) => {
		if (o instanceof THREE.Mesh) geometries.add(o.geometry);
	});
	for (const geometry of geometries) geometry.dispose();
}
