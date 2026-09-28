import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { POOF_SECONDS, Poofs } from '../src/render/poof';

/**
 * The poofs (`poof.ts`): each fades with a material to itself, and a
 * material outlives its poof. three.js frees a shader program with the last
 * material that drew with it, so a poof that freed its own had the program
 * compiled again for the next poof: in the game, a freeze every time a friend
 * turned up or an animal missed in a battle beside the kid (#152).
 */
describe('poofs', () => {
	it('hand their materials on to the poofs after them and free none: never more than ever played at once', () => {
		const scene = new THREE.Scene();
		const poofs = new Poofs(scene);
		const materials = new Set<THREE.Material>();
		let freed = 0;
		let now = 0;
		let most = 0;
		const look = () =>
			scene.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				const material = o.material as THREE.Material;
				if (materials.has(material)) return;
				materials.add(material);
				material.addEventListener('dispose', () => freed++);
			});
		for (let i = 0; i < 40; i++) {
			// Mostly one at a time; now and then three at once, calm ones too.
			const together = i % 5 === 0 ? 3 : 1;
			for (let k = 0; k < together; k++) poofs.play(new THREE.Vector3(i, 0, k), k === 1);
			most = Math.max(most, poofs.playing);
			// Each one starts as a full burst, whoever faded its material out before.
			poofs.update(now);
			look();
			scene.traverse((o) => {
				if (o instanceof THREE.Mesh)
					expect((o.material as THREE.Material).opacity).toBeCloseTo(0.95, 6);
			});
			for (let t = 0; t < POOF_SECONDS + 0.2; t += 0.1) {
				poofs.update((now += 0.1));
				look();
			}
			expect(poofs.playing).toBe(0);
		}
		expect(most).toBe(3);
		expect(freed).toBe(0);
		expect(materials.size).toBeLessThanOrEqual(most);
		// Gone from the scene all the same.
		expect(scene.children).toEqual([]);
	});
});
