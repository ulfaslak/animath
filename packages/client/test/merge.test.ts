import { ANIMALS } from '@mathgame/engine';
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	animateFlight,
	animateIdle,
	animateWalk,
	buildAnimalMesh,
	buildAnimalParts,
	buildPlayerMesh,
	buildPlayerParts,
	disposeFigure
} from '../src/render/animals';
import { buildBoatMesh, buildBoatParts, disposeBoat, poseBoat } from '../src/render/boat';
import { animateSwing } from '../src/render/clearing';
import { buildGliderMesh, buildGliderParts, poseGlider } from '../src/render/glider';
import { REACH, forgetShapes, shapesInUse } from '../src/render/merge';
import { PLAYER_LOOK, TRAINER_LOOKS } from '../src/render/palette';

/**
 * Figures drawn in few draw calls (`merge.ts`, #152): a figure drawn is its
 * parts merged, and it must draw exactly what the parts drew, in every pose
 * the animations give it. Two figures that draw the same triangles, each in
 * the same place, wound the same way round and in the same colour, draw the
 * same pixels: the material is the same flat-shaded lit one, whose facets
 * take their light from where they are, never from their normals. So this
 * compares triangles, with no WebGL: the parts as built (`buildAnimalParts`)
 * against the figure drawn (`buildAnimalMesh`), both posed alike.
 */

beforeEach(() => forgetShapes());

/**
 * A triangle as drawn: its corners in the world (x, y, z each, in the order
 * that faces the camera, counter-clockwise), its colour, whether it casts a
 * shadow, and its middle.
 */
interface Triangle {
	corners: number[];
	rgb: [number, number, number];
	shadow: boolean;
	middle: [number, number, number];
}

/** Whether `o` and everything it hangs from are shown. */
function shown(o: THREE.Object3D): boolean {
	for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
	return true;
}

/**
 * Every triangle `root` draws, as it stands now. A part seen from inside
 * (`BackSide`) is drawn turned over, one seen from both sides both ways
 * round, and one placed as in a mirror turned back, as WebGL culls them. A
 * skinned mesh's corners are where its bones put them.
 */
function triangles(root: THREE.Object3D): Triangle[] {
	root.updateMatrixWorld(true);
	const out: Triangle[] = [];
	const v = new THREE.Vector3();
	root.traverse((o) => {
		if (!(o instanceof THREE.Mesh) || !shown(o)) return;
		const material = o.material as THREE.MeshLambertMaterial;
		if (!material.flatShading) throw new Error(`${o.name}: not flat-shaded`);
		const geometry = o.geometry as THREE.BufferGeometry;
		const position = geometry.getAttribute('position');
		const colors = material.vertexColors ? geometry.getAttribute('color') : null;
		// Each corner where it is drawn, worked out once.
		const world = new Float64Array(position.count * 3);
		for (let i = 0; i < position.count; i++) {
			o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
			world.set([v.x, v.y, v.z], i * 3);
		}
		const rgb = (i: number): [number, number, number] =>
			colors
				? [colors.getX(i), colors.getY(i), colors.getZ(i)]
				: [material.color.r, material.color.g, material.color.b];
		const index = geometry.index;
		const count = index ? index.count : position.count;
		const at = (k: number) => (index ? index.getX(k) : k);
		const mirrored = o.matrixWorld.determinant() < 0;
		const ways =
			material.side === THREE.DoubleSide
				? [false, true]
				: [(material.side === THREE.BackSide) !== mirrored];
		for (let k = 0; k + 2 < count; k += 3) {
			const abc = [at(k), at(k + 1), at(k + 2)];
			const color = rgb(abc[0]!);
			if (abc.some((i) => rgb(i).some((c, j) => c !== color[j]))) {
				throw new Error(`${o.name}: a triangle in two colours`);
			}
			for (const flip of ways) {
				const order = flip ? [...abc].reverse() : abc;
				const corners = order.flatMap((i) => [world[i * 3]!, world[i * 3 + 1]!, world[i * 3 + 2]!]);
				const middle: [number, number, number] = [0, 1, 2].map(
					(j) => (corners[j]! + corners[j + 3]! + corners[j + 6]!) / 3
				) as [number, number, number];
				out.push({ corners, rgb: color, shadow: o.castShadow, middle });
			}
		}
	});
	return out;
}

