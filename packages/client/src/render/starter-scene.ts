import { Rng } from '@mathgame/engine';
import * as THREE from 'three';
import { motion } from '../motion';
import { IDLE_DEPTH, animateIdle, buildAnimalMesh, disposeFigure } from './animals';
import { COLORS, TILE_COLORS } from './palette';
import type { Stage } from './renderer';

/**
 * The starter stage: the animals a new game can start with, side by side on
 * a round patch of meadow, big enough to choose between (at the explore
 * camera a squirrel is a few pixels tall). It is drawn instead of the world
 * while the starter screen and its name box are up ([[UI_SPEC]] § Title).
 *
 * The one that is lit stands on a warm ring, faces the camera and bounces;
 * the others idle, turned a little towards it. Picking one makes it hop for
 * joy. With reduced motion the bounce is a third as high and the joy one
 * small hop. The row is as long as the list it is given, so a species added to the
 * starters simply stands in it. The words (the names under the animals) are
 * the DOM's: `spots()` says where each animal's feet are on screen.
 *
 * The DOM's card takes the bottom of the screen, and grows when the name box
 * opens (on a touch screen it moves to the top instead, clear of the
 * tablet's keyboard). The DOM measures the band it leaves the row
 * (`setRoom`), and the row slides up or down into it (a lens shift, so
 * nothing turns or grows), no further than it must: its name tags never
 * slip under the card (#78).
 */

/** Tiles between two animals' centres. */
const SPACING = 1.45;
/** Vertical field of view, in degrees. */
const FOV = 30;
/** The share of the screen's width the row may take. */
const ROW_SHARE = 0.72;
/** Where the row's middle sits, from the top of the screen: above the card at the bottom. */
const ROW_AT = 0.45;
const BOUNCE_SECONDS = 1.3;
/** How high the lit one bounces now and then, in tiles (a third as high with reduced motion). */
const BOUNCE = 0.16;
/** How much bigger the lit one stands than the others. */
const LIT_SCALE = 1.12;
/** How far, in radians, the others turn towards the lit one. */
const TURN = 0.45;
const UP = new THREE.Vector3(0, 1, 0);
const JOY_SECONDS = 0.9;
/** How quickly the row slides into its room: seconds for the gap to shrink to a third. */
const LIFT_EASE = 0.08;

/** A band of the screen, in CSS pixels from its top. */
export interface StarterRoom {
	/** The animals' tops stay below this. */
	top: number;
	/** Their feet stay above this. */
	bottom: number;
}

/**
 * How far to lift the row on screen, in CSS pixels (negative: lower it), for
 * a row whose feet and tallest top stand at `row.feet` and `row.top` unlifted:
 * as little as puts it in `room`, the feet above its bottom and the tops
 * below its top. When the band is too short for both, the feet win, so the
 * name tags under them stay clear of the card below.
 */
export function liftFor(row: { feet: number; top: number }, room: StarterRoom | null): number {
	if (!room) return 0;
	// Feet below the band: up, whatever that does to the tops.
	const low = row.feet - room.bottom;
	if (low > 0) return low;
	// Tops above it: down, but never so far that the feet leave it.
	const high = room.top - row.top;
	return high > 0 ? -Math.min(high, -low) : 0;
}

