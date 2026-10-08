import type { GridPos } from '@mathgame/engine';
import * as THREE from 'three';
import { COLORS } from './palette';
import { BOX_GEOMETRY, ICE_TOP } from './tiles';

/**
 * Fishing at a fishing hole, on screen ([[UI_SPEC]] § Explore mode): the
 * trainer swings the rod up and casts, the line flies out and the bobber
 * drops into the hole; it bobs a little, then either goes under with a
 * splash (something bit: its battle follows, once this is over) or the line
 * is reeled back in (nothing bit). About two seconds.
 *
 * With reduced motion the rod does not swing: it is held out, the bobber is
 * in the hole at once, sits still, and goes under or comes back without a
 * splash ring growing.
 *
 * The rod, the line, the bobber and the ring are built once and kept: one
 * cast at a time, and nothing to free ([[INVARIANTS]] § Rendering).
 */

/** Seconds of the whole cast, start to the bobber gone or reeled in. */
export const FISH_SECONDS = 1.9;
/** The phases' ends, in seconds: the rod swung back and forward (the cast), the bobber's flight, its bobbing. */
const CAST_END = 0.3;
const FLY_END = 0.6;
const WAIT_END = 1.35;
/** Seconds from the cast to the bobber going under, when something bit: the splash's sound. */
export const FISH_BITE_DELAY = WAIT_END;
/** How far up from level the rod points as it is held out, and drawn back over the shoulder. */
const HELD_UP = 0.55;
const DRAWN_UP = 2.2;
/** The arm's turn about its shoulder while it holds the rod out (negative is forward). */
const ARM_OUT = -1.15;
const ROD_LENGTH = 0.62;
/** The line sags in the middle by this share of its length. */
const SAG = 0.12;
const LINE_POINTS = 9;

