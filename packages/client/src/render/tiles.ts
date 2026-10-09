import {
	BIOME_POLE,
	CHUNK_SIZE,
	Rng,
	hashInts,
	isWater,
	onTentLattice,
	tileAtWorld,
	type Chunk,
	type ChunkRef,
	type Tile
} from '@mathgame/engine';
import * as THREE from 'three';
import {
	CAMPFIRE_LIGHT,
	GLOW_REACH,
	litShapes,
	paintCampfireSteps,
	paintShapes,
	type GlowShape,
	type GlowTriangles
} from './campfire';
import { DOCTOR_GEOMETRIES, Druid } from './doctor';
import { ARCTIC_COLORS, BIOME_LOOK, CANOPY, COLORS, PROP_COLORS, TILE_COLORS } from './palette';

/**
 * Turns a chunk into meshes. Ground tiles are merged into one instanced mesh
 * per chunk (16×16 = 256 boxes), and so is every kind of prop: all the
 * chunk's trunks are one instanced mesh, all its canopies another, its rocks,
 * blades, reeds, flowers and bushes one each. So a screen of 25 chunks is
 * about 150 draw calls (the sun's shadow pass among them) however much grows
 * on it. Tents, a few per screen,
 * are small groups of their own with the druid (`doctor.ts`), whose
 * shapes are shared too, and the campfire's glow (`campfire.ts`).
 *
 * Every instanced mesh lists its boxes and props from the tile nearest the
 * camera to the farthest (the camera looks from +x and +z), so the GPU draws
 * what is in front first and skips the hidden sides of the boxes behind it
 * instead of shading them and then drawing over them. The ground casts no
 * shadow: with the sun behind the camera, a step's shadow falls behind the
 * step, out of sight, and drawing 25 chunks of boxes into the sun's shadow
 * map every frame cost more than the slivers it showed (#150).
 *
 * Every geometry and material here is built once and shared by every chunk:
 * a prop is a shape placed, turned, scaled and coloured, never a shape of its
 * own. So the GPU state a chunk owns is its instanced meshes' buffers, and
 * where it has a tent the glow its campfire paints on the ground round it,
 * built for that ground; `disposeChunkGroup` frees them when the chunk is
 * dropped.
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
	door: new THREE.ConeGeometry(0.2, 0.4, 4),
	/** A unit box: an ice block, each scaled to its own size, and the shine on the ice. */
	slab: new THREE.BoxGeometry(1, 1, 1)
} as const;

/** Every geometry the chunks share; `disposeChunkGroup` leaves these alone. */
export const SHARED_GEOMETRIES: ReadonlySet<THREE.BufferGeometry> = new Set([
	TILE_GEO,
	...Object.values(PROP_GEOMETRY),
	...DOCTOR_GEOMETRIES
]);

/** The druids of a chunk built by `buildChunkGroup`, one per tent, for the renderer to animate. */
export function doctorsIn(chunk: THREE.Object3D): readonly Druid[] {
	return (chunk.userData.doctors as Druid[] | undefined) ?? [];
}

/** From this height up a mountain's rocks are its peaks: paler, the boulders capped with snow. */
export const PEAK_HEIGHT = 3;

/** The height of the water's surface: it sits below the land. */
export const WATER_TOP = 0.2;

/** The height of the ice of a frozen lake or the sea: over the water, a step below the snow. */
export const ICE_TOP = 0.36;

/** Whether a tile is The Arctic's, which draws its water, rocks and trees its own way. */
export function isArcticTile(tile: Tile): boolean {
	return BIOME_POLE[tile.biome] !== null;
}

/**
 * Height of a tile's top face. Figures stand here; water, shallow or deep,
 * sits below the land, and the ice (a fishing hole in it too) between the
 * two; an ice block stands on what it is on.
 */
export function groundTop(tile: Tile): number {
	if (isWater(tile.kind) || tile.under === 'water') return WATER_TOP;
	if (tile.kind === 'ice' || tile.kind === 'hole' || tile.under === 'ice') return ICE_TOP;
	return 0.5 + tile.height * 0.25;
}

