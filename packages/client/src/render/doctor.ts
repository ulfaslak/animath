import * as THREE from 'three';
import { smoothstep } from './ease';
import { DOCTOR_COLORS as C } from './palette';

/**
 * The witch doctor ([[UI_SPEC]] § Explore mode, "The witch doctor"): the
 * figure who stands at every tent, and his pot bubbling on the fire beside
 * it. Built from the primitives the trainer and the animals are made of, in
 * tiles, his feet on y = 0 and his face towards +z, but every part of him
 * that moves as one is a single shape, its colours on its vertices, and
 * every shape is built once for all the tents (`DOCTOR_GEOMETRIES`, which
 * `tiles.ts` counts among its shared shapes). So a tent's doctor and pot
 * are meshes placed and turned, never geometry of their own: a chunk still
 * owns nothing on the GPU but its instance buffers and its light, and a
 * tent on screen costs eleven draw calls more, not twenty-seven, and two
 * more in the sun's shadow (the body and the hat; the rest are too small to
 * cast one worth drawing).
 *
 * He is alive (`WitchDoctor.animate`, every frame the world is drawn): he
 * breathes and sways, his tall floppy hat nods a moment after him and its
 * tip swings, every few seconds he lifts his staff and taps it down, and
 * bubbles rise and pop in the pot. When the trainer comes within two tiles
 * he hops and waves, once (`Greetings` remembers), turned their way unless
 * the tent stands between them. With reduced motion everything moves a
 * third as much, and he still waves.
 */

type Vec3 = readonly [number, number, number];

/** One primitive of a merged shape: placed, turned (Euler angles) and sized, in one colour. */
interface Piece {
	shape: THREE.BufferGeometry;
	color: number;
	at?: Vec3;
	turn?: Vec3;
	size?: Vec3;
}

/**
 * Many primitives as one shape, each piece's colour on its own vertices, so
 * the part they make is one draw call. Unindexed, so every face keeps its
 * own normal: the facets stay flat.
 */
function merged(pieces: readonly Piece[]): THREE.BufferGeometry {
	const position: number[] = [];
	const color: number[] = [];
	const m = new THREE.Matrix4();
	const v = new THREE.Vector3();
	const c = new THREE.Color();
	for (const p of pieces) {
		const flat = p.shape.index ? p.shape.toNonIndexed() : p.shape;
		m.compose(
			new THREE.Vector3(...(p.at ?? [0, 0, 0])),
			new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.turn ?? [0, 0, 0]))),
			new THREE.Vector3(...(p.size ?? [1, 1, 1]))
		);
		c.setHex(p.color);
		const from = flat.getAttribute('position');
		for (let i = 0; i < from.count; i++) {
			v.fromBufferAttribute(from, i).applyMatrix4(m);
			position.push(v.x, v.y, v.z);
			color.push(c.r, c.g, c.b);
		}
		if (flat !== p.shape) flat.dispose();
		p.shape.dispose();
	}
	const shape = new THREE.BufferGeometry();
	shape.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
	shape.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
	shape.computeVertexNormals();
	return shape;
}

/** Where his arms hang from, either side of the robe's narrow top. */
const SHOULDER_X = 0.095;
const SHOULDER_Y = 0.4;
/** How long an arm is, shoulder to the middle of the hand. */
export const ARM_LENGTH = 0.215;
/**
 * Where the hat sits on his head, tipped back a little, and how tall its
 * crown is before the tip bends over. Seen from the camera's height a wide
 * brim hides the face under it: this one leaves his eyes and nose in view.
 */
const HAT_Y = 0.625;
const HAT_TILT = -0.18;
const BRIM = 0.16;
const CROWN = 0.22;
/** Where he stands his staff, beside him, and where on it his hand holds it. */
const STAFF_AT: Vec3 = [0.18, 0, 0.1];
const STAFF_GRIP = 0.3;
/** The pot's size, how far round from the top its opening is cut, and how high it hangs on the fire. */
const POT_R = 0.13;
const POT_OPEN = 0.28 * Math.PI;
const POT_Y = 0.3;
/** The opening: how high over the ground, and how wide. */
const POT_RIM_Y = POT_Y + POT_R * Math.cos(POT_OPEN);
const POT_RIM_R = POT_R * Math.sin(POT_OPEN);