export class StarterScene implements Stage {
	readonly scene = new THREE.Scene();
	readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 80);
	private figures: THREE.Group[] = [];
	private ring: THREE.Mesh;
	private lit = 0;
	private joy = -1;
	private lastT = -1;
	private width = 1;
	private height = 1;
	/** Where the row's feet and its tallest top are on screen, unlifted, in CSS pixels. */
	private row = { feet: 0, top: 0 };
	private room: StarterRoom | null = null;
	/** How far the row is lifted on screen now, in CSS pixels (negative: lowered). */
	private lift = 0;
	/** Where `lift` is sliding to: `liftFor` the room. */
	private liftTarget = 0;
	/** The row has taken its first room since `show`: it starts there, and slides only after. */
	private settled = false;

	constructor() {
		this.scene.background = new THREE.Color(COLORS.sky);
		this.scene.fog = new THREE.Fog(COLORS.sky, 14, 30);
		this.scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.1));
		const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
		sun.position.set(3, 8, 6);
		sun.castShadow = true;
		sun.shadow.mapSize.set(1024, 1024);
		sun.shadow.camera.left = sun.shadow.camera.bottom = -7;
		sun.shadow.camera.right = sun.shadow.camera.top = 7;
		sun.shadow.camera.near = 1;
		sun.shadow.camera.far = 30;
		sun.shadow.bias = -0.0005;
		this.scene.add(sun);

		const ground = new THREE.Mesh(
			new THREE.CylinderGeometry(9, 9.4, 0.8, 28),
			lambert(TILE_COLORS.grass)
		);
		ground.position.y = -0.4;
		ground.receiveShadow = true;
		this.scene.add(ground);
		this.scene.add(buildScenery());

		this.ring = new THREE.Mesh(
			new THREE.TorusGeometry(0.46, 0.06, 6, 24).rotateX(Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: COLORS.fire })
		);
		this.ring.position.y = 0.03;
		this.scene.add(this.ring);
	}

	/** Stand these species in a row, in order, the first lit. */
	show(speciesIds: readonly string[]): void {
		for (const figure of this.figures) {
			this.scene.remove(figure);
			disposeFigure(figure);
		}
		this.figures = speciesIds.map((id, i) => {
			const figure = buildAnimalMesh(id);
			const bounds = new THREE.Box3().setFromObject(figure);
			const box = bounds.getSize(new THREE.Vector3());
			// Towards a common size, as in battle: a squirrel and a rabbit both read, the
			// rabbit's ears still stand taller, and a squat, wide frog is sized by its width.
			const size = Math.max(box.y, box.x);
			const scale = Math.min(1.9, Math.max(1, Math.sqrt(1.1 / size)));
			figure.scale.setScalar(scale);
			figure.userData.baseScale = scale;
			// Its box at rest, unscaled: how high it stands, however it is turned or lit.
			figure.userData.bounds = bounds;
			// The ring under the lit one goes round its feet, however wide they are.
			figure.userData.ringScale = Math.max(1, ((Math.max(box.x, box.z) * scale) / 2 + 0.12) / 0.46);
			figure.userData.idlePhase = i * 1.1;
			figure.position.set(this.xOf(i, speciesIds.length), 0, 0);
			this.scene.add(figure);
			return figure;
		});
		this.lit = 0;
		this.joy = -1;
		// The screen shown now reports its own room; the last one's (the name box's, say) is gone.
		this.room = null;
		this.settled = false;
		this.frame();
	}

	/** Light the animal at `index`. */
	select(index: number): void {
		this.lit = index;
		this.joy = -1;
		this.measure();
	}

	/** The animal at `index` was picked: it hops for joy. */
	cheer(index: number): void {
		this.lit = index;
		this.joy = 0;
		this.measure();
	}

	/** Where each animal's feet are, as fractions of the canvas (0..1 across, 0..1 down). */
	spots(): { x: number; y: number }[] {
		return this.figures.map((figure) => {
			const p = new THREE.Vector3(figure.position.x, 0, 0).project(this.camera);
			return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
		});
	}

	resize(width: number, height: number): void {
		this.width = Math.max(1, width);
		this.height = Math.max(1, height);
		this.frame();
	}

	/**
	 * Keep the row within `room` (null: anywhere). The first room after `show`
	 * places it at once; a new one it slides to, as `slide` is called.
	 */
	setRoom(room: StarterRoom | null): void {
		this.room = room;
		this.liftTarget = liftFor(this.row, room);
		if (!this.settled && room) {
			this.settled = true;
			this.lift = this.liftTarget;
			this.applyLift();
		}
	}

	/** Slide the row towards its room by `dt` seconds of frame time; at once with reduced motion. */
	slide(dt: number): void {
		const gap = this.liftTarget - this.lift;
		if (gap === 0) return;
		this.lift =
			motion.reduced || Math.abs(gap) < 0.5
				? this.liftTarget
				: this.lift + gap * (1 - Math.exp(-dt / LIFT_EASE));
		this.applyLift();
	}

	update(t: number): void {
		const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
		this.lastT = t;
		if (this.joy >= 0) this.joy += dt;
		this.figures.forEach((figure, i) => {
			animateIdle(figure, t);
			const base = (figure.userData.baseScale as number | undefined) ?? 1;
			const lit = i === this.lit;
			figure.scale.setScalar(lit ? base * LIT_SCALE : base);
			// The lit one looks at you; the others turn a little towards it.
			const toward = Math.sign(this.lit - i) * TURN;
			figure.rotation.y = lit ? 0 : toward;
			let y = 0;
			if (lit && this.joy >= 0 && this.joy < JOY_SECONDS) {
				// Two quick hops, the second smaller; with reduced motion one small hop.
				const p = this.joy / JOY_SECONDS;
				y = motion.reduced
					? Math.sin(Math.min(1, p * 2) * Math.PI) * 0.15
					: Math.abs(Math.sin(p * Math.PI * 2)) * (p < 0.5 ? 0.45 : 0.25);
			} else if (lit) {
				// A bounce now and then, a third as high with reduced motion.
				const p = (t % BOUNCE_SECONDS) / BOUNCE_SECONDS;
				y = p < 0.35 ? Math.sin((p / 0.35) * Math.PI) * (motion.reduced ? BOUNCE / 3 : BOUNCE) : 0;
			}
			figure.position.y = y;
		});
		const lit = this.figures[this.lit];
		this.ring.visible = !!lit;
		if (lit) {
			this.ring.position.x = lit.position.x;
			this.ring.scale.setScalar((lit.userData.ringScale as number | undefined) ?? 1);
		}
	}

	private xOf(i: number, count: number): number {
		return (i - (count - 1) / 2) * SPACING;
	}

	/**
	 * Frame the row: far enough back that it takes `ROW_SHARE` of the width
	 * (and never so close that two animals fill the screen), its middle at
	 * `ROW_AT` from the top, then lifted into its room. A new size places it
	 * there at once.
	 */
	private frame(): void {
		const aspect = this.width / this.height;
		const count = Math.max(1, this.figures.length);
		const row = (count - 1) * SPACING + 1.2;
		const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
		const distance = Math.max(5.2, row / (ROW_SHARE * 2 * tan * aspect));
		const visible = 2 * distance * tan;
		const middle = 0.45;
		this.camera.aspect = aspect;
		this.camera.position.set(0, 1.5 + distance * 0.18, distance);
		this.camera.lookAt(0, middle - (0.5 - ROW_AT) * visible, 0);
		this.camera.updateMatrixWorld();
		this.measure();
		this.lift = this.liftTarget;
		this.applyLift();
	}

	/** Where the row's feet and highest top are, unlifted, and so where it slides to in its room. */
	private measure(): void {
		this.camera.clearViewOffset();
		const feet = this.screenY(0, 0);
		this.row = { feet, top: Math.min(feet, this.highest()) };
		this.liftTarget = liftFor(this.row, this.room);
		this.applyLift();
	}

	/**
	 * The highest any animal of the row reaches on screen, in CSS pixels from
	 * the top, as it stands with the one lit now: the lit one bigger, facing
	 * the camera, at the top of its bounce; the others turned towards it; all
	 * at the top of a breath. The corners of each one's box turned so, since
	 * the camera, looking down on the row, sees a far corner higher than a
	 * near one. (Not its hops of joy: they are over in a moment.)
	 */
	private highest(): number {
		let top = Infinity;
		const corner = new THREE.Vector3();
		this.figures.forEach((figure, i) => {
			const bounds = figure.userData.bounds as THREE.Box3 | undefined;
			if (!bounds) return;
			const lit = i === this.lit;
			const scale =
				((figure.userData.baseScale as number | undefined) ?? 1) * (lit ? LIT_SCALE : 1);
			const yaw = lit ? 0 : Math.sign(this.lit - i) * TURN;
			const height = bounds.max.y * scale * (1 + IDLE_DEPTH) + (lit ? BOUNCE : 0);
			for (const x of [bounds.min.x, bounds.max.x])
				for (const z of [bounds.min.z, bounds.max.z]) {
					corner.set(x * scale, 0, z * scale).applyAxisAngle(UP, yaw);
					top = Math.min(top, this.screenY(height, corner.z));
				}
		});
		return top;
	}

	/** Where a point `height` over the row, `z` in front of it, is on screen, in CSS pixels from the top. */
	private screenY(height: number, z: number): number {
		const p = new THREE.Vector3(0, height, z).project(this.camera);
		return ((1 - p.y) / 2) * this.height;
	}

	/** Shift the picture by `lift`: up when positive, down when negative. */
	private applyLift(): void {
		const { width, height } = this;
		if (this.lift === 0) this.camera.clearViewOffset();
		else this.camera.setViewOffset(width, height, 0, this.lift, width, height);
	}
}

