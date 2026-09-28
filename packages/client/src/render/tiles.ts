import { CHUNK_SIZE, Rng, hashInts, isWater, type Chunk, type Tile } from '@mathgame/engine';
import * as THREE from 'three';
import { DOCTOR_GEOMETRIES, WitchDoctor } from './doctor';
import { BIOME_LOOK, CANOPY, COLORS, PROP_COLORS, TILE_COLORS } from './palette';

/**
 * Turns a chunk into meshes. Ground tiles are merged into one instanced mesh
 * per chunk (16×16 = 256 boxes), and so is every kind of prop: all the
 * chunk's trunks are one instanced mesh, all its canopies another, its rocks,
 * blades, reeds, flowers and bushes one each. So a screen of 25 chunks is a
 * few hundred draw calls however much grows on it. Tents, a few per screen,
 * are small groups of their own with the campfire's light and the witch
 * doctor (`doctor.ts`), whose shapes are shared too.
 *
 * Every geometry and material here is built once and shared by every chunk:
 * a prop is a shape placed, turned, scaled and coloured, never a shape of its
 * own. So the only GPU state a chunk owns is its instanced meshes' buffers,
 * which `disposeChunkGroup` frees when the chunk is dropped.
 *
 * Each biome has its own look ([[DESIGN]] § Palette, `BIOME_LOOK`): the
 * meadow's bright grass and flowers, the forest's darker floor under
 * crowded trees, the river's sand and reed beds, the mountain's grey-green
 * turf, pebbles, boulder fields and snow on the highest rocks. Every prop is
 * placed by a hash of its tile, so the world looks the same on every visit.
 *
 * Coordinates: engine grid (x, y) → Three (x, height, z). +y on the grid is
 * "down" on screen, which is +z here; the camera's yaw makes that read
 * naturally.
 */
const TILE_GEO = new THREE.BoxGeometry(1, 1, 1);
/** The unit box every chunk's ground is made of, shared (the tools in the trainer's hand are boxes too). */
export const BOX_GEOMETRY: THREE.BufferGeometry = TILE_GEO;
const MATERIAL = new THREE.MeshLambertMaterial({ flatShading: true });

/** One shape per prop kind, shared by every chunk (and by the battle backdrop). */
export const PROP_GEOMETRY = {
	trunk: new THREE.CylinderGeometry(0.1, 0.14, 0.5, 5),
	canopy: new THREE.ConeGeometry(0.45, 1.1, 6),
	/** Radius 1: each rock, pebble and snow cap is scaled to its own size. */
	rock: new THREE.DodecahedronGeometry(1, 0),
	blade: new THREE.ConeGeometry(0.08, 0.35, 3),
	/** A reed's stalk, a tile tall at scale 1: each is scaled to its own height. */
	reed: new THREE.CylinderGeometry(0.024, 0.036, 1, 4),
	/** A reed's brown head. */
	cattail: new THREE.CylinderGeometry(0.046, 0.046, 0.16, 5),
	/** Radius 1: a flower or a bush, each scaled to its own size. */
	ball: new THREE.IcosahedronGeometry(1, 0),
	tent: new THREE.ConeGeometry(0.55, 0.8, 4),
	door: new THREE.ConeGeometry(0.2, 0.4, 4)
} as const;

/** Every geometry the chunks share; `disposeChunkGroup` leaves these alone. */
export const SHARED_GEOMETRIES: ReadonlySet<THREE.BufferGeometry> = new Set([
	TILE_GEO,
	...Object.values(PROP_GEOMETRY),
	...DOCTOR_GEOMETRIES
]);

/** The witch doctors of a chunk built by `buildChunkGroup`, one per tent, for the renderer to animate. */
export function doctorsIn(chunk: THREE.Object3D): readonly WitchDoctor[] {
	return (chunk.userData.doctors as WitchDoctor[] | undefined) ?? [];
}

/** From this height up a mountain's rocks are its peaks: paler, the boulders capped with snow. */
export const PEAK_HEIGHT = 3;

