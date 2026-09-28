import * as THREE from 'three';

/**
 * Figures drawn in few draw calls (#152). A figure (an animal, a trainer, the
 * boat and the glider a trainer carries) is built from primitives, a mesh per
 * part in the part's colour, and drawn like that a trainer with an animal
 * following cost about fifty draw calls a frame, every part drawn twice (on
 * screen and in the sun's shadow): ten friends on screen took a slow tablet
 * from 21 frames a second to 13.
 *
 * `takeShape` merges such a figure, as its builder made it, into the few
 * meshes that draw exactly what the parts drew: every part's triangles where
 * the part stood, in the part's colour, now on its vertices, so every merged
 * figure draws with one material. A part seen from inside (a `BackSide`
 * material: the boat's inside) is turned over, and one seen from both sides
 * is there twice, once each way round, so the one material draws the front of
 * everything and the pixels are the same. The merged shape is shared by every
 * figure of its kind (its `key`: a species, a trainer's look, a boat's trim),
 * and freed with the last of them (`release`).
 *
 * The parts that move on their own are joints (`markJoint`): a trainer's arms
 * and legs, a bird's wings, the wolf's tail, the boat's pennant. How they
 * stay apart is the `mode`:
 *   - `skinned`: the whole figure is one mesh, and each joint is a bone of it,
 *     named and placed as the joint was, so the animations that turn, stretch
 *     and move joints by name (`animals.ts`) move bones and the mesh follows.
 *     A figure with no joints is a plain mesh. One draw call, two with the
 *     shadow. The animals and the trainers.
 *   - `grouped`: each joint stays a group of its own with its parts merged in
 *     it, for figures whose parts show and hide (the glider's roll, its wing
 *     and their lines). The boat and the glider.
 *
 * The merged figure measures as the parts did: `Box3.setFromObject` reads a
 * box per mesh, and each mesh's is set to what the parts' own boxes made it
 * (not the tighter box of its vertices), so what a scene sizes from a figure
 * as it is built (a battle's scale, a portrait's frame) is unchanged. A
 * skinned figure's box is the one it had as built whatever its joints do,
 * and its bounding sphere, which culls it, is twice the reach of that box, to
 * hold a bird's spread wings. Nothing measures a figure mid-pose: what
 * `animals.ts` needs of one (how it lies down, how its wings spread) it
 * measures from the parts, before they are merged.
 */

/** Marks `node` as a joint: a part of a figure that its animations move on their own. */
export function markJoint<T extends THREE.Object3D>(node: T): T {
	node.userData.joint = true;
	return node;
}

const isJoint = (o: THREE.Object3D): boolean => o.userData.joint === true;

/** How a merged figure keeps its joints apart: bones of one mesh, or a mesh per group. */
export type MergeMode = 'skinned' | 'grouped';

/**
 * How far a skinned figure's joints may reach beyond its box as built, as a
 * share of the box's half diagonal: a bird's wings spread out to about twice
 * its width. Its bounding sphere is this big, so it is never culled while any
 * of it is in view (`merge.test.ts` holds every pose the animations give).
 */
export const REACH = 2;

/** Every merged figure's colours are on its vertices: one material draws all of them. */
export const FIGURE_MATERIAL = new THREE.MeshLambertMaterial({
	vertexColors: true,
	flatShading: true
});
/**
 * The same for the skinned ones, apart, and their depth in the sun's shadow
 * too: three.js compiles a material's program for skinned meshes separately,
 * and one material drawing both kinds would switch programs from one figure
 * to the next.
 */
export const SKINNED_MATERIAL = new THREE.MeshLambertMaterial({
	vertexColors: true,
	flatShading: true
});
const SKINNED_DEPTH = new THREE.MeshDepthMaterial();

/** One part as built: its shape, where it stands, its colour, and which frame it moves with. */
interface Piece {
	geometry: THREE.BufferGeometry;
	/** Where it stands in its frame (grouped) or in the figure's (skinned), as built. */
	matrix: THREE.Matrix4;
	color: THREE.Color;
	side: THREE.Side;
	castShadow: boolean;
	/** 0 the figure itself, then each joint in turn. */
	frame: number;
}