/** Whether `b` is `a`, corner for corner in some turn of the same winding. */
function same(a: Triangle, b: Triangle, tolerance: number): boolean {
	if (a.shadow !== b.shadow) return false;
	if (a.rgb.some((c, j) => Math.abs(c - b.rgb[j]!) > 1e-6)) return false;
	const t2 = tolerance * tolerance;
	for (let turn = 0; turn < 3; turn++) {
		let ok = true;
		for (let i = 0; i < 3 && ok; i++) {
			const [p, q] = [i * 3, ((i + turn) % 3) * 3];
			const d =
				(a.corners[p]! - b.corners[q]!) ** 2 +
				(a.corners[p + 1]! - b.corners[q + 1]!) ** 2 +
				(a.corners[p + 2]! - b.corners[q + 2]!) ** 2;
			ok = d <= t2;
		}
		if (ok) return true;
	}
	return false;
}

/**
 * The parts' triangles that `drawn` does not draw, and the ones `drawn` draws
 * that the parts do not: each matched once, found by where its middle is.
 */
function differences(parts: Triangle[], drawn: Triangle[], tolerance = 1e-5): string[] {
	const CELL = 1e-3;
	const cellOf = (t: Triangle) => t.middle.map((c) => Math.floor(c / CELL));
	const grid = new Map<string, Triangle[]>();
	for (const t of drawn) {
		const key = cellOf(t).join();
		const list = grid.get(key);
		if (list) list.push(t);
		else grid.set(key, [t]);
	}
	const take = (key: string, t: Triangle): boolean => {
		const list = grid.get(key);
		const i = list ? list.findIndex((d) => same(t, d, tolerance)) : -1;
		if (i < 0) return false;
		list!.splice(i, 1);
		return true;
	};
	const problems: string[] = [];
	for (const t of parts) {
		const [x, y, z] = cellOf(t) as [number, number, number];
		// Its own cell nearly always; the next ones when its middle sits on an edge between them.
		let found = take(`${x},${y},${z}`, t);
		for (let d = 0; !found && d < 27; d++) {
			if (d === 13) continue;
			found = take(
				`${x + (d % 3) - 1},${y + (Math.floor(d / 3) % 3) - 1},${z + Math.floor(d / 9) - 1}`,
				t
			);
		}
		if (!found && problems.length < 6) problems.push(`not drawn: ${told(t)}`);
	}
	for (const list of grid.values())
		for (const t of list) if (problems.length < 6) problems.push(`drawn too: ${told(t)}`);
	return problems;
}

function told(t: Triangle): string {
	const c = [0, 3, 6].map(
		(i) =>
			`(${t.corners
				.slice(i, i + 3)
				.map((x) => x.toFixed(4))
				.join(', ')})`
	);
	const hex = new THREE.Color(...t.rgb).getHexString();
	return `${c.join(' ')} #${hex}${t.shadow ? '' : ' no shadow'}`;
}

/** Both built alike, posed alike, and compared at every pose. */
function expectSame(
	what: string,
	parts: THREE.Object3D,
	drawn: THREE.Object3D,
	poses: [string, (figure: THREE.Object3D) => void][]
): void {
	for (const [pose, apply] of poses) {
		apply(parts);
		apply(drawn);
		const a = triangles(parts);
		const b = triangles(drawn);
		expect(b.length, `${what} ${pose}: as many triangles`).toBe(a.length);
		expect(differences(a, b), `${what} ${pose}`).toEqual([]);
	}
}

/** The figure itself moved about the world as the scenes do: turned, grown, lifted. */
function placed(figure: THREE.Object3D): void {
	figure.position.set(3.2, 0.4, -7.5);
	figure.rotation.set(0, 2.1, 0.05);
	figure.scale.setScalar(1.35);
}

const camera = new THREE.PerspectiveCamera();

