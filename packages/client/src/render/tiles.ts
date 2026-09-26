import { CHUNK_SIZE, Rng, hashInts, type Chunk, type Tile } from '@mathgame/engine';
import * as THREE from 'three';
import { COLORS, TILE_COLORS } from './palette';

/**
 * Turns a chunk into meshes. Ground tiles are merged into one instanced mesh
 * per chunk (16×16 = 256 boxes) so a screen of ~20 chunks stays a handful of
 * draw calls. Decorations (trees, rocks, tents) are small groups on top.
 *
 * Every geometry and material here is built once and shared by every chunk:
 * a decoration is a mesh placed, turned and scaled, never a shape of its own.
 * So the only GPU state a chunk owns is its ground's instance buffers, which
 * `disposeChunkGroup` frees when the chunk is dropped.
 *
 * Coordinates: engine grid (x, y) → Three (x, height, z). +y on the grid is
 * "down" on screen, which is +z here; the camera's yaw makes that read
 * naturally.
 */
const TILE_GEO = new THREE.BoxGeometry(1, 1, 1);
const MATERIAL = new THREE.MeshLambertMaterial({ flatShading: true });

/** One shape per prop kind, shared by every chunk (and by the battle backdrop). */
export const PROP_GEOMETRY = {
	trunk: new THREE.CylinderGeometry(0.1, 0.14, 0.5, 5),
	canopy: new THREE.ConeGeometry(0.45, 1.1, 6),
	/** Radius 1: each rock is scaled to its own size. */
	rock: new THREE.DodecahedronGeometry(1, 0),
	blade: new THREE.ConeGeometry(0.08, 0.35, 3),
	tent: new THREE.ConeGeometry(0.55, 0.8, 4),
	door: new THREE.ConeGeometry(0.2, 0.4, 4),
	fire: new THREE.ConeGeometry(0.15, 0.3, 5)
} as const;

/** Every geometry the chunks share; `disposeChunkGroup` leaves these alone. */
export const SHARED_GEOMETRIES: ReadonlySet<THREE.BufferGeometry> = new Set([
	TILE_GEO,
	...Object.values(PROP_GEOMETRY)
]);

/** Height of a tile's top face. Figures stand here; water sits below the land. */
export function groundTop(tile: Tile): number {
	return tile.kind === 'water' ? 0.2 : 0.5 + tile.height * 0.25;
}

export function buildChunkGroup(chunk: Chunk): THREE.Group {
	const group = new THREE.Group();
	const ground = new THREE.InstancedMesh(TILE_GEO, MATERIAL, CHUNK_SIZE * CHUNK_SIZE);
	ground.receiveShadow = true;
	ground.castShadow = true;
	const m = new THREE.Matrix4();
	const color = new THREE.Color();
	const ox = chunk.cx * CHUNK_SIZE;
	const oy = chunk.cy * CHUNK_SIZE;

	chunk.tiles.forEach((tile, i) => {
		const x = ox + (i % CHUNK_SIZE);
		const z = oy + Math.floor(i / CHUNK_SIZE);
		const h = groundTop(tile) + 0.5; // the box's base is at y = -0.5
		m.makeScale(1, h, 1);
		m.setPosition(x, h / 2 - 0.5, z);
		ground.setMatrixAt(i, m);
		color.setHex(TILE_COLORS[tile.kind]);
		// A little per-tile variation keeps large fields from looking like a grid.
		const jitter = (hashInts(x, z, 99) % 1000) / 1000 - 0.5;
		color.offsetHSL(0, 0, jitter * 0.05);
		ground.setColorAt(i, color);

		const deco = buildDecoration(tile, x, z, h - 0.5);
		if (deco) group.add(deco);
	});
	ground.instanceMatrix.needsUpdate = true;
	if (ground.instanceColor) ground.instanceColor.needsUpdate = true;
	group.add(ground);
	return group;
}

