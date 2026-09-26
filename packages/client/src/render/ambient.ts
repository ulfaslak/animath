import { Rng, isWater, tileAtWorld } from '@mathgame/engine';
import * as THREE from 'three';
import { motion } from '../motion';
import { BUTTERFLY_COLORS } from './palette';
import { groundTop } from './tiles';

/**
 * A few butterflies fluttering round wherever the camera looks, so the
 * world between battles is never empty ([[UI_SPEC]] § Explore mode). They
 * are decoration only: never a catalog animal (nothing a kid would expect
 * to battle), never on a tile, never in the way, and nothing hears of them.
 * Each wanders from one spot over land to the next near the middle of the
 * screen.
 *
 * None appears or vanishes in view, whatever the window's shape: they start
 * round the middle as the world appears (its first frame, or a jump of the
 * view: Continue, the trip to the tent), and one left behind off screen by a
 * walking trainer comes back from just off screen, ahead of the trainer.
 * With reduced motion there are fewer, slower, and their wings beat slower
 * and shallower; one no longer wanted flies off screen before it goes.
 * "Off screen" is measured against the camera's own view, so it holds at
 * any width.
 */

const COUNT = 6;
const REDUCED_COUNT = 2;
/** Tiles from the middle of the screen they wander within. */
const ROAM = 6.5;
/** Tiles beyond the edge of the view one comes back from, clear of its wings. */
const COME_BACK = 1;
/** Tiles beyond the edge of the view one must be before it is brought back: never one still in view. */
const LEFT_BEHIND = 3;
/** Tiles the view's middle can move in one frame and still be walking; further is a jump. */
const JUMP = 2;
/** Tiles a second the view moves at, at least, to count as walking somewhere. */
const WALKING = 0.5;
/** How high over the ground they flutter, in tiles. */
const HEIGHT = 0.7;

/** One wing, hinged on the body's axis, lying flat: the other is the same, mirrored. */
const WING = new THREE.CircleGeometry(0.11, 5).translate(0.1, 0, 0).rotateX(-Math.PI / 2);
const BODY = new THREE.CylinderGeometry(0.016, 0.016, 0.13, 4).rotateX(Math.PI / 2);
const wingMaterials = BUTTERFLY_COLORS.map(
	(hex) => new THREE.MeshLambertMaterial({ color: hex, side: THREE.DoubleSide, flatShading: true })
);
const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x2f2a28, flatShading: true });

interface Butterfly {
	group: THREE.Group;
	left: THREE.Mesh;
	right: THREE.Mesh;
	target: THREE.Vector2;
	speed: number;
	phase: number;
	/** No longer wanted (reduced motion came on): flying off screen, to go once out of sight. */
	leaving: boolean;
}

export class Butterflies {
	private flock: Butterfly[] = [];
	private rng = new Rng(20260926);
	private seed = 0;
	private made = 0;
	/** Where the view's middle was last frame; null until the world has been drawn. */
	private last: { x: number; z: number } | null = null;
	/** How fast the view's middle moves, in tiles a second, smoothed: the way the trainer walks. */
	private heading = new THREE.Vector2();
	private point = new THREE.Vector3();

	/** `camera` is the view they must never pop into; it is aimed before each `update`. */
	constructor(
		private scene: THREE.Object3D,
		private camera: THREE.OrthographicCamera
	) {}

	/** The world they fly over, for the ground's height and where land is. */
	setWorld(seed: number): void {
		this.seed = seed;
		for (const b of this.flock) this.scene.remove(b.group);
		this.flock = [];
		this.last = null;
	}

