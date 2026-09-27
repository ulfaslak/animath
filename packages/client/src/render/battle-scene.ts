import { Rng, type Biome } from '@mathgame/engine';
import * as THREE from 'three';
import { touch } from '../input/touch.svelte';
import { motion } from '../motion';
import { safeArea } from '../safe-area';
import { animateIdle, buildAnimalMesh, disposeFigure } from './animals';
import { appearScale, recallScale, smoothstep } from './ease';
import { SWIM_DEPTH } from './follower';
import {
	BIOME_LOOK,
	CANOPY,
	COLORS,
	CONFETTI_COLORS,
	PROP_COLORS,
	SPARKLE_COLORS,
	TILE_COLORS
} from './palette';
import { PROP_GEOMETRY } from './tiles';

/**
 * The battle scene: a patch of the biome the battle started in, the player's
 * animal seen from behind at the lower left, the wild animal facing it at the
 * upper right, and a fixed perspective camera low behind the player's animal
 * — the Game Boy framing (see [[UI_SPEC]] § Battle mode).
 *
 * One instance lives for the whole session: `begin` dresses it for a new
 * battle (backdrop, figures, no leftover effects) and `end` frees the figures
 * once the battle is left, so nothing is rebuilt or leaked per battle; each
 * biome's backdrop is built once and kept, from the world's shared prop
 * shapes. Units are tiles like the world; figures come from
 * `animals.ts`, idle the same way, and are scaled towards a common height so
 * an otter and a deer both read at battle size (a bear still looks bigger
 * than a squirrel).
 *
 * The bottom panel of the battle screen covers the lower part of the canvas.
 * The camera shifts its image up (a lens shift via `setViewOffset`, so
 * verticals stay vertical) until the scene is centred in the part of the
 * canvas the panel leaves free.
 *
 * Feedback is transient and presentational: an attacker lunges, a target
 * shakes, a miss puffs, a knocked-out animal lies down to rest in a little
 * ring of dust and stays down with z's over its head (`animateIdle`), the
 * leash flies, wobbles, then holds (with a burst of confetti) or pops off. With reduced motion (`motion.ts`) every movement is
 * smaller and the confetti fewer and slower; what happened still shows.
 */
export type BattleSide = 'player' | 'opponent';

const SPOT: Record<BattleSide, THREE.Vector3> = {
	player: new THREE.Vector3(-1.1, 0, 1.0),
	opponent: new THREE.Vector3(1.25, 0, -1.5)
};
const CAMERA_POSITION = new THREE.Vector3(0, 1.5, 5.5);
const CAMERA_TARGET = new THREE.Vector3(0, 0.3, 0);
/** Vertical field of view, in degrees, of the canvas area above the panel. */
const SCENE_FOV = 25;
/** How much lower the scene sits in the canvas area above the panel on a short screen, as a share of that area. */
const SHORT_DROP = 0.08;

/**
 * The tallest screen that is a short one, in CSS pixels: a phone held
 * sideways, where the battle's panel and status boxes take their compact
 * sizes. Mirrors the `(max-height: 560px)` media queries of the battle's
 * styles (`styles.css`, `BattlePanel.svelte`, `StatusBox.svelte`); change
 * them together.
 */
export const SHORT_SCREEN = 560;

/**
 * Height in CSS pixels of the battle screen's bottom panel for a canvas
 * `height` pixels tall, from its bottom edge. Mirrors `--battle-panel` in
 * `styles.css` (`clamp(260px, 40vh, 360px)`, and `clamp(364px, 48vh, 400px)`
 * with the touch controls on, where seven rows a finger tall must fit; on a
 * short screen 228 px, touch or not; all over the safe area's bottom inset);
 * change both together.
 */
export function battlePanelHeight(
	height: number,
	touchControls = touch.on,
	bottomInset = safeArea().bottom
): number {
	const cards =
		height <= SHORT_SCREEN
			? 228
			: touchControls
				? Math.min(400, Math.max(364, 0.48 * height))
				: Math.min(360, Math.max(260, 0.4 * height));
	return cards + bottomInset;
}

/** The ground a battle is fought on: the biome's own, as the world shows it round the grass. */
const GROUND: Record<Biome, number> = {
	meadow: BIOME_LOOK.meadow.ground,
	forest: BIOME_LOOK.forest.ground,
	river: BIOME_LOOK.river.ground,
	mountain: BIOME_LOOK.mountain.ground,
	sea: BIOME_LOOK.sea.ground
};

/**
 * Out on the deep water the surface stands this high over the ground, and
 * each animal swims in it as it does behind the boat: the lower `SWIM_DEPTH`
 * of its height under the surface, so a crab shows as much of itself as a
 * whale does.
 */
export const SEA_WATERLINE = 0.2;

const LUNGE_SECONDS = 0.35;
const SHAKE_SECONDS = 0.45;
const FAINT_SECONDS = 0.6;
const HOP_SECONDS = 0.5;
const PUFF_SECONDS = 0.5;
/** Seconds the leash takes from the hand to the animal; the wobble starts then. */
export const LEASH_FLIGHT_SECONDS = 0.55;
const LEASH_POP_SECONDS = 0.3;
const RECALL_SECONDS = 0.4;
const APPEAR_SECONDS = 0.4;
/** The dust rises as a tired animal's belly touches down, near the end of lying down. */
const DUST_DELAY_SECONDS = FAINT_SECONDS * 0.75;
const DUST_SECONDS = 0.7;
/** A confetti piece's life; each lives a little longer or shorter so they don't vanish at once. */
const CONFETTI_SECONDS = 1.3;
/** The poppers' pieces fly further and live longer: they rain over the whole scene. */
const POPPER_SECONDS = 1.9;
const GRAVITY = 6;
/** A caught animal's cheer: two hops, the first with a spin. */
const CHEER_SECONDS = 0.9;
/** A sparkle's life, from popping up to twinkling out; each waits its turn first. */
const SPARKLE_SECONDS = 0.8;