function lambert(hex: number): THREE.MeshLambertMaterial {
	return new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
}

/**
 * Behind the row: tall-grass tufts, flowers and bushes, a fixed scatter kept
 * clear of the animals and of the camera's side.
 */
function buildScenery(): THREE.Group {
	const group = new THREE.Group();
	const rng = new Rng(11);
	const tuft = lambert(TILE_COLORS.tallgrass);
	const canopies = [lambert(COLORS.canopy), lambert(COLORS.canopyLight)];
	const petals = [lambert(COLORS.white), lambert(COLORS.playerShirt), lambert(COLORS.fire)];

	for (let i = 0; i < 60; i++) {
		const x = rng.next() * 16 - 8;
		const z = -1.2 - rng.next() * 7;
		const clump = new THREE.Group();
		for (let b = 0; b < 3; b++) {
			const blade = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 3), tuft);
			blade.position.set(rng.next() * 0.5 - 0.25, 0.17, rng.next() * 0.5 - 0.25);
			blade.castShadow = true;
			clump.add(blade);
		}
		clump.position.set(x, 0, z);
		group.add(clump);
	}
	for (let i = 0; i < 26; i++) {
		const x = rng.next() * 14 - 7;
		const z = 1.4 - rng.next() * 7;
		// Flowers only beside and behind the row, never between it and the camera.
		if (z > -0.9 && Math.abs(x) < 3.2) continue;
		const flower = new THREE.Mesh(
			new THREE.IcosahedronGeometry(0.07, 0),
			petals[Math.floor(rng.next() * petals.length)]
		);
		flower.position.set(x, 0.07, z);
		group.add(flower);
	}
	// Round bushes along the back: low enough to stay whole in the picture, where a
	// tree would be cut off by its top edge.
	for (const [x, z, s] of [
		[-5.6, -5.4, 1.1],
		[-3.4, -7.2, 1.3],
		[-0.6, -8.0, 1.0],
		[2.4, -7.4, 1.4],
		[5.0, -5.8, 1.2],
		[7.0, -3.6, 0.9],
		[-7.2, -3.2, 1.0]
	] as const) {
		const bush = new THREE.Group();
		for (const [bx, by, bz, r] of [
			[0, 0.32, 0, 0.42],
			[-0.38, 0.22, 0.08, 0.3],
			[0.36, 0.2, 0.06, 0.28]
		] as const) {
			const ball = new THREE.Mesh(
				new THREE.IcosahedronGeometry(r, 0),
				canopies[Math.floor(rng.next() * 2)]
			);
			ball.position.set(bx, by, bz);
			ball.castShadow = true;
			bush.add(ball);
		}
		bush.scale.setScalar(s);
		bush.position.set(x, 0, z);
		group.add(bush);
	}
	return group;
}