describe('a figure drawn in one go draws exactly its parts', () => {
	for (const { id, realms } of ANIMALS) {
		it(`${id}: standing, breathing, ${realms.includes('air') ? 'flying, ' : ''}lying down, anywhere`, () => {
			const rest = (r: number) => (f: THREE.Object3D) => {
				f.userData.rest = r;
				animateIdle(f as THREE.Group, 1.3);
			};
			const flying: [string, (f: THREE.Object3D) => void][] = realms.includes('air')
				? [
						['wings spread, beating', (f) => animateFlight(f, 0.3, 1, false)],
						['wings half open', (f) => animateFlight(f, 0.55, 0.5, false)],
						['wings held still', (f) => animateFlight(f, 0.2, 1, true)],
						['folded again', (f) => animateFlight(f, 0.5, 0)]
					]
				: [];
			expectSame(id, buildAnimalParts(id), buildAnimalMesh(id), [
				['as built', () => {}],
				['breathing', (f) => animateIdle(f as THREE.Group, 0.7)],
				...flying,
				['lying down', rest(0.5)],
				['lying down, all the way', rest(1)],
				['placed in the world', placed]
			]);
		});
	}

	for (const look of [PLAYER_LOOK, ...TRAINER_LOOKS]) {
		it(`a trainer in ${look.shirt.toString(16)}: walking, swinging a tool, holding the glider's lines`, () => {
			const arms = (f: THREE.Object3D) => {
				for (const [name, side] of [
					['armL', -1],
					['armR', 1]
				] as const)
					f.getObjectByName(name)!.rotation.z = side * 0.35;
			};
			expectSame(`trainer ${look.shirt}`, buildPlayerParts(look), buildPlayerMesh(look), [
				['as built', () => {}],
				['mid-stride', (f) => animateWalk(f as THREE.Group, 0.5, 1)],
				['the other foot', (f) => animateWalk(f as THREE.Group, 0.3, -1)],
				['the tool raised', (f) => animateSwing(f, 0.4, false)],
				['the tool struck', (f) => animateSwing(f, 0.62, false)],
				["holding the glider's lines", arms],
				['breathing, placed in the world', (f) => (animateIdle(f as THREE.Group, 0.9), placed(f))]
			]);
		});
	}

	it('the boat: on the back, swinging under, afloat and rocking, in every trim', () => {
		for (const trim of [undefined, ...TRAINER_LOOKS.map((l) => l.shirt)]) {
			expectSame(`boat ${trim}`, buildBoatParts(trim), buildBoatMesh(trim), [
				['on the back', (b) => poseBoat(b as THREE.Group, 0, false)],
				['swinging under', (b) => poseBoat(b as THREE.Group, 0.5, false)],
				['nearly afloat', (b) => poseBoat(b as THREE.Group, 0.85, false)],
				['afloat, rocking', (b) => poseBoat(b as THREE.Group, 1, false, 0.03)],
				['placed in the world', placed]
			]);
		}
	});

	it('the glider: folded, opening, open, over a boat, and a friend’s shown only while it flies', () => {
		for (const color of [undefined, ...TRAINER_LOOKS.map((l) => l.shirt)]) {
			expectSame(`glider ${color}`, buildGliderParts(color), buildGliderMesh(color), [
				['folded', (g) => poseGlider(g as THREE.Group, 0, false, false)],
				['opening', (g) => poseGlider(g as THREE.Group, 0.4, false, false)],
				['open', (g) => poseGlider(g as THREE.Group, 1, false, false)],
				['over a boat', (g) => poseGlider(g as THREE.Group, 0.9, false, true)],
				["a friend's, folded", (g) => poseGlider(g as THREE.Group, 0, false, false, false)],
				['placed in the world', placed]
			]);
		}
	});
});