/** The height of the water's surface: it sits below the land. */
export const WATER_TOP = 0.2;

/** Height of a tile's top face. Figures stand here; water, shallow or deep, sits below the land. */
export function groundTop(tile: Tile): number {
	return isWater(tile.kind) ? WATER_TOP : 0.5 + tile.height * 0.25;
}

/**
 * The colour of a tile's ground: its kind in its biome's look. Where a tree
 * was chopped down it is the ground the tree stood on; where a rock was
 * broken, gravel.
 */
export function groundColor(tile: Tile): number {
	const look = BIOME_LOOK[tile.biome];
	if (tile.cleared === 'rock') {
		return tile.height >= PEAK_HEIGHT ? PROP_COLORS.gravelHigh : PROP_COLORS.gravel;
	}
	switch (tile.kind) {
		case 'grass':
		case 'tree':
		case 'tent':
			return look.ground;
		case 'tallgrass':
			return look.tallgrass;
		case 'rock':
			return tile.height >= PEAK_HEIGHT ? PROP_COLORS.rockHigh : TILE_COLORS.rock;
		default:
			return TILE_COLORS[tile.kind];
	}
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
	const props = new Props();

	chunk.tiles.forEach((tile, i) => {
		const x = ox + (i % CHUNK_SIZE);
		const z = oy + Math.floor(i / CHUNK_SIZE);
		const h = groundTop(tile) + 0.5; // the box's base is at y = -0.5
		m.makeScale(1, h, 1);
		m.setPosition(x, h / 2 - 0.5, z);
		ground.setMatrixAt(i, m);
		color.setHex(groundColor(tile));
		// A little per-tile variation keeps large fields from looking like a grid.
		const jitter = (hashInts(x, z, 99) % 1000) / 1000 - 0.5;
		color.offsetHSL(0, 0, jitter * 0.05);
		ground.setColorAt(i, color);

		decorate(props, group, tile, x, z, h - 0.5);
	});
	ground.instanceMatrix.needsUpdate = true;
	if (ground.instanceColor) ground.instanceColor.needsUpdate = true;
	group.add(ground);
	for (const mesh of props.build()) group.add(mesh);
	return group;
}

/**
 * What stands on one tile (a tree and its bushes, a rock and its snow), as a
 * group of instanced meshes of the shared shapes, placed in the world as a
 * chunk places them: the chop's flourish tips or breaks exactly what the
 * chunk drew. Free it with `disposeChunkGroup`.
 */
export function buildTileProps(tile: Tile, x: number, z: number): THREE.Group {
	const group = new THREE.Group();
	const props = new Props();
	decorate(props, group, tile, x, z, groundTop(tile));
	for (const mesh of props.build()) group.add(mesh);
	return group;
}

/**
 * Free the GPU state of a chunk that is no longer drawn: its instanced
 * meshes' buffers and vertex arrays, any geometry of its own, and its lights.
 * Removing the group from the scene is not enough: three.js keeps a mesh's
 * buffers for as long as the renderer lives unless the mesh or geometry is
 * disposed. The shared geometries and materials stay, since other chunks
 * still draw them.
 */
export function disposeChunkGroup(group: THREE.Object3D): void {
	group.traverse((o) => {
		if (o instanceof THREE.InstancedMesh) o.dispose();
		if (o instanceof THREE.Mesh && !SHARED_GEOMETRIES.has(o.geometry)) o.geometry.dispose();
		if (o instanceof THREE.Light) o.dispose();
	});
}

type PropKind = Exclude<keyof typeof PROP_GEOMETRY, 'tent' | 'door'>;

/** One material for every prop: each instance brings its own colour. */
const propMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
/** Which props throw a shadow: the tall and solid ones. Blades, reeds and flowers don't. */
const CASTS_SHADOW: Record<PropKind, boolean> = {
	trunk: true,
	canopy: true,
	rock: true,
	blade: false,
	reed: false,
	cattail: false,
	ball: true
};

/**
 * The props of one chunk, collected as it is built and turned into one
 * instanced mesh per shape at the end.
 */
