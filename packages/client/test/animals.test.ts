import { ANIMALS, spawnPoint } from '@mathgame/engine';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WORLD_SEED } from '../src/authority/local';
import { motion } from '../src/motion';
import {
	animateFlight,
	animateIdle,
	animateWalk,
	buildAnimalMesh,
	buildPlayerMesh
} from '../src/render/animals';
import { Zoo } from '../src/render/zoo';

/**
 * The figures' contract (see animals.ts): every catalog species has one,
 * feet on y = 0, centred on x, flat-shaded and shadow-casting, and bigger
 * with its tier: on land the smallest is a tier-1 animal and the biggest a
 * tier-5 one, at sea the whale the biggest. Whether they *look*
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

	it('sizes by tier: on land the smallest a tier-1 animal and the biggest a tier-5 one, at sea the whale biggest, and two tiers up always bigger', () => {
		const volumes = new Map(ANIMALS.map((s) => [s.id, volume(bounds(buildAnimalMesh(s.id)))]));
		const onLand = ANIMALS.filter((s) => s.realms.includes('land'));
		const atSea = ANIMALS.filter((s) => !s.realms.includes('land'));
		const bySize = [...onLand].sort((a, b) => volumes.get(a.id)! - volumes.get(b.id)!);
		expect(bySize[0]!.tier, `${bySize[0]!.id} is the smallest on land`).toBe(1);
		expect(bySize.at(-1)!.tier, `${bySize.at(-1)!.id} is the biggest on land`).toBe(5);
		// Inside a tier, size follows nature: the shrew, the stag beetle and the robin are
		// smaller than the squirrel; the sea eagle is bigger than the golden eagle, and the
		// eagle-owl than the tawny owl, a tier below it (#89).
		const squirrel = volumes.get('squirrel')!;
		for (const id of ['shrew', 'stag-beetle', 'robin']) {
			expect(volumes.get(id)!, `${id} vs squirrel`).toBeLessThan(squirrel);
		}
		expect(volumes.get('white-tailed-eagle')!).toBeGreaterThan(volumes.get('golden-eagle')!);
		expect(volumes.get('eagle-owl')!).toBeGreaterThan(volumes.get('tawny-owl')!);
		expect(volumes.get('bear')! / squirrel).toBeGreaterThan(5);
		// The moose stands tallest on land, over the bear and the red deer's antlers.
		const height = (id: string) => bounds(buildAnimalMesh(id)).getSize(new THREE.Vector3()).y;
		for (const { id } of onLand)
			if (id !== 'moose') expect(height(id), `${id} vs moose`).toBeLessThan(height('moose'));
		const whale = volumes.get('whale')!;
		for (const { id } of atSea)
			if (id !== 'whale') expect(volumes.get(id)!, id).toBeLessThan(whale);
		// At sea too (#89's third wave): the orca is smaller than the humpback, the grey seal
		// bigger than the harbour seal, the porpoise smaller than the dolphin, and the lion's
		// mane's bell bigger than the moon jellyfish's.
		for (const [big, small] of [
			['grey-seal', 'harbour-seal'],
			['dolphin', 'harbour-porpoise'],
			['lions-mane-jellyfish', 'moon-jellyfish']
		] as const)
			expect(volumes.get(big)!, `${big} vs ${small}`).toBeGreaterThan(volumes.get(small)!);
		for (const big of ANIMALS)
			for (const small of ANIMALS)
				if (big.tier >= small.tier + 2)
					expect(volumes.get(big.id)!, `${big.id} vs ${small.id}`).toBeGreaterThan(
						volumes.get(small.id)!
					);
	});

	it("hangs every bird's wings from a pair of shoulder joints, wingL and wingR, and no other animal's (#91)", () => {
		const birds = [
			'robin',
			'grey-heron',
			'tawny-owl',
			'buzzard',
			'mute-swan',
			'eagle-owl',
			'golden-eagle',
			'white-tailed-eagle'
		];
		// Every bird flies, and only birds (the engine's realms).
		expect(ANIMALS.filter((a) => a.realms.includes('air')).map((a) => a.id)).toEqual(birds);
		for (const id of birds) {
			const figure = buildAnimalMesh(id);
			const left = figure.getObjectByName('wingL');
			const right = figure.getObjectByName('wingR');
			expect(left && right, id).toBeTruthy();
			expect(left!.position.x, id).toBeLessThan(0);
			expect(left!.position.x, id).toBeCloseTo(-right!.position.x, 9);
			expect(left!.position.y, id).toBeCloseTo(right!.position.y, 9);
			expect(left!.children.length, id).toBeGreaterThan(0);
			expect(right!.children.length, id).toBe(left!.children.length);
		}
		for (const { id } of ANIMALS)
			if (!birds.includes(id))
				expect(buildAnimalMesh(id).getObjectByName('wingL'), id).toBeUndefined();
	});

	it('in the air every bird spreads its wings out past its sides, the two a mirror pair, beating (held still with reduced motion), and folds them back as built (#91)', () => {
		for (const { id } of ANIMALS.filter((a) => a.realms.includes('air'))) {
			const figure = buildAnimalMesh(id);
			const rig = figure.children[0]!;
			const left = figure.getObjectByName('wingL')!;
			const right = figure.getObjectByName('wingR')!;
			// The body: every part but the wings.
			const body = new THREE.Box3();
			figure.updateMatrixWorld(true);
			for (const part of rig.children)
				if (part !== left && part !== right) body.expandByObject(part);
			const half = Math.max(-body.min.x, body.max.x);
			const folded = [bounds(left), bounds(right)];
			const tips: number[] = [];
			for (let i = 0; i < 16; i++) {
				const t = i * 0.04;
				animateFlight(figure, t, 1, false);
				const [l, r] = [bounds(left), bounds(right)];
				// Out past its sides by a fifth of its width at least, the one wing the other's mirror.
				expect(r.max.x, `${id} at ${t}`).toBeGreaterThan(half * 1.2);
				expect(l.min.x, `${id} at ${t}`).toBeCloseTo(-r.max.x, 6);
				expect(l.max.y, `${id} at ${t}`).toBeCloseTo(r.max.y, 6);
				tips.push(r.max.y);
			}
			// It beats: its wing's top rises and falls through the beat.
			expect(Math.max(...tips) - Math.min(...tips), id).toBeGreaterThan(0.05);
			// With reduced motion the wings are held out still, gliding.
			const calm = [0, 0.3, 0.9].map((t) => {
				animateFlight(figure, t, 1, true);
				return bounds(right).max.y;
			});
			expect(new Set(calm.map((y) => y.toFixed(9))).size, id).toBe(1);
			// Held out, a wing reaches out from its shoulder further than it is deep from front to
			// back: a wing spread, never one still lying along the body, as the heron's and the
			// swan's, laid back along their sides, did when only turned out.
			const spread = bounds(right);
			const shoulder = right.getWorldPosition(new THREE.Vector3());
			expect(spread.max.x - shoulder.x, id).toBeGreaterThan(spread.max.z - spread.min.z);
			// Folded again, exactly as built.
			animateFlight(figure, 0.5, 0);
			expect(bounds(left).equals(folded[0]!), id).toBe(true);
			expect(bounds(right).equals(folded[1]!), id).toBe(true);
		}
		// Any other animal is left as it is.
		const squirrel = buildAnimalMesh('squirrel');
		const before = bounds(squirrel);
		animateFlight(squirrel, 0.3, 1, false);
		expect(bounds(squirrel).equals(before)).toBe(true);
	});

	it('refuses a species that is not in the catalog', () => {
		expect(() => buildAnimalMesh('dragon')).toThrow(/dragon/);
	});
});

/**
 * A tired animal lies down to rest (UI_SPEC § Battle mode): on its belly, legs
 * tucked out of sight, never tipped onto its side — a deer on its side read as
 * fallen furniture. Every species, so a new one's figure lies down too.
 */
