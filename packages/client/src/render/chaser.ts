import type { Direction } from '@mathgame/engine';
import * as THREE from 'three';
import { motion } from '../motion';
import { animateFlight, buildAnimalMesh, disposeFigure } from './animals';
import { appearScale, recallScale, smoothstep } from './ease';
import type { FigureHost } from './follower';
import { COLORS } from './palette';
import { FACING_ANGLE } from './trainer';

/**
 * The wild bird that noticed the glider and follows it down (#91, [[UI_SPEC]]
 * § Explore mode): a figure from `animals.ts` that comes into view from off
 * screen behind the trainer, a little "!" popping up over it, and flies after
 * them, gaining on them, its wings beating (held out, gliding, with reduced
 * motion), until they are down; then it swoops in to hover in front of them,
 * facing them, as the battle's circle closes. It is a view and nothing more:
 * the authority said a bird follows (`bird-follows`), and its battle starts
 * as the kid lands. Explore drives it (`notice`, `update`, `comeDown`,
 * `hide`); the figure idles with the world's other figures (`FigureHost`).
 */

/** Where it comes from: this far behind the trainer, and this far over them, off screen. */
export const CHASE_FROM = 9;
const CHASE_FROM_UP = 1.2;
/** Where it keeps to once it has caught up: behind the trainer, to their right, a little over them. */
export const CHASE_BEHIND = 1.9;
const CHASE_ASIDE = 0.55;
const CHASE_UP = 0.3;
/** Seconds it takes to catch up with the glider. */
export const CHASE_SECONDS = 1.1;
/** Seconds its swoop takes, from where it flew to where it hovers in front of the kid, down. */
export const SWOOP_SECONDS = 0.6;
/** Where it hovers once the kid is down: this far in front of them, this high over the ground there. */
export const HOVER_AHEAD = 1.5;
export const HOVER_UP = 0.8;
/** Seconds the "!" stays over it: popping up, held, then shrinking away. */
export const MARK_SECONDS = 1.6;
const MARK_POP = 0.25;
const MARK_GO = 0.3;
/** How far its nose dips as it flies after the glider. */
const CHASE_PITCH = 0.35;

const AHEAD: Record<Direction, { x: number; z: number }> = {
	up: { x: 0, z: -1 },
	down: { x: 0, z: 1 },
	left: { x: -1, z: 0 },
	right: { x: 1, z: 0 }
};
const BACK: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/**
 * The "!" over a bird that noticed the kid, the Game Boy games' own: a
 * cream bubble with the accent's ring and a near-black "!", unlit, facing the
 * camera and drawn over everything, as the landing ring is.
 */
function buildMark(): THREE.Group {
	const mark = new THREE.Group();
	const flat = (hex: number) =>
		new THREE.MeshBasicMaterial({ color: hex, depthTest: false, depthWrite: false });
	const parts: [THREE.BufferGeometry, number, number][] = [
		[new THREE.CircleGeometry(0.26, 24), COLORS.white, 0],
		[new THREE.RingGeometry(0.24, 0.3, 24), 0xff9f43, 0.001],
		[new THREE.PlaneGeometry(0.075, 0.22).translate(0, 0.05, 0), COLORS.dark, 0.002],
		[new THREE.CircleGeometry(0.045, 12).translate(0, -0.13, 0), COLORS.dark, 0.002]
	];
	for (const [geometry, hex, z] of parts) {
		const mesh = new THREE.Mesh(geometry, flat(hex));
		mesh.position.z = z;
		mesh.renderOrder = 11;
		mark.add(mesh);
	}
	mark.visible = false;
	return mark;
}

export class Chaser {
	private figure: THREE.Group | null = null;
	private shown: string | null = null;
	private readonly mark = buildMark();
	/** Seconds since it noticed the glider. */
	private t = 0;
	/** Where it flies: behind the glider, then swooping in, then hovering. */
	private at = new THREE.Vector3();
	private yaw = 0;
	/** The kid is down: from where it swoops to where it hovers, and how far through (0 to 1). */
	private swoop: { from: THREE.Vector3; to: THREE.Vector3; p: number } | null = null;
	/** The figure's height, measured once, for where the "!" goes over its head. */
	private height = 0.5;

	constructor(
		private readonly host: FigureHost,
		private readonly scene: THREE.Scene,
		private readonly camera: () => THREE.Camera
	) {
		scene.add(this.mark);
	}

	/** The species following, or null: for tests and anything that asks. */
	get species(): string | null {
		return this.figure ? this.shown : null;
	}

	/** Whether it is still on its way: after the glider, or swooping in; false once it hovers in front of the kid. */
	get arriving(): boolean {
		return this.figure !== null && (this.swoop === null || this.swoop.p < 1);
	}

	/** Whether the "!" is up over it. */
	get marked(): boolean {
		return this.mark.visible;
	}

