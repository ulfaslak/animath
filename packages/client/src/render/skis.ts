import * as THREE from 'three';
import { BOX_GEOMETRY } from './tiles';

/**
 * A trainer's skis ([[UI_SPEC]] § Explore mode, "Skis"): two long planks
 * under the feet, their tips turned up, a pole in each hand's reach, and at
 * speed a little spray of snow kicked up behind. Built in the trainer's own
 * frame (figures face +z), so they turn with the trainer; shown only on the
 * ground (never in the boat, in the air or on a mount's back).
 *
 * Boxes of the shared unit box and a handful of materials made once: nothing
 * to free.
 */

/** The skis' colour: a bright red, with a white binding. */
const SKI = 0xe0483b;
const BINDING = 0xf4f4f4;
const POLE = 0x3a3f4a;
const SNOW = 0xfbfdff;

const materials = new Map<number, THREE.MeshLambertMaterial>();
function material(hex: number): THREE.MeshLambertMaterial {
	let m = materials.get(hex);
	if (!m) {
		m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
		materials.set(hex, m);
	}
	return m;
}

function box(hex: number, size: [number, number, number], at: [number, number, number]): THREE.Mesh {
	const mesh = new THREE.Mesh(BOX_GEOMETRY, material(hex));
	mesh.scale.set(...size);
	mesh.position.set(...at);
	mesh.castShadow = true;
	return mesh;
}

/** Puffs of snow kicked up behind at speed. */
const SPRAY = 5;
const SPRAY_GEOMETRY = new THREE.IcosahedronGeometry(0.05, 0);

export class Skis {
	readonly group = new THREE.Group();
	private readonly spray: THREE.Mesh[] = [];

	constructor() {
		this.group.name = 'skis';
		for (const x of [-0.065, 0.065]) {
			this.group.add(box(SKI, [0.075, 0.018, 0.62], [x, 0.012, 0.04]));
			// The tip, turned up at the front.
			const tip = box(SKI, [0.075, 0.018, 0.1], [x, 0.03, 0.38]);
			tip.rotation.x = -0.6;
			this.group.add(tip);
			this.group.add(box(BINDING, [0.085, 0.03, 0.1], [x, 0.03, 0]));
			// A pole by each hand, leaning back.
			const pole = box(POLE, [0.016, 0.42, 0.016], [x * 3.6, 0.2, -0.06]);
			pole.rotation.x = -0.35;
			this.group.add(pole);
		}
		for (let i = 0; i < SPRAY; i++) {
			const puff = new THREE.Mesh(SPRAY_GEOMETRY, material(SNOW));
			puff.visible = false;
			this.spray.push(puff);
			this.group.add(puff);
		}
		this.group.visible = false;
	}

	/**
	 * This frame: shown or not, and at `speed` (0 still to 1 the top speed) the
	 * spray of snow behind; `t` is the clock in seconds. No spray with reduced
	 * motion.
	 */
	update(shown: boolean, speed: number, t: number, calm: boolean): void {
		this.group.visible = shown;
		const spraying = shown && speed > 0 && !calm;
		for (let i = 0; i < this.spray.length; i++) {
			const puff = this.spray[i]!;
			puff.visible = spraying;
			if (!spraying) continue;
			// Each puff flies up and back from the tails and fades by shrinking, one after another.
			const p = (t * 3 + i / SPRAY) % 1;
			const side = i % 2 === 0 ? -0.07 : 0.07;
			puff.position.set(side * (1 + p), 0.04 + Math.sin(p * Math.PI) * 0.18 * speed, -0.3 - p * 0.35);
			puff.scale.setScalar(Math.max(0.01, (1 - p) * (0.6 + speed * 0.8)));
		}
	}
}
