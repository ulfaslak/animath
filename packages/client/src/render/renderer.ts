import { tileAtWorld, type Direction, type GridPos } from '@mathgame/engine';
import * as THREE from 'three';
import { motion } from '../motion';
import { Butterflies } from './ambient';
import { animateIdle, animateWalk, buildPlayerMesh } from './animals';
import { ChunkRing } from './chunks';
import { COLORS } from './palette';
import { groundTop } from './tiles';

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
 * (`chunks.ts`). Figures (the player and anything added with `addFigure`)
 * breathe a little every frame, and the player swings its arms and legs
 * through each step (smaller with reduced motion).
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
	private cameraTarget = new THREE.Vector3();
	/** The player's step as last placed: how far through it (1 is standing) and which foot leads. */
	private step = { progress: 1, stride: 1 as 1 | -1 };
	/** While set, this scene is drawn instead of the world. */
	private stage: Stage | null = null;
	/** A few butterflies round the middle of the screen (`ambient.ts`), kept out of view but for there. */
	private butterflies = new Butterflies(this.scene, this.camera);
	/** When the world was last drawn, in seconds, for the butterflies' time step. */
	private lastT = -1;

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

	/** Draw world `seed`. The chunks already built stay when it is the world on screen. */
	setWorld(seed: number): void {
		if (seed === this.seed && this.chunks.size > 0) return;
		this.seed = seed;
		this.chunks.reset(seed);
		this.butterflies.setWorld(seed);
	}

	ensureChunksAround(pos: GridPos): void {
		this.chunks.update(pos);
	}

	/** Position the player between two tiles (progress 0..1) and face `dir`. */
	setPlayer(from: GridPos, to: GridPos, progress: number, dir: Direction): void {
		const t = progress * progress * (3 - 2 * progress); // smoothstep
		const x = from.x + (to.x - from.x) * t;
		const z = from.y + (to.y - from.y) * t;
		const yFrom = this.groundAt(from);
		const y = yFrom + (this.groundAt(to) - yFrom) * t;
		const hop = Math.sin(progress * Math.PI) * (motion.reduced ? 0.05 : 0.15);
		this.player.position.set(x, y + hop, z);
		// Figures face +z at rest, which is grid "down" (toward the camera).
		this.player.rotation.y = { up: Math.PI, down: 0, left: -Math.PI / 2, right: Math.PI / 2 }[dir];
		this.cameraTarget.set(x, 0, z);
		// Every step lands on the other foot: x + y changes by one each step.
		const moving = from.x !== to.x || from.y !== to.y;
		this.step.progress = moving ? progress : 1;
		this.step.stride = (((to.x + to.y) % 2) + 2) % 2 === 0 ? 1 : -1;
	}

	/**
	 * Where the player's middle is on the canvas, in CSS pixels from the top
	 * left: the encounter transition closes on it.
	 */
	playerScreenPoint(): { x: number; y: number } {
		this.placeCamera();
		const p = this.player.position.clone();
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
		animateWalk(this.player, this.step.progress, this.step.stride);
		for (const f of this.figures) animateIdle(f, t, this.camera);
		const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
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

	private groundAt(pos: GridPos): number {
		return groundTop(tileAtWorld(this.seed, pos.x, pos.y));
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