type EffectKind = 'lunge' | 'shake' | 'faint' | 'hop' | 'recall' | 'appear' | 'cheer';
/** Effects that leave the figure where they end until `setFigure` replaces it. */
const LASTING: readonly EffectKind[] = ['faint', 'recall'];
interface Effect {
	side: BattleSide;
	kind: EffectKind;
	t: number;
}
interface Puff {
	group: THREE.Group;
	t: number;
}
/** A ring of dust around a figure's feet; it waits `delay` seconds, then spreads and fades. */
interface Dust {
	group: THREE.Group;
	t: number;
	delay: number;
}
interface ConfettiPiece {
	mesh: THREE.Mesh;
	velocity: THREE.Vector3;
	spin: THREE.Vector3;
	t: number;
	life: number;
}
/** A four-pointed star that pops up beside a figure, turns and twinkles out. */
interface Sparkle {
	mesh: THREE.Mesh;
	/** Where it pops up, and the way it drifts (both world units). */
	from: THREE.Vector3;
	drift: THREE.Vector3;
	size: number;
	/** Seconds it waits before it shows. */
	delay: number;
	t: number;
}
interface Leash {
	loop: THREE.Mesh;
	rope: THREE.Mesh;
	t: number;
	state: 'flying' | 'caught' | 'broke';
}
/** Where the rope is held: the trainer's hand, just off the lower-left edge. */
const HAND = new THREE.Vector3(-2.4, 0.9, 3.4);
/**
 * Where the loop leaves the trainer's hand: low down, off the picture, so it
 * comes in from the lower left under the wild animal's status box, with room
 * to arc once past it. The rope stays in the hand, higher up: held this low,
 * it would run through the player's animal while the loop wobbles on the
 * wild one.
 */
const RELEASE = new THREE.Vector3(-2.4, 0.3, 3.8);
/**
 * The same on a short screen (`SHORT_SCREEN`), a phone held sideways: its
 * picture is so wide that the hand above would be in view, under the wild
 * animal's status box, and the rope would run along the box's bottom edge.
 * There the throw comes from under the picture's bottom edge, nearer the
 * middle, and rises over the player's animal to the wild one, well clear of
 * the box.
 */
const HAND_SHORT = new THREE.Vector3(-1.8, 0.6, 3.8);
const RELEASE_SHORT = new THREE.Vector3(-1.2, 0.3, 4.4);
const UP = new THREE.Vector3(0, 1, 0);
/** The loop leans back towards the camera, so it reads as a ring, not a line. */
const LOOP_TILT = Math.PI / 2 - 0.6;
/** The throw arcs at most a tile over the straight line from where the loop leaves the hand to the animal. */
const LEASH_ARC = 1;
/**
 * The sky a throw keeps clear over its loop, as a share of the scene's
 * height on screen (the canvas above the panel): the loop comes no nearer
 * than this to the top of the picture.
 */
const LEASH_HEADROOM = 0.05;
/**
 * The wild animal's status box over the picture's top-left corner, in CSS
 * pixels from the safe area's top left (the canvas's, on a screen with no
 * insets; the leash adds them): `.status.opponent` in `BattlePanel.svelte`
 * sits 16 px in from the corner and is 280 px wide, and its name and chunky
 * HP bar (`StatusBox`) make it 74 px tall (75 here, rounded up). Change
 * them together. The glow round the box on the wild animal's turn is only
 * light, within the loop's clearance.
 */
export const WILD_STATUS_BOX = { right: 16 + 280, bottom: 16 + 75 };
/**
 * The same box on a short screen (`SHORT_SCREEN`): 8 px down from the top,
 * 200 px wide and 60 px tall (61 here, rounded up), a size smaller. Change it
 * with the short screen's `.status` rules in `BattlePanel.svelte` and
 * `StatusBox.svelte`.
 */
export const WILD_STATUS_BOX_SHORT = { right: 16 + 200, bottom: 8 + 61 };

/** Where the wild animal's status box is on a canvas `height` pixels tall. */
export function wildStatusBox(height: number): { right: number; bottom: number } {
	return height <= SHORT_SCREEN ? WILD_STATUS_BOX_SHORT : WILD_STATUS_BOX;
}
/** How far the leash's loop keeps from the wild animal's status box, in CSS pixels. */
const LEASH_BOX_CLEARANCE = 16;
/** Points along the throw at which its arc is measured against the picture's top and the status box. */
const LEASH_SAMPLES = 32;

function lambert(hex: number): THREE.MeshLambertMaterial {
	return new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
}
const trunkMaterial = lambert(COLORS.trunk);
const boulderMaterial = lambert(COLORS.rock);
const snowMaterial = lambert(PROP_COLORS.snow);
const cattailMaterial = lambert(PROP_COLORS.cattail);
const waterMaterial = lambert(TILE_COLORS.water);
const deepWaterMaterial = lambert(TILE_COLORS.deepwater);
const sandMaterial = lambert(TILE_COLORS.sand);
const shoreGrassMaterial = lambert(TILE_COLORS.grass);
const puffMaterial = lambert(COLORS.white);
const dustMaterial = lambert(COLORS.dust);
const leashMaterial = lambert(COLORS.fire);
const confettiMaterials = CONFETTI_COLORS.map((hex) => {
	const material = lambert(hex);
	material.side = THREE.DoubleSide; // a flat piece shows from both faces as it tumbles
	return material;
});
/**
 * The sparkles: the doctor's chunky four-pointed stars, in its gold, green
 * and white. Unlit, so they shine whatever the light.
 */
const sparkleMaterials = SPARKLE_COLORS.map(
	(hex) => new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide })
);
const PUFF_GEOMETRY = new THREE.IcosahedronGeometry(0.12, 0);
/** Rounder than a miss's puff, so a cloud of it never reads as a heap of pebbles. */
const DUST_GEOMETRY = new THREE.IcosahedronGeometry(0.08, 1);
const CONFETTI_GEOMETRY = new THREE.PlaneGeometry(0.09, 0.06);
/** The poppers' pieces are bigger: they fly close to the camera, over the whole scene. */
const POPPER_GEOMETRY = new THREE.PlaneGeometry(0.1, 0.066);
/**
 * A four-pointed star one unit across, point to point: eight triangles
 * round its middle, built by hand (a `Shape` would bring its triangulator
 * into the bundle for one star).
 */
const STAR_GEOMETRY = (() => {
	const rim = [
		[0, 0.5],
		[0.13, 0.13],
		[0.5, 0],
		[0.13, -0.13],
		[0, -0.5],
		[-0.13, -0.13],
		[-0.5, 0],
		[-0.13, 0.13]
	] as const;
	const positions: number[] = [];
	rim.forEach(([ax, ay], i) => {
		const [bx, by] = rim[(i + 1) % rim.length]!;
		positions.push(0, 0, 0, bx, by, 0, ax, ay, 0);
	});
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	return geometry;
})();
const LOOP_GEOMETRY = new THREE.TorusGeometry(0.3, 0.05, 6, 16);
/** A unit-length rope along +y from the origin; stretched and turned per frame. */
const ROPE_GEOMETRY = new THREE.CylinderGeometry(0.025, 0.025, 1, 5).translate(0, 0.5, 0);