/** The robe and its belt, the head, the beard, the nose and the eyes: all that only breathes and sways. */
const BODY = merged([
	{ shape: new THREE.CylinderGeometry(0.075, 0.17, 0.44, 6), color: C.robe, at: [0, 0.22, 0] },
	{ shape: new THREE.CylinderGeometry(0.117, 0.121, 0.035, 6), color: C.band, at: [0, 0.27, 0] },
	{ shape: new THREE.SphereGeometry(0.115, 8, 6), color: C.skin, at: [0, 0.54, 0.01] },
	// A beard hanging from under the nose over the robe: a cone upside down.
	{
		shape: new THREE.ConeGeometry(0.095, 0.2, 6),
		color: C.beard,
		at: [0, 0.4, 0.065],
		turn: [Math.PI, 0, 0]
	},
	{ shape: new THREE.SphereGeometry(0.036, 6, 4), color: C.nose, at: [0, 0.515, 0.125] },
	{ shape: new THREE.BoxGeometry(0.03, 0.042, 0.02), color: C.eyes, at: [-0.045, 0.555, 0.112] },
	{ shape: new THREE.BoxGeometry(0.03, 0.042, 0.02), color: C.eyes, at: [0.045, 0.555, 0.112] }
]);

/** The hat, from where it sits on the head: brim, gold band, crown, and a feather in the band. */
const HAT = merged([
	{ shape: new THREE.CylinderGeometry(BRIM, BRIM, 0.024, 10), color: C.hat, at: [0, 0.012, 0] },
	{ shape: new THREE.CylinderGeometry(0.1, 0.104, 0.05, 8), color: C.band, at: [0, 0.047, 0] },
	{
		shape: new THREE.CylinderGeometry(0.052, 0.1, CROWN, 8),
		color: C.hat,
		at: [0, 0.012 + CROWN / 2, 0]
	},
	{
		shape: new THREE.SphereGeometry(0.03, 6, 4),
		color: C.feather,
		at: [0.1, 0.14, -0.01],
		turn: [-0.3, 0, -0.42],
		size: [0.6, 3.8, 0.35]
	}
]);

/** The hat's floppy tip, from where it bends: a knuckle, a cone, and a gold bobble on its end. */
const TIP = merged([
	{ shape: new THREE.SphereGeometry(0.052, 8, 4), color: C.hat },
	{ shape: new THREE.ConeGeometry(0.052, 0.2, 8), color: C.hat, at: [0, 0.1, 0] },
	{ shape: new THREE.SphereGeometry(0.03, 6, 4), color: C.band, at: [0, 0.2, 0] }
]);

/** An arm, from its shoulder: a sleeve widening to the cuff, and the hand. */
const ARM = merged([
	{ shape: new THREE.CylinderGeometry(0.034, 0.052, 0.2, 6), color: C.robe, at: [0, -0.1, 0] },
	{ shape: new THREE.SphereGeometry(0.037, 6, 4), color: C.skin, at: [0, -ARM_LENGTH, 0] }
]);

/** The staff, from its foot: a pole, a gold collar, and the doctor's green gem on top. */
const STAFF = merged([
	{ shape: new THREE.CylinderGeometry(0.016, 0.02, 0.78, 5), color: C.staff, at: [0, 0.39, 0] },
	{ shape: new THREE.CylinderGeometry(0.03, 0.022, 0.03, 6), color: C.band, at: [0, 0.775, 0] },
	{ shape: new THREE.IcosahedronGeometry(0.048, 0), color: C.gem, at: [0, 0.83, 0] }
]);

/** The pot, from the ground under it: two crossed logs, and the iron bowl over them with its rim. */
const POT = merged([
	{
		shape: new THREE.BoxGeometry(0.3, 0.045, 0.06),
		color: C.staff,
		at: [0, 0.023, 0],
		turn: [0, 0.6, 0]
	},
	{
		shape: new THREE.BoxGeometry(0.3, 0.045, 0.06),
		color: C.staff,
		at: [0, 0.05, 0],
		turn: [0, -0.6, 0]
	},
	{
		shape: new THREE.SphereGeometry(POT_R, 9, 6, 0, Math.PI * 2, POT_OPEN, Math.PI - POT_OPEN),
		color: C.pot,
		at: [0, POT_Y, 0]
	},
	{
		shape: new THREE.TorusGeometry(POT_RIM_R, 0.022, 4, 9),
		color: C.potRim,
		at: [0, POT_RIM_Y, 0],
		turn: [Math.PI / 2, 0, 0]
	}
]);

