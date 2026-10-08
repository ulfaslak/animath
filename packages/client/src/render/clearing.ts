import {
	Rng,
	hashInts,
	type ClearableKind,
	type Direction,
	type GridPos,
	type ItemId,
	type Tile
} from '@mathgame/engine';
import * as THREE from 'three';
import { smoothstep } from './ease';
import { ARCTIC_COLORS, COLORS, PROP_COLORS, TILE_COLORS } from './palette';
import {
	BOX_GEOMETRY,
	PEAK_HEIGHT,
	PROP_GEOMETRY,
	buildTileProps,
	disposeChunkGroup,
	groundTop
} from './tiles';
import { AHEAD } from './trainer';

/**
 * Chopping a tree and breaking a rock or an ice block, on screen ([[UI_SPEC]]
 * § Explore mode): the trainer swings the tool over the shoulder and down,
 * and as it lands the tree tips over, away from the trainer, and shrinks away
 * with a few chips of wood flying, or the rock shakes and cracks into
 * pebbles, the ice block into shards of ice. A
 * little under a second, all of it. The chunk already holds the stump or the
 * gravel when the flourish starts (`ChunkRing.setEdits`); the flourish draws
 * what stood there, exactly as the chunk drew it, and takes it down.
 *
 * With reduced motion the swing is half as big, nothing tips, flies or
 * shakes: the tree or the rock shrinks away where it stands, with a few chips
 * or pebbles that fade in place. What happened still shows.
 *
 * Decoration only: the authority has cleared the tile before any of this
 * starts, so walking into the gap at once is fine.
 */

/** How long the trainer's swing takes, in seconds. */
export const SWING_SECONDS = 0.36;
/** Shares of the swing: raised over the shoulder by the first, struck down by the second. */
const RAISE_END = 0.4;
const STRIKE_END = 0.62;
/** Seconds from the swing's start to the tool landing: the tree starts to fall, and the chop sounds. */
export const SWING_STRIKE = SWING_SECONDS * STRIKE_END;
/** Radians the arm turns: back over the shoulder, then down past the front. */
const RAISED = 2.5;
const STRUCK = -1.1;
/** With reduced motion, how far the arm swings, of the full swing. */
const CALM_SWING = 0.5;

const clamp01 = (p: number) => Math.min(1, Math.max(0, p));
const easeIn = (p: number) => clamp01(p) * clamp01(p);
const easeOut = (p: number) => 1 - (1 - clamp01(p)) * (1 - clamp01(p));

/**
 * The arm's turn about its shoulder `progress` (0..1) through a swing:
 * raised, struck, back to rest. 0 at both ends, so it hands over to the walk.
 */
export function swingAngle(progress: number, calm: boolean): number {
	const p = clamp01(progress);
	let a: number;
	if (p < RAISE_END) a = RAISED * easeOut(p / RAISE_END);
	else if (p < STRIKE_END) {
		a = RAISED + (STRUCK - RAISED) * easeIn((p - RAISE_END) / (STRIKE_END - RAISE_END));
	} else a = STRUCK * (1 - easeOut((p - STRIKE_END) / (1 - STRIKE_END)));
	return a * (calm ? CALM_SWING : 1);
}

/** The trainer's right arm `progress` through a swing (after `animateWalk`, which it overrides). */
export function animateSwing(figure: THREE.Object3D, progress: number, calm: boolean): void {
	const arm = figure.children[0]?.getObjectByName('armR');
	if (arm) arm.rotation.x = swingAngle(progress, calm);
}

const toolMaterials = new Map<number, THREE.MeshLambertMaterial>();
function toolMaterial(hex: number): THREE.MeshLambertMaterial {
	let m = toolMaterials.get(hex);
	if (!m) {
		m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
		toolMaterials.set(hex, m);
	}
	return m;
}

/** A box of the shared unit box, scaled, placed in the arm's frame. */
function block(hex: number, size: [number, number, number], at: [number, number, number]) {
	const mesh = new THREE.Mesh(BOX_GEOMETRY, toolMaterial(hex));
	mesh.scale.set(...size);
	mesh.position.set(...at);
	mesh.castShadow = true;
	return mesh;
}

/** A pale edge on the axe's blade, as the shop's picture has it. */
const EDGE = 0xe9e6e2;
/** The Arctic's tools, as their shop pictures have them: a red shaft and blue steel. */
const ICE_PICK_SHAFT = 0xc0392b;
const STEEL = 0x6f9fc4;

