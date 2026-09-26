import { Rng, tileAtWorld } from '@mathgame/engine';
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
 * screen; one that falls far behind a walking trainer comes back from off
 * screen, so none pops into view. With reduced motion there are fewer, and
 * their wings beat slower and shallower.
 */

const COUNT = 6;
const REDUCED_COUNT = 2;
/** Tiles from the middle of the screen they wander within, and beyond which they come back from off screen. */
const ROAM = 6.5;
const FAR = 13;
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
}

export class Butterflies {
	private flock: Butterfly[] = [];
	private rng = new Rng(20260926);
	private seed = 0;

	constructor(private scene: THREE.Object3D) {}

	/** The world they fly over, for the ground's height and where land is. */
	setWorld(seed: number): void {
		this.seed = seed;
		for (const b of this.flock) this.scene.remove(b.group);
		this.flock = [];
	}

	/** Advance them: `centre` is where the camera looks (x, z), `dt` and `t` seconds. */
	update(centre: { x: number; z: number }, dt: number, t: number): void {
		const wanted = motion.reduced ? REDUCED_COUNT : COUNT;
		while (this.flock.length < wanted) this.flock.push(this.spawn(centre));
		while (this.flock.length > wanted) this.scene.remove(this.flock.pop()!.group);
		const beat = motion.reduced ? 6 : 14;
		const depth = motion.reduced ? 0.4 : 1;
		for (const b of this.flock) {
			const g = b.group;
			const dx = g.position.x - centre.x;
			const dz = g.position.z - centre.z;
			// Left far behind: back from off screen, on the far side.
			if (Math.hypot(dx, dz) > FAR) {
				this.place(b, centre, true);
				continue;
			}
			const to = new THREE.Vector2(b.target.x - g.position.x, b.target.y - g.position.z);
			if (to.length() < 0.3) this.pickTarget(b, centre);
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

	private spawn(centre: { x: number; z: number }): Butterfly {
		const group = new THREE.Group();
		const material = wingMaterials[this.flock.length % wingMaterials.length]!;
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
			phase: this.rng.next() * Math.PI * 2
		};
		this.place(b, centre, false);
		this.scene.add(group);
		return b;
	}

	/** Put a butterfly near the middle of the screen, or off screen when `away`. */
	private place(b: Butterfly, centre: { x: number; z: number }, away: boolean): void {
		const angle = this.rng.next() * Math.PI * 2;
		const r = away ? FAR - 0.5 : 1.5 + this.rng.next() * (ROAM - 1.5);
		const x = centre.x + Math.cos(angle) * r;
		const z = centre.z + Math.sin(angle) * r;
		b.group.position.set(x, this.groundAt(x, z) + HEIGHT, z);
		this.pickTarget(b, centre);
	}

	/** The next spot to flutter to: over land, near the middle of the screen. */
	private pickTarget(b: Butterfly, centre: { x: number; z: number }): void {
		for (let tries = 0; tries < 8; tries++) {
			const angle = this.rng.next() * Math.PI * 2;
			const r = this.rng.next() * ROAM;
			const x = centre.x + Math.cos(angle) * r;
			const z = centre.z + Math.sin(angle) * r;
			if (tileAtWorld(this.seed, Math.round(x), Math.round(z)).kind !== 'water' || tries === 7) {
				b.target.set(x, z);
				return;
			}
		}
	}

	private groundAt(x: number, z: number): number {
		return groundTop(tileAtWorld(this.seed, Math.round(x), Math.round(z)));
	}
}
