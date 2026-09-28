import * as THREE from 'three';
import { COLORS } from './palette';

/**
 * The world's light, as the renderer hangs it (`renderer.ts`): a hemisphere
 * fill, white sky over a green bounce, and one warm sun, which shines from
 * `SUN_FROM` (from the point the camera looks at, so from the same direction
 * everywhere). The campfires' glow is painted against it.
 */
export const WORLD_LIGHT = {
	sky: 0xffffff,
	bounce: 0x88aa66,
	fill: 1.1,
	sun: 0xfff2d6,
	sunIntensity: 2.2
} as const;
export const SUN_FROM: readonly [number, number, number] = [12, 20, 8];

/**
 * The warm light over every campfire: a point light of this colour and
 * intensity, `height` over the ground its fire burns on, reaching `reach`
 * tiles, as three.js would light it (its distance falloff, the cut-off at
 * its reach). No such light is in the scene: its glow is painted
 * (`paintCampfire`), because every point light cost every lit pixel on
 * screen, and a new number of them compiled every lit shader again (#150,
 * #151). So the world's lights are the fill and the sun, always.
 */
export const CAMPFIRE_LIGHT = {
	color: COLORS.fire,
	intensity: 1.5,
	reach: 4,
	height: 0.6
} as const;

/** Below this, in the glow's strongest channel, a triangle is left out: no pixel would change. */
const INVISIBLE = 1 / 255;
/**
 * How far from the light anything is painted. Further out the glow is at
 * most 3.5/255 (on a face turned right to the fire, away from the sun) and
 * under 1/255 on the ground, though the light's own cut-off is at 4.
 */
export const GLOW_REACH = 3.5;

const SKY = new THREE.Color(WORLD_LIGHT.sky);
const BOUNCE = new THREE.Color(WORLD_LIGHT.bounce);
const SUN = new THREE.Color(WORLD_LIGHT.sun);
const FIRE = new THREE.Color(CAMPFIRE_LIGHT.color);
const SUN_DIRECTION = new THREE.Vector3(...SUN_FROM).normalize();
const CHANNELS = [
	[SKY.r, BOUNCE.r, SUN.r, FIRE.r],
	[SKY.g, BOUNCE.g, SUN.g, FIRE.g],
	[SKY.b, BOUNCE.b, SUN.b, FIRE.b]
] as const;

/**
 * What the fill and the sun give a surface facing `n` (a unit vector), per
 * channel, before its colour: what the fire's light is added to. Assumes
 * the sun reaches it.
 */
function litFacing(n: THREE.Vector3): [number, number, number] {
	const up = 0.5 * n.y + 0.5;
	const sun = Math.max(0, n.dot(SUN_DIRECTION)) * WORLD_LIGHT.sunIntensity;
	const lit = ([sky, bounce, sunColour]: readonly number[]) =>
		WORLD_LIGHT.fill * (bounce! + (sky! - bounce!) * up) + sun * sunColour!;
	return [lit(CHANNELS[0]), lit(CHANNELS[1]), lit(CHANNELS[2])];
}

/**
 * What the campfire's light adds at `(x, y, z)`, on a surface facing `n` that
 * the fill and the sun light `lit` (`litFacing`), `light` being where the
 * light hangs, all in one frame: the factor the lit colour on screen is
 * multiplied by, less one, per channel, into `out` from `at`; returned, the
 * strongest channel's. The light adds `fire × irradiance` to the rest
 * (three.js's Lambert sums every light's irradiance, then multiplies it by
 * the colour), so the lit colour grows by `(lit + fire) / lit` in linear
 * light, and by about that to the power 1/2.2 as the screen stores it.
 */