/**
 * The tool in the trainer's fist, to hang on the right arm's joint for a
 * swing: a handle down from the hand and the head at its end, leading the
 * swing. Boxes of the shared unit box: nothing to free.
 */
export function buildTool(tool: ItemId): THREE.Group {
	const group = new THREE.Group();
	group.name = `tool:${tool}`;
	// The hand is 0.25 below the shoulder joint; the handle runs on past it.
	if (tool === 'ice-pick') {
		// The ice pick: a red shaft, a long pick of blue steel across its head, a spike at its foot.
		group.add(block(ICE_PICK_SHAFT, [0.03, 0.34, 0.03], [0, -0.35, 0]));
		group.add(block(STEEL, [0.025, 0.035, 0.32], [0, -0.51, 0.03]));
		group.add(block(ARCTIC_COLORS.block, [0.027, 0.03, 0.06], [0, -0.51, 0.2]));
		return group;
	}
	if (tool === 'arctic-axe') {
		// The Arctic's axe: a red handle wrapped in white, and a broad blade of blue steel.
		group.add(block(ICE_PICK_SHAFT, [0.035, 0.3, 0.035], [0, -0.33, 0]));
		group.add(block(COLORS.white, [0.04, 0.06, 0.04], [0, -0.26, 0]));
		group.add(block(STEEL, [0.025, 0.14, 0.12], [0, -0.45, 0.06]));
		group.add(block(EDGE, [0.027, 0.14, 0.025], [0, -0.45, 0.125]));
		return group;
	}
	group.add(block(COLORS.trunk, [0.035, 0.3, 0.035], [0, -0.33, 0]));
	if (tool === 'pickaxe') {
		group.add(block(TILE_COLORS.rock, [0.03, 0.04, 0.3], [0, -0.47, 0]));
	} else {
		group.add(block(TILE_COLORS.rock, [0.025, 0.1, 0.1], [0, -0.45, 0.05]));
		group.add(block(EDGE, [0.027, 0.1, 0.025], [0, -0.45, 0.105]));
	}
	return group;
}

// --- the tree or rock coming down --------------------------------------------

/** Seconds a tree takes to fall; with reduced motion, to shrink away where it stands. */
const FALL_SECONDS = 0.55;
const CALM_SECONDS = 0.4;
/** How far over a tree tips before it has shrunk away: nearly flat. */
const FALL_ANGLE = 1.45;
/** Seconds a rock shakes before it cracks, and then takes to crumble. */
const SHAKE_SECONDS = 0.1;
const CRUMBLE_SECONDS = 0.3;
/** Seconds a chip or a pebble lasts, and the pull that brings it down (tiles per second squared). */
const BIT_SECONDS = 0.6;
const GRAVITY = 8;

/** Chips and pebbles: one material, each instance its own colour. */
const bitMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });

interface Bit {
	from: THREE.Vector3;
	/** Tiles per second; nothing with reduced motion. */
	velocity: THREE.Vector3;
	size: THREE.Vector3;
	turn: THREE.Euler;
}

interface Clearing {
	was: ClearableKind;
	/** Seconds on the renderer's clock when the swing started. */
	start: number;
	/** At the tile's ground: what stood there turns and shrinks about it. */
	pivot: THREE.Group;
	/** A tree falls about this axis, away from the trainer. */
	axis: THREE.Vector3;
	bits: THREE.InstancedMesh;
	/** The bits in the order they fly; with reduced motion only the first few show. */
	flying: Bit[];
	ground: number;
}

/** With reduced motion only this many chips or pebbles, and they don't fly. */
const CALM_BITS = 3;

export class ClearingEffects {
	private active: Clearing[] = [];
	private matrix = new THREE.Matrix4();
	private quaternion = new THREE.Quaternion();

	constructor(private parent: THREE.Object3D) {}