/** The flames on the logs, under the pot: a big one in the middle, three small ones leaning out round it. */
const FLAMES = merged([
	{ shape: new THREE.ConeGeometry(0.09, 0.26, 5), color: C.flame, at: [0, 0.13, 0] },
	...[0, 1, 2].map((i): Piece => {
		const a = (i * Math.PI * 2) / 3 + 0.4;
		const [dx, dz] = [Math.cos(a), Math.sin(a)];
		return {
			shape: new THREE.ConeGeometry(0.05, 0.18, 5),
			color: i === 1 ? C.flameHot : C.flameGold,
			at: [0.085 * dx, 0.1, 0.085 * dz],
			turn: [0.4 * dz, 0, -0.4 * dx]
		};
	})
]);

/** The potion filling the pot to just under its rim, and a bubble rising out of it. */
const POTION = new THREE.CircleGeometry(POT_RIM_R, 9).rotateX(-Math.PI / 2);
const BUBBLE = new THREE.SphereGeometry(0.026, 6, 4);

/** Every shape the doctors and their campfires draw, built once and never disposed. */
export const DOCTOR_GEOMETRIES: readonly THREE.BufferGeometry[] = [
	BODY,
	HAT,
	TIP,
	ARM,
	STAFF,
	POT,
	FLAMES,
	POTION,
	BUBBLE
];

/** Every merged part: the colours are on the vertices. */
const PAINTED = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
/** The flames, the potion and its bubbles glow: unlit. */
const FLAME_MATERIAL = new THREE.MeshBasicMaterial({ vertexColors: true });
const POTION_MATERIAL = new THREE.MeshBasicMaterial({ color: C.potion });
const BUBBLE_MATERIAL = new THREE.MeshBasicMaterial({ color: C.bubble });

function mesh(shape: THREE.BufferGeometry, shadow: boolean): THREE.Mesh {
	const m = new THREE.Mesh(shape, PAINTED);
	m.castShadow = shadow;
	return m;
}

function joint(x: number, y: number, z: number, ...parts: THREE.Object3D[]): THREE.Group {
	const g = new THREE.Group();
	g.position.set(x, y, z);
	g.add(...parts);
	return g;
}

/** Which way he faces at rest: towards the camera, between grid "down" and the camera's yaw. */
export const REST_YAW = 0.45;
/**
 * How far he turns from there to face the trainer: well round to his right,
 * less to his left, where his waving arm would reach over the tile in front
 * of the tent; past `BEHIND`, the tent is between them and he stays put.
 */
const MOST_RIGHT = 1.15;
const MOST_LEFT = 0.5;
const BEHIND = 2.1;
/** How fast he turns: most of the way in a third of a second. */
const TURN_RATE = 7;

/** A breath, and the slower sway from side to side (radians per second), and how big each is. */
const BREATH_RATE = 2.4;
const BREATH = 0.025;
const SWAY_RATE = 1.3;
const SWAY = 0.075;
/** Now and then he looks a little one way and the other, slower still. */
const LOOK_RATE = 0.8;
const LOOK = 0.22;
/** The hat bobs a beat after the body; its tip, bent over, swings. */
const HAT_BOB = 0.02;
const TIP_BEND: Vec3 = [-0.35, 0, 0.95];
const TIP_SWING = 0.3;
/** Every few seconds he lifts the staff and taps it down, and his knees give a little at the knock. */
const TAP_EVERY = 3.4;
const TAP_SECONDS = 0.5;
const TAP_LIFT = 0.1;
const TAP_DIP = 0.05;
/** The free arm hangs a little out from the robe; waving, it goes up and swings. */
const ARM_OUT = 0.2;
const WAVE_UP = 2.55;
const WAVE_SWING = 0.42;
const WAVE_HZ = 2.2;
/** The greeting: a hop, then the wave, then the arm comes down. */
export const GREET_SECONDS = 2.2;
const HOP_SECONDS = 0.36;
const HOP = 0.12;
const ARM_UP_SECONDS = 0.3;
const ARM_DOWN_SECONDS = 0.45;
/** With reduced motion: how much of each movement is left. The wave still waves. */
const CALM = 1 / 3;

/** The flames flicker: taller and shorter, quickly, two ways at once. */
const FLICKER = 0.14;
/** A bubble takes this long to rise and pop; three take turns. */
const BUBBLE_SECONDS = 1.3;
const BUBBLE_RISE = 0.15;
const BUBBLE_SPOTS: readonly (readonly [number, number])[] = [
	[0.03, 0.02],
	[-0.04, -0.01],
	[0.0, -0.045]
];

const DOWN = new THREE.Vector3(0, -1, 0);
const grip = new THREE.Vector3();
const reach = new THREE.Vector3();

