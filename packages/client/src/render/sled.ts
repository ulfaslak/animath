import * as THREE from 'three';
import { BOX_GEOMETRY } from './tiles';

/**
 * The Arctic's dog sled ([[UI_SPEC]] § Explore mode, "The dog sled"): a
 * look only, as the harness is. With the sled owned and a lead that can pull
 * one (`canPull`: the reindeer, the Arctic wolf) leading on the snow, the
 * trainer stands on the runners at the back of a small wooden sled, and the
 * lead walks in front of it in its traces. Built in the trainer's own frame
 * (figures face +z): the sled runs forward from under their feet, and the
 * traces from its front to `reach` ahead, where the lead's harness is.
 *
 * Boxes of the shared unit box and a few colours made once: nothing to free
 * but the traces' little line geometry, which `dispose` frees.
 */

const WOOD = 0xa86b3c;
const WOOD_DARK = 0x7a4b2a;
const CLOTH = 0x2f6fb3;
const TRACE = 0x3a2f2a;

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

/** How high the trainer stands on the runners. */
export const SLED_STAND = 0.05;
/** Where the sled's front is, ahead of the trainer's feet: the traces start here. */
export const SLED_FRONT = 0.72;

const traceMaterial = new THREE.LineBasicMaterial({ color: TRACE });

export class Sled {
	readonly group = new THREE.Group();
	private readonly traces: THREE.LineSegments;
	private reach = 0;

	constructor() {
		this.group.name = 'sled';
		// The runners, under the trainer's feet and on to the front, curling up there.
		for (const x of [-0.13, 0.13]) {
			this.group.add(box(WOOD_DARK, [0.03, 0.025, 0.9], [x, 0.012, 0.25]));
			const curl = box(WOOD_DARK, [0.03, 0.025, 0.14], [x, 0.06, 0.73]);
			curl.rotation.x = -0.9;
			this.group.add(curl);
			// The handlebar's uprights, in front of the trainer.
			this.group.add(box(WOOD, [0.025, 0.36, 0.025], [x, 0.2, 0.12]));
		}
		this.group.add(box(WOOD, [0.3, 0.025, 0.025], [0, 0.38, 0.12]));
		// The basket: a bed of slats with a blue load on it.
		this.group.add(box(WOOD, [0.3, 0.03, 0.46], [0, 0.11, 0.42]));
		this.group.add(box(CLOTH, [0.24, 0.1, 0.3], [0, 0.17, 0.42]));
		this.group.add(box(WOOD, [0.3, 0.06, 0.02], [0, 0.14, 0.65]));
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
		this.traces = new THREE.LineSegments(geometry, traceMaterial);
		this.traces.frustumCulled = false;
		this.group.add(this.traces);
		this.group.visible = false;
	}

	/**
	 * Shown or not, with the lead's harness `reach` ahead of the trainer's feet
	 * at `height` (the traces run from the sled's front to it).
	 */
	update(shown: boolean, reach: number, height: number): void {
		this.group.visible = shown;
		if (!shown || reach === this.reach) return;
		this.reach = reach;
		const p = this.traces.geometry.getAttribute('position') as THREE.BufferAttribute;
		for (const [i, x] of [-0.1, 0.1].entries()) {
			p.setXYZ(i * 2, x, 0.15, SLED_FRONT);
			p.setXYZ(i * 2 + 1, x * 0.6, height, reach);
		}
		p.needsUpdate = true;
	}

	dispose(): void {
		this.traces.geometry.dispose();
	}
}