	/**
	 * Advance them: `centre` is where the camera looks (x, z), with the camera
	 * already aimed there for this frame; `dt` and `t` are seconds.
	 */
	update(centre: { x: number; z: number }, dt: number, t: number): void {
		const wanted = motion.reduced ? REDUCED_COUNT : COUNT;
		const last = this.last;
		const jumped = !last || Math.hypot(centre.x - last.x, centre.z - last.z) > JUMP;
		if (jumped) this.heading.set(0, 0);
		else if (dt > 0) {
			const k = Math.min(1, dt * 4);
			this.heading.x += ((centre.x - last.x) / dt - this.heading.x) * k;
			this.heading.y += ((centre.z - last.z) / dt - this.heading.y) * k;
		}
		this.last = { x: centre.x, z: centre.z };
		if (jumped) this.appear(centre, wanted);
		else this.keepCount(centre, wanted);

		const beat = motion.reduced ? 6 : 14;
		const depth = motion.reduced ? 0.4 : 1;
		for (const b of [...this.flock]) {
			const g = b.group;
			const out = this.beyond(g.position);
			if (b.leaving && out > COME_BACK) {
				this.scene.remove(g);
				this.flock = this.flock.filter((other) => other !== b);
				continue;
			}
			// Left behind, out of sight: back from just off screen, coming in.
			if (!b.leaving && out > LEFT_BEHIND) {
				this.comeBack(b, centre);
				continue;
			}
			// Its spot fell behind a walking trainer: a new one near the middle, so none dawdles out of sight.
			const stale = Math.hypot(b.target.x - centre.x, b.target.y - centre.z) > ROAM + 1;
			if (!b.leaving && stale) this.pickTarget(b, centre);
			const to = new THREE.Vector2(b.target.x - g.position.x, b.target.y - g.position.z);
			if (to.length() < 0.3) {
				if (b.leaving) this.leaveTarget(b);
				else this.pickTarget(b, centre);
			}
			to.normalize();
			// A lazy wobble across the way it goes.
			const wobble = Math.sin(t * 1.7 + b.phase) * 0.6;
			const vx = to.x + -to.y * wobble;
			const vz = to.y + to.x * wobble;
			const step = b.speed * dt * (motion.reduced ? 0.6 : 1);
			g.position.x += vx * step;
			g.position.z += vz * step;
			const ground = this.groundAt(g.position.x, g.position.z);
			const bob = Math.sin(t * 2.3 + b.phase) * 0.12;
			g.position.y += (ground + HEIGHT + bob - g.position.y) * Math.min(1, dt * 4);
			g.rotation.y = Math.atan2(vx, vz);
			const flap = (0.15 + Math.abs(Math.sin(t * beat + b.phase)) * 1.0) * depth;
			b.right.rotation.z = flap;
			b.left.rotation.z = -flap;
		}
	}

	/**
	 * The world appears afresh (its first frame, or the view jumped): the
	 * ones on their way out go with the old view, and the rest start round
	 * the middle with the world.
	 */
	private appear(centre: { x: number; z: number }, wanted: number): void {
		for (const b of this.flock) if (b.leaving) this.scene.remove(b.group);
		this.flock = this.flock.filter((b) => !b.leaving);
		while (this.flock.length > wanted) this.scene.remove(this.flock.pop()!.group);
		for (const b of this.flock) this.placeNear(b, centre);
		while (this.flock.length < wanted) this.flock.push(this.spawn(centre, true));
	}

	/** As many as wanted: new ones come from off screen, and spare ones fly off it. */
	private keepCount(centre: { x: number; z: number }, wanted: number): void {
		let staying = this.flock.filter((b) => !b.leaving).length;
		// Wanted again before it got away: it turns back.
		for (const b of this.flock) {
			if (staying >= wanted) break;
			if (!b.leaving) continue;
			b.leaving = false;
			this.pickTarget(b, centre);
			staying++;
		}
		for (; staying < wanted; staying++) this.flock.push(this.spawn(centre, false));
		for (let i = this.flock.length - 1; i >= 0 && staying > wanted; i--) {
			const b = this.flock[i]!;
			if (b.leaving) continue;
			b.leaving = true;
			this.leaveTarget(b);
			staying--;
		}
	}

	private spawn(centre: { x: number; z: number }, near: boolean): Butterfly {
		const group = new THREE.Group();
		const material = wingMaterials[this.made++ % wingMaterials.length]!;
		const right = new THREE.Mesh(WING, material);
		const left = new THREE.Mesh(WING, material);
		left.scale.x = -1;
		group.add(right, left, new THREE.Mesh(BODY, bodyMaterial));
		const b: Butterfly = {
			group,
			left,
			right,
			target: new THREE.Vector2(),
			speed: 0.7 + this.rng.next() * 0.4,
			phase: this.rng.next() * Math.PI * 2,
			leaving: false
		};
		if (near) this.placeNear(b, centre);
		else this.comeBack(b, centre);
		this.scene.add(group);
		return b;
	}