	/**
	 * A tile was cleared: what stood there, `base` (the tile as the seed made
	 * it), comes down, the way the trainer faced (`facing`). `now` is the
	 * renderer's clock when the swing starts, in seconds.
	 */
	play(base: Tile, at: GridPos, facing: Direction, now: number): void {
		if (base.kind !== 'tree' && base.kind !== 'rock' && base.kind !== 'iceblock') return;
		const top = groundTop(base);
		const pivot = new THREE.Group();
		pivot.position.set(at.x, top, at.y);
		const props = buildTileProps(base, at.x, at.y);
		props.position.set(-at.x, -top, -at.y);
		pivot.add(props);
		const { x: dx, z: dz } = AHEAD[facing];
		const rng = new Rng(hashInts(at.x, at.y, 77));
		const flying = base.kind === 'tree' ? chips(rng, dx, dz, top) : pebbles(rng, top);
		const colours =
			base.kind === 'tree'
				? CHIP_COLOURS
				: base.kind === 'iceblock'
					? SHARD_COLOURS
					: pebbleColours(base);
		const shape = base.kind === 'tree' ? PROP_GEOMETRY.ball : PROP_GEOMETRY.rock;
		const bits = new THREE.InstancedMesh(shape, bitMaterial, flying.length);
		const colour = new THREE.Color();
		flying.forEach((_, i) => bits.setColorAt(i, colour.setHex(colours[i % colours.length]!)));
		if (bits.instanceColor) bits.instanceColor.needsUpdate = true;
		bits.castShadow = true;
		bits.count = 0;
		// Moved every frame, so their bounds are never current: never culled.
		bits.frustumCulled = false;
		// The bits fly from the tile, not from the tipping tree: a sibling of the pivot, on the tile.
		bits.position.set(at.x, 0, at.y);
		const root = new THREE.Group();
		root.add(pivot, bits);
		this.parent.add(root);
		this.active.push({
			was: base.kind,
			start: now,
			pivot,
			// It tips over about the ground line across the way the trainer faces.
			axis: new THREE.Vector3(dz, 0, -dx),
			bits,
			flying,
			ground: top
		});
	}

	/** Move every clearing on to `now` (seconds), and free the ones that are over. */
	update(now: number, calm: boolean): void {
		this.active = this.active.filter((c) => {
			const since = now - c.start - SWING_STRIKE;
			const over = c.was === 'tree' ? this.fell(c, since, calm) : this.crumbled(c, since, calm);
			const bitsOver = this.fly(c, since, calm);
			if (!over || !bitsOver) return true;
			this.free(c);
			return false;
		});
	}

	/** Take every clearing down at once: the world is starting over. */
	clear(): void {
		for (const c of this.active) this.free(c);
		this.active = [];
	}

	/** How many clearings are playing. */
	get size(): number {
		return this.active.length;
	}

	/** The tree `since` seconds after the tool landed (before it, standing); true once it is gone. */
	private fell(c: Clearing, since: number, calm: boolean): boolean {
		if (since < 0) return false;
		if (calm) {
			const p = since / CALM_SECONDS;
			c.pivot.quaternion.identity();
			c.pivot.scale.setScalar(Math.max(0.001, 1 - smoothstep(p)));
			return p >= 1;
		}
		const p = since / FALL_SECONDS;
		c.pivot.quaternion.setFromAxisAngle(c.axis, FALL_ANGLE * easeIn(p));
		c.pivot.scale.setScalar(Math.max(0.001, 1 - smoothstep((p - 0.45) / 0.55)));
		return p >= 1;
	}

	/** The rock `since` seconds after the tool landed: a shake, then it crumbles away; true once gone. */
	private crumbled(c: Clearing, since: number, calm: boolean): boolean {
		if (since < 0) return false;
		const shake = calm ? 0 : SHAKE_SECONDS;
		if (since < shake) {
			const fade = 1 - since / shake;
			c.pivot.rotation.set(
				Math.cos(since * 70) * 0.05 * fade,
				0,
				Math.sin(since * 70) * 0.06 * fade
			);
			return false;
		}
		c.pivot.rotation.set(0, 0, 0);
		const p = (since - shake) / (calm ? CALM_SECONDS : CRUMBLE_SECONDS);
		c.pivot.scale.setScalar(Math.max(0.001, 1 - smoothstep(p)));
		return p >= 1;
	}