	/**
	 * A bird of `speciesId` noticed the glider: it comes in from off screen
	 * behind the trainer (at `trainer`, flying `facing`), a "!" over it.
	 */
	notice(speciesId: string, trainer: THREE.Vector3, facing: Direction): void {
		this.hide();
		const figure = buildAnimalMesh(speciesId);
		figure.userData.idlePhase = 2.1;
		this.height = new THREE.Box3().setFromObject(figure).getSize(new THREE.Vector3()).y;
		this.figure = figure;
		this.shown = speciesId;
		this.t = 0;
		this.at.copy(this.startFrom(trainer, facing));
		this.yaw = FACING_ANGLE[facing];
		this.host.addFigure(figure);
		this.place(figure, 1);
	}

	/**
	 * The kid is down: it swoops from where it flies to `hover`, in front of
	 * them, turned to face them (they face `facing`), and hovers there.
	 */
	comeDown(hover: { x: number; y: number; z: number }, facing: Direction): void {
		if (!this.figure) return;
		this.swoop = { from: this.at.clone(), to: new THREE.Vector3(hover.x, hover.y, hover.z), p: 0 };
		this.yaw = FACING_ANGLE[BACK[facing]];
	}

	/**
	 * A frame: after the glider at `trainer`, flying `facing`, closing in on
	 * its spot behind them; or swooping in, or hovering, once they are down.
	 */
	update(dt: number, trainer: THREE.Vector3, facing: Direction): void {
		const figure = this.figure;
		if (!figure) return;
		this.t += dt;
		const calm = motion.reduced;
		if (this.swoop) {
			const swoop = this.swoop;
			swoop.p = Math.min(1, swoop.p + dt / SWOOP_SECONDS);
			const p = smoothstep(swoop.p);
			this.at.lerpVectors(swoop.from, swoop.to, p);
			// A dive: down a little under the line, and up again to hover.
			this.at.y -= Math.sin(p * Math.PI) * (calm ? 0.1 : 0.35);
			figure.rotation.set(CHASE_PITCH * (1 - p), this.yaw, 0, 'YXZ');
		} else {
			const catchUp = Math.min(1, this.t / CHASE_SECONDS);
			const from = this.startFrom(trainer, facing);
			const to = this.spotBehind(trainer, facing);
			this.at.lerpVectors(from, to, 1 - (1 - catchUp) ** 3);
			this.yaw = FACING_ANGLE[facing];
			figure.rotation.set(CHASE_PITCH, this.yaw, 0, 'YXZ');
		}
		this.place(figure, 1);
		animateFlight(figure, this.t * 1.15, 1, calm);
		this.showMark(figure, calm);
	}

	/** The bird is gone: its battle has begun on its own screen, or the kid is somewhere else now. */
	hide(): void {
		this.mark.visible = false;
		this.swoop = null;
		if (!this.figure) return;
		this.host.removeFigure(this.figure);
		disposeFigure(this.figure);
		this.figure = null;
		this.shown = null;
	}

	/** Free what it keeps for as long as the page lives: the "!". */
	dispose(): void {
		this.hide();
		this.scene.remove(this.mark);
		this.mark.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			o.geometry.dispose();
			(o.material as THREE.Material).dispose();
		});
	}

	/** Where it comes from: far behind the trainer and over them, off screen. */
	private startFrom(trainer: THREE.Vector3, facing: Direction): THREE.Vector3 {
		const ahead = AHEAD[facing];
		return new THREE.Vector3(
			trainer.x - ahead.x * CHASE_FROM,
			trainer.y + CHASE_FROM_UP,
			trainer.z - ahead.z * CHASE_FROM
		);
	}

	/** Where it keeps to behind the glider: to the trainer's right, a little over them, weaving a little. */
	private spotBehind(trainer: THREE.Vector3, facing: Direction): THREE.Vector3 {
		const ahead = AHEAD[facing];
		const right = { x: -ahead.z, z: ahead.x };
		const weave = motion.reduced ? 0 : Math.sin(this.t * 2.3) * 0.15;
		return new THREE.Vector3(
			trainer.x - ahead.x * CHASE_BEHIND + right.x * (CHASE_ASIDE + weave),
			trainer.y + CHASE_UP + (motion.reduced ? 0 : Math.sin(this.t * 3.4) * 0.06),
			trainer.z - ahead.z * CHASE_BEHIND + right.z * (CHASE_ASIDE + weave)
		);
	}

	/** Put the figure where it flies, hovering with a little bob once it is there. */
	private place(figure: THREE.Group, scale: number): void {
		figure.position.copy(this.at);
		if (this.swoop && this.swoop.p >= 1 && !motion.reduced)
			figure.position.y += Math.sin(this.t * 3) * 0.05;
		figure.scale.setScalar(scale);
	}

	/** The "!" over its head, turned to the camera: popping up, held, then shrinking away. */
	private showMark(figure: THREE.Group, calm: boolean): void {
		const t = this.t;
		this.mark.visible = t < MARK_SECONDS;
		if (!this.mark.visible) return;
		const size =
			t < MARK_POP
				? appearScale(t / MARK_POP, calm)
				: t > MARK_SECONDS - MARK_GO
					? recallScale((t - (MARK_SECONDS - MARK_GO)) / MARK_GO)
					: 1;
		this.mark.position.copy(figure.position);
		this.mark.position.y += this.height + 0.35;
		this.mark.quaternion.copy(this.camera().quaternion);
		this.mark.scale.setScalar(Math.max(0.001, size));
	}
}
