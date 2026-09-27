import {
	CHUNK_SIZE,
	WorldEdits,
	isWater,
	tileAtWorld,
	type ChunkRef,
	type Direction,
	type GridPos,
	type ItemId
} from '@mathgame/engine';
import * as THREE from 'three';
import { motion } from '../motion';
import { Butterflies } from './ambient';
import { animateIdle, animateWalk, buildPlayerMesh } from './animals';
import { BOAT_STAND, buildBoatMesh, poseBoat, standAstern } from './boat';
import { ChunkRing } from './chunks';
import { ClearingEffects, SWING_SECONDS, animateSwing, buildTool } from './clearing';
import { appearScale } from './ease';
import { OtherPlayers } from './others';
import { COLORS } from './palette';
import { Poofs } from './poof';
import { FACING_ANGLE, strideOnto, trainerStep } from './trainer';

/**
 * A scene drawn instead of the world, with its own camera: the battle scene,
 * or the title's starter stage.
 */
export interface Stage {
	readonly scene: THREE.Scene;
	readonly camera: THREE.Camera;
	/** Advance its animation; `t` is seconds. */
	update(t: number): void;
	/** Match the canvas, in CSS pixels. */
	resize(width: number, height: number): void;
}

/**
 * Owns the Three.js scene: a fixed-angle orthographic camera (no zoom, no
 * rotation — the world reads like a diorama), flat-shaded low-poly meshes,
 * one directional light with soft shadows. The chunks around the player are
 * built as the player approaches them and freed when they fall behind
 * (`chunks.ts`), each as the player left it (a tree they chopped is a
 * stump). Figures (the player and anything added with `addFigure`)
 * breathe a little every frame, and the player swings its arms and legs
 * through each step (smaller with reduced motion), and its tool when it
 * clears a tile (`clearing.ts`).
 *
 * Once the player owns the boat (`setBoat`) the trainer carries it upside
 * down on their back (`boat.ts`); a step onto the water swings it under
 * them as they hop in, a step back onto land swings it back, and out on the
 * water they stand in it, gliding from tile to tile, the two of them rocking
 * gently on the water (still with reduced motion, where the boat snaps from
 * the back to the water half way through the step instead).
 */
const VIEW_HEIGHT_TILES = 14; // how many tiles tall the viewport is
const CAMERA_PITCH = THREE.MathUtils.degToRad(50);
const CAMERA_YAW = THREE.MathUtils.degToRad(35);
/** Where the camera rides relative to what it looks at: pitch and yaw never change. */
const CAMERA_OFFSET = new THREE.Vector3(
	Math.sin(CAMERA_YAW) * Math.cos(CAMERA_PITCH),
	Math.sin(CAMERA_PITCH),
	Math.cos(CAMERA_YAW) * Math.cos(CAMERA_PITCH)
).multiplyScalar(40);

/** Seconds the boat takes to grow onto the trainer's back when it is bought. */
const BOAT_ARRIVES_SECONDS = 0.45;

/** Whether two overlays clear the same tiles: their text forms are canonical. */
function sameEdits(a: WorldEdits, b: WorldEdits): boolean {
	if (a === b) return true;
	const [x, y] = [a.encode(), b.encode()];
	return x.length === y.length && x.every((entry, i) => entry === y[i]);
}

/** Fit the world's camera to a canvas `aspect` wide: always 14 tiles tall, as wide as the window. */
export function frameWorldCamera(camera: THREE.OrthographicCamera, aspect: number): void {
	const halfH = VIEW_HEIGHT_TILES / 2;
	camera.left = -halfH * aspect;
	camera.right = halfH * aspect;
	camera.top = halfH;
	camera.bottom = -halfH;
	camera.updateProjectionMatrix();
}

/** Point the world's camera at `target` (on the ground) from its one fixed angle. */
export function aimWorldCamera(camera: THREE.OrthographicCamera, target: THREE.Vector3): void {
	camera.position.copy(target).add(CAMERA_OFFSET);
	camera.lookAt(target);
	camera.updateMatrixWorld();
}