export class BattleScene {
	readonly scene = new THREE.Scene();
	readonly camera = new THREE.PerspectiveCamera(SCENE_FOV, 1, 0.1, 80);
	private ground: THREE.Mesh;
	private groundMaterial = lambert(GROUND.meadow);
	private backdrops = new Map<Biome, THREE.Group>();
	private figures: Record<BattleSide, THREE.Group | null> = { player: null, opponent: null };
	/** Each figure's resting height above its feet (for effects aimed at its middle). */
	private heights: Record<BattleSide, number> = { player: 0.5, opponent: 0.5 };
	/** Where each figure's feet are: on the ground, or out at sea, sunk into the water. */
	private feet: Record<BattleSide, number> = { player: 0, opponent: 0 };
	/** The biome the battle is fought in: at sea the figures swim. */
	private biome: Biome = 'meadow';
	private effects: Effect[] = [];
	private puffs: Puff[] = [];
	private dusts: Dust[] = [];
	private confetti: ConfettiPiece[] = [];
	private sparkles: Sparkle[] = [];
	/** Counts confetti bursts, to seed each one's scatter. */
	private bursts = 0;
	private leash: Leash | null = null;
	private lastT = -1;
	/** The canvas size in CSS pixels, from the last `resize`. */
	private width = 1;
	private height = 1;

