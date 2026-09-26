import { ANIMALS } from '@mathgame/engine';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { animateIdle, animateWalk, buildAnimalMesh, buildPlayerMesh } from '../src/render/animals';

/**
 * The figures' contract (see animals.ts): every catalog species has one,
 * feet on y = 0, centred on x, flat-shaded and shadow-casting, and the bear
 * is the biggest while the squirrel is the smallest. Whether they *look*
 * like the animal is checked by eye with `?zoo`; this pins what a screenshot
 * cannot.
 */
function bounds(figure: THREE.Object3D): THREE.Box3 {
	figure.updateMatrixWorld(true);
	return new THREE.Box3().setFromObject(figure);
}
function volume(b: THREE.Box3): number {
	const s = b.getSize(new THREE.Vector3());
	return s.x * s.y * s.z;
}

const figures = [
	...ANIMALS.map((spec) => [spec.id, buildAnimalMesh(spec.id)] as const),
	['player', buildPlayerMesh()] as const
];

describe('figures', () => {
	for (const [id, figure] of figures) {
		describe(id, () => {
			const b = bounds(figure);

			it('stands with its feet on y = 0', () => {
				expect(b.min.y).toBeCloseTo(0, 3);
				expect(b.max.y).toBeGreaterThan(0.2);
			});

			it('is centred on x', () => {
				expect(Math.abs(b.min.x + b.max.x)).toBeLessThan(0.01);
			});

			it('is flat-shaded and casts shadows', () => {
				let meshes = 0;
				figure.traverse((o) => {
					if (!(o instanceof THREE.Mesh)) return;
					meshes++;
					expect((o.material as THREE.MeshLambertMaterial).flatShading).toBe(true);
					expect(o.castShadow).toBe(true);
				});
				expect(meshes).toBeGreaterThan(2);
			});

			it('keeps its feet on the ground while idling', () => {
				for (const t of [0, 0.3, 0.7, 1.3, 2.9]) {
					animateIdle(figure, t);
					expect(bounds(figure).min.y).toBeCloseTo(0, 3);
				}
				animateIdle(figure, Math.PI / 2 / 2.4); // peak of the breath
				expect(bounds(figure).max.y).toBeGreaterThan(b.max.y);
			});
		});
	}

	it('sizes the bear biggest and the squirrel smallest', () => {
		const volumes = new Map(ANIMALS.map((s) => [s.id, volume(bounds(buildAnimalMesh(s.id)))]));
		const bear = volumes.get('bear')!;
		const squirrel = volumes.get('squirrel')!;
		for (const [id, v] of volumes) {
			if (id !== 'bear') expect(v, `${id} vs bear`).toBeLessThan(bear);
			if (id !== 'squirrel') expect(v, `${id} vs squirrel`).toBeGreaterThan(squirrel);
		}
		expect(bear / squirrel).toBeGreaterThan(5);
	});

	it('refuses a species that is not in the catalog', () => {
		expect(() => buildAnimalMesh('dragon')).toThrow(/dragon/);
	});
});

describe('the trainer walking', () => {
	const JOINTS = ['armL', 'armR', 'legL', 'legR'];

	it('swings arms and legs through a step, from rest to rest, leading with each foot in turn', () => {
		const figure = buildPlayerMesh();
		const rig = figure.children[0]!;
		const angle = (joint: string) => rig.getObjectByName(joint)!.rotation.x;
		for (const progress of [0, 1]) {
			animateIdle(figure, 0);
			animateWalk(figure, progress, 1);
			for (const joint of JOINTS) expect(angle(joint)).toBeCloseTo(0, 6);
			expect(rig.rotation.z).toBeCloseTo(0, 6);
		}
		animateIdle(figure, 0);
		animateWalk(figure, 0.5, 1);
		const arm = angle('armL');
		expect(Math.abs(arm)).toBeGreaterThan(0.3);
		expect(angle('armR')).toBeCloseTo(-arm, 6);
		// A left arm swings with the right leg, as people walk.
		expect(Math.sign(angle('legR'))).toBe(Math.sign(arm));
		// Mid-stride the feet stay on the ground; the step's hop lifts the whole figure.
		expect(bounds(figure).min.y).toBeGreaterThan(-0.02);
		animateIdle(figure, 0);
		animateWalk(figure, 0.5, -1);
		expect(angle('armL')).toBeCloseTo(-arm, 6);
	});

	it('with no amount, stands still', () => {
		const figure = buildPlayerMesh();
		animateIdle(figure, 0);
		animateWalk(figure, 0.5, 1, 0);
		const rig = figure.children[0]!;
		for (const joint of JOINTS) expect(rig.getObjectByName(joint)!.rotation.x).toBeCloseTo(0, 9);
	});
});