const rodMaterial = new THREE.MeshLambertMaterial({ color: 0x7a4b2e, flatShading: true });
const reelMaterial = new THREE.MeshLambertMaterial({ color: 0x9aa4ad, flatShading: true });
const bobberRed = new THREE.MeshLambertMaterial({ color: COLORS.playerShirt, flatShading: true });
const bobberWhite = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
const lineMaterial = new THREE.LineBasicMaterial({ color: 0xf4f7fa });
const ringMaterial = new THREE.MeshBasicMaterial({
	color: 0xffffff,
	transparent: true,
	opacity: 0.8,
	depthWrite: false
});
const HALF_BALL = new THREE.SphereGeometry(0.045, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
const RING = new THREE.RingGeometry(0.06, 0.09, 16);

/** What came of the cast: the bobber goes under, or is reeled in. */
export type CastOutcome = 'bite' | 'nothing';

export class FishingEffect {
	/** The rod, hung on the trainer's arm while a cast plays: a grip, a reel, a long thin shaft. */
	private readonly rod = new THREE.Group();
	/** The rod's tip, where the line starts. */
	private readonly tip = new THREE.Object3D();
	private readonly line: THREE.Line;
	private readonly bobber = new THREE.Group();
	private readonly ring = new THREE.Mesh(RING, ringMaterial);
	private readonly linePositions = new Float32Array(LINE_POINTS * 3);
	private cast: {
		start: number;
		hole: THREE.Vector3;
		outcome: CastOutcome;
		arm: THREE.Object3D;
	} | null = null;
	private readonly at = new THREE.Vector3();
	private readonly from = new THREE.Vector3();

	constructor(private readonly parent: THREE.Object3D) {
		const grip = new THREE.Mesh(BOX_GEOMETRY, rodMaterial);
		grip.scale.set(0.04, 0.04, 0.14);
		grip.position.set(0, 0, 0.02);
		const reel = new THREE.Mesh(BOX_GEOMETRY, reelMaterial);
		reel.scale.set(0.05, 0.05, 0.04);
		reel.position.set(0, -0.035, 0.05);
		const shaft = new THREE.Mesh(BOX_GEOMETRY, rodMaterial);
		shaft.scale.set(0.02, 0.02, ROD_LENGTH);
		shaft.position.set(0, 0, ROD_LENGTH / 2 + 0.06);
		this.tip.position.set(0, 0, ROD_LENGTH + 0.08);
		this.rod.add(grip, reel, shaft, this.tip);
		this.rod.name = 'tool:fishing-rod';
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
		this.line = new THREE.Line(geometry, lineMaterial);
		this.line.frustumCulled = false;
		const top = new THREE.Mesh(HALF_BALL, bobberRed);
		const bottom = new THREE.Mesh(HALF_BALL, bobberWhite);
		bottom.rotation.x = Math.PI;
		this.bobber.add(top, bottom);
		this.ring.rotation.x = -Math.PI / 2;
	}

	/** Whether a cast is still playing: a battle that bit waits for the bobber to go under. */
	playing(now: number): boolean {
		return this.cast !== null && now - this.cast.start < FISH_SECONDS;
	}

	/**
	 * A line cast by the trainer whose right arm is `arm` (the joint the rod
	 * hangs on), into the hole at `hole`, from the tile beside it facing it;
	 * `now` is the renderer's clock, in seconds.
	 */
	play(arm: THREE.Object3D, hole: GridPos, outcome: CastOutcome, now: number): void {
		this.stop();
		this.rod.position.set(0, -0.25, 0);
		arm.add(this.rod);
		this.parent.add(this.line, this.bobber);
		this.cast = { start: now, hole: new THREE.Vector3(hole.x, ICE_TOP + 0.02, hole.y), outcome, arm };
	}

	/** Take the rod, the line and the bobber away. */
	stop(): void {
		if (!this.cast) return;
		this.cast.arm.rotation.x = 0;
		this.rod.removeFromParent();
		this.line.removeFromParent();
		this.bobber.removeFromParent();
		this.ring.removeFromParent();
		this.cast = null;
	}

	/** One frame of the cast at `now`. Ends it, and tidies up, at its end. */
	update(now: number, calm: boolean): void {
		const cast = this.cast;
		if (!cast) return;
		const t = now - cast.start;
		if (t >= FISH_SECONDS) {
			this.stop();
			return;
		}
		// The arm holds the rod out; the rod turns from drawn back over the shoulder to held out.
		cast.arm.rotation.x = ARM_OUT;
		const swing = calm ? 1 : smooth(t / CAST_END);
		const up = DRAWN_UP + (HELD_UP - DRAWN_UP) * swing;
		// The rod's own turn on the arm: the arm's undone, then tipped up from level.
		this.rod.rotation.x = -ARM_OUT - up;
		this.tip.getWorldPosition(this.from);
		// The bobber: flown from the tip to the hole, bobbing there, then under or back.
		const hole = cast.hole;
		const bob = calm ? 0 : Math.sin((t - FLY_END) * 9) * 0.012;
		if (!calm && t < FLY_END) {
			const p = Math.max(0, (t - CAST_END) / (FLY_END - CAST_END));
			this.at.lerpVectors(this.from, hole, p);
			this.at.y += Math.sin(p * Math.PI) * 0.35;
		} else if (t < WAIT_END) {
			this.at.copy(hole).setY(hole.y + bob);
		} else if (cast.outcome === 'bite') {
			// Under it goes, with a ring of splash spreading round the hole.
			const p = Math.min(1, (t - WAIT_END) / 0.25);
			this.at.copy(hole).setY(hole.y - 0.12 * p);
			if (!this.ring.parent) this.parent.add(this.ring);
			this.ring.position.set(hole.x, hole.y + 0.005, hole.z);
			const grow = calm ? 1 : 1 + 2.5 * smooth((t - WAIT_END) / (FISH_SECONDS - WAIT_END));
			this.ring.scale.setScalar(grow);
			ringMaterial.opacity = 0.8 * (1 - (t - WAIT_END) / (FISH_SECONDS - WAIT_END));
		} else {
			// Reeled back in to the tip.
			const p = smooth((t - WAIT_END) / (FISH_SECONDS - WAIT_END));
			this.at.lerpVectors(hole, this.from, p);
		}
		this.bobber.position.copy(this.at);
		this.bobber.visible = !(cast.outcome === 'bite' && t > WAIT_END + 0.25);
		this.drawLine(this.from, this.at);
	}

	/** The line from the rod's tip to the bobber, sagging a little in the middle. */
	private drawLine(a: THREE.Vector3, b: THREE.Vector3): void {
		const sag = a.distanceTo(b) * SAG;
		for (let i = 0; i < LINE_POINTS; i++) {
			const p = i / (LINE_POINTS - 1);
			this.linePositions[i * 3] = a.x + (b.x - a.x) * p;
			this.linePositions[i * 3 + 1] = a.y + (b.y - a.y) * p - Math.sin(p * Math.PI) * sag;
			this.linePositions[i * 3 + 2] = a.z + (b.z - a.z) * p;
		}
		const position = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
		position.needsUpdate = true;
	}
}

function smooth(p: number): number {
	const x = Math.min(1, Math.max(0, p));
	return x * x * (3 - 2 * x);
}
