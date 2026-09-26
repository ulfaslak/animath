import { Rng, type Biome } from '@mathgame/engine';
import * as THREE from 'three';
import { motion } from '../motion';
import { animateIdle, buildAnimalMesh } from './animals';
import { COLORS, CONFETTI_COLORS, TILE_COLORS } from './palette';
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
 * shakes, a miss puffs, a knocked-out animal tips over into a little cloud of
 * dust and stays down, the leash flies, wobbles, then holds (with a burst of
 * confetti) or pops off. With reduced motion (`motion.ts`) every movement is
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

/**
 * Height in CSS pixels of the battle screen's bottom panel for a canvas
 * `height` pixels tall. Mirrors `--battle-panel` in `styles.css`
 * (`clamp(260px, 40vh, 360px)`); change both together.
 */
export function battlePanelHeight(height: number): number {
	return Math.min(360, Math.max(260, 0.4 * height));
}

const GROUND: Record<Biome, number> = {
	meadow: TILE_COLORS.grass,
	forest: TILE_COLORS.grass,
	river: TILE_COLORS.sand,
	mountain: TILE_COLORS.rock
};

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
/** The dust rises as a fainting animal touches down, near the end of its fall. */
const DUST_DELAY_SECONDS = FAINT_SECONDS * 0.75;
const DUST_SECONDS = 0.7;
/** A confetti piece's life; each lives a little longer or shorter so they don't vanish at once. */
const CONFETTI_SECONDS = 1.3;
const GRAVITY = 6;

type EffectKind = 'lunge' | 'shake' | 'faint' | 'hop' | 'recall' | 'appear';
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
interface Leash {
	loop: THREE.Mesh;
	rope: THREE.Mesh;
	t: number;
	state: 'flying' | 'caught' | 'broke';
}
/** Where the leash comes from: the trainer's hand, just off the lower-left edge. */
const HAND = new THREE.Vector3(-2.4, 0.9, 3.4);
const UP = new THREE.Vector3(0, 1, 0);

