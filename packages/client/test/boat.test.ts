import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildPlayerMesh } from '../src/render/animals';
import { BOAT_STAND, buildBoatMesh, disposeBoat, poseBoat } from '../src/render/boat';

/**
 * The boat on the trainer (`boat.ts`): upside down on their back, right side
 * up under their feet afloat, and every pose between on the way, which the
 * human asked to be smooth ("rotates, translates and scales"). What a frame
 * can't show for sure: where it sits in both poses, that no step of the way
 * jumps, and that reduced motion snaps it half way instead.
 */
function inTrainer(afloat: number, calm = false): { boat: THREE.Group; box: THREE.Box3 } {
	const trainer = buildPlayerMesh();
	const boat = buildBoatMesh();
	trainer.add(boat);
	poseBoat(boat, afloat, calm);
	trainer.updateMatrixWorld(true);
	return { boat, box: new THREE.Box3().setFromObject(boat) };
}

const pennantScale = (boat: THREE.Group) => boat.getObjectByName('pennant')!.scale.x;
/** Which way one of the boat's own axes points in the trainer's frame. */
const axis = (boat: THREE.Group, x: number, y: number, z: number) =>
	new THREE.Vector3(x, y, z).applyQuaternion(boat.quaternion);
/** How far the boat is turned from sitting right side up, in radians. */
const turned = (boat: THREE.Group) => boat.quaternion.angleTo(new THREE.Quaternion());

describe('the boat', () => {
	it('on the back: its bottom turned out, small, off the ground and behind the trainer, its pennant down', () => {
		const { boat, box } = inTrainer(0);
		// The open side against the trainer's back (+z, the way they face), the bow
		// down, leaning back a little at the top: its bottom out, like a shell.
		expect(axis(boat, 0, 1, 0).z).toBeGreaterThan(0.9);
		expect(axis(boat, 0, 0, 1).y).toBeLessThan(-0.9);
		expect(axis(boat, 0, 0, -1).z).toBeLessThan(0);
		expect(boat.scale.x).toBeLessThan(0.7);
		// On the back, from the shoulders down past the hips, never down by the feet.
		expect(box.min.y).toBeGreaterThan(0.08);

		expect(box.max.y).toBeGreaterThan(0.5);

		// Behind the trainer, who faces +z: nothing of it in front of their face.
		expect(box.max.z).toBeLessThan(0.12);
		expect(pennantScale(boat)).toBeLessThan(0.01);
		const trainer = new THREE.Box3().setFromObject(buildPlayerMesh());
		// No wider than the trainer's shoulders and arms.
		expect(box.max.x - box.min.x).toBeLessThanOrEqual(trainer.max.x - trainer.min.x + 0.01);
	});

	it('afloat: right side up and full size under the trainer, the floor at their feet, the rim over them', () => {
		const { boat, box } = inTrainer(1);
		expect(turned(boat)).toBeCloseTo(0, 5);
		expect(boat.scale.x).toBe(1);
		expect(pennantScale(boat)).toBe(1);
		// The keel is under the feet by the floor's height, and the water comes up to
		// BOAT_STAND under the feet: only a sliver of the hull is below it.
		const water = -BOAT_STAND;
		expect(box.min.y).toBeLessThan(water);
		expect(water - box.min.y).toBeLessThan(0.1);
		// The rim stands over the feet, so the trainer stands in it.
		const hull = new THREE.Box3().setFromObject(boat.children[0]!);
		expect(hull.max.y).toBeGreaterThan(0.05);
		// Centred under the trainer, as long as a tile is wide, or nearly.
		expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 1);
		expect(box.max.z - box.min.z).toBeGreaterThan(0.8);
		expect(box.max.z - box.min.z).toBeLessThan(1);
	});

	it('swings from one to the other smoothly: no step of the way jumps, it grows all the way, and turns once', () => {
		const { boat } = inTrainer(0);
		const at = new THREE.Vector3();
		const last = new THREE.Vector3();
		let lastScale = 0;
		let lastTurn = Infinity;
		const steps = 200;
		const jumps: string[] = [];
		for (let i = 0; i <= steps; i++) {
			poseBoat(boat, i / steps, false);
			at.copy(boat.position);
			if (i > 0 && at.distanceTo(last) > 0.02) jumps.push(`moved ${at.distanceTo(last)} at ${i}`);
			if (boat.scale.x < lastScale) jumps.push(`shrank at ${i}`);
			if (turned(boat) > lastTurn + 1e-9) jumps.push(`turned back at ${i}`);
			if (i > 0 && lastTurn - turned(boat) > 0.05) jumps.push(`turned ${lastTurn - turned(boat)} at ${i}`);
			last.copy(at);
			lastScale = boat.scale.x;
			lastTurn = turned(boat);
		}
		expect(jumps).toEqual([]);
		// On the way it swings out to the trainer's side, clear of their body.
		poseBoat(boat, 0.5, false);
		expect(boat.position.x).toBeGreaterThan(0.3);
	});

	it('with reduced motion, snaps from the back to the water half way, and rocks not at all', () => {
		const back = turned(inTrainer(0).boat);
		for (const a of [0, 0.2, 0.49]) {
			expect(turned(inTrainer(a, true).boat)).toBeCloseTo(back, 5);
			expect(inTrainer(a, true).boat.scale.x).toBeLessThan(0.7);

		}
		for (const a of [0.5, 0.8, 1]) {
			expect(turned(inTrainer(a, true).boat)).toBeCloseTo(0, 5);
			expect(inTrainer(a, true).boat.scale.x).toBe(1);
		}

	});

	it('frees its own geometries, and only those: the materials are shared', () => {
		const boat = buildBoatMesh();
		const geometries = new Set<THREE.BufferGeometry>();
		const materials = new Set<THREE.Material>();
		boat.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			geometries.add(o.geometry);
			materials.add(o.material as THREE.Material);
		});
		let freed = 0;
		for (const g of geometries) g.addEventListener('dispose', () => freed++);
		let lost = 0;
		for (const m of materials) m.addEventListener('dispose', () => lost++);
		disposeBoat(boat);
		expect(freed).toBe(geometries.size);
		expect(lost).toBe(0);
	});
});