	constructor() {
		this.scene.background = new THREE.Color(COLORS.sky);
		this.scene.fog = new THREE.Fog(COLORS.sky, 12, 24);
		this.scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.1));
		const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
		sun.position.set(4, 8, 5);
		sun.castShadow = true;
		sun.shadow.mapSize.set(1024, 1024);
		sun.shadow.camera.left = sun.shadow.camera.bottom = -6;
		sun.shadow.camera.right = sun.shadow.camera.top = 6;
		sun.shadow.camera.near = 1;
		sun.shadow.camera.far = 30;
		sun.shadow.bias = -0.0005;
		this.scene.add(sun);

		this.ground = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 0.6, 24), this.groundMaterial);
		this.ground.position.y = -0.3;
		this.ground.receiveShadow = true;
		this.scene.add(this.ground);

		this.camera.position.copy(CAMERA_POSITION);
		this.camera.lookAt(CAMERA_TARGET);
	}

	/** Dress the scene for a new battle: backdrop, both figures, no leftover effects. */
	begin(biome: Biome, playerSpecies: string, opponentSpecies: string): void {
		this.end();
		this.biome = biome;
		this.groundMaterial.color.setHex(GROUND[biome]);
		for (const [b, group] of this.backdrops) group.visible = b === biome;
		if (!this.backdrops.has(biome)) {
			const backdrop = buildBackdrop(biome);
			this.backdrops.set(biome, backdrop);
			this.scene.add(backdrop);
		}
		this.setFigure('player', playerSpecies);
		this.setFigure('opponent', opponentSpecies);
	}

	/**
	 * The battle is over and off screen: free both figures and clear every
	 * effect, so nothing of it stays in memory until the next battle. The
	 * backdrops stay, one per biome, for the next battle there.
	 */
	end(): void {
		for (const side of ['player', 'opponent'] as const) {
			const figure = this.figures[side];
			if (!figure) continue;
			this.scene.remove(figure);
			disposeFigure(figure);
			this.figures[side] = null;
		}
		for (const puff of this.puffs) this.scene.remove(puff.group);
		this.puffs = [];
		for (const dust of this.dusts) {
			this.scene.remove(dust.group);
			(dust.group.userData.material as THREE.Material).dispose();
		}
		this.dusts = [];
		for (const piece of this.confetti) this.scene.remove(piece.mesh);
		this.confetti = [];
		for (const sparkle of this.sparkles) this.scene.remove(sparkle.mesh);
		this.sparkles = [];
		this.dropLeash();
		this.effects = [];
	}

	/** Put a species' figure on one side, replacing (and freeing) whatever stood there. */
	setFigure(side: BattleSide, speciesId: string): void {
		const old = this.figures[side];
		if (old) {
			this.scene.remove(old);
			disposeFigure(old);
		}
		const figure = buildAnimalMesh(speciesId);
		const height = new THREE.Box3().setFromObject(figure).getSize(new THREE.Vector3()).y;
		const scale = Math.min(1.6, Math.max(0.8, Math.sqrt(1 / height)));
		figure.scale.setScalar(scale);
		figure.userData.baseScale = scale;
		this.heights[side] = height * scale;
		this.feet[side] = this.biome === 'sea' ? SEA_WATERLINE - height * scale * SWIM_DEPTH : 0;
		const other = SPOT[side === 'player' ? 'opponent' : 'player'];
		// Face the other animal: the player's from behind, the wild one three-quarters on.
		figure.rotation.y = Math.atan2(other.x - SPOT[side].x, other.z - SPOT[side].z);
		figure.userData.baseYaw = figure.rotation.y;
		figure.userData.idlePhase = side === 'player' ? 0 : 1.3;
		figure.position.copy(SPOT[side]);
		figure.position.y += this.feet[side];
		this.figures[side] = figure;
		this.scene.add(figure);
		this.effects = this.effects.filter((e) => e.side !== side);
	}

	/** The attacker jumps a little towards the other animal and back. */
	lunge(side: BattleSide): void {
		this.effects.push({ side, kind: 'lunge', t: 0 });
	}

	shake(side: BattleSide): void {
		this.effects.push({ side, kind: 'shake', t: 0 });
	}

	/** A happy hop in place. */
	hop(side: BattleSide): void {
		this.effects.push({ side, kind: 'hop', t: 0 });
	}

	/** A win: the winner hops, and a few stars twinkle round it. */
	winCheer(side: BattleSide): void {
		this.hop(side);
		this.sparkle(side, 6);
	}

	/** The animal is tired: it lies down to rest in a ring of dust and stays down until `setFigure` replaces it. */
	faint(side: BattleSide): void {
		this.effects.push({ side, kind: 'faint', t: 0 });
		this.dust(side);
	}

	/** The animal goes back to its trainer: it shrinks away and stays gone until `setFigure`. */
	recall(side: BattleSide): void {
		this.effects.push({ side, kind: 'recall', t: 0 });
	}

	/** A fresh animal steps in: it grows from nothing with a little bounce. */
	appear(side: BattleSide): void {
		this.effects.push({ side, kind: 'appear', t: 0 });
	}

	/** A little cloud beside a figure: the attack aimed at it missed. */
	puff(side: BattleSide): void {
		const group = new THREE.Group();
		const rng = new Rng(this.puffs.length + 11);
		for (let i = 0; i < 6; i++) {
			const bit = new THREE.Mesh(PUFF_GEOMETRY, puffMaterial);
			bit.position.set(rng.next() * 0.6 - 0.3, rng.next() * 0.4 - 0.2, rng.next() * 0.4 - 0.2);
			group.add(bit);
		}
		const spot = SPOT[side];
		group.position.set(spot.x + 0.35, this.feet[side] + this.heights[side] * 0.6, spot.z + 0.3);
		this.puffs.push({ group, t: 0 });
		this.scene.add(group);
	}

	/** A ring of dust at a figure's feet, rising as it lies down. */
	private dust(side: BattleSide): void {
		const group = new THREE.Group();
		// Its own material, so the cloud can fade without fading another one.
		const material = dustMaterial.clone();
		material.transparent = true;
		const count = 10;
		for (let i = 0; i < count; i++) {
			const bit = new THREE.Mesh(DUST_GEOMETRY, material);
			const angle = (i / count) * Math.PI * 2 + 0.3;
			// Each bit remembers the way it drifts; `update` moves it out along it.
			bit.userData.dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
			group.add(bit);
		}
		// Round the animal where it lies: it lies down on the spot it stood on.
		const spot = SPOT[side];
		const size = this.heights[side];
		// At sea it rises off the water's surface, a splash more than dust.
		group.position.set(spot.x, this.biome === 'sea' ? SEA_WATERLINE : 0, spot.z);
		group.userData.size = size;
		group.userData.material = material;
		group.visible = false;
		this.dusts.push({ group, t: 0, delay: DUST_DELAY_SECONDS });
		this.scene.add(group);
	}

	/** A small burst of confetti around a figure: the caught celebration. */
	private celebrate(side: BattleSide): void {
		const rng = new Rng(++this.bursts * 7919);
		const reduced = motion.reduced;
		const count = reduced ? 12 : 30;
		const spot = SPOT[side];
		const from = new THREE.Vector3(spot.x, this.feet[side] + this.heights[side] * 0.8, spot.z);
		for (let i = 0; i < count; i++) {
			const mesh = new THREE.Mesh(
				CONFETTI_GEOMETRY,
				confettiMaterials[i % confettiMaterials.length]
			);
			mesh.position.copy(from);
			mesh.rotation.set(rng.next() * 6, rng.next() * 6, rng.next() * 6);
			const angle = rng.next() * Math.PI * 2;
			const out = (0.5 + rng.next() * 1.1) * (reduced ? 0.4 : 1);
			// Up to about half a tile over the animal: a burst round it, never off the top of the scene.
			const up = (1.7 + rng.next() * 1.1) * (reduced ? 0.5 : 1);
			this.confetti.push({
				mesh,
				velocity: new THREE.Vector3(Math.cos(angle) * out, up, Math.sin(angle) * out),
				spin: reduced
					? new THREE.Vector3()
					: new THREE.Vector3(rng.next() * 10 - 5, rng.next() * 10 - 5, rng.next() * 10 - 5),
				t: 0,
				life: CONFETTI_SECONDS * (0.8 + rng.next() * 0.4)
			});
			this.scene.add(mesh);
		}
	}

	/**
	 * Where a figure's middle is on the canvas, in CSS pixels from the top left:
	 * the battle screen's transition opens there.
	 */
	screenPoint(side: BattleSide): { x: number; y: number } {
		const p = SPOT[side].clone();
		p.y = this.feet[side] + this.heights[side] * 0.5;
		this.camera.updateMatrixWorld();
		p.project(this.camera);
		return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height };
	}

	/** The leash's loop flies from the trainer's hand to the wild animal and wobbles there. */
	throwLeash(): void {
		this.dropLeash();
		const loop = new THREE.Mesh(LOOP_GEOMETRY, leashMaterial);
		const rope = new THREE.Mesh(ROPE_GEOMETRY, leashMaterial);
		loop.castShadow = rope.castShadow = true;
		this.leash = { loop, rope, t: 0, state: 'flying' };
		this.scene.add(loop, rope);
	}

	/**
	 * How the throw ended: the loop holds, or it pops off. Held, it is the
	 * biggest moment a battle has: the animal cheers (two hops, a spin),
	 * stars twinkle round it, confetti bursts round it and two poppers go
	 * off near the camera, raining bigger confetti over the whole scene.
	 */
	leashResult(success: boolean): void {
		if (!this.leash) return;
		this.leash.state = success ? 'caught' : 'broke';
		this.leash.t = 0;
		if (success) {
			this.effects.push({ side: 'opponent', kind: 'cheer', t: 0 });
			this.celebrate('opponent');
			this.sparkle('opponent', 10);
			this.poppers();
		} else this.shake('opponent');
	}

	/** Stars that pop up round a figure one after another, turn a little and twinkle out. */
	sparkle(side: BattleSide, count: number): void {
		const rng = new Rng(++this.bursts * 3571);
		const spot = SPOT[side];
		const h = this.heights[side];
		for (let i = 0; i < count; i++) {
			const angle = (i / count) * Math.PI * 2 + rng.next() * 0.5;
			const r = 0.3 + h * 0.4 + rng.next() * 0.15;
			const from = new THREE.Vector3(
				spot.x + Math.cos(angle) * r,
				this.feet[side] + h * (0.25 + rng.next() * 0.9),
				spot.z + Math.sin(angle) * r * 0.6
			);
			const drift = new THREE.Vector3(Math.cos(angle), 0.9, Math.sin(angle) * 0.6).multiplyScalar(
				0.3
			);
			const mesh = new THREE.Mesh(STAR_GEOMETRY, sparkleMaterials[i % sparkleMaterials.length]);
			mesh.visible = false;
			this.sparkles.push({
				mesh,
				from,
				drift,
				size: 0.2 + rng.next() * 0.12,
				delay: i * 0.06 + rng.next() * 0.05,
				t: 0
			});
			this.scene.add(mesh);
		}
	}

	/**
	 * Two poppers go off in the scene's lower corners, close to the camera,
	 * and throw bigger confetti up and in over the whole scene: nearer the
	 * camera, it reads big, and it frames both animals rather than covering
	 * one. With reduced motion, fewer pieces that rise less and never tumble.
	 */
	private poppers(): void {
		const rng = new Rng(++this.bursts * 104729);
		const reduced = motion.reduced;
		const gravity = reduced ? GRAVITY * 0.4 : GRAVITY;
		this.camera.updateMatrixWorld();
		const eye = this.camera.position;
		// Where the canvas's free part begins, above the panel, in the camera's -1..1.
		const bottom = -1 + (2 * battlePanelHeight(this.height)) / Math.max(1, this.height);
		const at = (x: number, y: number, distance: number) =>
			new THREE.Vector3(x, y, 0.5)
				.unproject(this.camera)
				.sub(eye)
				.normalize()
				.multiplyScalar(distance)
				.add(eye);
		for (const side of [-1, 1]) {
			const from = at(side * 0.84, bottom + 0.08, 3.2);
			// Up the sides, clear of the wild animal at the upper right: the left one
			// towards the open sky at the upper left, the right one almost straight up.
			const to = at(side < 0 ? -0.3 : 0.74, bottom + (1 - bottom) * 0.9, 3.8);
			const count = reduced ? 8 : 26;
			for (let i = 0; i < count; i++) {
				const mesh = new THREE.Mesh(
					POPPER_GEOMETRY,
					confettiMaterials[(i + (side > 0 ? 3 : 0)) % confettiMaterials.length]
				);
				mesh.position.copy(from);
				mesh.rotation.set(rng.next() * 6, rng.next() * 6, rng.next() * 6);
				// Aimed at the upper middle, fanned out: up enough to get there, across in about 0.7 s.
				const aim = to.clone().sub(from);
				aim.x += (rng.next() - 0.5) * 1.4;
				aim.z += (rng.next() - 0.5) * 1.0;
				const rise = Math.max(0.2, aim.y + (rng.next() - 0.3) * 0.5) * (reduced ? 0.5 : 1);
				const velocity = new THREE.Vector3(
					(aim.x / 0.7) * (reduced ? 0.6 : 1),
					Math.sqrt(2 * gravity * rise) * 1.25,
					(aim.z / 0.7) * (reduced ? 0.6 : 1)
				);
				this.confetti.push({
					mesh,
					velocity,
					spin: reduced
						? new THREE.Vector3()
						: new THREE.Vector3(rng.next() * 10 - 5, rng.next() * 10 - 5, rng.next() * 10 - 5),
					t: 0,
					life: POPPER_SECONDS * (0.8 + rng.next() * 0.4)
				});
				this.scene.add(mesh);
			}
		}
	}

	/**
	 * Match the canvas size. The image is shifted up by the panel's height so
	 * the scene is centred in the free area above it, and the field of view is
	 * widened by the same proportion so that area always spans `SCENE_FOV`.
	 * On a short screen the scene sits `SHORT_DROP` of the free area lower:
	 * its band is so thin that the sky over a tall wild animal would leave no
	 * room for the leash to arc, and the ground under the player's animal has
	 * room to spare.
	 */
	resize(width: number, height: number): void {
		this.width = width;
		this.height = height;
		const panel = battlePanelHeight(height);
		const free = Math.max(1, height - panel);
		const full = height + panel;
		const tan = Math.tan(THREE.MathUtils.degToRad(SCENE_FOV / 2)) * (full / free);
		const drop = height <= SHORT_SCREEN ? Math.round(SHORT_DROP * free) : 0;
		this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tan));
		this.camera.aspect = width / full;
		this.camera.setViewOffset(width, full, 0, panel - drop, width, height);
		this.camera.updateProjectionMatrix();
	}

	/** Advance idling and effects; `t` is seconds. */
	update(t: number): void {
		const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
		this.lastT = t;
		for (const side of ['player', 'opponent'] as const) {
			const figure = this.figures[side];
			if (!figure) continue;
			figure.position.copy(SPOT[side]);
			figure.position.y += this.feet[side];
			figure.rotation.z = 0;
			figure.rotation.x = 0;
			figure.rotation.y = (figure.userData.baseYaw as number | undefined) ?? figure.rotation.y;
			figure.scale.setScalar((figure.userData.baseScale as number | undefined) ?? 1);
		}
		for (const effect of this.effects) {
			effect.t += dt;
			const figure = this.figures[effect.side];
			if (figure) applyEffect(figure, effect);
		}
		this.effects = this.effects.filter(
			(e) => LASTING.includes(e.kind) || e.t < effectSeconds(e.kind)
		);
		// After the effects, so a tired animal is posed as far down as its faint has got.
		for (const side of ['player', 'opponent'] as const) {
			const figure = this.figures[side];
			if (figure) animateIdle(figure, t, this.camera);
		}

		// With reduced motion a miss's puff swells less and stays where it is.
		const calm = motion.reduced;
		for (const puff of this.puffs) {
			puff.t += dt;
			const p = Math.min(1, puff.t / PUFF_SECONDS);
			puff.group.scale.setScalar(Math.sin(p * Math.PI) * (calm ? 1 : 1.4) + 0.01);
			if (!calm) puff.group.position.y += dt * 0.4;
		}
		for (const puff of this.puffs) if (puff.t >= PUFF_SECONDS) this.scene.remove(puff.group);
		this.puffs = this.puffs.filter((p) => p.t < PUFF_SECONDS);

		for (const dust of this.dusts) {
			dust.t += dt;
			const p = (dust.t - dust.delay) / DUST_SECONDS;
			dust.group.visible = p > 0 && p < 1;
			if (!dust.group.visible) continue;
			// A ring rolling out along the ground from round the animal, rising a
			// little, puffing up and thinning away: it frames the animal, never hides it.
			// With reduced motion it rolls out and rises a third as far.
			const size = dust.group.userData.size as number;
			const travel = calm ? 0.35 : 1;
			const ring = size * (0.55 + p * 0.5 * travel);
			const ease = Math.sin(Math.min(1, p * 2) * (Math.PI / 2));
			for (const bit of dust.group.children) {
				const dir = bit.userData.dir as THREE.Vector3;
				bit.position.set(dir.x * ring, 0.05 + p * 0.12 * travel, dir.z * ring);
				bit.scale.setScalar(Math.max(0.01, (0.4 + 0.6 * ease) * Math.min(1.3, size)));
			}
			(dust.group.userData.material as THREE.Material).opacity = 0.8 * (1 - p);
		}
		for (const dust of this.dusts) {
			if (dust.t >= dust.delay + DUST_SECONDS) {
				this.scene.remove(dust.group);
				(dust.group.userData.material as THREE.Material).dispose();
			}
		}
		this.dusts = this.dusts.filter((d) => d.t < d.delay + DUST_SECONDS);

		const gravity = motion.reduced ? GRAVITY * 0.4 : GRAVITY;
		for (const piece of this.confetti) {
			piece.t += dt;
			piece.velocity.y -= gravity * dt;
			// Air slows it, so pieces flutter down instead of dropping like stones.
			piece.velocity.multiplyScalar(Math.max(0, 1 - 1.6 * dt));
			piece.mesh.position.addScaledVector(piece.velocity, dt);
			piece.mesh.position.y = Math.max(0.02, piece.mesh.position.y);
			piece.mesh.rotation.x += piece.spin.x * dt;
			piece.mesh.rotation.y += piece.spin.y * dt;
			piece.mesh.rotation.z += piece.spin.z * dt;
			// Shrinks away over the last third of its life.
			const left = (piece.life - piece.t) / (piece.life / 3);
			piece.mesh.scale.setScalar(Math.max(0.01, Math.min(1, left)));
		}
		for (const piece of this.confetti) if (piece.t >= piece.life) this.scene.remove(piece.mesh);
		this.confetti = this.confetti.filter((c) => c.t < c.life);

		// Each star faces the camera, pops up past its size, turns an eighth and
		// shrinks away as it drifts out; with reduced motion it twinkles in place.
		for (const s of this.sparkles) {
			s.t += dt;
			const p = (s.t - s.delay) / SPARKLE_SECONDS;
			s.mesh.visible = p > 0 && p < 1;
			if (!s.mesh.visible) continue;
			const reduced = motion.reduced;
			const grow = reduced
				? Math.sin(p * Math.PI)
				: p < 0.3
					? 0.2 + (p / 0.3) * 0.9
					: 1.1 - ((p - 0.3) / 0.7) * 0.8;
			s.mesh.position.copy(s.from).addScaledVector(s.drift, reduced ? 0 : p);
			s.mesh.quaternion.copy(this.camera.quaternion);
			s.mesh.rotateZ(reduced ? 0 : p * (Math.PI / 4));
			s.mesh.scale.setScalar(Math.max(0.001, grow * s.size));
		}
		for (const s of this.sparkles) {
			if (s.t >= s.delay + SPARKLE_SECONDS) this.scene.remove(s.mesh);
		}
		this.sparkles = this.sparkles.filter((s) => s.t < s.delay + SPARKLE_SECONDS);

		this.updateLeash(dt, t);
	}

	/** Where the loop settles on the wild animal, a little above its middle. */
	private leashHold(): THREE.Vector3 {
		const to = SPOT.opponent;
		return new THREE.Vector3(to.x, this.feet.opponent + this.heights.opponent * 0.55, to.z);
	}

	/** Big enough to go round the wild animal: a squirrel's loop is small, a bear's wide. */
	private loopSize(): number {
		return Math.max(0.8, Math.min(1.6, this.heights.opponent / 0.7));
	}

	/** Where the rope is held, for the picture as it is: `HAND`, or `HAND_SHORT` on a short screen. */
	private hand(): THREE.Vector3 {
		return this.height <= SHORT_SCREEN ? HAND_SHORT : HAND;
	}

	/** Where the loop leaves the hand, for the picture as it is: `RELEASE`, or `RELEASE_SHORT`. */
	private release(): THREE.Vector3 {
		return this.height <= SHORT_SCREEN ? RELEASE_SHORT : RELEASE;
	}

	/**
	 * How high the throw arcs over the straight line from where the loop
	 * leaves the hand to the animal, at its middle, with full motion:
	 * `LEASH_ARC`, or lower where the picture has no room for it, so that all
	 * the way the loop's top stays `LEASH_HEADROOM` below the top edge and the
	 * whole loop stays `LEASH_BOX_CLEARANCE` clear of the wild animal's status
	 * box. Measured through the camera as it is, against every point of this
	 * animal's loop: the camera sees little sky above the animals, and a
	 * taller animal is held higher in a bigger loop, so a deer's throw arcs
	 * lower than a frog's.
	 */
	private leashArc(): number {
		const camera = this.camera;
		camera.updateMatrixWorld();
		const eye = camera.getWorldPosition(new THREE.Vector3());
		const width = Math.max(1, this.width);
		const height = Math.max(1, this.height);
		// A line on the canvas, between two points given in the camera's -1..1, as
		// the plane through the eye that the camera sees on that line.
		const seen = (x0: number, y0: number, x1: number, y1: number) =>
			new THREE.Plane().setFromCoplanarPoints(
				eye,
				new THREE.Vector3(x0, y0, 0.5).unproject(camera),
				new THREE.Vector3(x1, y1, 0.5).unproject(camera)
			);
		/** The line across the canvas `y` CSS pixels below its top edge. */
		const across = (y: number) => seen(-1, 1 - (2 * y) / height, 1, 1 - (2 * y) / height);
		const free = Math.max(1, height - battlePanelHeight(height));
		// The loop keeps under the first line…
		const ceiling = across(free * LEASH_HEADROOM);
		// …and out of the corner above the second and left of the third: the box and its margin.
		const inset = safeArea();
		const box = wildStatusBox(height);
		const boxBottom = across(box.bottom + inset.top + LEASH_BOX_CLEARANCE);
		const boxRight = (2 * (box.right + inset.left + LEASH_BOX_CLEARANCE)) / width - 1;
		const boxSide = seen(boxRight, -1, boxRight, 1);
		// Signed so that the box's side of the line (where the canvas's left edge is) is negative.
		if (boxSide.distanceToPoint(new THREE.Vector3(-1, 0, 0.5).unproject(camera)) > 0) {
			boxSide.negate();
		}
		// How a point's distance from that line changes for each tile it rises: the
		// camera looks a little down, so uprights lean on the canvas.
		const drift = boxSide.normal.y;
		/** How far `point` can rise before it meets `plane`, a line across the canvas. */
		const rise = (plane: THREE.Plane, point: THREE.Vector3) =>
			-(plane.normal.x * point.x + plane.normal.z * point.z + plane.constant) / plane.normal.y -
			point.y;
		// The loop's points as it flies (tilted and sized, never turned), around its middle.
		const shape = new THREE.Matrix4().compose(
			new THREE.Vector3(),
			new THREE.Quaternion().setFromEuler(new THREE.Euler(LOOP_TILT, 0, 0)),
			new THREE.Vector3().setScalar(this.loopSize())
		);
		const rim = LOOP_GEOMETRY.getAttribute('position');
		const points = Array.from({ length: rim.count }, (_, i) =>
			new THREE.Vector3().fromBufferAttribute(rim, i).applyMatrix4(shape)
		);
		const hold = this.leashHold();
		const release = this.release();
		const at = new THREE.Vector3();
		const point = new THREE.Vector3();
		let arc = LEASH_ARC;
		for (let i = 1; i < LEASH_SAMPLES; i++) {
			const p = i / LEASH_SAMPLES;
			at.lerpVectors(release, hold, p);
			// How far this point of the straight throw can rise before a point of the loop meets a line.
			let room = Infinity;
			for (const q of points) {
				point.addVectors(at, q);
				room = Math.min(room, rise(ceiling, point));
				// Into the box's corner: up past its bottom line while beside the box, or
				// drifting in over the box as it rises on.
				const past = Math.max(0, rise(boxBottom, point));
				const side = boxSide.distanceToPoint(point);
				if (side + drift * past < 0) room = Math.min(room, past);
				else if (drift < 0) room = Math.min(room, -side / drift);
			}
			arc = Math.min(arc, room / Math.sin(p * Math.PI));
		}
		return Number.isFinite(arc) ? Math.max(0, arc) : 0;
	}

	private updateLeash(dt: number, t: number): void {
		const leash = this.leash;
		if (!leash) return;
		leash.t += dt;
		const to = SPOT.opponent;
		const holdY = this.leashHold().y;
		const size = this.loopSize();
		const { loop, rope } = leash;
		loop.scale.setScalar(size);
		loop.rotation.set(LOOP_TILT, 0, 0);
		// With reduced motion the throw arcs a third as high, and a loop that pops off rises a third as far.
		const calm = motion.reduced ? 0.35 : 1;
		if (leash.state === 'flying') {
			const p = Math.min(1, leash.t / LEASH_FLIGHT_SECONDS);
			// Measured each frame: a resize can change the picture mid-throw.
			const lift = p < 1 ? Math.sin(p * Math.PI) * this.leashArc() * calm : 0;
			const from = this.release();
			loop.position.set(
				from.x + (to.x - from.x) * p,
				from.y + (holdY - from.y) * p + lift,
				from.z + (to.z - from.z) * p
			);
			// Settled on the animal: it wobbles while everyone waits, a swing each
			// way every 0.35 s (the pace of the `wobble` cue's ticks).
			if (p >= 1) loop.rotation.z = Math.sin(t * 9) * (motion.reduced ? 0.1 : 0.3);
		} else if (leash.state === 'caught') {
			// Snug on the animal, and up with it as it hops for joy.
			const standing = to.y + this.feet.opponent;
			const lift = (this.figures.opponent?.position.y ?? standing) - standing;
			loop.position.set(to.x, holdY + lift, to.z);
			loop.scale.setScalar(size * (1 - 0.15 * Math.min(1, leash.t / 0.2)));
		} else {
			const p = Math.min(1, leash.t / LEASH_POP_SECONDS);
			loop.position.set(to.x, holdY + p * 0.8 * calm, to.z);
			loop.scale.setScalar(Math.max(0.001, size * (1 - p)));
			if (p >= 1) {
				this.dropLeash();
				return;
			}
		}
		// The rope runs from the hand to the loop.
		const hand = this.hand();
		const span = loop.position.clone().sub(hand);
		rope.position.copy(hand);
		rope.scale.set(1, span.length(), 1);
		rope.quaternion.setFromUnitVectors(UP, span.normalize());
	}

	private dropLeash(): void {
		if (this.leash) this.scene.remove(this.leash.loop, this.leash.rope);
		this.leash = null;
	}
}

