import { ANIMALS } from '@mathgame/engine';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildAnimalParts, buildPlayerParts } from '../src/render/animals';
import { SADDLE, poseRider } from '../src/render/mount';

describe('riding with the harness', () => {
	it('knows where to sit on every animal that carries a kid, and on no other', () => {
		const carriers = ANIMALS.filter((a) => a.carries).map((a) => a.id);
		expect(Object.keys(SADDLE).sort()).toEqual([...carriers].sort());
	});

	it("sits each kid on the top of its animal's back, as the figure is built", () => {
		for (const [id, saddle] of Object.entries(SADDLE)) {
			const figure = buildAnimalParts(id);
			figure.updateMatrixWorld(true);
			// Straight down onto the figure where the kid sits: the first thing hit is its back.
			const ray = new THREE.Raycaster(
				new THREE.Vector3(0, 5, saddle.z),
				new THREE.Vector3(0, -1, 0)
			);
			const hit = ray.intersectObject(figure, true)[0];
			expect(hit, id).toBeDefined();
			expect(Math.abs(hit!.point.y - saddle.y), id).toBeLessThan(0.006);
			// Behind its middle: clear of the neck and the head.
			expect(saddle.z, id).toBeLessThanOrEqual(0);
		}
	});

	it('spreads the legs astride as far as the kid sits, and puts them straight again at 0', () => {
		const rig = buildPlayerParts().children[0]!;
		const legL = rig.getObjectByName('legL')!;
		const legR = rig.getObjectByName('legR')!;
		poseRider(rig, 1);
		// Round the animal's back on either side, swung forward.
		expect(legL.rotation.z).toBeLessThan(0);
		expect(legR.rotation.z).toBeGreaterThan(0);
		expect(legL.rotation.x).toBeLessThan(0);
		legL.rotation.x = 0.3;
		poseRider(rig, 0);
		expect(legL.rotation.z).toBeCloseTo(0, 9);
		expect(legR.rotation.z).toBeCloseTo(0, 9);
		// On foot the walk's swing is left as it is.
		expect(legL.rotation.x).toBe(0.3);
	});
});