class Props {
	private placed = new Map<PropKind, { matrix: THREE.Matrix4; color: number }[]>();
	private dummy = new THREE.Object3D();

	/** A prop of `kind` at (x, y, z), turned (Euler angles) and scaled (a number, or per axis). */
	add(
		kind: PropKind,
		x: number,
		y: number,
		z: number,
		color: number,
		scale: number | [number, number, number] = 1,
		rotation: [number, number, number] = [0, 0, 0]
	): void {
		const d = this.dummy;
		d.position.set(x, y, z);
		d.rotation.set(...rotation);
		if (typeof scale === 'number') d.scale.setScalar(scale);
		else d.scale.set(...scale);
		d.updateMatrix();
		let list = this.placed.get(kind);
		if (!list) this.placed.set(kind, (list = []));
		list.push({ matrix: d.matrix.clone(), color });
	}

	build(): THREE.InstancedMesh[] {
		const out: THREE.InstancedMesh[] = [];
		const color = new THREE.Color();
		for (const [kind, list] of this.placed) {
			const mesh = new THREE.InstancedMesh(PROP_GEOMETRY[kind], propMaterial, list.length);
			list.forEach((p, i) => {
				mesh.setMatrixAt(i, p.matrix);
				mesh.setColorAt(i, color.setHex(p.color));
			});
			mesh.instanceMatrix.needsUpdate = true;
			if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
			mesh.castShadow = CASTS_SHADOW[kind];
			mesh.name = kind;
			mesh.computeBoundingSphere();
			out.push(mesh);
		}
		return out;
	}
}

const tentMat = new THREE.MeshLambertMaterial({ color: COLORS.tentCloth, flatShading: true });
const tentDoorMat = new THREE.MeshLambertMaterial({ color: COLORS.tentDoor, flatShading: true });

/** A random pick from a list, by the tile's own draw. */
function pick<T>(rng: Rng, list: readonly T[]): T {
	return list[Math.floor(rng.next() * list.length) % list.length]!;
}