/** A joint as built: its name, the frame it hangs from, its place there, and what it carries. */
interface JointRest {
	name: string;
	parent: number;
	position: THREE.Vector3;
	quaternion: THREE.Quaternion;
	scale: THREE.Vector3;
	visible: boolean;
	userData: Record<string, unknown>;
}

/** One merged mesh: in the frame it hangs from, casting a shadow or not, and its box as the parts made it. */
interface MergedMesh {
	frame: number;
	geometry: THREE.BufferGeometry;
	castShadow: boolean;
	box: THREE.Box3;
}

/** A kind of figure, merged: shared by every figure of it on screen. */
export interface Shape {
	readonly key: string;
	readonly mode: MergeMode;
	/** The figure itself as built: its name, place and what it carries (the tests read `userData`). */
	readonly root: JointRest;
	readonly joints: readonly JointRest[];
	readonly meshes: readonly MergedMesh[];
	/** Skinned with joints: each bone's place as built, inverted (the body's is the identity). */
	readonly boneInverses: readonly THREE.Matrix4[] | null;
	/** What the builder measured of the parts, handed to every figure of the kind. */
	readonly measures: Record<string, unknown>;
	users: number;
}

const shapes = new Map<string, Shape>();
/** Which shape a mesh of a figure draws, and which figure it belongs to (one release each). */
const uses = new WeakMap<THREE.Object3D, Use>();
interface Use {
	shape: Shape;
	released: boolean;
}

/**
 * The shape of `key`, merged from what `build` makes the first time (the
 * figure as its primitives, and what was measured of them), and counted as
 * used once more: `instantiate` it, and `release` the figure when it goes.
 */
export function takeShape(
	key: string,
	mode: MergeMode,
	build: () => { root: THREE.Object3D; measures?: Record<string, unknown> }
): Shape {
	let shape = shapes.get(key);
	if (!shape) {
		const { root, measures } = build();
		shape = merge(key, mode, root, measures ?? {});
		shapes.set(key, shape);
	}
	shape.users++;
	return shape;
}

/** How many figures draw each merged shape now: for tests. */
export function shapesInUse(): Map<string, number> {
	return new Map([...shapes].map(([key, shape]) => [key, shape.users]));
}

/**
 * Start again with no shapes, as a page does, leaving each one a figure still
 * holds to it (freed with the last of its own figures). For tests, which
 * build figures they never free: one that counts what a scene frees starts
 * here, so a figure another test left behind shares nothing with its own.
 */
export function forgetShapes(): void {
	shapes.clear();
}

/**
 * A figure of `shape`: its root (named and placed as built) holding the
 * merged meshes, and its joints (bones, or groups), named and placed as
 * built. Its geometry is the shape's: free it with `release`.
 */
export function instantiate(shape: Shape): THREE.Group {
	const use: Use = { shape, released: false };
	const root = new THREE.Group();
	place(root, shape.root);
	uses.set(root, use);
	if (shape.mode === 'skinned') {
		const [only] = shape.meshes;
		if (!only || shape.meshes.length > 1) throw new Error(`${shape.key}: one mesh, skinned`);
		if (!shape.boneInverses) {
			root.add(mesh(new THREE.Mesh(only.geometry, FIGURE_MATERIAL), only, use));
			return root;
		}
		// The mesh, then the bones: the body's (all that moves with the figure itself), and
		// each joint's, hanging where the joint hung.
		const skinned = mesh(new THREE.SkinnedMesh(only.geometry, SKINNED_MATERIAL), only, use);
		const body = new THREE.Bone();
		body.name = 'body';
		root.add(skinned, body);
		const bones: THREE.Bone[] = [body];
		const frames: THREE.Object3D[] = [root];
		for (const rest of shape.joints) {
			const bone = new THREE.Bone();
			place(bone, rest);
			frames[rest.parent]!.add(bone);
			frames.push(bone);
			bones.push(bone);
		}
		// Bound as built: each bone's place then, undone, is where its vertices were merged.
		const skeleton = new THREE.Skeleton(
			bones,
			shape.boneInverses.map((m) => m.clone())
		);
		skinned.bind(skeleton, new THREE.Matrix4());
		skinned.customDepthMaterial = SKINNED_DEPTH;
		skinned.boundingBox = only.box.clone();
		skinned.boundingSphere = only.box.getBoundingSphere(new THREE.Sphere());
		skinned.boundingSphere.radius *= REACH;
		return root;
	}
	const frames: THREE.Object3D[] = [root];
	for (const rest of shape.joints) {
		const group = new THREE.Group();
		place(group, rest);
		frames[rest.parent]!.add(group);
		frames.push(group);
	}
	for (const merged of shape.meshes) {
		frames[merged.frame]!.add(mesh(new THREE.Mesh(merged.geometry, FIGURE_MATERIAL), merged, use));
	}
	return root;
}