export class GameRenderer {
	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
	private player: THREE.Group;
	private figures: THREE.Group[] = [];
	private chunks = new ChunkRing(this.scene);
	private seed = 0;
	/** The tiles the player has cleared, as the chunks on screen show them. */
	private edits = WorldEdits.none;
	/** Trees tipping over and rocks cracking, until each is gone. */
	private clearings = new ClearingEffects(this.scene);
	/** The trainer's swing in progress: the tool in its hand and when it started (seconds). */
	private swing: { tool: THREE.Group; start: number } | null = null;
	private cameraTarget = new THREE.Vector3();
	/** The player's step as last placed: how far through it (1 is standing) and which foot leads. */
	private step = { progress: 1, stride: 1 as 1 | -1 };
	/** While set, this scene is drawn instead of the world. */
	private stage: Stage | null = null;
	/** A few butterflies round the middle of the screen (`ambient.ts`), kept out of view but for there. */
	private butterflies = new Butterflies(this.scene, this.camera);
	/** When the world was last drawn, in seconds, for the butterflies' time step. */
	private lastT = -1;
	/** The boat on the trainer, built the first time the player owns one; hidden while they don't. */
	private boat: THREE.Group | null = null;
	private boatOwned = false;
	/** How far the boat is under the trainer this frame: 0 on their back, 1 afloat under them. */
	private afloat = 0;
	/** Seconds since the boat was bought, while it grows onto the trainer's back. */
	private boatArriving: number | null = null;
	/** Where `setPlayer` last put the trainer, before the water rocks them. */
	private playerAt = new THREE.Vector3();
	/** Little clouds of dust where a trainer turns up out of nowhere. */
	private poofs = new Poofs(this.scene);
	/** The other players in view, each with their lead (`others.ts`). */
	readonly others: OtherPlayers = new OtherPlayers(this.scene, this, this.poofs);

	constructor(private canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;

		this.scene.background = new THREE.Color(COLORS.sky);
		this.scene.fog = new THREE.Fog(COLORS.sky, 40, 70);

		this.scene.add(this.camera);

		const hemi = new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.1);
		this.scene.add(hemi);
		const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
		sun.position.set(12, 20, 8);
		sun.castShadow = true;
		sun.shadow.mapSize.set(2048, 2048);
		sun.shadow.camera.left = -24;
		sun.shadow.camera.right = 24;
		sun.shadow.camera.top = 24;
		sun.shadow.camera.bottom = -24;
		sun.shadow.camera.near = 1;
		sun.shadow.camera.far = 60;
		sun.shadow.bias = -0.0005;
		this.scene.add(sun);
		this.scene.add(sun.target);
		this.sun = sun;

		this.player = buildPlayerMesh();
		this.scene.add(this.player);