function effectSeconds(kind: EffectKind): number {
	switch (kind) {
		case 'lunge':
			return LUNGE_SECONDS;
		case 'shake':
			return SHAKE_SECONDS;
		case 'hop':
			return HOP_SECONDS;
		case 'faint':
			return FAINT_SECONDS;
		case 'recall':
			return RECALL_SECONDS;
		case 'appear':
			return APPEAR_SECONDS;
		case 'cheer':
			return CHEER_SECONDS;
	}
}

/**
 * Offset a figure (already reset to its spot) for one running effect. With
 * reduced motion the lunge, shake and hop travel about a third as far; the
 * faint, the recall and the appearance keep their shape, since they say
 * what happened, but the recall rises a third as high and the appearance
 * grows to its size without bouncing past it.
 */
function applyEffect(figure: THREE.Group, effect: Effect): void {
	const p = Math.min(1, effect.t / effectSeconds(effect.kind));
	const k = motion.reduced ? 0.35 : 1;
	switch (effect.kind) {
		case 'lunge': {
			const target = SPOT[effect.side === 'player' ? 'opponent' : 'player'];
			const reach = Math.sin(p * Math.PI) * 0.45 * k;
			const dx = target.x - figure.position.x;
			const dz = target.z - figure.position.z;
			const len = Math.hypot(dx, dz) || 1;
			figure.position.x += (dx / len) * reach;
			figure.position.z += (dz / len) * reach;
			figure.position.y += Math.sin(p * Math.PI) * 0.12 * k;
			break;
		}
		case 'shake':
			figure.position.x += Math.sin(p * Math.PI * 6) * 0.12 * (1 - p) * k;
			break;
		case 'hop':
			figure.position.y += Math.abs(Math.sin(p * Math.PI * 2)) * 0.25 * (1 - p * 0.5) * k;
			break;
		case 'faint':
			// Lies down (`animateIdle` poses it): slowly at first, then settling, and stays down.
			figure.userData.rest = p * p * (3 - 2 * p);
			break;
		case 'recall':
			figure.scale.multiplyScalar(recallScale(p));
			figure.position.y += Math.sin(p * Math.PI) * 0.15 * k;
			break;
		case 'appear':
			figure.scale.multiplyScalar(appearScale(p, motion.reduced));
			break;
		case 'cheer': {
			// Two hops for joy, the first higher and with a whole turn; with less
			// motion, one small hop and no turn.
			if (motion.reduced) {
				figure.position.y += Math.sin(Math.min(1, p * 2) * Math.PI) * 0.1;
				break;
			}
			const first = p < 0.5;
			const q = first ? p / 0.5 : (p - 0.5) / 0.5;
			figure.position.y += Math.sin(q * Math.PI) * (first ? 0.4 : 0.22);
			if (first) figure.rotation.y += smoothstep(q) * Math.PI * 2;
			break;
		}
	}
}