function mesh<T extends THREE.Mesh>(m: T, merged: MergedMesh, use: Use): T {
	m.castShadow = merged.castShadow;
	uses.set(m, use);
	return m;
}

function place(node: THREE.Object3D, rest: JointRest): void {
	node.name = rest.name;
	node.position.copy(rest.position);
	node.quaternion.copy(rest.quaternion);
	node.scale.copy(rest.scale);
	node.visible = rest.visible;
	node.userData = { ...rest.userData };
}

/**
 * Let go of every merged figure under `root` (itself, a boat on a trainer's
 * back): each figure once, however often it is released. The last figure of
 * a kind frees its shape. A skinned figure's bones are freed with it, and a
 * geometry of the figure's own (a resting animal's z's) is freed too.
 */
export function release(root: THREE.Object3D): void {
	const own = new Set<THREE.BufferGeometry>();
	root.traverse((o) => {
		const use = uses.get(o);
		if (use && !use.released) {
			use.released = true;
			const shape = use.shape;
			shape.users--;
			if (shape.users <= 0) {
				if (shapes.get(shape.key) === shape) shapes.delete(shape.key);
				for (const merged of shape.meshes) merged.geometry.dispose();
			}
		}
		if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
		else if (o instanceof THREE.Mesh && !uses.has(o)) own.add(o.geometry);
	});
	for (const geometry of own) geometry.dispose();
}

// --- merging ------------------------------------------------------------------

function merge(
	key: string,
	mode: MergeMode,
	root: THREE.Object3D,
	measures: Record<string, unknown>
): Shape {
	root.updateWorldMatrix(true, true);
	const frames: THREE.Object3D[] = [root];
	const joints: JointRest[] = [];
	const pieces: Piece[] = [];
	const visit = (node: THREE.Object3D, frame: number) => {
		for (const child of node.children) {
			if (isJoint(child)) {
				// A joint turns about its own place in the frame it hangs from: nothing between them.
				if (node !== frames[frame]) {
					throw new Error(`${key}: joint ${child.name} hangs from a part, not a joint`);
				}
				joints.push({ ...rest(child), parent: frame });
				frames.push(child);
				visit(child, frames.length - 1);
				continue;
			}
			if (child instanceof THREE.Mesh) pieces.push(piece(key, child, frame));
			visit(child, frame);
		}
	};
	visit(root, 0);
	// Each part where it stands in the frame it is merged in: the figure's own (skinned), or its joint's.
	const inverse = frames.map((f) => f.matrixWorld.clone().invert());
	const skinned = mode === 'skinned';
	for (const p of pieces) {
		p.matrix.multiplyMatrices(inverse[skinned ? 0 : p.frame]!, p.matrix);
	}
	const meshes: MergedMesh[] = [];
	const groups = new Map<string, Piece[]>();
	for (const p of pieces) {
		const group = `${skinned ? 0 : p.frame}:${p.castShadow}`;
		const list = groups.get(group) ?? [];
		list.push(p);
		groups.set(group, list);
	}
	for (const [group, list] of groups) {
		const frame = skinned ? 0 : list[0]!.frame;
		const box = new THREE.Box3();
		for (const p of list) {
			p.geometry.computeBoundingBox();
			box.union(p.geometry.boundingBox!.clone().applyMatrix4(p.matrix));
		}
		const geometry = mergePieces(list, skinned && joints.length > 0);
		geometry.boundingBox = box.clone();
		meshes.push({ frame, geometry, castShadow: group.endsWith('true'), box });
	}
	if (skinned && meshes.length !== 1) {
		throw new Error(`${key}: a skinned figure's parts all cast a shadow, or none do`);
	}
	for (const p of pieces) p.geometry.dispose();
	// A bone's place as built, in the figure's frame: where its parts were merged, undone.
	const boneInverses =
		skinned && joints.length > 0
			? [
					new THREE.Matrix4(),
					...frames.slice(1).map((_, i) => inverse[i + 1]!.clone().multiply(root.matrixWorld))
				]
			: null;
	return {
		key,
		mode,
		root: { ...rest(root), parent: -1 },
		joints,
		meshes,
		boneInverses,
		measures,
		users: 0
	};
}