/**
 * The colour of a tile's ground: its kind in its biome's look. Where a tree
 * was chopped down it is the ground the tree stood on; where a rock was
 * broken, gravel.
 */
export function groundColor(tile: Tile): number {
	const look = BIOME_LOOK[tile.biome];
	const arctic = isArcticTile(tile);
	if (tile.cleared === 'rock') {
		return tile.height >= PEAK_HEIGHT ? PROP_COLORS.gravelHigh : PROP_COLORS.gravel;
	}
	switch (tile.kind) {
		case 'grass':
		case 'snow':
		case 'tree':
		case 'tent':
			return look.ground;
		case 'tallgrass':
		case 'deepsnow':
			return look.tallgrass;
		case 'rock':
			if (arctic) return ARCTIC_COLORS.rockGround;
			return tile.height >= PEAK_HEIGHT ? PROP_COLORS.rockHigh : TILE_COLORS.rock;
		case 'water':
		case 'deepwater':
			return arctic ? ARCTIC_COLORS[tile.kind] : TILE_COLORS[tile.kind];
		case 'iceblock':
			// The ground under the block: snow, the ice, or the open water round it.
			if (tile.under === 'water') return ARCTIC_COLORS.water;
			if (tile.under === 'ice') return TILE_COLORS.ice;
			return look.ground;
		default:
			return TILE_COLORS[tile.kind];
	}
}

/**
 * Tiles of the world as the player left them, by grid position: what a
 * campfire's glow lies on and lights; `undefined` for a tile not known,
 * taken to be as high as the fire's, with nothing on it.
 */
export type WorldTiles = (x: number, y: number) => Tile | undefined;

/**
 * The chunk's meshes. `world` gives the tiles round a tent that are in the
 * chunks next door (the ring passes the world's own), for its campfire's
 * glow; without it, the glow stops at the chunk's edge, on flat ground.
 * Without `glow`, the tents' glow waits for `paintGlows`.
 */
export function buildChunkGroup(chunk: Chunk, world?: WorldTiles, glow = true): THREE.Group {
	const group = new THREE.Group();
	const count = CHUNK_SIZE * CHUNK_SIZE;
	const ground = new THREE.InstancedMesh(TILE_GEO, MATERIAL, count);
	ground.receiveShadow = true;
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
		// Nearest the camera first: the tiles run row by row, +x along a row, rows towards +z.
		const at = count - 1 - i;
		ground.setMatrixAt(at, m);
		color.setHex(groundColor(tile));
		// A little per-tile variation keeps large fields from looking like a grid.
		const jitter = (hashInts(x, z, 99) % 1000) / 1000 - 0.5;
		color.offsetHSL(0, 0, jitter * 0.05);
		ground.setColorAt(at, color);

		decorate(props, group, tile, x, z, h - 0.5);
	});
	ground.instanceMatrix.needsUpdate = true;
	if (ground.instanceColor) ground.instanceColor.needsUpdate = true;
	group.add(ground);
	for (const mesh of props.build()) group.add(mesh);
	if (glow) {
		paintGlows(group, (x, z) =>
			x >= ox && x < ox + CHUNK_SIZE && z >= oy && z < oy + CHUNK_SIZE
				? chunk.tiles[(z - oy) * CHUNK_SIZE + (x - ox)]
				: world?.(x, z)
		);
	}
	return group;
}

/**
 * What stands on one tile (a tree and its bushes, a rock and its snow, a
 * tent and its glow on flat ground), as a group of instanced meshes of the
 * shared shapes, placed in the world as a chunk places them: the chop's
 * flourish tips or breaks exactly what the chunk drew. Free it with
 * `disposeChunkGroup`.
 */
export function buildTileProps(tile: Tile, x: number, z: number): THREE.Group {
	const group = new THREE.Group();
	const props = new Props();
	decorate(props, group, tile, x, z, groundTop(tile));
	for (const mesh of props.build()) group.add(mesh);
	paintGlows(group, (tx, tz) => (tx === x && tz === z ? tile : undefined));
	return group;
}

