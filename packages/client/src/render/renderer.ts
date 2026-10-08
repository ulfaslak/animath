import {
	CHUNK_SIZE,
	WorldEdits,
	getLand,
	isWater,
	landOfSeed,
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
import { SUN_FROM, WORLD_LIGHT } from './campfire';
import { Chaser } from './chaser';
import { ChunkRing } from './chunks';
import { ClearingEffects, SWING_SECONDS, animateSwing, buildTool } from './clearing';
import { Greetings } from './doctor';
import { appearScale, smoothstep } from './ease';
import { buildGliderMesh, poseGlider } from './glider';
import { WatchedFights } from './fights';
import { OtherPlayers } from './others';
import { COLORS, GLIDER_COLORS, PLAYER_LOOK } from './palette';
import { SIT_DROP, poseRider } from './mount';
import { Poofs } from './poof';
import { PortraitStudio } from './portraits';
import { buildTileProps, disposeChunkGroup, groundTop } from './tiles';
import { FACING_ANGLE, slidesBetween, strideOnto, trainerPose, trainerStep } from './trainer';

/**
 * The trainer with the glider, as explore poses them this frame: how far up
 * into the air (`lift`, 0 on the ground to 1 cruising), how open the canopy
 * is (`open`, 0 folded on the back to 1 overhead), how deep the wind-up's
 * crouch is before a take-off (`crouch`, 0 to 1), and a hop in place when a
 * take-off was refused (`hop`, 0 to 1 through it).
 */
export interface AirPose {
	lift: number;
	open: number;
	crouch: number;
	hop: number;
}

const GROUNDED: AirPose = { lift: 0, open: 0, crouch: 0, hop: 0 };

/**
 * The trainer on a mount's back (`Follower.seat`): how high over the ground
 * its back is, and how far they sit there (0 to 1, as it grows in or shrinks away).
 */
export interface Seat {
	height: number;
	weight: number;
}

const ON_FOOT: Seat = { height: 0, weight: 0 };

/** Seconds the glider takes to grow onto the trainer's back when it is bought. */
const GLIDER_ARRIVES_SECONDS = 0.45;

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
/** How many tiles tall the viewport is (the title's scenery measures the screen with it too). */
export const VIEW_HEIGHT_TILES = 14;
const CAMERA_PITCH = THREE.MathUtils.degToRad(50);
/** The camera's turn about the vertical, from +z towards +x (the title's scenery uses it too). */
export const CAMERA_YAW = THREE.MathUtils.degToRad(35);
/** Where the camera rides relative to what it looks at: pitch and yaw never change. */
const CAMERA_OFFSET = new THREE.Vector3(
	Math.sin(CAMERA_YAW) * Math.cos(CAMERA_PITCH),
	Math.sin(CAMERA_PITCH),
	Math.cos(CAMERA_YAW) * Math.cos(CAMERA_PITCH)
).multiplyScalar(40);

/** Seconds the boat takes to grow onto the trainer's back when it is bought. */
const BOAT_ARRIVES_SECONDS = 0.45;

/** Where the sun hangs from what the camera looks at: its light comes from the same way everywhere. */
const SUN_OFFSET = new THREE.Vector3(...SUN_FROM);

/** Whether two overlays clear the same tiles: their text forms are canonical. */
function sameEdits(a: WorldEdits, b: WorldEdits): boolean {
	if (a === b) return true;
	const [x, y] = [a.encode(), b.encode()];
	return x.length === y.length && x.every((entry, i) => entry === y[i]);
}

/**
 * How many device pixels the game draws per CSS pixel on a canvas `width` ×
 * `height` CSS pixels big, on a screen of `device` pixels per CSS pixel. The
 * GPU's time goes with the pixels it fills, so the drawing holds at most
 * `PIXEL_BUDGET` pixels (a big phone held sideways at 2×), except that a
 * screen bigger than a phone keeps 1.5 per CSS pixel, where the figures'
 * edges stay crisp; never more than 2, nor than the screen has. At an older
 * iPad's 1080×810 that is 1.5: 56% of the pixels of 2×, the frame 40% quicker
 * on a laptop GPU of its class (#150).
 */
export function pixelRatioFor(width: number, height: number, device: number): number {
	const budget = Math.sqrt(PIXEL_BUDGET / Math.max(1, width * height));
	return Math.min(device, MAX_PIXEL_RATIO, Math.max(BIG_SCREEN_PIXEL_RATIO, budget));
}
const PIXEL_BUDGET = 1_800_000;
const MAX_PIXEL_RATIO = 2;
const BIG_SCREEN_PIXEL_RATIO = 1.5;

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
	/** The glider on the trainer, built the first time the player owns one. */
	private glider: THREE.Group | null = null;
	private gliderOwned = false;
	/** Seconds since the glider was bought, while it grows onto the trainer's back. */
	private gliderArriving: number | null = null;
	/** The trainer's pose with the glider, as `setPlayer` last had it. */
	private air: AirPose = GROUNDED;
	/** How far the trainer sits on a mount this frame: 0 on foot (and up in the air). */
	private sitting = 0;
	/** The dark disc on the ground under a trainer in the air: where they are over. */
	private shadow: THREE.Mesh;
	/**
	 * The landing ring: a soft cream ring on the tile the glider would come
	 * down on if the kid let go now, and over a tree or a rock, the tool that
	 * will clear it. Hidden on the ground.
	 */
	private ring: THREE.Mesh;
	private ringTools: Partial<Record<ItemId, THREE.Group>> = {};
	private ringAt: GridPos | null = null;
	private ringTool: ItemId | null = null;
	/** Little clouds of dust where a trainer turns up out of nowhere. */
	private poofs = new Poofs(this.scene);
	/** Which witch doctors are greeting the trainer, who came near them. */
	private greetings = new Greetings();
	/** Draws the animal book's pictures, made the first time the book asks for one. */
	private studio: PortraitStudio | null = null;
	/** The other players in view, each with their lead (`others.ts`). */
	readonly others: OtherPlayers = new OtherPlayers(this.scene, this, this.poofs);
	/** Their battles, drawn beside them (`fights.ts`). */
	readonly fights: WatchedFights = new WatchedFights(this.scene, this, this.poofs, this.others);
	/** A wild bird following the glider down (`chaser.ts`), which explore flies. */
	readonly chaser: Chaser = new Chaser(this, this.scene, () => this.camera);

	constructor(private canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;

		this.scene.background = new THREE.Color(COLORS.sky);
		this.scene.fog = new THREE.Fog(COLORS.sky, 40, 70);

		this.scene.add(this.camera);

		// The world's only lights, always the same two: a campfire's glow is painted (`campfire.ts`).
		const hemi = new THREE.HemisphereLight(WORLD_LIGHT.sky, WORLD_LIGHT.bounce, WORLD_LIGHT.fill);
		this.scene.add(hemi);
		const sun = new THREE.DirectionalLight(WORLD_LIGHT.sun, WORLD_LIGHT.sunIntensity);
		sun.position.set(...SUN_FROM);
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

		// Built once, for as long as the page lives, and shown only while the trainer flies.
		const shadow = new THREE.CircleGeometry(0.3, 16);
		shadow.rotateX(-Math.PI / 2);
		this.shadow = new THREE.Mesh(
			shadow,
			new THREE.MeshBasicMaterial({
				color: GLIDER_COLORS.shadow,
				transparent: true,
				opacity: 0,
				depthWrite: false
			})
		);
		this.shadow.visible = false;
		this.scene.add(this.shadow);
		const ring = new THREE.RingGeometry(0.3, 0.42, 28);
		ring.rotateX(-Math.PI / 2);
		// Drawn over everything, a tree's crown included: it marks a tile, it is no thing on it.
		this.ring = new THREE.Mesh(
			ring,
			new THREE.MeshBasicMaterial({
				color: GLIDER_COLORS.ring,
				transparent: true,
				opacity: 0.9,
				depthTest: false,
				depthWrite: false
			})
		);
		this.ring.renderOrder = 10;
		this.ring.visible = false;
		this.scene.add(this.ring);

		window.addEventListener('resize', () => this.resize());
		this.resize();
		this.warmUp();
	}
	private sun: THREE.DirectionalLight;

	/**
	 * Compile what a tent draws with (its cloth, the doctor, his fire, the
	 * glow), and what the scene holds hidden till it is needed (the flier's
	 * shadow and the landing ring), as the page starts, in the background
	 * where the browser can, rather than on the frame the first tent comes
	 * into view or the first glide takes off, which the compile would stall
	 * (#151). The world's lights never change, so these programs serve for
	 * good.
	 */
	private warmUp(): void {
		const camp = buildTileProps({ kind: 'tent', biome: 'meadow', height: 0 }, 0, 0);
		this.renderer
			.compileAsync(camp, this.camera, this.scene)
			.catch(() => undefined)
			.finally(() => disposeChunkGroup(camp));
		this.renderer.compileAsync(this.scene, this.camera).catch(() => undefined);
	}

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
		this.dress(getLand(landOfSeed(seed)).look === 'warm-hat');
		this.chunks.reset(seed, edits);
		this.clearings.clear();
		this.poofs.clear();
		this.greetings.clear();
		this.others.setWorld(seed);
		this.fights.setWorld(seed);
		this.butterflies.setWorld(seed);
	}

	/**
	 * The trainer in the land's look: in The Arctic the warm hat (`warm`),
	 * elsewhere the cap. Only the figure changes: what it carries (the boat,
	 * the glider) stays on it.
	 */
	private dress(warm: boolean): void {
		const rig = this.player.children[0];
		if (!rig || Boolean(this.player.userData.warm) === warm) return;
		this.endSwing();
		const dressed = buildPlayerMesh({ ...PLAYER_LOOK, warm }).children[0];
		if (!dressed) return;
		this.player.remove(rig);
		this.player.add(dressed);
		// The rig is the figure's first child: the walk, the breath and the rider's pose read it there.
		this.player.children.splice(this.player.children.indexOf(dressed), 1);
		this.player.children.unshift(dressed);
		this.player.userData.warm = warm;
		this.player.userData.airborne = undefined;
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

	/**
	 * The player owns the glider or not: folded on their back, it opens over
	 * them in the air. Bought while the game is on (`arriving`), it grows
	 * onto their back with a little bounce.
	 */
	setGlider(owned: boolean, arriving = false): void {
		if (owned && !this.glider) {
			this.glider = buildGliderMesh();
			this.player.add(this.glider);
		}
		if (owned && !this.gliderOwned && arriving) this.gliderArriving = 0;
		this.gliderOwned = owned;
		if (this.glider) this.glider.visible = owned;
	}

	/**
	 * Position the player between two tiles (progress 0..1) and face `dir`;
	 * with the glider, `air` says how far up they are and how open it is; on
	 * a mount's back, `seat` where they sit (they rise off it as they take off).
	 */
	setPlayer(
		from: GridPos,
		to: GridPos,
		progress: number,
		dir: Direction,
		air: AirPose = GROUNDED,
		seat: Seat = ON_FOOT
	): void {
		this.air = air;
		const lift = smoothstep(air.lift);
		this.sitting = seat.weight * (1 - lift);
		const { x, y, z, afloat } = trainerPose(
			this.seed,
			from,
			to,
			progress,
			this.boatOwned,
			motion.reduced,
			lift,
			this.sitting
		);
		this.afloat = afloat;
		// A take-off refused: a little hop in place.
		const hop =
			air.hop > 0 ? Math.sin(Math.min(1, air.hop) * Math.PI) * (motion.reduced ? 0.04 : 0.14) : 0;
		// Astride: the hips on the mount's back, the feet hanging below it.
		const astride = (seat.height - SIT_DROP * seat.weight) * (1 - lift);
		this.playerAt.set(x, y + hop + astride, z);
		this.player.position.copy(this.playerAt);
		// Figures face +z at rest, which is grid "down" (toward the camera).
		this.player.rotation.y = FACING_ANGLE[dir];
		this.cameraTarget.set(x, 0, z);
		// Every step lands on the other foot: x + y changes by one each step. Up in the air
		// nobody walks, and on the ice nobody does either: they slide, feet together.
		const moving =
			(from.x !== to.x || from.y !== to.y) && lift === 0 && !slidesBetween(this.seed, from, to);
		this.step.progress = moving ? progress : 1;
		this.step.stride = strideOnto(to);
		this.placeShadow(x, z, lift);
	}

	/**
	 * Where the glider would come down if the kid let go now: the landing
	 * ring on that tile, with the tool that will clear it over a tree or a
	 * rock; null takes it away.
	 */
	setLandingSpot(at: GridPos | null, tool: ItemId | null = null): void {
		this.ringAt = at && { ...at };
		this.ringTool = at ? tool : null;
	}

	/** The disc on the ground under the trainer, darker the higher they are; none on the ground. */
	private placeShadow(x: number, z: number, lift: number): void {
		this.shadow.visible = lift > 0.02;
		if (!this.shadow.visible) return;
		const under = tileAtWorld(this.seed, Math.round(x), Math.round(z));
		this.shadow.position.set(x, groundTop(under) + 0.02, z);
		this.shadow.scale.setScalar(0.8 + 0.4 * lift);
		(this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.28 * lift;
	}

	/**
	 * Where the trainer is in the world, as `setPlayer` last put them (up in
	 * the air with the glider, their point in the air): what the birds up
	 * there fly by.
	 */
	trainerPoint(): THREE.Vector3 {
		return this.playerAt.clone();
	}

	/** The world's fixed camera, for turning a mark over a figure to face it. */
	get worldCamera(): THREE.Camera {
		return this.camera;
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

	/**
	 * A picture of `speciesId`'s figure for the animal book, drawn offscreen
	 * with this renderer (`portraits.ts`): a PNG data URL, or null while the
	 * WebGL context is lost. The screen is not touched; the next frame draws
	 * as ever.
	 */
	portrait(speciesId: string): string | null {
		this.studio ??= new PortraitStudio(this.renderer);
		return this.studio.draw(speciesId);
	}

	/**
	 * Draw `stage` instead of the world (a battle, the starter stage), or
	 * `null` for the world. The first time a stage is shown, everything in its
	 * scene is compiled, what it keeps hidden until later too (the battle's
	 * dust): a program compiled mid-battle stalls that frame (#159).
	 */
	setStage(stage: Stage | null): void {
		this.stage = stage;
		const { w, h } = this.size();
		stage?.resize(w, h);
		if (stage && !this.compiled.has(stage)) {
			this.compiled.add(stage);
			this.renderer.compileAsync(stage.scene, stage.camera).catch(() => undefined);
		}
	}
	/** The stages whose scenes were compiled when first shown. */
	private compiled = new WeakSet<Stage>();

	render(): void {
		const t = performance.now() / 1000;
		if (this.stage) {
			this.stage.update(t);
			this.renderer.render(this.stage.scene, this.stage.camera);
			return;
		}
		// The ring's edge, off screen, a piece a frame: its chunks, and their campfires' glow.
		this.chunks.work();
		animateIdle(this.player, t);
		// Standing in the boat, or carried, the trainer's legs don't walk; carried, they sit astride.
		animateWalk(
			this.player,
			this.step.progress,
			this.step.stride,
			this.afloat === 1 ? 0 : 1 - this.sitting
		);
		const rig = this.player.children[0];
		if (rig) poseRider(rig, this.sitting);
		this.poseBoat(t);
		this.poseFlight(t);
		if (this.swing) {
			const progress = (t - this.swing.start) / SWING_SECONDS;
			animateSwing(this.player, progress, motion.reduced);
			if (progress >= 1) this.endSwing();
		}
		this.clearings.update(t, motion.reduced);
		const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
		// The others walk and fade (their followers are figures too, idled below), and their
		// battles play beside them.
		const centre = { x: Math.round(this.cameraTarget.x), y: Math.round(this.cameraTarget.z) };
		this.others.setCentre(centre);
		this.others.update(t, dt);
		this.fights.setCentre(centre);
		this.fights.update(t, dt);
		this.poofs.update(t);
		for (const f of this.figures) animateIdle(f, t, this.camera);
		this.animateDoctors(t);
		this.lastT = t;
		// Aimed first: the butterflies keep out of this frame's view, not the last one's.
		this.placeCamera();
		this.butterflies.update({ x: this.cameraTarget.x, z: this.cameraTarget.z }, dt, t);
		this.sun.position.copy(this.cameraTarget).add(SUN_OFFSET);
		this.sun.target.position.copy(this.cameraTarget);
		this.renderer.render(this.scene, this.camera);
	}

	/**
	 * The witch doctors at the tents in the chunks built (`doctor.ts`): each
	 * breathes, sways and taps his staff, and one the trainer comes near hops
	 * and waves, turned their way.
	 */
	private animateDoctors(t: number): void {
		const trainer = this.playerAt;
		this.chunks.forEachDoctor((doctor) => {
			const greeting = this.greetings.check(doctor.x, doctor.z, trainer, t);
			doctor.animate(t, greeting, greeting === null ? null : trainer, motion.reduced);
		});
		this.greetings.sweep(t);
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

	/**
	 * The trainer with the glider this frame: the canopy folded on the back or
	 * open overhead (above the boat's shell when the boat rides on their back),
	 * a crouch as Space winds up a take-off, and up in the air a gentle bob
	 * and sway, the arms out a little to the lines (still with reduced
	 * motion). A glider just bought grows onto the back. Then the landing ring.
	 */
	private poseFlight(t: number): void {
		const rig = this.player.children[0];
		const calm = motion.reduced;
		const air = this.air;
		const lift = smoothstep(air.lift);
		if (rig && air.crouch > 0) {
			// Knees bent for the jump: shorter, about the feet.
			rig.scale.y *= 1 - 0.2 * air.crouch;
		}
		// Up in the air the dark disc under them is their shadow: the sun's, cast off to one side
		// and a little way off, would be a second one.
		const up = lift > 0.02;
		if (this.player.userData.airborne !== up) {
			this.player.userData.airborne = up;
			this.player.traverse((o) => {
				if (o instanceof THREE.Mesh) o.castShadow = !up;
			});
		}
		const flying = lift > 0 && !calm;
		this.player.rotation.z = flying ? Math.sin(t * 1.3) * 0.05 * lift : 0;
		// Up in the air the boat rides on the back, so nothing else moves the trainer up or down.
		if (flying) this.player.position.y = this.playerAt.y + Math.sin(t * 2.2) * 0.03 * lift;
		for (const [name, side] of [
			['armL', -1],
			['armR', 1]
		] as const) {
			const arm = rig?.getObjectByName(name);
			if (arm) arm.rotation.z = side * 0.35 * lift;
		}
		const glider = this.glider;
		if (glider && this.gliderOwned) {
			poseGlider(glider, air.open, calm, this.boatOwned && this.afloat < 0.5);
			if (this.gliderArriving !== null) {
				const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
				this.gliderArriving += dt;
				const p = this.gliderArriving / GLIDER_ARRIVES_SECONDS;
				glider.scale.setScalar(appearScale(p, calm));
				if (p >= 1) {
					this.gliderArriving = null;
					glider.scale.setScalar(1);
				}
			}
		}
		this.poseRing(t, calm);
	}

	/** The landing ring where `setLandingSpot` put it, breathing gently; the tool over it slowly turning. */
	private poseRing(t: number, calm: boolean): void {
		const at = this.ringAt;
		this.ring.visible = at !== null;
		for (const [id, tool] of Object.entries(this.ringTools)) {
			if (tool) tool.visible = at !== null && id === this.ringTool;
		}
		if (!at) return;
		const top = groundTop(tileAtWorld(this.seed, at.x, at.y));
		this.ring.position.set(at.x, top + 0.03, at.y);
		this.ring.scale.setScalar(calm ? 1 : 1 + Math.sin(t * 4) * 0.06);
		const id = this.ringTool;
		if (!id) return;
		let marker = this.ringTools[id];
		if (!marker) {
			// The tool of the trainer's swing, head up, its middle on the marker's origin.
			const tool = buildTool(id);
			tool.rotation.z = Math.PI;
			tool.position.y = -0.34;
			marker = new THREE.Group();
			marker.add(tool);
			marker.scale.setScalar(1.8);
			this.ringTools[id] = marker;
			this.scene.add(marker);
		}
		marker.visible = true;
		// Over the crown of a tree, or the top of a snowy rock.
		marker.position.set(at.x, top + 1.9 + (calm ? 0 : Math.sin(t * 2.5) * 0.06), at.y);
		marker.rotation.set(0, calm ? 0.6 : t * 1.5, 0);
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
		this.renderer.setDrawingBufferSize(w, h, pixelRatioFor(w, h, window.devicePixelRatio));
		frameWorldCamera(this.camera, w / h);
		this.stage?.resize(w, h);
	}
}