function glowInto(
	x: number,
	y: number,
	z: number,
	n: THREE.Vector3,
	lit: readonly number[],
	light: THREE.Vector3,
	out: number[],
	at: number
): number {
	out[at] = out[at + 1] = out[at + 2] = 0;
	const [lx, ly, lz] = [light.x - x, light.y - y, light.z - z];
	const d = Math.sqrt(lx * lx + ly * ly + lz * lz);
	const { intensity, reach } = CAMPFIRE_LIGHT;
	if (d >= reach) return 0;
	const facing = (n.x * lx + n.y * ly + n.z * lz) / Math.max(d, 1e-6);
	if (facing <= 0) return 0;
	const cut = 1 - (d / reach) ** 4;
	const irradiance = (intensity / Math.max(d * d, 0.01)) * cut * cut * facing;
	let strongest = 0;
	for (let c = 0; c < 3; c++) {
		const glow = Math.min(1, Math.pow(1 + (irradiance * CHANNELS[c]![3]) / lit[c]!, 1 / 2.2) - 1);
		out[at + c] = glow;
		strongest = Math.max(strongest, glow);
	}
	return strongest;
}

/**
 * How finely to cut the ground `d` from the light: the glow falls off as the
 * square of the distance, so a cell a quarter of the distance across keeps
 * its gradient smooth, from 0.06 tiles right by the fire to half a tile at
 * the edge of its reach.
 */
const cellAt = (d: number) => Math.min(0.5, Math.max(0.06, d / 4));
/**
 * How finely to cut a shape's face `d` from the light: as the ground near
 * the fire, coarser further off. The glow there, about `0.3 / d²`, strays
 * from a straight line across a cell `s` wide by about `0.75 (s / d)²` of
 * itself, so cells of `0.2 d²` keep it within 2/255, and a face two tiles
 * off, where the glow is faint, is left whole.
 */
const shapeCellAt = (d: number) => Math.min(1, Math.max(cellAt(d), 0.2 * d * d));

/**
 * Collects the glow's triangles: where they are, and the glow at each
 * corner. A surface is cut into a grid of corners first (`xyz`, their glow
 * `rgb`, its strongest channel `peak`), then into triangles, dropping those
 * with no glow at any corner.
 */
class GlowPainter {
	/** The triangles' corners so far, three numbers each: where they are, and their glow. */
	private positions = new Float32Array(3 * 8192);
	private glows = new Float32Array(3 * 8192);
	private count = 0;
	private readonly xyz: number[] = [];
	private readonly rgb: number[] = [];
	private readonly peak: number[] = [];
	private readonly near = new THREE.Vector3();
	private readonly face = new THREE.Triangle();

	constructor(private readonly light: THREE.Vector3) {}

	/**
	 * A rectangle facing `n`: from `origin` along `u` and `v` (`u × v` points
	 * along `n`, so it faces the camera the way its surface does), cut finely
	 * enough to follow the glow.
	 */
	rectangle(origin: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, n: THREE.Vector3): void {
		if (!this.faces(origin, n)) return;
		const ou = origin.clone().add(u);
		const ouv = ou.clone().add(v);
		const d = Math.min(
			this.distanceTo(origin, ou, ouv),
			this.distanceTo(origin, ouv, origin.clone().add(v))
		);
		if (d >= GLOW_REACH) return;
		const cell = cellAt(d);
		const cols = Math.max(1, Math.ceil(u.length() / cell));
		const rows = Math.max(1, Math.ceil(v.length() / cell));
		const lit = litFacing(n);
		this.begin();
		for (let j = 0; j <= rows; j++) {
			for (let i = 0; i <= cols; i++) {
				const [s, t] = [i / cols, j / rows];
				this.corner(
					origin.x + u.x * s + v.x * t,
					origin.y + u.y * s + v.y * t,
					origin.z + u.z * s + v.z * t,
					n,
					lit
				);
			}
		}
		const at = (i: number, j: number) => j * (cols + 1) + i;
		for (let j = 0; j < rows; j++) {
			for (let i = 0; i < cols; i++) {
				this.triangle(at(i, j), at(i + 1, j), at(i + 1, j + 1));
				this.triangle(at(i, j), at(i + 1, j + 1), at(i, j + 1));
			}
		}
	}

