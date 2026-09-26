import { Rng } from '@mathgame/engine';
import * as THREE from 'three';
import { animateIdle, buildAnimalMesh } from './animals';
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
 * joy. The row is as long as the list it is given, so a species added to the
 * starters simply stands in it. The words (the names under the animals) are
 * the DOM's: `spots()` says where each animal's feet are on screen.
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
const JOY_SECONDS = 0.9;

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
			disposeGeometries(figure);
		}
		this.figures = speciesIds.map((id, i) => {
			const figure = buildAnimalMesh(id);
			const box = new THREE.Box3().setFromObject(figure).getSize(new THREE.Vector3());
			// Towards a common size, as in battle: a squirrel and a rabbit both read, the
			// rabbit's ears still stand taller, and a squat, wide frog is sized by its width.
			const size = Math.max(box.y, box.x);
			const scale = Math.min(1.9, Math.max(1, Math.sqrt(1.1 / size)));
			figure.scale.setScalar(scale);
			figure.userData.baseScale = scale;
			// The ring under the lit one goes round its feet, however wide they are.
			figure.userData.ringScale = Math.max(1, ((Math.max(box.x, box.z) * scale) / 2 + 0.12) / 0.46);
			figure.userData.idlePhase = i * 1.1;
			figure.position.set(this.xOf(i, speciesIds.length), 0, 0);
			this.scene.add(figure);
			return figure;
		});
		this.lit = 0;
		this.joy = -1;
		this.frame();
	}

	/** Light the animal at `index`. */
	select(index: number): void {
		this.lit = index;
		this.joy = -1;
	}

	/** The animal at `index` was picked: it hops for joy. */
	cheer(index: number): void {
		this.lit = index;
		this.joy = 0;
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

	update(t: number): void {
		const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
		this.lastT = t;
		if (this.joy >= 0) this.joy += dt;
		this.figures.forEach((figure, i) => {
			animateIdle(figure, t);
			const base = (figure.userData.baseScale as number | undefined) ?? 1;
			const lit = i === this.lit;
			figure.scale.setScalar(lit ? base * 1.12 : base);
			// The lit one looks at you; the others turn a little towards it.
			const toward = Math.sign(this.lit - i) * 0.45;
			figure.rotation.y = lit ? 0 : toward;
			let y = 0;
			if (lit && this.joy >= 0 && this.joy < JOY_SECONDS) {
				// Two quick hops, the second smaller.
				const p = this.joy / JOY_SECONDS;
				y = Math.abs(Math.sin(p * Math.PI * 2)) * (p < 0.5 ? 0.45 : 0.25);
			} else if (lit) {
				const p = (t % BOUNCE_SECONDS) / BOUNCE_SECONDS;
				y = p < 0.35 ? Math.sin((p / 0.35) * Math.PI) * 0.16 : 0;
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
	 * `ROW_AT` from the top.
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
		this.camera.updateProjectionMatrix();
		this.camera.updateMatrixWorld();
	}
}

function lambert(hex: number): THREE.MeshLambertMaterial {
	return new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
}

/** Free a figure's geometries. Materials are shared across figures (animals.ts caches them). */
function disposeGeometries(root: THREE.Object3D): void {
	root.traverse((o) => {
		if (o instanceof THREE.Mesh) o.geometry.dispose();
	});
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