function lambert(hex: number): THREE.MeshLambertMaterial {
	return new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
}
const tuftMaterial = lambert(0x4fa83d);
const trunkMaterial = lambert(COLORS.trunk);
const canopyMaterials = [lambert(COLORS.canopy), lambert(COLORS.canopyLight)];
const boulderMaterial = lambert(COLORS.rock);
const waterMaterial = lambert(TILE_COLORS.water);
const puffMaterial = lambert(COLORS.white);
const dustMaterial = lambert(COLORS.dust);
const leashMaterial = lambert(COLORS.fire);
const confettiMaterials = CONFETTI_COLORS.map((hex) => {
	const material = lambert(hex);
	material.side = THREE.DoubleSide; // a flat piece shows from both faces as it tumbles
	return material;
});
const PUFF_GEOMETRY = new THREE.IcosahedronGeometry(0.12, 0);
/** Rounder than a miss's puff, so a cloud of it never reads as a heap of pebbles. */
const DUST_GEOMETRY = new THREE.IcosahedronGeometry(0.08, 1);
const CONFETTI_GEOMETRY = new THREE.PlaneGeometry(0.09, 0.06);
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
	/** Each figure's resting height above the ground (for effects aimed at its middle). */
	private heights: Record<BattleSide, number> = { player: 0.5, opponent: 0.5 };
	private effects: Effect[] = [];
	private puffs: Puff[] = [];
	private dusts: Dust[] = [];
	private confetti: ConfettiPiece[] = [];
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
			disposeGeometries(figure);
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
		this.dropLeash();
		this.effects = [];
	}

	/** Put a species' figure on one side, replacing (and freeing) whatever stood there. */
	setFigure(side: BattleSide, speciesId: string): void {
		const old = this.figures[side];
		if (old) {
			this.scene.remove(old);
			disposeGeometries(old);
		}
		const figure = buildAnimalMesh(speciesId);
		const height = new THREE.Box3().setFromObject(figure).getSize(new THREE.Vector3()).y;
		const scale = Math.min(1.6, Math.max(0.8, Math.sqrt(1 / height)));
		figure.scale.setScalar(scale);
		figure.userData.baseScale = scale;
		this.heights[side] = height * scale;
		const other = SPOT[side === 'player' ? 'opponent' : 'player'];
		// Face the other animal: the player's from behind, the wild one three-quarters on.
		figure.rotation.y = Math.atan2(other.x - SPOT[side].x, other.z - SPOT[side].z);
		figure.userData.idlePhase = side === 'player' ? 0 : 1.3;
		figure.position.copy(SPOT[side]);
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

	/** Tip the figure over into a puff of dust; it stays down until `setFigure` replaces it. */
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
		group.position.set(spot.x + 0.35, this.heights[side] * 0.6, spot.z + 0.3);
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
		// Round its middle once it lies down: `faint` tips it sideways about its
		// own z (see `applyEffect`), so its head ends up that way from its feet.
		const spot = SPOT[side];
		const tip = new THREE.Euler(0, this.figures[side]?.rotation.y ?? 0, faintTilt(side));
		const head = new THREE.Vector3(0, 1, 0).applyEuler(tip);
		const size = this.heights[side];
		group.position.set(spot.x + head.x * size * 0.45, 0, spot.z + head.z * size * 0.45);
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
		const from = new THREE.Vector3(spot.x, this.heights[side] * 0.8, spot.z);
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
		p.y = this.heights[side] * 0.5;
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

	/** How the throw ended: the loop holds (and the animal hops), or it pops off. */
	leashResult(success: boolean): void {
		if (!this.leash) return;
		this.leash.state = success ? 'caught' : 'broke';
		this.leash.t = 0;
		if (success) {
			this.hop('opponent');
			this.celebrate('opponent');
		} else this.shake('opponent');
	}

	/**
	 * Match the canvas size. The image is shifted up by the panel's height so
	 * the scene is centred in the free area above it, and the field of view is
	 * widened by the same proportion so that area always spans `SCENE_FOV`.
	 */
	resize(width: number, height: number): void {
		this.width = width;
		this.height = height;
		const panel = battlePanelHeight(height);
		const free = Math.max(1, height - panel);
		const full = height + panel;
		const tan = Math.tan(THREE.MathUtils.degToRad(SCENE_FOV / 2)) * (full / free);
		this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tan));
		this.camera.aspect = width / full;
		this.camera.setViewOffset(width, full, 0, panel, width, height);
		this.camera.updateProjectionMatrix();
	}

	/** Advance idling and effects; `t` is seconds. */
	update(t: number): void {
		const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
		this.lastT = t;
		for (const side of ['player', 'opponent'] as const) {
			const figure = this.figures[side];
			if (!figure) continue;
			animateIdle(figure, t);
			figure.position.copy(SPOT[side]);
			figure.rotation.z = 0;
			figure.rotation.x = 0;
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

		for (const puff of this.puffs) {
			puff.t += dt;
			const p = Math.min(1, puff.t / PUFF_SECONDS);
			puff.group.scale.setScalar(Math.sin(p * Math.PI) * 1.4 + 0.01);
			puff.group.position.y += dt * 0.4;
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
			const size = dust.group.userData.size as number;
			const ring = size * (0.55 + p * 0.5);
			const ease = Math.sin(Math.min(1, p * 2) * (Math.PI / 2));
			for (const bit of dust.group.children) {
				const dir = bit.userData.dir as THREE.Vector3;
				bit.position.set(dir.x * ring, 0.05 + p * 0.12, dir.z * ring);
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

		this.updateLeash(dt, t);
	}

	private updateLeash(dt: number, t: number): void {
		const leash = this.leash;
		if (!leash) return;
		leash.t += dt;
		const to = SPOT.opponent;
		const holdY = this.heights.opponent * 0.55;
		// Big enough to go round the animal: a squirrel's loop is small, a bear's wide.
		const size = Math.max(0.8, Math.min(1.6, this.heights.opponent / 0.7));
		const { loop, rope } = leash;
		loop.scale.setScalar(size);
		// Tilted towards the camera so the loop reads as a ring, not a line.
		loop.rotation.set(Math.PI / 2 - 0.6, 0, 0);
		if (leash.state === 'flying') {
			const p = Math.min(1, leash.t / LEASH_FLIGHT_SECONDS);
			loop.position.set(
				HAND.x + (to.x - HAND.x) * p,
				HAND.y + (holdY - HAND.y) * p + Math.sin(p * Math.PI) * 1.0,
				HAND.z + (to.z - HAND.z) * p
			);
			// Settled on the animal: it wobbles while everyone waits, a swing each
			// way every 0.35 s (the pace of the `wobble` cue's ticks).
			if (p >= 1) loop.rotation.z = Math.sin(t * 9) * (motion.reduced ? 0.1 : 0.3);
		} else if (leash.state === 'caught') {
			loop.position.set(to.x, holdY, to.z);
			loop.scale.setScalar(size * (1 - 0.15 * Math.min(1, leash.t / 0.2)));
		} else {
			const p = Math.min(1, leash.t / LEASH_POP_SECONDS);
			loop.position.set(to.x, holdY + p * 0.8, to.z);
			loop.scale.setScalar(Math.max(0.001, size * (1 - p)));
			if (p >= 1) {
				this.dropLeash();
				return;
			}
		}
		// The rope runs from the hand to the loop.
		const span = loop.position.clone().sub(HAND);
		rope.position.copy(HAND);
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
	}
}

/** How far over a tired animal tips, about its own z: away from the other one. */
function faintTilt(side: BattleSide): number {
	return (side === 'player' ? -1 : 1) * (Math.PI / 2);
}

/**
 * Offset a figure (already reset to its spot) for one running effect. With
 * reduced motion the lunge, shake and hop travel about a third as far; the
 * faint, the recall and the appearance keep their shape, since they say
 * what happened.
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
		case 'faint': {
			const ease = p * p;
			figure.rotation.z = faintTilt(effect.side) * ease;
			figure.position.y -= ease * 0.05;
			break;
		}
		case 'recall':
			// Shrinks to nothing; a sliver of scale keeps the matrix invertible.
			figure.scale.multiplyScalar(Math.max(0.001, 1 - p * p));
			figure.position.y += Math.sin(p * Math.PI) * 0.15;
			break;
		case 'appear': {
			// Grows past its size and settles back (an ease-out with a little overshoot).
			const grow = 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2);
			figure.scale.multiplyScalar(Math.max(0.001, grow));
			break;
		}
	}
}

/** Free a figure's geometries. Materials are shared across figures (animals.ts caches them). */
function disposeGeometries(root: THREE.Object3D): void {
	root.traverse((o) => {
		if (o instanceof THREE.Mesh) o.geometry.dispose();
	});
}

/**
 * The biome's scenery, kept clear of both figures and of the line between
 * them: tall grass everywhere, plus trees in the forest, boulders on the
 * mountain and a strip of water behind a river bank. A fixed scatter, so
 * every battle in a biome looks the same.
 */
function buildBackdrop(biome: Biome): THREE.Group {
	const group = new THREE.Group();
	const rng = new Rng(7);
	const clear = (x: number, z: number, r: number) =>
		Object.values(SPOT).every((s) => Math.hypot(x - s.x, z - s.z) > r);

	for (let i = 0; i < 40; i++) {
		const angle = rng.next() * Math.PI * 2;
		const radius = 1.4 + rng.next() * 6;
		const x = Math.cos(angle) * radius;
		const z = Math.sin(angle) * radius - 1;
		// Nothing between the camera and the player's animal: a tuft that close
		// would fill the screen and show through the bottom panel.
		if (z > SPOT.player.z + 0.6 || !clear(x, z, 0.9)) continue;
		const tuft = new THREE.Group();
		for (let b = 0; b < 3; b++) {
			const blade = new THREE.Mesh(PROP_GEOMETRY.blade, tuftMaterial);
			blade.position.set(rng.next() * 0.5 - 0.25, 0.17, rng.next() * 0.5 - 0.25);
			blade.castShadow = true;
			tuft.add(blade);
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
				canopyMaterials[Math.floor(rng.next() * 2)]
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
			rock.rotation.set(rng.next(), rng.next(), rng.next());
			rock.castShadow = true;
			group.add(rock);
		}
	} else if (biome === 'river') {
		const water = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 6), waterMaterial);
		water.position.set(0, -0.08, -8);
		water.receiveShadow = true;
		group.add(water);
	}
	return group;
}