function rest(node: THREE.Object3D): Omit<JointRest, 'parent'> {
	return {
		name: node.name,
		position: node.position.clone(),
		quaternion: node.quaternion.clone(),
		scale: node.scale.clone(),
		visible: node.visible,
		userData: { ...node.userData }
	};
}

/**
 * A part as built. Only what merging draws exactly as it was: a shown part,
 * in one flat-shaded, opaque, lit colour (the facets' light comes from the
 * pixels, not the normals, so a part turned over lights the same).
 */
function piece(key: string, mesh: THREE.Mesh, frame: number): Piece {
	const material = mesh.material;
	const plain =
		material instanceof THREE.MeshLambertMaterial &&
		material.flatShading &&
		!material.transparent &&
		!material.vertexColors &&
		material.map === null &&
		material.emissive.getHex() === 0;
	if (!plain) throw new Error(`${key}: a part in one plain colour, please (${mesh.name})`);
	if (!mesh.visible) throw new Error(`${key}: a hidden part would show once merged`);
	const { color, side } = material as THREE.MeshLambertMaterial;
	return {
		geometry: mesh.geometry,
		matrix: mesh.matrixWorld.clone(),
		color: color.clone(),
		side,
		castShadow: mesh.castShadow,
		frame
	};
}

/**
 * The pieces as one geometry: positions and normals where each piece stands,
 * its colour on its vertices, which frame each vertex moves with (`skin`),
 * and every triangle wound the way it is seen: a piece seen from inside turned
 * over, one seen from both sides there both ways round, and one placed as in
 * a mirror (which turns its triangles over) turned back.
 */
function mergePieces(pieces: readonly Piece[], skin: boolean): THREE.BufferGeometry {
	const position: number[] = [];
	const normal: number[] = [];
	const color: number[] = [];
	const skinIndex: number[] = [];
	const skinWeight: number[] = [];
	const index: number[] = [];
	const v = new THREE.Vector3();
	const n = new THREE.Vector3();
	const turn = new THREE.Matrix3();
	for (const p of pieces) {
		const from = p.geometry.getAttribute('position');
		const normals = p.geometry.getAttribute('normal');
		turn.getNormalMatrix(p.matrix);
		const base = position.length / 3;
		for (let i = 0; i < from.count; i++) {
			v.fromBufferAttribute(from, i).applyMatrix4(p.matrix);
			position.push(v.x, v.y, v.z);
			if (normals) n.fromBufferAttribute(normals, i).applyMatrix3(turn).normalize();
			else n.set(0, 1, 0);
			normal.push(n.x, n.y, n.z);
			color.push(p.color.r, p.color.g, p.color.b);
			if (skin) {
				skinIndex.push(p.frame, 0, 0, 0);
				skinWeight.push(1, 0, 0, 0);
			}
		}
		const triangles = p.geometry.index;
		const count = triangles ? triangles.count : from.count;
		const at = (k: number) => base + (triangles ? triangles.getX(k) : k);
		const flip = (p.side === THREE.BackSide) !== p.matrix.determinant() < 0;
		for (let k = 0; k + 2 < count; k += 3) {
			const [a, b, c] = [at(k), at(k + 1), at(k + 2)];
			if (p.side === THREE.DoubleSide) index.push(a, b, c, a, c, b);
			else if (flip) index.push(a, c, b);
			else index.push(a, b, c);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
	if (skin) {
		geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
		geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
	}
	geometry.setIndex(index);
	return geometry;
}