/** Whether the ground point (x, z) is within `r` of the line from under the camera to `spot`. */
function nearSightLine(x: number, z: number, spot: THREE.Vector3, r: number): boolean {
	const ax = CAMERA_POSITION.x;
	const az = CAMERA_POSITION.z;
	const dx = spot.x - ax;
	const dz = spot.z - az;
	const along = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
	return Math.hypot(x - (ax + dx * along), z - (az + dz * along)) < r;
}

/**
 * The biome's scenery, kept clear of both figures and of the line between
 * them, in the biome's own colours (`BIOME_LOOK`): tall grass everywhere
 * (reeds at the river), plus trees in the forest, boulders on the mountain,
 * the biggest capped with snow, and a strip of water behind a river bank. Out
 * on the sea, the deep water's surface over the animals' feet, a few crests of
 * waves, and a shore far behind. A fixed scatter, so every battle in a biome
 * looks the same.
 */
function buildBackdrop(biome: Biome): THREE.Group {
	const group = new THREE.Group();
	const rng = new Rng(7);
	const look = BIOME_LOOK[biome];
	const tuftMaterial = lambert(look.blade);
	const canopyMaterials = CANOPY.map((hex) => lambert(hex));
	const clear = (x: number, z: number, r: number) =>
		Object.values(SPOT).every((s) => Math.hypot(x - s.x, z - s.z) > r);

	if (biome === 'sea') {
		buildSea(group, rng, tuftMaterial, clear);
		return group;
	}

	for (let i = 0; i < 40; i++) {
		const angle = rng.next() * Math.PI * 2;
		const radius = 1.4 + rng.next() * 6;
		const x = Math.cos(angle) * radius;
		const z = Math.sin(angle) * radius - 1;
		// Nothing between the camera and the player's animal: a tuft that close
		// would fill the screen and show through the bottom panel.
		if (z > SPOT.player.z + 0.6 || !clear(x, z, 0.9)) continue;
		// Reeds stand taller than grass: none on the line from the camera to either animal.
		if (biome === 'river' && Object.values(SPOT).some((s) => nearSightLine(x, z, s, 0.8))) {
			continue;
		}
		const tuft = new THREE.Group();
		for (let b = 0; b < 3; b++) {
			const bx = rng.next() * 0.5 - 0.25;
			const bz = rng.next() * 0.5 - 0.25;
			if (biome === 'river') {
				// A reed: a stalk a little taller than the grass, most with a brown head.
				if (b === 2) continue;
				const height = 0.3 + rng.next() * 0.14;
				const stalk = new THREE.Mesh(PROP_GEOMETRY.reed, tuftMaterial);
				stalk.scale.set(1, height, 1);
				stalk.position.set(bx, height / 2, bz);
				stalk.castShadow = true;
				tuft.add(stalk);
				if (b === 0) {
					const head = new THREE.Mesh(PROP_GEOMETRY.cattail, cattailMaterial);
					head.position.set(bx, height + 0.04, bz);
					tuft.add(head);
				}
			} else {
				const blade = new THREE.Mesh(PROP_GEOMETRY.blade, tuftMaterial);
				blade.position.set(bx, 0.17, bz);
				blade.castShadow = true;
				tuft.add(blade);
			}
		}
		tuft.position.set(x, 0, z);
		group.add(tuft);
	}

	if (biome === 'forest') {
		for (const [x, z, s] of [
			[-4.2, -3.5, 1.3],
			[-2.6, -6.5, 1.6],
			[0.2, -7.5, 1.4],
			[3.4, -5.8, 1.7],
			[5.2, -3.2, 1.2],
			[-5.8, -1.0, 1.5],
			[6.8, -7.0, 1.5]
		] as const) {
			const tree = new THREE.Group();
			const trunk = new THREE.Mesh(PROP_GEOMETRY.trunk, trunkMaterial);
			trunk.position.y = 0.25;
			const canopy = new THREE.Mesh(
				PROP_GEOMETRY.canopy,
				canopyMaterials[Math.floor(rng.next() * canopyMaterials.length)]
			);
			canopy.position.y = 0.95;
			trunk.castShadow = canopy.castShadow = true;
			tree.add(trunk, canopy);
			tree.scale.setScalar(s);
			tree.position.set(x, 0, z);
			group.add(tree);
		}
	} else if (biome === 'mountain') {
		for (const [x, z, r] of [
			[-3.8, -3.0, 0.6],
			[-1.8, -6.0, 0.9],
			[2.8, -5.0, 0.8],
			[4.6, -2.4, 0.5],
			[-5.2, -0.4, 0.7],
			[6.0, -6.5, 1.1]
		] as const) {
			const rock = new THREE.Mesh(PROP_GEOMETRY.rock, boulderMaterial);
			rock.scale.setScalar(r);
			rock.position.set(x, r * 0.6, z);
			// The big ones stand upright under a cap of snow, as on the world's peaks.
			const peak = r >= 0.8;
			rock.rotation.set(peak ? 0 : rng.next(), rng.next(), peak ? 0 : rng.next());
			rock.castShadow = true;
			group.add(rock);
			if (peak) {
				const cap = new THREE.Mesh(PROP_GEOMETRY.rock, snowMaterial);
				cap.scale.set(r * 0.82, r * 0.42, r * 0.82);
				cap.position.set(x, r * 0.6 + r * 0.72, z);
				cap.rotation.y = rock.rotation.y;
				group.add(cap);
			}
		}
	} else if (biome === 'river') {
		const water = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 6), waterMaterial);
		water.position.set(0, -0.08, -8);
		water.receiveShadow = true;
		group.add(water);
	}
	return group;
}