	/**
	 * Every triangle of `geometry` placed by `matrix`, each glowing by its own
	 * face's normal, as a flat-shaded mesh is lit, and cut finely enough to
	 * follow the glow: a face next to the fire is brightest where it is
	 * nearest, which its corners alone would miss.
	 */
	shape(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
		const position = geometry.getAttribute('position');
		const index = geometry.getIndex();
		const count = index ? index.count : position.count;
		const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
		const [ab, ac, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
		const read = (to: THREE.Vector3, k: number) =>
			to.fromBufferAttribute(position, index ? index.getX(k) : k).applyMatrix4(matrix);
		for (let k = 0; k + 2 < count; k += 3) {
			read(a, k);
			read(b, k + 1);
			read(c, k + 2);
			ab.subVectors(b, a);
			ac.subVectors(c, a);
			n.crossVectors(ab, ac);
			if (n.lengthSq() < 1e-12) continue;
			n.normalize();
			if (!this.faces(a, n)) continue;
			const d = this.distanceTo(a, b, c);
			if (d >= GLOW_REACH) continue;
			const longest = Math.max(ab.length(), ac.length(), c.distanceTo(b));
			const cuts = Math.max(1, Math.ceil(longest / shapeCellAt(d)));
			const lit = litFacing(n);
			// A triangular grid over the face: corner (i, j) is a + ab·i/cuts + ac·j/cuts, i + j ≤ cuts.
			this.begin();
			const rowStart: number[] = [];
			for (let i = 0; i <= cuts; i++) {
				rowStart.push(this.peak.length);
				for (let j = 0; i + j <= cuts; j++) {
					const [s, t] = [i / cuts, j / cuts];
					this.corner(
						a.x + ab.x * s + ac.x * t,
						a.y + ab.y * s + ac.y * t,
						a.z + ab.z * s + ac.z * t,
						n,
						lit
					);
				}
			}
			const at = (i: number, j: number) => rowStart[i]! + j;
			for (let i = 0; i < cuts; i++) {
				for (let j = 0; i + j < cuts; j++) {
					this.triangle(at(i, j), at(i + 1, j), at(i, j + 1));
					if (i + j + 1 < cuts) this.triangle(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
				}
			}
		}
	}

	/** Whether a surface through `p` facing `n` is turned towards the light at all. */
	private faces(p: THREE.Vector3, n: THREE.Vector3): boolean {
		const { light } = this;
		return (light.x - p.x) * n.x + (light.y - p.y) * n.y + (light.z - p.z) * n.z > 0;
	}

	/** How far the light is from the nearest point of the triangle `a, b, c`. */
	private distanceTo(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
		this.face.set(a, b, c).closestPointToPoint(this.light, this.near);
		return Number.isFinite(this.near.x) ? this.near.distanceTo(this.light) : Infinity;
	}

	private begin(): void {
		this.xyz.length = this.rgb.length = this.peak.length = 0;
	}

	private corner(x: number, y: number, z: number, n: THREE.Vector3, lit: readonly number[]): void {
		const at = this.rgb.length;
		this.xyz.push(x, y, z);
		this.rgb.push(0, 0, 0);
		this.peak.push(glowInto(x, y, z, n, lit, this.light, this.rgb, at));
	}

	/** The triangle of corners `a, b, c`, unless no pixel of it would glow. */
	private triangle(a: number, b: number, c: number): void {
		const { peak } = this;
		if (peak[a]! < INVISIBLE && peak[b]! < INVISIBLE && peak[c]! < INVISIBLE) return;
		this.emit(a);
		this.emit(b);
		this.emit(c);
	}

	private emit(k: number): void {
		if (3 * this.count === this.positions.length) {
			const [positions, glows] = [this.positions, this.glows];
			this.positions = new Float32Array(2 * positions.length);
			this.glows = new Float32Array(2 * glows.length);
			this.positions.set(positions);
			this.glows.set(glows);
		}
		const [at, from] = [3 * this.count++, 3 * k];
		const { xyz, rgb, positions, glows } = this;
		positions[at] = xyz[from]!;
		positions[at + 1] = xyz[from + 1]!;
		positions[at + 2] = xyz[from + 2]!;
		glows[at] = rgb[from]!;
		glows[at + 1] = rgb[from + 1]!;
		glows[at + 2] = rgb[from + 2]!;
	}

	/** The triangles painted so far, `more` after them. */
	triangles(more?: GlowTriangles): GlowTriangles {
		const size = 3 * this.count;
		const extra = more?.positions.length ?? 0;
		const positions = new Float32Array(size + extra);
		const glows = new Float32Array(size + extra);
		positions.set(this.positions.subarray(0, size));
		glows.set(this.glows.subarray(0, size));
		if (more) {
			positions.set(more.positions, size);
			glows.set(more.glows, size);
		}
		return { positions, glows };
	}
}

/** Triangles of glow, in a fire's frame: each corner's position, then its glow, three numbers each. */
export interface GlowTriangles {
	positions: Float32Array;
	glows: Float32Array;
}

/**
 * The glow, laid over what is already drawn: it multiplies the colour on
 * screen by one plus its own, `dst × (1 + glow)`, which is how much more
 * light the surface would reflect with the fire's light on it. It never
 * writes depth and is drawn after everything solid, so what stands in front
 * of a glowing surface (the doctor, a trainer, a tree) hides it; a little
 * depth offset keeps it on the surface it paints, not under it. Fog fades
 * it as it fades the ground.
 */
export const GLOW_MATERIAL = new THREE.ShaderMaterial({
	name: 'campfire-glow',
	vertexShader: /* glsl */ `
		attribute vec3 glow;
		varying vec3 vGlow;
		#include <fog_pars_vertex>
		void main() {
			vGlow = glow;
			vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
			gl_Position = projectionMatrix * mvPosition;
			#include <fog_vertex>
		}`,
	fragmentShader: /* glsl */ `
		varying vec3 vGlow;
		#include <fog_pars_fragment>
		void main() {
			vec3 glow = vGlow;
			#ifdef USE_FOG
				glow *= 1.0 - smoothstep( fogNear, fogFar, vFogDepth );
			#endif
			gl_FragColor = vec4( glow, 1.0 );
		}`,
	uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
	fog: true,
	transparent: true,
	depthWrite: false,
	blending: THREE.CustomBlending,
	blendEquation: THREE.AddEquation,
	blendSrc: THREE.DstColorFactor,
	blendDst: THREE.OneFactor,
	polygonOffset: true,
	polygonOffsetFactor: -1,
	polygonOffsetUnits: -1
});

/** The ground round a campfire: the height of the top of the tile `dx, dz` over the fire's own. */
export type GroundAround = (dx: number, dz: number) => number;

/** A shape the fire lights, where it stands in the fire's frame. */
export interface GlowShape {
	geometry: THREE.BufferGeometry;
	matrix: THREE.Matrix4;
}

/**
 * The glow on `shapes` alone (what stands the same by every fire: the tent,
 * the pot), to paint once and add to every fire's (`paintCampfire`).
 */
export function paintShapes(fire: THREE.Vector3, shapes: readonly GlowShape[]): GlowTriangles {
	const painter = new GlowPainter(lightOver(fire));
	for (const { geometry, matrix } of shapes) painter.shape(geometry, matrix);
	return painter.triangles();
}

/** Where the campfire's light hangs over a fire at `fire`. */
const lightOver = (fire: THREE.Vector3) => fire.clone().setY(fire.y + CAMPFIRE_LIGHT.height);

/**
 * The campfire's glow, in the frame of the tile the fire burns on (its
 * middle, on the ground), the fire at `fire`: a mesh over the ground's tops
 * round it, as high as `ground` says each tile is, the sides of steps facing
 * the camera, every one of `shapes` (the trees, rocks and grass round it),
 * each glowing as a small warm light over the fire would light it, and
 * `extra` (the tent and the pot, painted once for every fire). Null where
 * nothing would glow. Its geometry is its own, built for this ground and
 * what stands on it: free it with its chunk.
 */
export function paintCampfire(
	fire: THREE.Vector3,
	ground: GroundAround,
	shapes: readonly GlowShape[],
	extra?: GlowTriangles
): THREE.Mesh | null {
	const steps = paintCampfireSteps(fire, ground, shapes, extra);
	for (;;) {
		const step = steps.next();
		if (step.done) return step.value;
	}
}

/** How many shapes one step of `paintCampfireSteps` paints: a few milliseconds' work on a slow tablet. */
const SHAPES_A_STEP = 24;

/**
 * `paintCampfire` a step at a time, for a caller that spreads the work over
 * frames: it pauses after the ground and after every `SHAPES_A_STEP` shapes,
 * and returns the mesh.
 */
export function* paintCampfireSteps(
	fire: THREE.Vector3,
	ground: GroundAround,
	shapes: readonly GlowShape[],
	extra?: GlowTriangles
): Generator<void, THREE.Mesh | null> {
	const painter = new GlowPainter(lightOver(fire));
	const reach = Math.ceil(GLOW_REACH);
	const up = new THREE.Vector3(0, 1, 0);
	const east = new THREE.Vector3(1, 0, 0);
	const south = new THREE.Vector3(0, 0, 1);
	for (let dz = -reach; dz <= reach; dz++) {
		for (let dx = -reach; dx <= reach; dx++) {
			const top = ground(dx, dz);
			// The top, from its near-left corner along +x and then back along -z.
			painter.rectangle(
				new THREE.Vector3(dx - 0.5, top, dz + 0.5),
				new THREE.Vector3(1, 0, 0),
				new THREE.Vector3(0, 0, -1),
				up
			);
			// The camera sees the sides facing +x and +z, where the next tile is lower.
			const lowerEast = ground(dx + 1, dz);
			if (lowerEast < top) {
				painter.rectangle(
					new THREE.Vector3(dx + 0.5, lowerEast, dz + 0.5),
					new THREE.Vector3(0, 0, -1),
					new THREE.Vector3(0, top - lowerEast, 0),
					east
				);
			}
			const lowerSouth = ground(dx, dz + 1);
			if (lowerSouth < top) {
				painter.rectangle(
					new THREE.Vector3(dx - 0.5, lowerSouth, dz + 0.5),
					new THREE.Vector3(1, 0, 0),
					new THREE.Vector3(0, top - lowerSouth, 0),
					south
				);
			}
		}
	}
	for (let i = 0; i < shapes.length; i++) {
		if (i % SHAPES_A_STEP === 0) yield;
		painter.shape(shapes[i]!.geometry, shapes[i]!.matrix);
	}
	const { positions, glows } = painter.triangles(extra);
	if (positions.length === 0) return null;
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('glow', new THREE.BufferAttribute(glows, 3));
	geometry.computeBoundingSphere();
	const mesh = new THREE.Mesh(geometry, GLOW_MATERIAL);
	mesh.name = 'campfire-glow';
	return mesh;
}

/**
 * The shapes of every lit mesh under `parts` (lit by the world's light, so
 * the fire's shows on them too), each where it stands in `root`'s frame.
 */
export function litShapes(parts: readonly THREE.Object3D[], root: THREE.Object3D): GlowShape[] {
	const shapes: GlowShape[] = [];
	for (const part of parts) {
		part.traverse((o) => {
			if (!(o instanceof THREE.Mesh) || !isLit(o.material)) return;
			shapes.push({ geometry: o.geometry as THREE.BufferGeometry, matrix: placedUnder(o, root) });
		});
	}
	return shapes;
}

/** Whether a material is lit by the world's light, so the fire's would show on it too. */
function isLit(material: THREE.Material | THREE.Material[]): boolean {
	const one = Array.isArray(material) ? material[0] : material;
	return one instanceof THREE.MeshLambertMaterial || one instanceof THREE.MeshStandardMaterial;
}

/** Where `o` stands in `root`'s frame: its own placement and every parent's up to `root`. */
function placedUnder(o: THREE.Object3D, root: THREE.Object3D): THREE.Matrix4 {
	const matrix = new THREE.Matrix4();
	for (let at: THREE.Object3D | null = o; at && at !== root; at = at.parent) {
		at.updateMatrix();
		matrix.premultiply(at.matrix);
	}
	return matrix;
}
