import { Rng, type Biome } from '@mathgame/engine';
import * as THREE from 'three';
import { animateIdle, buildAnimalMesh } from './animals';
import { COLORS, TILE_COLORS } from './palette';

/**
 * The battle scene: a patch of ground in the biome's colour with a few tufts
 * of the tall grass the battle started in, the player's animal seen from
 * behind at bottom-left, the wild animal facing it at top-right, and a low
 * perspective camera just behind the player's animal — the Game Boy framing.
 *
 * Units are tiles like the world; figures come from `animals.ts` and idle the
 * same way. Feedback is a transient on the figure and nothing else: a hit
 * shakes it, a faint tips it over and leaves it down.
 */
export type BattleSide = 'player' | 'opponent';

const GROUND: Record<Biome, number> = {
	meadow: TILE_COLORS.grass,
	forest: COLORS.canopyLight,
	river: TILE_COLORS.sand,
	mountain: TILE_COLORS.rock
};

const SPOT: Record<BattleSide, THREE.Vector3> = {
	player: new THREE.Vector3(-1.0, 0, 1.2),
	opponent: new THREE.Vector3(1.1, 0, -1.7)
};

const SHAKE_SECONDS = 0.4;
const FAINT_SECONDS = 0.6;

interface Effect {
	side: BattleSide;
	kind: 'shake' | 'faint';
	t: number;
}

const groundMaterials = new Map<number, THREE.MeshLambertMaterial>();
const tuftMaterial = new THREE.MeshLambertMaterial({ color: 0x4fa83d, flatShading: true });

export class BattleScene {
	readonly scene = new THREE.Scene();
	readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
	private figures: Record<BattleSide, THREE.Group | null> = { player: null, opponent: null };
	private effects: Effect[] = [];
	private lastT = -1;

	constructor(biome: Biome) {
		this.scene.background = new THREE.Color(COLORS.sky);
		this.scene.fog = new THREE.Fog(COLORS.sky, 14, 30);
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

		let groundMat = groundMaterials.get(GROUND[biome]);
		if (!groundMat) {
			groundMat = new THREE.MeshLambertMaterial({ color: GROUND[biome], flatShading: true });
			groundMaterials.set(GROUND[biome], groundMat);
		}
		const ground = new THREE.Mesh(new THREE.CylinderGeometry(9, 8.5, 0.6, 14), groundMat);
		ground.position.y = -0.3;
		ground.receiveShadow = true;
		this.scene.add(ground);

		// Tufts of tall grass around the figures, in a fixed scatter.
		const rng = new Rng(7);
		for (let i = 0; i < 26; i++) {
			const angle = rng.next() * Math.PI * 2;
			const radius = 1.6 + rng.next() * 4.5;
			const x = Math.cos(angle) * radius;
			const z = Math.sin(angle) * radius;
			if (Math.abs(x - SPOT.player.x) < 0.7 && Math.abs(z - SPOT.player.z) < 0.7) continue;
			if (Math.abs(x - SPOT.opponent.x) < 0.7 && Math.abs(z - SPOT.opponent.z) < 0.7) continue;
			const tuft = new THREE.Group();
			for (let b = 0; b < 3; b++) {
				const blade = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 3), tuftMaterial);
				blade.position.set(rng.next() * 0.5 - 0.25, 0.17, rng.next() * 0.5 - 0.25);
				blade.castShadow = true;
				tuft.add(blade);
			}
			tuft.position.set(x, 0, z);
			this.scene.add(tuft);
		}

		this.camera.position.set(-1.7, 1.5, 4.6);
		this.camera.lookAt(0.4, 0.55, -0.8);
	}

	/** Put a species' figure on one side, replacing whatever stood there. */
	setFigure(side: BattleSide, speciesId: string): void {
		const old = this.figures[side];
		if (old) this.scene.remove(old);
		const figure = buildAnimalMesh(speciesId);
		figure.position.copy(SPOT[side]);
		// The player's animal faces away from the camera, toward the opponent.
		figure.rotation.y = side === 'player' ? Math.PI : 0;
		figure.userData.idlePhase = side === 'player' ? 0 : 1.3;
		this.figures[side] = figure;
		this.scene.add(figure);
		this.effects = this.effects.filter((e) => e.side !== side);
	}

	shake(side: BattleSide): void {
		this.effects.push({ side, kind: 'shake', t: 0 });
	}

	/** Tip the figure over; it stays down until `setFigure` replaces it. */
	faint(side: BattleSide): void {
		this.effects.push({ side, kind: 'faint', t: 0 });
	}

	resize(aspect: number): void {
		this.camera.aspect = aspect;
		this.camera.updateProjectionMatrix();
	}

	/** Advance idling and effects; `t` is seconds. */
	update(t: number): void {
		const dt = this.lastT < 0 ? 0 : Math.min(0.1, t - this.lastT);
		this.lastT = t;
		for (const side of ['player', 'opponent'] as const) {
			const figure = this.figures[side];
			if (!figure) continue;
			animateIdle(figure, t);
			figure.position.copy(SPOT[side]);
			figure.rotation.z = 0;
		}
		for (const effect of this.effects) {
			effect.t += dt;
			const figure = this.figures[effect.side];
			if (!figure) continue;
			if (effect.kind === 'shake') {
				const p = Math.min(1, effect.t / SHAKE_SECONDS);
				figure.position.x += Math.sin(p * Math.PI * 6) * 0.12 * (1 - p);
			} else {
				const p = Math.min(1, effect.t / FAINT_SECONDS);
				const ease = p * p;
				figure.rotation.z = (effect.side === 'player' ? -1 : 1) * ease * (Math.PI / 2);
				figure.position.y -= ease * 0.05;
			}
		}
		this.effects = this.effects.filter((e) => e.kind === 'faint' || e.t < SHAKE_SECONDS);
	}
}