/**
 * The sea's scenery: the deep water's surface at `SEA_WATERLINE`, over the
 * ground and the animals' feet, crests of waves in the shallows' paler blue,
 * kept off the line from the camera to either animal, and far behind, a sandy
 * shore with the meadow's green beyond it.
 */
function buildSea(
	group: THREE.Group,
	rng: Rng,
	crestMaterial: THREE.Material,
	clear: (x: number, z: number, r: number) => boolean
): void {
	const surface = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 0.1, 24), deepWaterMaterial);
	surface.position.y = SEA_WATERLINE - 0.05;
	surface.receiveShadow = true;
	group.add(surface);
	for (let i = 0; i < 26; i++) {
		const angle = rng.next() * Math.PI * 2;
		const radius = 1.4 + rng.next() * 6;
		const x = Math.cos(angle) * radius;
		const z = Math.sin(angle) * radius - 1;
		if (z > SPOT.player.z + 0.6 || !clear(x, z, 1)) continue;
		if (Object.values(SPOT).some((s) => nearSightLine(x, z, s, 0.6))) continue;
		const crest = new THREE.Mesh(PROP_GEOMETRY.ball, crestMaterial);
		const size = 0.12 + rng.next() * 0.1;
		crest.scale.set(size * 2.2, size * 0.35, size);
		crest.rotation.y = rng.next() * 0.6 - 0.3;
		crest.position.set(x, SEA_WATERLINE, z);
		group.add(crest);
	}
	const sand = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 3), sandMaterial);
	sand.position.set(0, 0.1, -10.5);
	sand.receiveShadow = true;
	const grass = new THREE.Mesh(new THREE.BoxGeometry(40, 0.6, 6), shoreGrassMaterial);
	grass.position.set(0, 0.2, -15);
	group.add(sand, grass);
}
