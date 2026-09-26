import { tileAtWorld, type Direction, type GridPos } from '@mathgame/engine';
import * as THREE from 'three';
import { animateIdle, buildPlayerMesh } from './animals';
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
 * breathe a little every frame.
 */
const VIEW_HEIGHT_TILES = 14; // how many tiles tall the viewport is
const CAMERA_PITCH = THREE.MathUtils.degToRad(50);
const CAMERA_YAW = THREE.MathUtils.degToRad(35);

export class GameRenderer {
	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera: THREE.OrthographicCamera;
	private player: THREE.Group;
	private figures: THREE.Group[] = [];
	private chunks = new ChunkRing(this.scene);
	private seed = 0;
	private cameraTarget = new THREE.Vector3();
	/** While set, this scene is drawn instead of the world. */
	private stage: Stage | null = null;

	constructor(private canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;

		this.scene.background = new THREE.Color(COLORS.sky);
		this.scene.fog = new THREE.Fog(COLORS.sky, 40, 70);

		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
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
		const hop = Math.sin(progress * Math.PI) * 0.15;
		this.player.position.set(x, y + hop, z);
		// Figures face +z at rest, which is grid "down" (toward the camera).
		this.player.rotation.y = { up: Math.PI, down: 0, left: -Math.PI / 2, right: Math.PI / 2 }[dir];
		this.cameraTarget.set(x, 0, z);
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
		for (const f of this.figures) animateIdle(f, t);
		// Camera rides a fixed offset from the target: pitch/yaw never change.
		const dist = 40;
		const offset = new THREE.Vector3(
			Math.sin(CAMERA_YAW) * Math.cos(CAMERA_PITCH),
			Math.sin(CAMERA_PITCH),
			Math.cos(CAMERA_YAW) * Math.cos(CAMERA_PITCH)
		).multiplyScalar(dist);
		this.camera.position.copy(this.cameraTarget).add(offset);
		this.camera.lookAt(this.cameraTarget);
		this.sun.position.copy(this.cameraTarget).add(new THREE.Vector3(12, 20, 8));
		this.sun.target.position.copy(this.cameraTarget);
		this.renderer.render(this.scene, this.camera);
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
		const aspect = w / h;
		const halfH = VIEW_HEIGHT_TILES / 2;
		this.camera.left = -halfH * aspect;
		this.camera.right = halfH * aspect;
		this.camera.top = halfH;
		this.camera.bottom = -halfH;
		this.camera.updateProjectionMatrix();
		this.stage?.resize(w, h);
	}
}