/** Place what stands on one tile: trees, rocks, grass, reeds, flowers, a tent. */
function decorate(props: Props, group: THREE.Group, tile: Tile, x: number, z: number, top: number) {
	const rng = new Rng(hashInts(x, z, 31));
	const look = BIOME_LOOK[tile.biome];
	/** A spot on the tile, at most `r` from its middle. */
	const near = (r: number): [number, number] => [
		x + (rng.next() * 2 - 1) * r,
		z + (rng.next() * 2 - 1) * r
	];

	switch (tile.kind) {
		case 'tree': {
			tree(props, rng, x, z, top, 0.9 + rng.next() * 0.4);
			// A forest is crowded: often a young tree beside the big one, and a bush at its foot.
			// Never taller than before: a tree hides the tile behind it from the camera.
			if (tile.biome === 'forest') {
				if (rng.chance(0.55)) {
					const [sx, sz] = [
						x + (rng.chance(0.5) ? 0.3 : -0.3),
						z + (rng.chance(0.5) ? 0.28 : -0.28)
					];
					tree(props, rng, sx, sz, top, 0.5 + rng.next() * 0.2);
				}
				if (rng.chance(0.6)) {
					const [bx, bz] = near(0.36);
					const r = 0.14 + rng.next() * 0.08;
					props.add('ball', bx, top + r * 0.6, bz, pick(rng, PROP_COLORS.bush), [r, r * 0.8, r]);
				}
			}
			return;
		}
		case 'rock': {
			const peak = tile.height >= PEAK_HEIGHT;
			const r = 0.3 + rng.next() * 0.2;
			const y = top + 0.2;
			// The highest rocks stand upright under their snow; the others lie any way.
			const turn: [number, number, number] = peak
				? [0, rng.next() * Math.PI, 0]
				: [rng.next(), rng.next(), rng.next()];
			props.add('rock', x, y, z, rng.chance(0.5) ? COLORS.rock : PROP_COLORS.boulderLight, r, turn);
			if (peak && rng.chance(0.8)) {
				props.add(
					'rock',
					x,
					y + r * 0.72,
					z,
					PROP_COLORS.snow,
					[r * 0.82, r * 0.42, r * 0.82],
					turn
				);
			}
			// A boulder field: smaller rocks tumbled round the big one.
			const more = rng.chance(0.7) ? 1 + (rng.chance(0.4) ? 1 : 0) : 0;
			for (let k = 0; k < more; k++) {
				const [bx, bz] = near(0.34);
				const s = 0.12 + rng.next() * 0.1;
				props.add(
					'rock',
					bx,
					top + s * 0.3,
					bz,
					pick(rng, [COLORS.rock, PROP_COLORS.boulderLight]),
					s,
					[rng.next(), rng.next(), rng.next()]
				);
			}
			return;
		}
		case 'tallgrass': {
			if (tile.biome === 'river') {
				reeds(props, rng, look.blade, x, z, top);
				return;
			}
			for (let k = 0; k < 4; k++) {
				const [bx, bz] = near(0.32);
				const s = 0.95 + rng.next() * 0.35;
				props.add('blade', bx, top + 0.17 * s, bz, look.blade, s, [0, rng.next() * Math.PI, 0]);
			}
			return;
		}
		case 'grass': {
			if (tile.cleared === 'tree') {
				// A stump where the tree stood, set back from the middle (away from the
				// camera), so the trainer or the lead standing on the tile never stands in
				// it; its pale cut face on top, and a few chips of fresh wood about.
				const [sx, sz] = [x - 0.24, z - 0.2];
				const turn: [number, number, number] = [0, rng.next() * Math.PI * 2, 0];
				props.add('trunk', sx, top + 0.06, sz, COLORS.trunk, [1.3, 0.24, 1.3], turn);
				props.add('trunk', sx, top + 0.125, sz, PROP_COLORS.wood, [0.95, 0.02, 0.95], turn);
				for (let k = 0; k < 3; k++) {
					const [cx, cz] = near(0.34);
					props.add(
						'ball',
						cx,
						top + 0.01,
						cz,
						PROP_COLORS.wood,
						[0.04, 0.012, 0.028],
						[0, rng.next() * Math.PI, 0]
					);
				}
				return;
			}
			if (tile.cleared === 'rock') {
				// Gravel where the rock stood: pebbles and chips small enough never to
				// look like a rock you can't pass, and on the peaks a little snow.
				const peak = tile.height >= PEAK_HEIGHT;
				const count = 4 + Math.floor(rng.next() * 3);
				for (let k = 0; k < count; k++) {
					const [px, pz] = near(0.36);
					const s = 0.04 + rng.next() * 0.05;
					const colour = pick(rng, [COLORS.rock, PROP_COLORS.boulderLight, PROP_COLORS.pebble]);
					props.add('rock', px, top + s * 0.3, pz, colour, s, [rng.next(), rng.next(), 0]);
				}
				if (peak) {
					const [px, pz] = near(0.3);
					props.add(
						'rock',
						px,
						top + 0.01,
						pz,
						PROP_COLORS.snow,
						[0.09, 0.025, 0.07],
						[0, rng.next() * Math.PI, 0]
					);
				}
				return;
			}
			if (tile.biome === 'meadow' && rng.chance(0.2)) {
				// A few flowers in the meadow grass.
				const count = 2 + (rng.chance(0.5) ? 1 : 0);
				for (let k = 0; k < count; k++) {
					const [fx, fz] = near(0.36);
					props.add('ball', fx, top + 0.05, fz, pick(rng, PROP_COLORS.flower), 0.065);
				}
			} else if (tile.biome === 'mountain' && rng.chance(0.4)) {
				// Pebbles on the mountain turf: small enough never to look like a rock you can't pass.
				const count = 1 + Math.floor(rng.next() * 3);
				for (let k = 0; k < count; k++) {
					const [px, pz] = near(0.38);
					const s = 0.045 + rng.next() * 0.05;
					props.add('rock', px, top + s * 0.3, pz, PROP_COLORS.pebble, s, [
						rng.next(),
						rng.next(),
						0
					]);
				}
			}
			return;
		}
		case 'tent': {
			const camp = tent(x, z, top);
			group.add(camp);
			const doctors = (group.userData.doctors ??= []) as WitchDoctor[];
			doctors.push(camp.userData.doctor as WitchDoctor);
			return;
		}
		default:
			return;
	}
}

