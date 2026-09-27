import * as THREE from 'three';
import { COLORS } from './palette';

/**
 * A poof ([[UI_SPEC]] § Explore mode, "Playing together"): a little cloud of
 * dust where a trainer turns up out of nowhere, the player going to a friend
 * with Go to or a friend arriving the same way. A ring of soft puffs in the
 * dust's warm off-white (never grey smoke) bursts out round the tile at knee
 * height, swells, rises a little and fades, in `POOF_SECONDS`. With reduced
 * motion, half as many puffs swell and fade where they are.
 *
 * The puffs share one shape, built once and never freed; each poof has its
 * own material, for its fade, and frees it when it is over, so a poof leaves
 * nothing behind ([[INVARIANTS]] § Rendering).
 */
export const POOF_SECONDS = 0.7;
const PUFFS = 8;
const CALM_PUFFS = 4;
/** How far out from the middle of the tile the puffs start, and how far they travel. */
const START_RADIUS = 0.18;
const TRAVEL = 0.42;
/** How high over the ground they start, and how much they rise. */
const START_HEIGHT = 0.18;
const RISE = 0.28;

/** The puff's shape: a low-poly ball, one for every puff of every poof. */
export const PUFF_GEOMETRY = new THREE.IcosahedronGeometry(0.15, 0);

interface Poof {
	group: THREE.Group;
	material: THREE.MeshLambertMaterial;
	/**
	 * When it started: its first frame drawn, not when it was asked for. A go
	 * to a friend far away builds the world round them before the next frame
	 * (a moment, on a slow machine), and the poof plays whole after it.
	 */
	start: number | null;
	calm: boolean;
}

export class Poofs {
	private active: Poof[] = [];

	constructor(private parent: THREE.Object3D) {}

	/** How many poofs are playing: for tests. */
	get playing(): number {
		return this.active.length;
	}

	/** A poof at `at` (the ground under a trainer's feet), from the next frame on. */
	play(at: THREE.Vector3, calm: boolean): void {
		const material = new THREE.MeshLambertMaterial({
			color: COLORS.dust,
			flatShading: true,
			transparent: true,
			opacity: 0.95,
			depthWrite: false
		});
		const group = new THREE.Group();
		group.position.copy(at);
		const count = calm ? CALM_PUFFS : PUFFS;
		for (let i = 0; i < count; i++) {
			const puff = new THREE.Mesh(PUFF_GEOMETRY, material);
			const turn = (i / count) * Math.PI * 2 + (calm ? Math.PI / 4 : 0);
			puff.userData.dir = new THREE.Vector2(Math.cos(turn), Math.sin(turn));
			group.add(puff);
		}
		this.parent.add(group);
		const poof: Poof = { group, material, start: null, calm };
		this.active.push(poof);
		this.pose(poof, 0);
	}

	/** Move every poof on to `now` (seconds); the ones that are over go, and free their material. */
	update(now: number): void {
		this.active = this.active.filter((poof) => {
			poof.start ??= now;
			const p = (now - poof.start) / POOF_SECONDS;
			if (p >= 1) {
				this.drop(poof);
				return false;
			}
			this.pose(poof, Math.max(0, p));
			return true;
		});
	}

	/** Every poof goes at once (a new world, the title). */
	clear(): void {
		for (const poof of this.active) this.drop(poof);
		this.active = [];
	}

	private pose(poof: Poof, p: number): void {
		const out = poof.calm ? 0 : 1 - Math.pow(1 - p, 2); // bursting out, slowing down
		const swell = poof.calm
			? 0.6 + 0.5 * p
			: 0.5 + 0.9 * Math.sin(Math.min(1, p * 1.4) * Math.PI * 0.6);
		for (const puff of poof.group.children) {
			const dir = puff.userData.dir as THREE.Vector2;
			const r = START_RADIUS + TRAVEL * out;
			puff.position.set(dir.x * r, START_HEIGHT + RISE * (poof.calm ? 0 : p), dir.y * r);
			puff.scale.setScalar(Math.max(0.001, swell));
		}
		// Fades over the second half: it is a burst first, then a wisp.
		poof.material.opacity = 0.95 * Math.min(1, Math.max(0, (1 - p) * 2));
	}

	private drop(poof: Poof): void {
		poof.group.removeFromParent();
		poof.material.dispose();
	}
}