/** How far through a tap of the staff at `p` (0..1) it is lifted: up, then dropped with a knock. */
function tapLift(p: number): number {
	if (p <= 0 || p >= 1) return 0;
	return p < 0.5 ? smoothstep(p / 0.5) : 1 - ((p - 0.5) / 0.5) ** 2;
}

/** An angle brought into (−π, π]. */
function wrap(a: number): number {
	return a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
}

/**
 * One tent's witch doctor and the pot on its fire. The tent puts `figure`
 * and `pot` where they stand on its tile; `animate` moves them every frame.
 */
export class WitchDoctor {
	/** The doctor, turned as a whole towards the trainer. */
	readonly figure = new THREE.Group();
	/** The campfire, from the ground under it: the logs, the flames, the pot on them. */
	readonly pot = new THREE.Group();
	private flames: THREE.Mesh;
	private rig = new THREE.Group();
	private hat: THREE.Group;
	private tip: THREE.Group;
	private waving: THREE.Group;
	private holding: THREE.Group;
	private staff: THREE.Group;
	private bubbles: THREE.Mesh[];
	private yaw = REST_YAW;
	/** When he was last posed, in seconds; null until the first frame, which sets his facing outright. */
	private lastT: number | null = null;

	/**
	 * `x`, `z`: where the figure stands in the world, to turn towards the
	 * trainer; `phase` (radians) keeps the doctors in view out of step.
	 */
	constructor(
		readonly x: number,
		readonly z: number,
		private phase: number
	) {
		this.tip = joint(0, 0.012 + CROWN, 0, mesh(TIP, false));
		this.tip.rotation.set(...TIP_BEND);
		this.hat = joint(0, HAT_Y, 0, mesh(HAT, true), this.tip);
		this.hat.rotation.x = HAT_TILT;
		this.waving = joint(-SHOULDER_X, SHOULDER_Y, 0, mesh(ARM, false));
		this.holding = joint(SHOULDER_X, SHOULDER_Y, 0, mesh(ARM, false));
		this.staff = joint(...STAFF_AT, mesh(STAFF, false));
		this.rig.add(mesh(BODY, true), this.hat, this.waving, this.holding, this.staff);
		// Named for the tests, which follow them through a greeting.
		this.rig.name = 'rig';
		this.hat.name = 'hat';
		this.tip.name = 'tip';
		this.waving.name = 'waving';
		this.holding.name = 'holding';
		this.staff.name = 'staff';
		this.figure.add(this.rig);
		this.figure.rotation.y = REST_YAW;

		this.bubbles = BUBBLE_SPOTS.map(([bx, bz]) => {
			const b = new THREE.Mesh(BUBBLE, BUBBLE_MATERIAL);
			b.position.set(bx, POT_RIM_Y, bz);
			return b;
		});
		const potion = new THREE.Mesh(POTION, POTION_MATERIAL);
		potion.position.y = POT_RIM_Y - 0.012;
		this.flames = new THREE.Mesh(FLAMES, FLAME_MATERIAL);
		this.pot.add(mesh(POT, false), this.flames, potion, ...this.bubbles);
		this.animate(0, null, null, false);
		// The first frame drawn turns him straight to where he looks: a doctor built
		// again (a tree chopped beside his tent) must not jump from his rest.
		this.lastT = null;
	}