/**
 * Paint the glow of each campfire in a chunk built without it
 * (`buildChunkGroup`), once, `world` giving the tiles round it as the player
 * left them.
 */
export function paintGlows(group: THREE.Group, world: WorldTiles): void {
	const steps = glowSteps(group, world);
	while (!steps.next().done);
}

/**
 * `paintGlows` a step at a time, for the ring to spread over frames: each
 * step is a few milliseconds' work on a slow tablet (the ground round a
 * fire, then its props a handful at a time), and the glow goes on its tent
 * once whole.
 */
export function* glowSteps(group: THREE.Group, world: WorldTiles): Generator<void> {
	for (const camp of group.children) {
		if (!(camp instanceof THREE.Group) || !camp.userData.doctor || camp.userData.painted) continue;
		camp.userData.painted = true;
		yield* paintGlow(camp, world);
	}
}

/** Whether a chunk holds a tent whose glow `paintGlows` has not painted yet. */
export function awaitsGlow(group: THREE.Group): boolean {
	return group.children.some((c) => c.userData.doctor && !c.userData.painted);
}

/**
 * What the fire lights of a tent, the same by every fire (the tent, its door
 * and the pot, which never move): painted with the first tent, kept for all.
 */
let tentGlow: GlowTriangles | null = null;

/**
 * Paint the glow of the campfire at `camp` (`campfire.ts`) a step at a time:
 * on the ground round it, the tent, its door and the pot, and every prop
 * within its reach, placed as their chunks place them, `world` giving the
 * tiles. The glow goes on the tent once whole.
 */
function* paintGlow(camp: THREE.Group, world: WorldTiles): Generator<void> {
	const { x, y: top, z } = camp.position;
	const reach = Math.ceil(GLOW_REACH);
	// The tiles round the fire, one further out for the sides of steps: each asked for once.
	const span = reach + 1;
	const near: (Tile | undefined)[] = [];
	for (let dz = -span; dz <= span; dz++) {
		for (let dx = -span; dx <= span; dx++) near.push(world(x + dx, z + dz));
	}
	const around = (dx: number, dz: number) => near[(dz + span) * (2 * span + 1) + (dx + span)];
	// What stands round the fire (never another tent: they stand far apart), where it is in reach.
	const props = new Props();
	const unused = new THREE.Group();
	for (let dz = -reach; dz <= reach; dz++) {
		for (let dx = -reach; dx <= reach; dx++) {
			const tile = around(dx, dz);
			if (!tile || tile.kind === 'tent') continue;
			decorate(props, unused, tile, x + dx, z + dz, groundTop(tile));
		}
	}
	const fire = new THREE.Vector3(FIRE_AT[0], 0, FIRE_AT[1]);
	const light = new THREE.Vector3(x + FIRE_AT[0], top + CAMPFIRE_LIGHT.height, z + FIRE_AT[1]);
	const toCamp = new THREE.Matrix4().makeTranslation(-x, -top, -z);
	const shapes: GlowShape[] = [];
	const at = new THREE.Vector3();
	props.forEach((kind, matrix) => {
		// No prop is more than a tile across.
		if (at.setFromMatrixPosition(matrix).distanceTo(light) > GLOW_REACH + 1) return;
		shapes.push({ geometry: PROP_GEOMETRY[kind], matrix: toCamp.clone().multiply(matrix) });
	});
	tentGlow ??= paintShapes(fire, litShapes(camp.userData.glowing as THREE.Object3D[], camp));
	const glow = yield* paintCampfireSteps(
		fire,
		(dx, dz) => {
			const tile = around(dx, dz);
			return tile ? groundTop(tile) - top : 0;
		},
		shapes,
		tentGlow
	);
	if (glow) camp.add(glow);
}

/**
 * The chunks holding a tent whose campfire's glow reaches a tile from
 * `(x0, y0)` to `(x1, y1)`: what it lights there changes when those tiles
 * do (a tree chopped, a chunk grown back), so they are built again with them.
 */