		window.addEventListener('resize', () => this.resize());
		this.resize();
	}
	private sun: THREE.DirectionalLight;

	/**
	 * Draw world `seed`, as `edits` leave it. The chunks already built stay
	 * when it is the world on screen with the same edits; with other edits
	 * (a new game after the title showed a saved one) they are built again.
	 */
	setWorld(seed: number, edits: WorldEdits = WorldEdits.none): void {
		if (seed === this.seed && this.chunks.size > 0) {
			if (sameEdits(edits, this.edits)) return;
			this.edits = edits;
			this.chunks.reset(seed, edits);
			return;
		}
		this.seed = seed;
		this.edits = edits;
		this.chunks.reset(seed, edits);
		this.clearings.clear();
		this.poofs.clear();
		this.others.setWorld(seed);
		this.butterflies.setWorld(seed);
	}

	/** A poof round the player's feet, on `pos`: they just turned up there (Go to). */
	poofAt(pos: GridPos): void {
		const { y } = trainerStep(this.seed, pos, pos, 1, this.boatOwned, motion.reduced);
		this.poofs.play(new THREE.Vector3(pos.x, y, pos.y), motion.reduced);
	}

	/**
	 * Where a point in the world is on the canvas, in CSS pixels from the top
	 * left, as this frame's camera sees it (`visible`: inside the canvas).
	 */
	toScreen(p: THREE.Vector3): { x: number; y: number; visible: boolean } {
		const v = p.clone().project(this.camera);
		const { w, h } = this.size();
		const x = ((v.x + 1) / 2) * w;
		const y = ((1 - v.y) / 2) * h;
		return { x, y, visible: x >= 0 && x <= w && y >= 0 && y <= h };
	}

	/** Where the ground at grid `(x, y)` is on the canvas: for pointing at something off screen. */
	groundToScreen(x: number, y: number): { x: number; y: number } {
		return this.toScreen(new THREE.Vector3(x, 0, y));
	}

	/** The canvas size in CSS pixels, for what is drawn over it. */
	screenSize(): { w: number; h: number } {
		return this.size();
	}

	/** Whether the world is on screen: no battle or starter stage drawn instead. */
	get showingWorld(): boolean {
		return this.stage === null;
	}

	/**
	 * The player cleared the tile at `pos` (and the far chunks in `regrown`
	 * grew back): from now on the world is as `edits` leave it. The chunk
	 * holding it is built again with the stump or the gravel, and the chop
	 * plays: the trainer swings `tool`, and what stood there (the seed's own
	 * tile) tips over or cracks, away from the way the trainer faces.
	 */
	cleared(
		pos: GridPos,
		tool: ItemId,
		facing: Direction,
		edits: WorldEdits,
		regrown: readonly ChunkRef[]
	): void {
		this.edits = edits;
		const chunk = { cx: Math.floor(pos.x / CHUNK_SIZE), cy: Math.floor(pos.y / CHUNK_SIZE) };
		this.chunks.setEdits(edits, [chunk, ...regrown]);
		const now = performance.now() / 1000;
		this.clearings.play(tileAtWorld(this.seed, pos.x, pos.y), pos, facing, now);
		this.startSwing(tool, now);
	}

	/** Put the tool in the trainer's right hand and swing it; a swing already going is replaced. */
	private startSwing(tool: ItemId, now: number): void {
		this.endSwing();
		const held = buildTool(tool);
		this.player.children[0]?.getObjectByName('armR')?.add(held);
		this.swing = { tool: held, start: now };
	}

	private endSwing(): void {
		this.swing?.tool.removeFromParent();
		this.swing = null;
	}

	ensureChunksAround(pos: GridPos): void {
		this.chunks.update(pos);
	}

	/**
	 * The player owns the boat or not: it rides on the trainer's back, or under
	 * them out on the water. Bought while the game is on (`arriving`), it grows
	 * onto their back with a little bounce.
	 */
	setBoat(owned: boolean, arriving = false): void {
		if (owned && !this.boat) {
			this.boat = buildBoatMesh();
			this.player.add(this.boat);
		}
		if (owned && !this.boatOwned && arriving) this.boatArriving = 0;
		this.boatOwned = owned;
		if (this.boat) this.boat.visible = owned;
	}

	/** Position the player between two tiles (progress 0..1) and face `dir`. */
	setPlayer(from: GridPos, to: GridPos, progress: number, dir: Direction): void {
		const { x, y, z, afloat } = trainerStep(
			this.seed,
			from,
			to,
			progress,
			this.boatOwned,
			motion.reduced
		);
		this.afloat = afloat;
		this.playerAt.set(x, y, z);
		this.player.position.copy(this.playerAt);
		// Figures face +z at rest, which is grid "down" (toward the camera).
		this.player.rotation.y = FACING_ANGLE[dir];
		this.cameraTarget.set(x, 0, z);
		// Every step lands on the other foot: x + y changes by one each step.
		const moving = from.x !== to.x || from.y !== to.y;
		this.step.progress = moving ? progress : 1;
		this.step.stride = strideOnto(to);
	}

	/**
	 * Where the player's middle is on the canvas, in CSS pixels from the top
	 * left: the encounter transition closes on it. Their body, which stands
	 * back towards the stern in the boat, not the middle of their tile.
	 */
	playerScreenPoint(): { x: number; y: number } {
		this.placeCamera();
		this.player.updateMatrixWorld(true);
		const body = this.player.children[0] ?? this.player;
		const p = body.getWorldPosition(new THREE.Vector3());
		p.y += 0.35;
		p.project(this.camera);
		const { w, h } = this.size();
		return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
	}

	/**
	 * Point the camera at a ground position other than the player's (the
	 * title's slow drift). The angle is the explore camera's, never another;
	 * the next `setPlayer` points it back at the player.
	 */
	lookAt(x: number, z: number): void {
		this.cameraTarget.set(x, 0, z);
	}

	/** Add a standing figure (from `animals.ts`) to the world; it idles with the player. */
	addFigure(figure: THREE.Group): void {
		this.figures.push(figure);
		this.scene.add(figure);
	}

	/** Take a figure added with `addFigure` out of the world. */
	removeFigure(figure: THREE.Group): void {
		this.figures = this.figures.filter((f) => f !== figure);
		this.scene.remove(figure);
	}

	/** Show a battle scene instead of the world, or `null` to return to it. */
	setBattle(scene: Stage | null): void {
		this.setStage(scene);
	}

	/** Draw `stage` instead of the world (a battle, the starter stage), or `null` for the world. */
	setStage(stage: Stage | null): void {
		this.stage = stage;
		const { w, h } = this.size();
		stage?.resize(w, h);
	}

	render(): void {
		const t = performance.now() / 1000;
		if (this.stage) {
			this.stage.update(t);
			this.renderer.render(this.stage.scene, this.stage.camera);
			return;
		}
		animateIdle(this.player, t);
		// Standing in the boat, the trainer's legs don't walk.
		animateWalk(this.player, this.step.progress, this.step.stride, this.afloat === 1 ? 0 : 1);
		this.poseBoat(t);
		if (this.swing) {
			const progress = (t - this.swing.start) / SWING_SECONDS;
			animateSwing(this.player, progress, motion.reduced);
			if (progress >= 1) this.endSwing();
		}
		this.clearings.update(t, motion.reduced);
		const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
		// The others walk and fade (their followers are figures too, idled below).
		this.others.setCentre({
			x: Math.round(this.cameraTarget.x),
			y: Math.round(this.cameraTarget.z)
		});
		this.others.update(t, dt);
		this.poofs.update(t);
		for (const f of this.figures) animateIdle(f, t, this.camera);
		this.lastT = t;
		// Aimed first: the butterflies keep out of this frame's view, not the last one's.
		this.placeCamera();
		this.butterflies.update({ x: this.cameraTarget.x, z: this.cameraTarget.z }, dt, t);
		this.sun.position.copy(this.cameraTarget).add(new THREE.Vector3(12, 20, 8));
		this.sun.target.position.copy(this.cameraTarget);
		this.renderer.render(this.scene, this.camera);
	}

	/** The camera rides a fixed offset from the target: pitch and yaw never change. */
	private placeCamera(): void {
		aimWorldCamera(this.camera, this.cameraTarget);
	}

	/**
	 * The boat where this frame's step puts it, rocking with the trainer once
	 * afloat (not with reduced motion), and growing onto their back when just
	 * bought. Afloat it stays over the middle of the tile and the trainer
	 * stands back towards its stern (their rig moves; the boat, a child of the
	 * figure, does not), leaving the bow for a rider.
	 */
	private poseBoat(t: number): void {
		const boat = this.boat;
		const rig = this.player.children[0];
		if (!boat || !this.boatOwned) {
			if (rig) rig.position.z = 0;
			return;
		}
		const calm = motion.reduced;
		const rocking = this.afloat === 1 && !calm;
		this.player.position.copy(this.playerAt);
		if (rocking) this.player.position.y += Math.sin(t * 2.1) * 0.012;
		poseBoat(boat, this.afloat, calm, rocking ? Math.sin(t * 1.6) * 0.035 : 0);
		if (rig) rig.position.z = -standAstern(this.afloat, calm);
		if (this.boatArriving !== null) {
			const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
			this.boatArriving += dt;
			const p = this.boatArriving / BOAT_ARRIVES_SECONDS;
			boat.scale.multiplyScalar(appearScale(p, calm));
			if (p >= 1) this.boatArriving = null;
		}
	}

	/** The canvas's width over its height: how many tiles wide the world view is, per tile tall. */
	aspect(): number {
		const { w, h } = this.size();
		return w / Math.max(1, h);
	}

	/** The canvas size in CSS pixels. */
	private size(): { w: number; h: number } {
		return {
			w: this.canvas.clientWidth || window.innerWidth,
			h: this.canvas.clientHeight || window.innerHeight
		};
	}

	private resize(): void {
		const { w, h } = this.size();
		this.renderer.setSize(w, h, false);
		frameWorldCamera(this.camera, w / h);
		this.stage?.resize(w, h);
	}
}
