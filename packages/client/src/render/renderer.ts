import { CHUNK_SIZE, generateChunk, type Direction, type GridPos } from '@mathgame/engine';
import * as THREE from 'three';
import { COLORS } from './palette';
import { buildChunkGroup } from './tiles';

/**
 * Owns the Three.js scene: a fixed-angle orthographic camera (no zoom, no
 * rotation — the world reads like a diorama), flat-shaded low-poly meshes,
 * one directional light with soft shadows. Chunks are built lazily as the
 * player approaches them and cached by key.
 */
const VIEW_HEIGHT_TILES = 14; // how many tiles tall the viewport is
const CAMERA_PITCH = THREE.MathUtils.degToRad(50);
const CAMERA_YAW = THREE.MathUtils.degToRad(35);
const CHUNK_RADIUS = 2;

export class GameRenderer {
	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera: THREE.OrthographicCamera;
	private player: THREE.Group;
	private chunks = new Map<string, THREE.Group>();
	private seed = 0;
	private cameraTarget = new THREE.Vector3();

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

		this.player = buildPlayerPlaceholder();
		this.scene.add(this.player);

		window.addEventListener('resize', () => this.resize());
		this.resize();
	}
	private sun: THREE.DirectionalLight;

	setWorld(seed: number): void {
		this.seed = seed;
		for (const g of this.chunks.values()) this.scene.remove(g);
		this.chunks.clear();
	}

	ensureChunksAround(pos: GridPos): void {
		const cx = Math.floor(pos.x / CHUNK_SIZE);
		const cy = Math.floor(pos.y / CHUNK_SIZE);
		const wanted = new Set<string>();
		for (let dy = -CHUNK_RADIUS; dy <= CHUNK_RADIUS; dy++) {
			for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
				const key = `${cx + dx},${cy + dy}`;
				wanted.add(key);
				if (!this.chunks.has(key)) {
					const group = buildChunkGroup(generateChunk(this.seed, cx + dx, cy + dy));
					this.chunks.set(key, group);
					this.scene.add(group);
				}
			}
		}
		for (const [key, group] of this.chunks) {
			if (!wanted.has(key)) {
				this.scene.remove(group);
				this.chunks.delete(key);
			}
		}
	}

	/** Position the player between two tiles (progress 0..1) and face `dir`. */
	setPlayer(from: GridPos, to: GridPos, progress: number, dir: Direction): void {
		const t = progress * progress * (3 - 2 * progress); // smoothstep
		const x = from.x + (to.x - from.x) * t;
		const z = from.y + (to.y - from.y) * t;
		const hop = Math.sin(progress * Math.PI) * 0.15;
		this.player.position.set(x, 0.5 + hop, z);
		this.player.rotation.y = { up: Math.PI, down: 0, left: -Math.PI / 2, right: Math.PI / 2 }[dir];
		this.cameraTarget.set(x, 0, z);
	}

	render(): void {
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

	private resize(): void {
		const w = this.canvas.clientWidth || window.innerWidth;
		const h = this.canvas.clientHeight || window.innerHeight;
		this.renderer.setSize(w, h, false);
		const aspect = w / h;
		const halfH = VIEW_HEIGHT_TILES / 2;
		this.camera.left = -halfH * aspect;
		this.camera.right = halfH * aspect;
		this.camera.top = halfH;
		this.camera.bottom = -halfH;
		this.camera.updateProjectionMatrix();
	}
}

/** A stand-in until real low-poly animal models arrive: body + head + ears. */
function buildPlayerPlaceholder(): THREE.Group {
	const g = new THREE.Group();
	const bodyMat = new THREE.MeshLambertMaterial({ color: COLORS.player, flatShading: true });
	const headMat = new THREE.MeshLambertMaterial({ color: COLORS.playerHead, flatShading: true });
	const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.7), bodyMat);
	body.position.y = 0;
	body.castShadow = true;
	const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), headMat);
	head.position.set(0, 0.35, 0.35);
	head.castShadow = true;
	const earGeo = new THREE.ConeGeometry(0.08, 0.2, 4);
	const earL = new THREE.Mesh(earGeo, bodyMat);
	earL.position.set(-0.12, 0.62, 0.35);
	const earR = earL.clone();
	earR.position.x = 0.12;
	g.add(body, head, earL, earR);
	return g;
}