export function campfiresReaching(
	seed: number,
	x0: number,
	y0: number,
	x1: number,
	y1: number
): ChunkRef[] {
	const out: ChunkRef[] = [];
	// What `paintGlow` decorates, a tile further for good measure.
	const reach = Math.ceil(GLOW_REACH) + 1;
	for (let y = y0 - reach; y <= y1 + reach; y++) {
		for (let x = x0 - reach; x <= x1 + reach; x++) {
			if (onTentLattice(x, y) && tileAtWorld(seed, x, y).kind === 'tent') {
				out.push({ cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(y / CHUNK_SIZE) });
			}
		}
	}
	return out;
}

/**
 * Free the GPU state of a chunk that is no longer drawn: its instanced
 * meshes' buffers and vertex arrays, and any geometry of its own (a
 * campfire's glow). Removing the group from the scene is not enough: three.js
 * keeps a mesh's buffers for as long as the renderer lives unless the mesh or
 * geometry is disposed. The shared geometries and materials stay, since other
 * chunks still draw them.
 */
export function disposeChunkGroup(group: THREE.Object3D): void {
	group.traverse((o) => {
		if (o instanceof THREE.InstancedMesh) o.dispose();
		if (o instanceof THREE.Mesh && !SHARED_GEOMETRIES.has(o.geometry)) o.geometry.dispose();
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
	ball: true,
	slab: true
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

	/** Each prop placed so far: its shape and where it stands. */
	forEach(visit: (kind: PropKind, matrix: THREE.Matrix4) => void): void {
		for (const [kind, list] of this.placed) for (const p of list) visit(kind, p.matrix);
	}

	/** One instanced mesh per shape, its props nearest the camera first, as the ground's boxes are. */
	build(): THREE.InstancedMesh[] {
		const out: THREE.InstancedMesh[] = [];
		const color = new THREE.Color();
		for (const [kind, list] of this.placed) {
			const mesh = new THREE.InstancedMesh(PROP_GEOMETRY[kind], propMaterial, list.length);
			// Placed tile by tile, row by row: the last placed is the nearest.
			list.forEach((p, i) => {
				const at = list.length - 1 - i;
				mesh.setMatrixAt(at, p.matrix);
				mesh.setColorAt(at, color.setHex(p.color));
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

	if (isArcticTile(tile) && decorateArctic(props, group, rng, tile, x, z, top, near)) return;
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
		case 'grass':
		case 'snow': {
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
			if (tile.cleared === 'iceblock') {
				// Where an ice block stood on the snow: a few flat chips of ice, catching the light.
				const count = 3 + Math.floor(rng.next() * 3);
				for (let k = 0; k < count; k++) {
					const [cx, cz] = near(0.34);
					const w = 0.06 + rng.next() * 0.06;
					const colour = pick(rng, [ARCTIC_COLORS.block, ARCTIC_COLORS.blockTop]);
					props.add(
						'slab',
						cx,
						top + 0.012,
						cz,
						colour,
						[w, 0.024, w * 0.7],
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
			const doctors = (group.userData.doctors ??= []) as Druid[];
			doctors.push(camp.userData.doctor as Druid);
			return;
		}
		default:
			return;
	}
}

/**
 * What stands on a tile of The Arctic's ([[DESIGN]] § Palette, "The
 * Arctic"), where it is drawn its own way; false for a tile drawn as
 * Nordland's (a tent, a stump). Snow lies bare, now and then with a tuft of
 * dry tundra grass or a rookery's pebbles; deep snow is heaped with white
 * drifts, as tall grass stands with blades; the ice has a streak of shine,
 * so it looks slippery; a fishing hole is a dark round of water with a rim
 * of snow; an ice block is a glassy blue-white block, a smaller one often
 * beside it; a rock a cold dark boulder, capped with snow; a tree a spruce,
 * two tiers of a darker, bluer green than Nordland's pines, snow on its tip.
 */
function decorateArctic(
	props: Props,
	group: THREE.Group,
	rng: Rng,
	tile: Tile,
	x: number,
	z: number,
	top: number,
	near: (r: number) => [number, number]
): boolean {
	const look = BIOME_LOOK[tile.biome];
	switch (tile.kind) {
		case 'snow': {
			if (tile.cleared) return false;
			if ((tile.biome === 'tundra' || tile.biome === 'taiga') && rng.chance(0.12)) {
				for (let k = 0; k < 3; k++) {
					const [bx, bz] = near(0.3);
					props.add('blade', bx, top + 0.08, bz, ARCTIC_COLORS.tuft, 0.55, [
						0,
						rng.next() * Math.PI,
						0
					]);
				}
			} else if (tile.biome === 'rookery' && rng.chance(0.35)) {
				const count = 2 + Math.floor(rng.next() * 3);
				for (let k = 0; k < count; k++) {
					const [px, pz] = near(0.38);
					const s = 0.04 + rng.next() * 0.04;
					props.add('rock', px, top + s * 0.3, pz, ARCTIC_COLORS.pebble, s, [
						rng.next(),
						rng.next(),
						0
					]);
				}
			}
			return true;
		}
		case 'deepsnow': {
			// Drifts heaped on it: soft white mounds, so it reads as tall grass does.
			const count = 3 + (rng.chance(0.5) ? 1 : 0);
			for (let k = 0; k < count; k++) {
				const [bx, bz] = near(0.28);
				const r = 0.13 + rng.next() * 0.08;
				props.add(
					'ball',
					bx,
					top + r * 0.25,
					bz,
					look.blade,
					[r * 1.3, r * 0.75, r],
					[0, rng.next() * Math.PI, 0]
				);
			}
			return true;
		}
		case 'ice': {
			// A streak or two of shine across the ice: it looks slippery.
			const streaks = rng.chance(0.55) ? 1 + (rng.chance(0.3) ? 1 : 0) : 0;
			for (let k = 0; k < streaks; k++) {
				const [sx, sz] = near(0.2);
				const length = 0.35 + rng.next() * 0.25;
				props.add(
					'slab',
					sx,
					top + 0.006,
					sz,
					ARCTIC_COLORS.shine,
					[length, 0.012, 0.05],
					[0, Math.PI / 4 + (rng.next() - 0.5) * 0.4, 0]
				);
			}
			return true;
		}
		case 'hole': {
			// A dark round of water in the ice, a rim of snow lumps round it.
			props.add('ball', x, top + 0.004, z, ARCTIC_COLORS.hole, [0.3, 0.01, 0.3]);
			for (let k = 0; k < 7; k++) {
				const angle = (k / 7) * Math.PI * 2 + rng.next() * 0.4;
				const r = 0.05 + rng.next() * 0.03;
				props.add(
					'ball',
					x + Math.cos(angle) * 0.34,
					top + r * 0.3,
					z + Math.sin(angle) * 0.34,
					ARCTIC_COLORS.holeRim,
					[r * 1.4, r * 0.7, r]
				);
			}
			return true;
		}
		case 'iceblock': {
			const turn = (rng.next() - 0.5) * 0.5;
			const w = 0.66 + rng.next() * 0.12;
			const h = 0.55 + rng.next() * 0.2;
			// Afloat it shows a little more of itself under the waterline.
			const base = tile.under === 'water' ? top - 0.1 : top;
			props.add('slab', x, base + h / 2, z, ARCTIC_COLORS.block, [w, h, w * 0.9], [0, turn, 0]);
			props.add(
				'slab',
				x,
				base + h + 0.02,
				z,
				ARCTIC_COLORS.blockTop,
				[w * 0.86, 0.04, w * 0.76],
				[0, turn, 0]
			);
			if (rng.chance(0.5)) {
				const [bx, bz] = [x + (rng.chance(0.5) ? 0.3 : -0.3), z + 0.28];
				const s = 0.22 + rng.next() * 0.08;
				props.add('slab', bx, base + s / 2, bz, ARCTIC_COLORS.block, [s, s, s], [0, rng.next(), 0]);
			}
			return true;
		}
		case 'rock': {
			const r = 0.32 + rng.next() * 0.18;
			const turn: [number, number, number] = [0, rng.next() * Math.PI, 0];
			const colour = rng.chance(0.5) ? ARCTIC_COLORS.rock : ARCTIC_COLORS.rockLight;
			// Cliffs stand taller on the shore and the fell; a nunatak out of the ice sheet too.
			const tall = tile.biome === 'bird-cliffs' || tile.biome === 'fell' ? 1.35 : 1;
			props.add('rock', x, top + 0.2 * tall, z, colour, [r, r * tall, r], turn);
			if (rng.chance(0.75)) {
				props.add(
					'rock',
					x,
					top + 0.2 * tall + r * tall * 0.72,
					z,
					PROP_COLORS.snow,
					[r * 0.82, r * 0.42, r * 0.82],
					turn
				);
			}
			return true;
		}
		case 'tree': {
			spruce(props, rng, x, z, top, 0.85 + rng.next() * 0.35);
			if (rng.chance(0.4)) {
				const [sx, sz] = [x + (rng.chance(0.5) ? 0.3 : -0.3), z + (rng.chance(0.5) ? 0.28 : -0.28)];
				spruce(props, rng, sx, sz, top, 0.45 + rng.next() * 0.15);
			}
			return true;
		}
		default:
			return false;
	}
}

/**
 * The taiga's spruce: a trunk, two tiers of a dark blue-green canopy, the
 * upper narrower, and a cap of snow on its tip: never Nordland's pine.
 */
function spruce(props: Props, rng: Rng, x: number, z: number, top: number, scale: number): void {
	const turn = rng.next() * Math.PI * 2;
	const green = pick(rng, ARCTIC_COLORS.spruce);
	props.add(
		'trunk',
		x,
		top + 0.2 * scale,
		z,
		COLORS.trunk,
		[scale, scale * 0.8, scale],
		[0, turn, 0]
	);
	props.add(
		'canopy',
		x,
		top + 0.62 * scale,
		z,
		green,
		[scale * 1.05, scale * 0.62, scale * 1.05],
		[0, turn, 0]
	);
	props.add(
		'canopy',
		x,
		top + 1.0 * scale,
		z,
		green,
		[scale * 0.72, scale * 0.55, scale * 0.72],
		[0, turn + 0.5, 0]
	);
	props.add(
		'canopy',
		x,
		top + 1.22 * scale,
		z,
		PROP_COLORS.snow,
		[scale * 0.3, scale * 0.2, scale * 0.3],
		[0, turn, 0]
	);
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
 * back to the left, the druid in front of it, right of its door, and
 * his pot on the campfire at its right. The camera sees all of them, and
 * none of them reaches where a trainer on a tile beside the tent stands.
 */
export const TENT_AT = [-0.11, -0.1] as const;
export const DOCTOR_AT = [0.18, 0.28] as const;
export const FIRE_AT = [0.34, -0.22] as const;

/**
 * A doctor's tent with the druid (`userData.doctor`, a `Druid`)
 * and his campfire with the pot on it. What the fire lights of it, which
 * never moves, is `userData.glowing` (the tent, its door and the pot); the
 * chunk paints the glow once all round it is placed (`paintGlow`). The
 * doctor, who moves, is not in it.
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
	const phase = (hashInts(x, z, 17) / 4294967296) * Math.PI * 2;
	const doctor = new Druid(x + DOCTOR_AT[0], z + DOCTOR_AT[1], phase);
	doctor.figure.position.set(DOCTOR_AT[0], 0, DOCTOR_AT[1]);
	doctor.pot.position.set(FIRE_AT[0], 0, FIRE_AT[1]);
	g.add(cloth, door, doctor.figure, doctor.pot);
	g.position.set(x, top, z);
	g.userData.doctor = doctor;
	g.userData.glowing = [cloth, door, doctor.pot];
	return g;
}