describe('a tired animal, resting', () => {
	const camera = new THREE.PerspectiveCamera();
	for (const spec of ANIMALS) {
		it(`${spec.id} lies on its belly, upright and lower, with z's only once it is down`, () => {
			const figure = buildAnimalMesh(spec.id);
			const rig = figure.children[0]!;
			const standing = bounds(rig);
			const width = standing.max.x - standing.min.x;
			// What stands clear of the ground: the body over the legs, the head, a tail.
			const raised = rig.children.filter((part) => bounds(part).min.y > 0.005);

			figure.userData.rest = 0.5;
			animateIdle(figure, 1, camera);
			expect(figure.getObjectByName('zs')?.visible ?? false, 'z-s on the way down').toBe(false);

			figure.userData.rest = 1;
			animateIdle(figure, 1, camera);
			const lying = bounds(rig);
			const body = raised.map((part) => bounds(part).min.y);
			// Down on the ground, the body touching it, and still standing up out of it.
			expect(Math.min(...body)).toBeLessThanOrEqual(0.01);
			expect(lying.max.y).toBeLessThan(standing.max.y * 0.95);
			expect(lying.max.y).toBeGreaterThan(standing.max.y * 0.45);
			// Upright: as wide as it stands, where a figure on its side is as wide as it was tall.
			expect(Math.abs(lying.max.x - lying.min.x - width)).toBeLessThan(width * 0.1);
			// The z's rise over it once it is down, and only where there is a camera to face.
			const zs = figure.getObjectByName('zs');
			expect(zs?.visible).toBe(true);
			expect(zs!.children.some((z) => z.visible)).toBe(true);
			animateIdle(figure, 2);
			expect(zs!.visible).toBe(false);
		});
	}
});

describe('the ?zoo line-up', () => {
	it('stands once in the page: a game picked up again or started anew puts up no second one', () => {
		const world: THREE.Group[] = [];
		const zoo = new Zoo({ addFigure: (figure) => world.push(figure) }, false);
		const spawn = spawnPoint(WORLD_SEED);
		zoo.welcome(WORLD_SEED, spawn);
		const lineUp = [...world];
		expect(lineUp).toHaveLength(ANIMALS.length);
		// Continue after the Start screen, seven steps on; then a new game from the title.
		zoo.welcome(WORLD_SEED, { x: spawn.x + 7, y: spawn.y });
		zoo.welcome(WORLD_SEED, spawn);
		expect(world).toHaveLength(ANIMALS.length);
		expect(world.every((figure, i) => figure === lineUp[i])).toBe(true);
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

	it('with reduced motion, swings its limbs less and never rocks (UI_SPEC § Sound and juice)', () => {
		const figure = buildPlayerMesh();
		const rig = figure.children[0]!;
		const swing = (reduced: boolean, progress: number) => {
			motion.reduced = reduced;
			try {
				animateIdle(figure, 0);
				animateWalk(figure, progress, 1);
			} finally {
				motion.reduced = false;
			}
			return { arm: rig.getObjectByName('armL')!.rotation.x, rock: rig.rotation.z };
		};
		for (const progress of [0.1, 0.25, 0.5, 0.75, 0.9]) {
			const full = swing(false, progress);
			const calm = swing(true, progress);
			expect(Math.abs(full.rock)).toBeGreaterThan(0);
			expect(calm.rock).toBe(0);
			expect(Math.abs(calm.arm)).toBeGreaterThan(0);
			expect(Math.abs(calm.arm)).toBeLessThan(Math.abs(full.arm) / 2);
		}
	});
});