	/** The chips or pebbles `since` seconds after the tool landed (a rock's after its shake); true once gone. */
	private fly(c: Clearing, since: number, calm: boolean): boolean {
		const from = c.was !== 'tree' && !calm ? since - SHAKE_SECONDS : since;
		if (from < 0) return false;
		const life = calm ? CALM_SECONDS : BIT_SECONDS;
		const shown = calm ? Math.min(CALM_BITS, c.flying.length) : c.flying.length;
		c.bits.count = from < life ? shown : 0;
		const shrink = Math.max(0.001, 1 - smoothstep((from / life - 0.6) / 0.4));
		const scale = new THREE.Vector3();
		for (let i = 0; i < shown; i++) {
			const bit = c.flying[i]!;
			const at = bit.from.clone();
			if (!calm) {
				// Up and out, down again, and it stays where it lands.
				const land = landingTime(bit, c.ground);
				const t = Math.min(from, land);
				at.addScaledVector(bit.velocity, t);
				at.y -= 0.5 * GRAVITY * t * t;
				at.y = Math.max(at.y, c.ground + bit.size.y / 2);
			}
			this.quaternion.setFromEuler(bit.turn);
			scale.copy(bit.size).multiplyScalar(shrink);
			this.matrix.compose(at, this.quaternion, scale);
			c.bits.setMatrixAt(i, this.matrix);
		}
		c.bits.instanceMatrix.needsUpdate = true;
		return from >= life;
	}

	private free(c: Clearing): void {
		const root = c.pivot.parent;
		if (root) {
			this.parent.remove(root);
			disposeChunkGroup(root);
		}
	}
}

/** When a bit thrown from `from` with its velocity comes down to `ground`. */
function landingTime(bit: Bit, ground: number): number {
	const rise = bit.from.y - (ground + bit.size.y / 2);
	const v = bit.velocity.y;
	// from.y + v t − g t² / 2 = ground: the later root.
	return (v + Math.sqrt(v * v + 2 * GRAVITY * Math.max(0, rise))) / GRAVITY;
}

const CHIP_COLOURS: readonly number[] = [PROP_COLORS.wood, PROP_COLORS.wood, COLORS.trunk];
/** An ice block's shards: its blue and its pale top, and the ice's shine. */
const SHARD_COLOURS: readonly number[] = [
	ARCTIC_COLORS.block,
	ARCTIC_COLORS.blockTop,
	ARCTIC_COLORS.shine
];

function pebbleColours(base: Tile): readonly number[] {
	const grey = [COLORS.rock, PROP_COLORS.boulderLight, PROP_COLORS.pebble];
	return base.height >= PEAK_HEIGHT ? [...grey, PROP_COLORS.snow] : grey;
}

/**
 * Six chips from where the axe bit, low on the trunk: out towards the
 * trainer's side and up, spread either way. Across the ground from the
 * tile's middle; heights are the world's.
 */
function chips(rng: Rng, dx: number, dz: number, top: number): Bit[] {
	const out: Bit[] = [];
	for (let i = 0; i < 6; i++) {
		const side = (rng.next() * 2 - 1) * 1.2;
		const back = 0.5 + rng.next() * 0.9;
		out.push({
			from: new THREE.Vector3(
				-dx * 0.12 - dz * side * 0.05,
				top + 0.2,
				-dz * 0.12 + dx * side * 0.05
			),
			velocity: new THREE.Vector3(
				-dx * back + dz * side,
				1.3 + rng.next() * 0.9,
				-dz * back - dx * side
			),
			size: new THREE.Vector3(0.05, 0.018, 0.035).multiplyScalar(0.8 + rng.next() * 0.5),
			turn: new THREE.Euler(rng.next(), rng.next() * Math.PI, rng.next())
		});
	}
	return out;
}

/** Seven pebbles bursting from the rock's middle, every way round (placed as the chips are). */
function pebbles(rng: Rng, top: number): Bit[] {
	const out: Bit[] = [];
	for (let i = 0; i < 7; i++) {
		const angle = (i / 7) * Math.PI * 2 + rng.next() * 0.6;
		const speed = 0.6 + rng.next() * 0.6;
		const s = 0.05 + rng.next() * 0.04;
		out.push({
			from: new THREE.Vector3(Math.cos(angle) * 0.1, top + 0.2, Math.sin(angle) * 0.1),
			velocity: new THREE.Vector3(
				Math.cos(angle) * speed,
				1 + rng.next() * 0.7,
				Math.sin(angle) * speed
			),
			size: new THREE.Vector3(s, s * 0.8, s),
			turn: new THREE.Euler(rng.next(), rng.next(), rng.next())
		});
	}
	return out;
}