	/** Somewhere round the middle of the screen, in view. */
	private placeNear(b: Butterfly, centre: { x: number; z: number }): void {
		const angle = this.rng.next() * Math.PI * 2;
		const r = 1.5 + this.rng.next() * (ROAM - 1.5);
		const x = centre.x + Math.cos(angle) * r;
		const z = centre.z + Math.sin(angle) * r;
		b.group.position.set(x, this.groundAt(x, z) + HEIGHT, z);
		this.pickTarget(b, centre);
	}

	/** Just off screen: ahead of a walking trainer, or anywhere round a still one; then in towards the middle. */
	private comeBack(b: Butterfly, centre: { x: number; z: number }): void {
		const walking = this.heading.length() > WALKING;
		const angle = walking
			? Math.atan2(this.heading.y, this.heading.x) + (this.rng.next() - 0.5) * Math.PI * 0.6
			: this.rng.next() * Math.PI * 2;
		b.group.position.copy(this.offScreen(centre, angle, COME_BACK));
		this.pickTarget(b, centre);
	}

	/** Out of sight the nearest way: of eight ways across the ground, the one that leaves the view soonest. */
	private leaveTarget(b: Butterfly): void {
		const from = { x: b.group.position.x, z: b.group.position.z };
		let best: THREE.Vector3 | null = null;
		let bestDistance = Infinity;
		for (let i = 0; i < 8; i++) {
			const away = this.offScreen(from, (i / 8) * Math.PI * 2, COME_BACK + 1, 0);
			const distance = Math.hypot(away.x - from.x, away.z - from.z);
			if (distance < bestDistance) {
				best = away;
				bestDistance = distance;
			}
		}
		b.target.set(best!.x, best!.z);
	}

	/** The next spot to flutter to: over land, near the middle of the screen. */
	private pickTarget(b: Butterfly, centre: { x: number; z: number }): void {
		for (let tries = 0; tries < 8; tries++) {
			const angle = this.rng.next() * Math.PI * 2;
			const r = this.rng.next() * ROAM;
			const x = centre.x + Math.cos(angle) * r;
			const z = centre.z + Math.sin(angle) * r;
			if (!isWater(tileAtWorld(this.seed, Math.round(x), Math.round(z)).kind) || tries === 7) {
				b.target.set(x, z);
				return;
			}
		}
	}

	/**
	 * The first spot from `from` along `angle` (looking from `start` tiles
	 * out), at flying height, `margin` tiles beyond the view's edge.
	 */
	private offScreen(
		from: { x: number; z: number },
		angle: number,
		margin: number,
		start = ROAM
	): THREE.Vector3 {
		const at = new THREE.Vector3();
		for (let r = start; r < 100; r += 0.5) {
			const x = from.x + Math.cos(angle) * r;
			const z = from.z + Math.sin(angle) * r;
			at.set(x, this.groundAt(x, z) + HEIGHT, z);
			if (this.beyond(at) >= margin) break;
		}
		return at;
	}

	/** How far outside the camera's view `p` is, in tiles across the screen; negative inside it. */
	private beyond(p: THREE.Vector3): number {
		const c = this.camera;
		const v = this.point.copy(p).applyMatrix4(c.matrixWorldInverse);
		const halfW = (c.right - c.left) / (2 * c.zoom);
		const halfH = (c.top - c.bottom) / (2 * c.zoom);
		const dx = Math.abs(v.x - (c.right + c.left) / 2) - halfW;
		const dy = Math.abs(v.y - (c.top + c.bottom) / 2) - halfH;
		return Math.max(dx, dy);
	}

	private groundAt(x: number, z: number): number {
		return groundTop(tileAtWorld(this.seed, Math.round(x), Math.round(z)));
	}
}