	/**
	 * Pose him and his pot for time `t` (seconds). `greeting`: seconds since
	 * he began greeting the trainer, or null when they are not near;
	 * `trainer`: where they are, to turn towards while near.
	 */
	animate(
		t: number,
		greeting: number | null,
		trainer: { x: number; z: number } | null,
		calm: boolean
	): void {
		const first = this.lastT === null;
		const dt = this.lastT === null ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
		this.lastT = t;
		const k = calm ? CALM : 1;
		const s = t + this.phase;

		// The knock of the staff on the ground: a quick dip just after it lands.
		const since = (((s % TAP_EVERY) + TAP_EVERY) % TAP_EVERY) - TAP_SECONDS;
		const dip = since >= 0 && since < 0.2 ? Math.sin((since / 0.2) * Math.PI) : 0;
		this.rig.scale.y = 1 + BREATH * Math.sin(s * BREATH_RATE) - TAP_DIP * k * dip;
		this.rig.rotation.z = SWAY * k * Math.sin(s * SWAY_RATE);
		this.hat.position.y = HAT_Y + HAT_BOB * k * Math.sin(s * BREATH_RATE - 0.9);
		this.tip.rotation.z = TIP_BEND[2] + TIP_SWING * k * Math.sin(s * SWAY_RATE - 1.1);

		// Greeting: a hop as it starts, and the free arm up, waving, and down again.
		const g = greeting !== null && greeting < GREET_SECONDS ? greeting : null;
		const hop = g !== null && g < HOP_SECONDS ? Math.sin((g / HOP_SECONDS) * Math.PI) : 0;
		this.rig.position.y = HOP * k * hop;
		const up =
			g === null
				? 0
				: smoothstep(g / ARM_UP_SECONDS) *
					(1 - smoothstep((g - (GREET_SECONDS - ARM_DOWN_SECONDS)) / ARM_DOWN_SECONDS));
		const swing =
			WAVE_SWING * (calm ? 0.5 : 1) * Math.sin(g === null ? 0 : g * WAVE_HZ * Math.PI * 2);
		this.waving.rotation.z = -ARM_OUT - up * (WAVE_UP + swing);

		// The staff: lifted and tapped down now and then, never while he waves; his hand on it.
		const tap = g === null ? tapLift((((s % TAP_EVERY) + TAP_EVERY) % TAP_EVERY) / TAP_SECONDS) : 0;
		this.staff.position.y = TAP_LIFT * k * tap;
		grip.set(STAFF_AT[0], this.staff.position.y + STAFF_GRIP, STAFF_AT[2]);
		reach.subVectors(grip, this.holding.position).normalize();
		this.holding.quaternion.setFromUnitVectors(DOWN, reach);

		// Turned towards the trainer while they are near, unless the tent is between them;
		// looking about a little, otherwise.
		let want = REST_YAW + LOOK * k * Math.sin(s * LOOK_RATE);
		if (trainer) {
			const off = wrap(Math.atan2(trainer.x - this.x, trainer.z - this.z) - REST_YAW);
			if (Math.abs(off) < BEHIND) want = REST_YAW + Math.max(-MOST_RIGHT, Math.min(MOST_LEFT, off));
		}
		if (first) this.yaw = want;
		else this.yaw += (want - this.yaw) * (1 - Math.exp(-dt * TURN_RATE));
		this.figure.rotation.y = this.yaw;

		// The fire flickers under the pot.
		const flicker = FLICKER * k * (0.7 * Math.sin(s * 11) + 0.3 * Math.sin(s * 17 + 1));
		this.flames.scale.set(1 - flicker / 3, 1 + flicker, 1 - flicker / 3);

		// Three bubbles take turns: each grows as it rises out of the potion, then pops.
		const rate = calm ? 0.6 : 1;
		this.bubbles.forEach((b, i) => {
			const p = ((s * rate) / BUBBLE_SECONDS + i / this.bubbles.length) % 1;
			const size = p < 0.85 ? 0.35 + 0.65 * (p / 0.85) : (1 - p) / 0.15;
			b.position.y = POT_RIM_Y - 0.01 + BUBBLE_RISE * k * p;
			b.scale.setScalar(Math.max(0.001, size));
		});
	}
}

/** The trainer this near a doctor (tiles, straight line), and he greets them; this far, and he stops. */
export const GREET_NEAR = 2.3;
export const GREET_FAR = 3.5;

/**
 * When each doctor near the trainer began greeting them, by the spot he
 * stands on: a greeting plays once as the trainer comes near, and again
 * only after they have walked away. Kept by place rather than on the figure,
 * so a chunk built again (a tree chopped beside the tent) starts no new one.
 */
export class Greetings {
	private since = new Map<string, { start: number; seen: number }>();

	/**
	 * Seconds since the doctor standing at (`x`, `z`) began greeting the
	 * trainer at `trainer`, or null while they are not near him. Ask once a
	 * frame for every doctor, then `sweep`.
	 */
	check(x: number, z: number, trainer: { x: number; z: number }, t: number): number | null {
		const key = `${x},${z}`;
		const d = Math.hypot(trainer.x - x, trainer.z - z);
		const known = this.since.get(key);
		if (known && d > GREET_FAR) {
			this.since.delete(key);
			return null;
		}
		if (known) {
			known.seen = t;
			return t - known.start;
		}
		if (d > GREET_NEAR) return null;
		this.since.set(key, { start: t, seen: t });
		return 0;
	}

	/** Forget the doctors nobody asked about at `t`: their chunk is gone, or the world is. */
	sweep(t: number): void {
		for (const [key, { seen }] of this.since) if (seen !== t) this.since.delete(key);
	}

	clear(): void {
		this.since.clear();
	}
}