/**
 * Free the GPU state of a chunk that is no longer drawn: its ground's instance
 * buffers and vertex arrays, any geometry of its own, and its lights. Removing
 * the group from the scene is not enough: three.js keeps a mesh's buffers for
 * as long as the renderer lives unless the mesh or geometry is disposed. The
 * shared geometries and materials stay, since other chunks still draw them.
 */
export function disposeChunkGroup(group: THREE.Object3D): void {
	group.traverse((o) => {
		if (o instanceof THREE.InstancedMesh) o.dispose();
		if (o instanceof THREE.Mesh && !SHARED_GEOMETRIES.has(o.geometry)) o.geometry.dispose();
		if (o instanceof THREE.Light) o.dispose();
	});
}

const trunkMat = new THREE.MeshLambertMaterial({ color: COLORS.trunk, flatShading: true });
const canopyMat = new THREE.MeshLambertMaterial({ color: COLORS.canopy, flatShading: true });
const canopyLightMat = new THREE.MeshLambertMaterial({
	color: COLORS.canopyLight,
	flatShading: true
});
const rockMat = new THREE.MeshLambertMaterial({ color: COLORS.rock, flatShading: true });
const tentMat = new THREE.MeshLambertMaterial({ color: COLORS.tentCloth, flatShading: true });
const tentDoorMat = new THREE.MeshLambertMaterial({ color: COLORS.tentDoor, flatShading: true });
const fireMat = new THREE.MeshBasicMaterial({ color: COLORS.fire });
const grassMat = new THREE.MeshLambertMaterial({ color: 0x4fa83d, flatShading: true });

function buildDecoration(tile: Tile, x: number, z: number, top: number): THREE.Object3D | null {
	const rng = new Rng(hashInts(x, z, 31));
	switch (tile.kind) {
		case 'tree': {
			const g = new THREE.Group();
			const scale = 0.8 + rng.next() * 0.5;
			const trunk = new THREE.Mesh(PROP_GEOMETRY.trunk, trunkMat);
			trunk.position.y = 0.25;
			const canopy = new THREE.Mesh(
				PROP_GEOMETRY.canopy,
				rng.chance(0.5) ? canopyMat : canopyLightMat
			);
			canopy.position.y = 0.95;
			trunk.castShadow = canopy.castShadow = true;
			g.add(trunk, canopy);
			g.scale.setScalar(scale);
			g.rotation.y = rng.next() * Math.PI * 2;
			g.position.set(x, top, z);
			return g;
		}
		case 'rock': {
			const rock = new THREE.Mesh(PROP_GEOMETRY.rock, rockMat);
			rock.scale.setScalar(0.3 + rng.next() * 0.2);
			rock.position.set(x, top + 0.2, z);
			rock.rotation.set(rng.next(), rng.next(), rng.next());
			rock.castShadow = true;
			return rock;
		}
		case 'tallgrass': {
			const g = new THREE.Group();
			for (let i = 0; i < 3; i++) {
				const blade = new THREE.Mesh(PROP_GEOMETRY.blade, grassMat);
				blade.position.set(x + rng.next() * 0.6 - 0.3, top + 0.17, z + rng.next() * 0.6 - 0.3);
				g.add(blade);
			}
			return g;
		}
		case 'tent': {
			const g = new THREE.Group();
			const tent = new THREE.Mesh(PROP_GEOMETRY.tent, tentMat);
			tent.position.y = 0.4;
			tent.rotation.y = Math.PI / 4;
			tent.castShadow = true;
			const door = new THREE.Mesh(PROP_GEOMETRY.door, tentDoorMat);
			door.position.set(0, 0.2, 0.42);
			door.rotation.y = Math.PI / 4;
			const fire = new THREE.Mesh(PROP_GEOMETRY.fire, fireMat);
			fire.position.set(0.9, 0.15, 0.6);
			const light = new THREE.PointLight(COLORS.fire, 1.5, 4);
			light.position.set(0.9, 0.6, 0.6);
			g.add(tent, door, fire, light);
			g.position.set(x, top, z);
			return g;
		}
		default:
			return null;
	}
}