/** A pine: a trunk and a cone of canopy, `scale` times the size of the one in the battle backdrop. */
function tree(props: Props, rng: Rng, x: number, z: number, top: number, scale: number): void {
	const turn = rng.next() * Math.PI * 2;
	props.add('trunk', x, top + 0.25 * scale, z, COLORS.trunk, scale, [0, turn, 0]);
	props.add('canopy', x, top + 0.95 * scale, z, pick(rng, CANOPY), scale, [0, turn, 0]);
}

/**
 * A reed bed: five stalks of different heights, three with a brown head —
 * taller, thinner and yellower than tall grass, so the river's encounter
 * tiles never read as the meadow's.
 */
function reeds(props: Props, rng: Rng, stalk: number, x: number, z: number, top: number): void {
	for (let k = 0; k < 5; k++) {
		const rx = x + (rng.next() * 2 - 1) * 0.3;
		const rz = z + (rng.next() * 2 - 1) * 0.3;
		const height = 0.42 + rng.next() * 0.3;
		const [ax, az] = [(rng.next() - 0.5) * 0.25, (rng.next() - 0.5) * 0.25];
		props.add('reed', rx, top + height / 2, rz, stalk, [1, height, 1], [ax, 0, az]);
		if (k < 3) {
			// On the stalk's tip: a small lean about x tips it towards +z, about z towards -x.
			const tip = height / 2 + 0.04;
			props.add(
				'cattail',
				rx - az * tip,
				top + height / 2 + tip,
				rz + ax * tip,
				PROP_COLORS.cattail,
				1,
				[ax, 0, az]
			);
		}
	}
}

/**
 * Where things stand on a tent's tile, from its middle (x, z): the tent set
 * back to the left, the witch doctor in front of it, right of its door, and
 * his pot on the campfire at its right. The camera sees all of them, and
 * none of them reaches where a trainer on a tile beside the tent stands.
 */
export const TENT_AT = [-0.11, -0.1] as const;
export const DOCTOR_AT = [0.18, 0.28] as const;
export const FIRE_AT = [0.34, -0.22] as const;

/**
 * A doctor's tent with the witch doctor (`userData.doctor`, a `WitchDoctor`)
 * and his campfire, the pot on it, and the fire's warm light.
 */
function tent(x: number, z: number, top: number): THREE.Group {
	const g = new THREE.Group();
	const cloth = new THREE.Mesh(PROP_GEOMETRY.tent, tentMat);
	cloth.position.set(TENT_AT[0], 0.4, TENT_AT[1]);
	cloth.rotation.y = Math.PI / 4;
	cloth.castShadow = true;
	const door = new THREE.Mesh(PROP_GEOMETRY.door, tentDoorMat);
	door.position.set(TENT_AT[0], 0.2, TENT_AT[1] + 0.42);
	door.rotation.y = Math.PI / 4;
	const light = new THREE.PointLight(COLORS.fire, 1.5, 4);
	light.position.set(FIRE_AT[0], 0.6, FIRE_AT[1]);
	const phase = (hashInts(x, z, 17) / 4294967296) * Math.PI * 2;
	const doctor = new WitchDoctor(x + DOCTOR_AT[0], z + DOCTOR_AT[1], phase);
	doctor.figure.position.set(DOCTOR_AT[0], 0, DOCTOR_AT[1]);
	doctor.pot.position.set(FIRE_AT[0], 0, FIRE_AT[1]);
	g.add(cloth, door, light, doctor.figure, doctor.pot);
	g.position.set(x, top, z);
	g.userData.doctor = doctor;
	return g;
}