describe('a figure drawn in one go measures as its parts did', () => {
	const box = (o: THREE.Object3D) => {
		o.updateMatrixWorld(true);
		return new THREE.Box3().setFromObject(o);
	};

	it('the same box as built, which sizes it in a battle, a portrait and the starters', () => {
		for (const { id } of ANIMALS) {
			const [parts, drawn] = [buildAnimalParts(id), buildAnimalMesh(id)];
			expect(box(drawn).equals(box(parts)), id).toBe(true);
			// And how it lies down, measured from its parts.
			expect(drawn.userData.restShape, id).toEqual(parts.userData.restShape);
		}
		expect(box(buildPlayerMesh()).equals(box(buildPlayerParts()))).toBe(true);
	});

	it('a skinned figure is never culled while any of it is in view: every pose stays in its sphere', () => {
		const poses: [string, (f: THREE.Group) => void][] = [
			['spread', (f) => animateFlight(f, 0.3, 1, false)],
			['beat up', (f) => animateFlight(f, Math.PI / 2 / 10, 1, false)],
			['beat down', (f) => animateFlight(f, (3 * Math.PI) / 2 / 10, 1, false)],
			['down', (f) => ((f.userData.rest = 1), animateIdle(f, 0.4))],
			['stride', (f) => animateWalk(f, 0.5, 1)],
			['tool raised', (f) => animateSwing(f, 0.4, false)],
			['tool struck', (f) => animateSwing(f, 0.62, false)]
		];
		const figures = [...ANIMALS.map((a) => buildAnimalMesh(a.id)), buildPlayerMesh()];
		let skinned = 0;
		for (const figure of figures) {
			const mesh = figure.children[0]!.children[0];
			if (!(mesh instanceof THREE.SkinnedMesh)) continue;
			skinned++;
			for (const [name, pose] of poses) {
				pose(figure);
				figure.updateMatrixWorld(true);
				const sphere = mesh.boundingSphere!;
				const position = mesh.geometry.getAttribute('position');
				let far = 0;
				for (let i = 0; i < position.count; i++) {
					far = Math.max(
						far,
						mesh.getVertexPosition(i, new THREE.Vector3()).distanceTo(sphere.center)
					);
				}
				expect(far, `${figure.name} ${name}`).toBeLessThanOrEqual(sphere.radius);
			}
		}
		// Nordland's eight birds and The Arctic's nine (#192), the wolf's tail, the octopus's arms,
		// the stag beetle's jaws, the trainer.
		expect(skinned).toBe(21);
		expect(REACH).toBeGreaterThan(1);
	});
});

describe('a kind of figure is one shape, shared', () => {
	it('by every figure of it, and freed with the last of them', () => {
		const a = buildAnimalMesh('fox');
		const b = buildAnimalMesh('fox');
		const geometry = (f: THREE.Object3D) => (f.children[0]!.children[0] as THREE.Mesh).geometry;
		expect(geometry(a)).toBe(geometry(b));
		expect(shapesInUse().get('animal:fox')).toBe(2);
		let freed = 0;
		geometry(a).addEventListener('dispose', () => freed++);
		disposeFigure(a);
		disposeFigure(a);
		expect([freed, shapesInUse().get('animal:fox')]).toEqual([0, 1]);
		disposeFigure(b);
		expect([freed, shapesInUse().has('animal:fox')]).toEqual([1, false]);
		// The next fox is merged afresh.
		const c = buildAnimalMesh('fox');
		expect(geometry(c)).not.toBe(geometry(a));
		disposeFigure(c);
	});

	it('each figure with bones of its own, posed on its own', () => {
		const a = buildPlayerMesh();
		const b = buildPlayerMesh();
		animateWalk(a, 0.5, 1);
		expect(Math.abs(a.getObjectByName('armL')!.rotation.x)).toBeGreaterThan(0.3);
		expect(Math.abs(b.getObjectByName('armL')!.rotation.x)).toBe(0);
		const skeleton = (f: THREE.Object3D) =>
			(f.children[0]!.children[0] as THREE.SkinnedMesh).skeleton;
		expect(skeleton(a)).not.toBe(skeleton(b));
		expect(skeleton(a).bones.map((bone) => bone.name)).toEqual([
			'body',
			'legL',
			'legR',
			'armL',
			'armR'
		]);
		let freed = 0;
		skeleton(a).boneTexture = null;
		skeleton(a).computeBoneTexture();
		skeleton(a).boneTexture!.addEventListener('dispose', () => freed++);
		disposeFigure(a);
		expect(freed).toBe(1);
		disposeFigure(b);
	});

	it('a trainer in each look, a boat and a glider in each colour: a shape apiece', () => {
		const trainers = TRAINER_LOOKS.map((look) => buildPlayerMesh(look));
		const boats = TRAINER_LOOKS.map((look) => buildBoatMesh(look.shirt));
		expect(
			new Set(trainers.map((t) => (t.children[0]!.children[0] as THREE.Mesh).geometry)).size
		).toBe(TRAINER_LOOKS.length);
		for (const t of trainers) disposeFigure(t);
		for (const b of boats) disposeBoat(b);
		expect([...shapesInUse().keys()]).toEqual([]);
	});
});
