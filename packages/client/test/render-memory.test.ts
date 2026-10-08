import {
	ANIMALS,
	CHUNK_SIZE,
	STARTERS,
	WorldEdits,
	onTentLattice,
	isWalkable,
	isWater,
	landSeed,
	spawnPoint,
	tileAtWorld,
	type Biome,
	type GridPos
} from '@mathgame/engine';
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { WORLD_SEED } from '../src/authority/local';
import { BattleScene } from '../src/render/battle-scene';
import { GLOW_MATERIAL } from '../src/render/campfire';
import { ChunkRing, SHOWN_RADIUS } from '../src/render/chunks';
import { ClearingEffects } from '../src/render/clearing';
import { Follower, SWIM_DEPTH } from '../src/render/follower';
import { forgetShapes } from '../src/render/merge';
import { PortraitStudio, type PortraitRenderer } from '../src/render/portraits';
import type { GameRenderer } from '../src/render/renderer';
import { StarterScene } from '../src/render/starter-scene';
import { TitleScenery } from '../src/render/title-scenery';
import { SHARED_GEOMETRIES, WATER_TOP } from '../src/render/tiles';
import { besideA } from './clearing';

// A figure's shape is shared by every figure of its kind and freed with the last of them
// (merge.ts): each test starts with none, as a page does, so what it counts is its own.
beforeEach(() => forgetShapes());

/**
 * What the renderer keeps alive on the GPU, counted without WebGL. three.js
 * uploads every geometry a mesh draws, and an InstancedMesh's instance
 * buffers, and keeps them (with their vertex arrays) until that geometry or
 * mesh is disposed. So a resource is live here from the first time the scene
 * shows it until it fires its `dispose` event, whether or not it is still in
 * the scene. Issue #24 was chunks taken out of the scene and never disposed:
 * every chunk ever walked past stayed live.
 */
type Resource = THREE.BufferGeometry | THREE.InstancedMesh;
/** What a list of resources is, short enough for a failure message ("InstancedMesh", "ConeGeometry"). */
const kinds = (list: Resource[]) =>
	list.map((r) => (r instanceof THREE.InstancedMesh ? 'InstancedMesh' : r.type));

/** Every resource the scene under `root` would draw. */
function resourcesIn(root: THREE.Object3D): Set<Resource> {
	const out = new Set<Resource>();
	root.traverse((o) => {
		if (o instanceof THREE.InstancedMesh) out.add(o);
		if (o instanceof THREE.Mesh) out.add(o.geometry as THREE.BufferGeometry);
	});
	return out;
}

class Ledger {
	readonly live = new Set<Resource>();
	private seen = new WeakSet<Resource>();
	private disposed = new WeakSet<Resource>();

	/** Note everything under `root`, as drawing a frame of it would. */
	see(root: THREE.Object3D): void {
		for (const r of resourcesIn(root)) this.track(r);
	}

	isDisposed(r: Resource): boolean {
		return this.disposed.has(r);
	}

	/** Live resources other than the geometries every chunk shares: what chunks own. */
	owned(): Resource[] {
		return [...this.live].filter(
			(r) => !(r instanceof THREE.BufferGeometry && SHARED_GEOMETRIES.has(r))
		);
	}

	/** Owned resources still live although the scene under `root` no longer shows them: leaks. */
	ownedOutside(root: THREE.Object3D): Resource[] {
		const shown = resourcesIn(root);
		return this.owned().filter((r) => !shown.has(r));
	}

	/** Resources under `root` that were disposed while the scene still shows them. */
	disposedIn(root: THREE.Object3D): Resource[] {
		return [...resourcesIn(root)].filter((r) => this.disposed.has(r));
	}

	private track(r: Resource): void {
		if (this.seen.has(r)) return;
		this.seen.add(r);
		this.live.add(r);
		(r as THREE.EventDispatcher<{ dispose: object }>).addEventListener('dispose', () => {
			this.live.delete(r);
			this.disposed.add(r);
		});
	}
}

/** Every tile from `from` to `to` in a straight line along one axis. */
function* line(from: GridPos, to: GridPos): Generator<GridPos> {
	const dx = Math.sign(to.x - from.x);
	const dy = Math.sign(to.y - from.y);
	for (let p = { ...from }; p.x !== to.x || p.y !== to.y;) {
		p = { x: p.x + dx, y: p.y + dy };
		yield p;
	}
}

const RING = 25; // 5 × 5 chunks around the player
const SHOWN = (2 * SHOWN_RADIUS + 1) ** 2; // the 3 × 3 the screen shows
const FAR = 5 * CHUNK_SIZE; // five chunk borders out: the ring there shares no chunk with the start's
const chunkOf = (p: GridPos) => `${Math.floor(p.x / CHUNK_SIZE)},${Math.floor(p.y / CHUNK_SIZE)}`;

describe('the chunks around the player', () => {
	const start = spawnPoint(WORLD_SEED);

	it('free every chunk they leave: a walk far out and back ends with what it started with', () => {
		const parent = new THREE.Group();
		const ring = new ChunkRing(parent);
		const ledger = new Ledger();
		ring.reset(WORLD_SEED);
		ring.update(start);
		ring.finish();
		ledger.see(parent);
		const atStart = ledger.owned().length;
		expect(ring.size).toBe(RING);
		expect(atStart).toBeGreaterThan(0);

		// Round a square, west, south, east and north, back to the start: every
		// sixteenth step enters a new column or row of chunks.
		const west = { x: start.x - FAR, y: start.y };
		const southWest = { x: start.x - FAR, y: start.y + FAR };
		const south = { x: start.x, y: start.y + FAR };
		const legs: [GridPos, GridPos][] = [
			[start, west],
			[west, southWest],
			[southWest, south],
			[south, start]
		];
		let chunk = chunkOf(start);
		const leaks: string[] = [];
		for (const [from, to] of legs) {
			for (const p of line(from, to)) {
				// A frame a step: the ring's edge is built a piece a frame.
				ring.update(p);
				ring.work();
				ledger.see(parent);
				// The ring only frees chunks when the player crosses into another chunk.
				if (chunkOf(p) === chunk) continue;
				chunk = chunkOf(p);
				// At every crossing, what the chunks own is exactly what is on screen.
				const leaked = ledger.ownedOutside(parent);
				if (leaked.length) leaks.push(`${chunk}: ${kinds(leaked).length} left behind`);
				if (ring.size < SHOWN || ring.size > RING)
					leaks.push(`${chunk}: ${ring.size} chunks built`);
			}
		}
		ring.finish();
		ledger.see(parent);

		expect(leaks.slice(0, 5)).toEqual([]);
		expect(parent.children.length).toBe(RING);
		// Back where it began, the chunks own exactly as much as they did then.
		expect(ledger.owned().length).toBe(atStart);
		// Nothing still on screen was freed (a shared shape disposed under another chunk).
		expect(kinds(ledger.disposedIn(parent))).toEqual([]);
		expect(kinds([...SHARED_GEOMETRIES].filter((g) => ledger.isDisposed(g)))).toEqual([]);
		// About 1.8 s alone (hundreds of chunks built and freed); over 5 s under a heavy load.
		// 0.55 s alone at a load average of 12 to 23 and 1.9 s in the whole suite at 28 (2026-09-28),
		// which scales to 10 s at 150.
	}, 60_000);

	it('free the whole ring on a jump, and every chunk of the old world when the world changes', () => {
		const parent = new THREE.Group();
		const ring = new ChunkRing(parent);
		const ledger = new Ledger();
		ring.reset(WORLD_SEED);
		// A step, then a jump far off (a knock-out's trip to a tent is one).
		for (const p of [start, { x: start.x + 1, y: start.y }, { x: -300, y: 200 }]) {
			ring.update(p);
			ring.finish();
			ledger.see(parent);
			expect(kinds(ledger.ownedOutside(parent))).toEqual([]);
		}
		expect(ring.size).toBe(RING);
		ring.reset(WORLD_SEED + 1);
		expect(parent.children.length).toBe(0);
		expect(kinds(ledger.owned())).toEqual([]);
		ring.update(start);
		ring.finish();
		expect(ring.size).toBe(RING);
		// About 1 s alone (three whole rings of chunks built); over 5 s under a heavy load.
	}, 30_000);

	it("draw only shared shapes, but for the glow of each tent's campfire, built for the ground round it", () => {
		const parent = new THREE.Group();
		const ring = new ChunkRing(parent);
		// Meadow, river and tents by the start, forest and rocks further out; then The Arctic's
		// ice blocks, ice and spruces by its spawn (#191).
		const own = new Set<THREE.BufferGeometry>();
		const shared = new Set<THREE.BufferGeometry>();
		const glows = new Set<THREE.BufferGeometry>();
		const tents = new Set<object>();
		const arctic = landSeed('arctic', 1);
		for (const [seed, p] of [
			[WORLD_SEED, start],
			[WORLD_SEED, { x: -80, y: -2 }],
			[arctic, spawnPoint(arctic)]
		] as const) {
			ring.reset(seed);
			ring.update(p);
			ring.finish();
			ring.forEachDoctor((doctor) => tents.add(doctor));
			parent.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				if (SHARED_GEOMETRIES.has(o.geometry)) shared.add(o.geometry);
				else (o.material === GLOW_MATERIAL ? glows : own).add(o.geometry);
			});
		}
		expect([...own].map((g) => g.type)).toEqual([]);
		// One glow a tent, and never one without: `disposeChunkGroup` frees it with its chunk.
		expect(tents.size).toBeGreaterThan(0);
		expect(glows.size).toBe(tents.size);
		// Every kind of prop was on the way, so none escaped the check.
		expect(shared.size).toBe(SHARED_GEOMETRIES.size);
	});

	it('hold no light, so the lights never change in number as tents come and go', () => {
		// three.js writes the number of point lights into every lit shader: each new number of
		// campfire lights in the ring compiled every lit program again, and the frame froze
		// for up to 0.75 s (#151). A campfire's glow is painted instead.
		const parent = new THREE.Group();
		const ring = new ChunkRing(parent);
		ring.reset(WORLD_SEED);
		const tents = new Set<object>();
		const lights: string[] = [];
		// East from the start through twenty columns of chunks, and the tents in them.
		for (const p of line(start, { x: start.x + 4 * FAR, y: start.y })) {
			ring.update(p);
			ring.work();
			ring.forEachDoctor((doctor) => tents.add(doctor));
			parent.traverse((o) => {
				if (o instanceof THREE.Light) lights.push(`${o.type} at ${chunkOf(p)}`);
			});
		}
		expect(lights.slice(0, 5)).toEqual([]);
		expect(tents.size).toBeGreaterThan(2);
	}, 30_000);

	it("build what the screen shows at once and the ring's edge a piece a frame, each chunk once, and none that left before its turn", () => {
		const parent = new THREE.Group();
		const built: THREE.Object3D[] = [];
		const add = parent.add.bind(parent);
		parent.add = (...objects: THREE.Object3D[]) => {
			built.push(...objects);
			return add(...objects);
		};
		// One piece of work a frame, however quick.
		const ring = new ChunkRing(parent, 0);
		ring.reset(WORLD_SEED);
		ring.update(start);
		// The 3×3 round the player at once; the sixteen round them wait.
		expect(ring.size).toBe(SHOWN);
		expect(ring.pending).toBe(RING - SHOWN);
		ring.work();
		expect(ring.size).toBe(SHOWN + 1);
		ring.finish();
		expect(ring.size).toBe(RING);
		expect(built.length).toBe(RING);
		// A step into the next column of chunks: its five at the ring's edge, one a frame.
		const next = { x: (Math.floor(start.x / CHUNK_SIZE) + 1) * CHUNK_SIZE, y: start.y };
		ring.update(next);
		expect(ring.size).toBe(RING - 5);
		const before = built.length;
		for (let frame = 1; ring.pending > 0; frame++) {
			ring.work();
			// Building a chunk with a tent leaves its glow for the frame after.
			expect(built.length - before).toBeLessThanOrEqual(frame);
		}
		expect(built.length - before).toBe(5);
		expect(ring.size).toBe(RING);
		// A jump before the ring's edge is built: its work goes with it, none of it built later.
		ring.update({ x: next.x + CHUNK_SIZE, y: next.y });
		const left = ring.pending;
		expect(left).toBe(5);
		const far = { x: next.x + 20 * CHUNK_SIZE, y: next.y };
		ring.update(far);
		expect(ring.pending).toBe(RING - SHOWN);
		const beforeFar = built.length;
		ring.finish();
		expect(built.length - beforeFar).toBe(RING - SHOWN);
		expect(parent.children.length).toBe(RING);
		// Every tent in the finished ring has its glow, once.
		let tents = 0;
		let glows = 0;
		parent.traverse((o) => {
			if (o.userData.doctor) tents++;
			if (o instanceof THREE.Mesh && o.material === GLOW_MATERIAL) glows++;
		});
		expect(glows).toBe(tents);
	});
});

describe('a tree chopped down, a rock broken', () => {
	const start = spawnPoint(WORLD_SEED);
	/** How many of a prop the scene under `root` draws: canopies are trees, rocks are boulders and pebbles. */
	const instances = (root: THREE.Object3D, name: string) => {
		let n = 0;
		root.traverse((o) => {
			if (o instanceof THREE.InstancedMesh && o.name === name) n += o.count;
		});
		return n;
	};

	it("builds a tent's chunk next door again when a tree its campfire lights is chopped: no glow is left in the air", () => {
		// The first tent from the spawn with a tree in the next chunk, three tiles from it at most.
		const home = spawnPoint(WORLD_SEED);
		let found: { tent: GridPos; tree: GridPos } | null = null;
		for (let r = 0; r < 400 && !found; r++) {
			for (let y = home.y - r; y <= home.y + r && !found; y++) {
				for (let x = home.x - r; x <= home.x + r && !found; x++) {
					if (Math.max(Math.abs(x - home.x), Math.abs(y - home.y)) !== r) continue;
					if (!onTentLattice(x, y) || tileAtWorld(WORLD_SEED, x, y).kind !== 'tent') continue;
					for (let dy = -3; dy <= 3 && !found; dy++) {
						for (let dx = -3; dx <= 3 && !found; dx++) {
							const tree = { x: x + dx, y: y + dy };
							if (chunkOf(tree) === chunkOf({ x, y })) continue;
							if (tileAtWorld(WORLD_SEED, tree.x, tree.y).kind === 'tree')
								found = { tent: { x, y }, tree };
						}
					}
				}
			}
		}
		expect(found).not.toBeNull();
		const { tent, tree } = found!;
		const parent = new THREE.Group();
		const ring = new ChunkRing(parent);
		ring.reset(WORLD_SEED);
		ring.update(tree);
		ring.finish();
		/** The glowing corners of the tent's glow standing over the tree's tile, above its trunk's foot. */
		const overTheTree = () => {
			let camp: THREE.Object3D | null = null;
			parent.traverse((o) => {
				if (o.userData.doctor && o.position.x === tent.x && o.position.z === tent.y) camp = o;
			});
			const glow = (camp as THREE.Object3D | null)?.getObjectByName('campfire-glow') as THREE.Mesh;
			const at = glow.geometry.getAttribute('position');
			const [dx, dz] = [tree.x - tent.x, tree.y - tent.y];
			let n = 0;
			for (let k = 0; k < at.count; k++) {
				const near = Math.abs(at.getX(k) - dx) < 0.45 && Math.abs(at.getZ(k) - dz) < 0.45;
				if (near && at.getY(k) > 0.45) n++;
			}
			return { glow, n };
		};
		const before = overTheTree();
		expect(before.n).toBeGreaterThan(0);
		ring.setEdits(WorldEdits.none.with(tree), [
			{ cx: Math.floor(tree.x / CHUNK_SIZE), cy: Math.floor(tree.y / CHUNK_SIZE) }
		]);
		const after = overTheTree();
		expect(after.glow).not.toBe(before.glow);
		expect(after.n).toBe(0);
	});

	it('rebuilds only the chunk it is in, frees the old one, and the chunk comes back without it after a walk away', () => {
		const parent = new THREE.Group();
		const ring = new ChunkRing(parent);
		const ledger = new Ledger();
		ring.reset(WORLD_SEED);
		ring.update(start);
		ring.finish();
		ledger.see(parent);
		const tree = besideA('tree').target;
		const canopies = instances(parent, 'canopy');
		const before = [...parent.children];
		const edits = WorldEdits.none.with(tree);
		ring.setEdits(edits, [
			{ cx: Math.floor(tree.x / CHUNK_SIZE), cy: Math.floor(tree.y / CHUNK_SIZE) },
			// A chunk far out of the ring (grown back, say): nothing to rebuild.
			{ cx: 400, cy: 400 }
		]);
		ledger.see(parent);
		expect(parent.children.filter((c) => before.includes(c)).length).toBe(RING - 1);
		expect(ring.size).toBe(RING);
		expect(kinds(ledger.ownedOutside(parent))).toEqual([]);
		const chopped = instances(parent, 'canopy');
		// The big tree, and the young one that often grows beside it.
		expect(canopies - chopped).toBeGreaterThanOrEqual(1);
		expect(canopies - chopped).toBeLessThanOrEqual(2);
		// Walk five chunks away and back: the chunk is built again as the player left it.
		const away = { x: start.x - FAR, y: start.y };
		for (const p of [...line(start, away), ...line(away, start)]) {
			ring.update(p);
			ring.work();
			ledger.see(parent);
		}
		ring.finish();
		ledger.see(parent);
		expect(instances(parent, 'canopy')).toBe(chopped);
		expect(kinds(ledger.ownedOutside(parent))).toEqual([]);
		// About 1 s alone (the walk builds some fifty chunks); over 5 s under a heavy load.
	}, 30_000);

	it('frees everything the chop and the break built once they are over, with reduced motion too, and at once on a new world', () => {
		for (const calm of [false, true]) {
			const parent = new THREE.Group();
			const effects = new ClearingEffects(parent);
			const ledger = new Ledger();
			const tree = besideA('tree');
			const rock = besideA('rock');
			for (const [spot, t0] of [
				[tree, 0],
				[rock, 0.3]
			] as const) {
				effects.play(
					tileAtWorld(WORLD_SEED, spot.target.x, spot.target.y),
					spot.target,
					spot.facing,
					t0
				);
			}
			for (let t = 0; t < 3; t += 1 / 60) {
				effects.update(t, calm);
				ledger.see(parent);
			}
			expect(effects.size).toBe(0);
			expect(parent.children).toEqual([]);
			// Only shared shapes were ever drawn; the flourishes' own instanced meshes are freed.
			expect(kinds(ledger.owned())).toEqual([]);
			// A new world takes one still playing down with it.
			effects.play(tileAtWorld(WORLD_SEED, tree.target.x, tree.target.y), tree.target, 'up', 10);
			effects.update(10.4, calm);
			ledger.see(parent);
			expect(ledger.owned().length).toBeGreaterThan(0);
			effects.clear();
			expect(parent.children).toEqual([]);
			expect(kinds(ledger.owned())).toEqual([]);
		}
		// Nothing plays for a tile that is not a tree or a rock.
		const parent = new THREE.Group();
		const effects = new ClearingEffects(parent);
		effects.play(tileAtWorld(WORLD_SEED, start.x, start.y), start, 'up', 0);
		expect(parent.children).toEqual([]);
	});
});

describe('the battle scene', () => {
	const species = ANIMALS.map((a) => a.id);
	const isFigure = (o: THREE.Object3D) => species.includes(o.name);

	it('frees every figure a battle showed once it ends, ten battles in a row', () => {
		const scene = new BattleScene();
		const ledger = new Ledger();
		const biomes: Biome[] = ['meadow', 'forest', 'river', 'mountain', 'sea'];
		let between: number | null = null;
		for (let i = 0; i < 10; i++) {
			const figures = new Set<THREE.BufferGeometry>();
			const look = () => {
				ledger.see(scene.scene);
				for (const figure of scene.scene.children.filter(isFigure)) {
					figure.traverse((o) => {
						if (o instanceof THREE.Mesh) figures.add(o.geometry);
					});
				}
			};
			const n = species.length;
			scene.begin(biomes[i % biomes.length]!, species[i % n]!, species[(i + 3) % n]!);
			look();
			// A switch replaces the player's figure mid-battle; effects come and go.
			scene.setFigure('player', species[(i + 1) % n]!);
			scene.puff('opponent');
			scene.throwLeash();
			scene.faint('opponent');
			scene.update(i + 0.05);
			scene.update(i + 0.1);
			look();
			scene.end();

			expect(scene.scene.children.filter(isFigure).map((o) => o.name)).toEqual([]);
			expect(kinds([...figures].filter((g) => !ledger.isDisposed(g)))).toEqual([]);
			// Once every biome's backdrop is built, what a battle leaves behind is the same every time.
			if (i === biomes.length - 1) between = ledger.live.size;
			if (between !== null) expect(ledger.live.size).toBe(between);
		}
	});
});

describe('the lead walking behind the trainer', () => {
	it('frees every figure it stops showing: ten changes of lead, a tired team, quit to the title', () => {
		const world = new THREE.Group();
		const follower = new Follower({
			addFigure: (figure) => world.add(figure),
			removeFigure: (figure) => world.remove(figure)
		});
		const ledger = new Ledger();
		const shown = new Set<THREE.BufferGeometry>();
		const look = () => {
			ledger.see(world);
			world.traverse((o) => {
				if (o instanceof THREE.Mesh) shown.add(o.geometry as THREE.BufferGeometry);
			});
		};
		const start = spawnPoint(WORLD_SEED);
		follower.place(WORLD_SEED, start, 'down');
		const leads = [
			'fox',
			'bear',
			null,
			'rabbit',
			'deer',
			null,
			null,
			'otter',
			'wolf',
			'frog',
			'fox'
		];
		for (const lead of leads) {
			follower.lead(lead);
			// Long enough for the one following to shrink away and the next to grow in.
			for (let i = 0; i < 8; i++) {
				follower.update(1, 0.1);
				look();
			}
			expect(world.children.map((f) => f.name)).toEqual(lead ? [lead] : []);
		}
		const current = new Set<THREE.BufferGeometry>();
		world.traverse((o) => {
			if (o instanceof THREE.Mesh) current.add(o.geometry as THREE.BufferGeometry);
		});
		expect(kinds([...shown].filter((g) => !current.has(g) && !ledger.isDisposed(g)))).toEqual([]);
		follower.hide();
		expect(world.children).toEqual([]);
		expect(kinds([...shown].filter((g) => !ledger.isDisposed(g)))).toEqual([]);
	});

	it('a number key mashed mid-swap: never two at once, the last lead stays, nothing left behind', () => {
		const world = new THREE.Group();
		const follower = new Follower({
			addFigure: (figure) => world.add(figure),
			removeFigure: (figure) => world.remove(figure)
		});
		const ledger = new Ledger();
		const shown = new Set<THREE.BufferGeometry>();
		follower.place(WORLD_SEED, spawnPoint(WORLD_SEED), 'down');
		const crowded: number[] = [];
		// A change of lead every 50 ms, faster than a swap plays out, landing on every phase of it.
		const mash = ['fox', 'rabbit', 'fox', null, 'bear', 'fox', 'rabbit', null, null, 'deer', 'fox'];
		for (const [i, lead] of mash.entries()) {
			follower.lead(lead);
			follower.update(1, 0.05);
			ledger.see(world);
			world.traverse((o) => {
				if (o instanceof THREE.Mesh) shown.add(o.geometry as THREE.BufferGeometry);
			});
			if (world.children.length > 1) crowded.push(i);
		}
		for (let i = 0; i < 20; i++) follower.update(1, 0.05);
		expect(crowded).toEqual([]);
		expect(world.children.map((f) => f.name)).toEqual(['fox']);
		expect(follower.species).toBe('fox');
		const current = new Set<THREE.BufferGeometry>();
		world.traverse((o) => {
			if (o instanceof THREE.Mesh) current.add(o.geometry as THREE.BufferGeometry);
		});
		expect(kinds([...shown].filter((g) => !current.has(g) && !ledger.isDisposed(g)))).toEqual([]);
	});
});

describe('the title', () => {
	const figureGeometries = (root: THREE.Object3D) => {
		const out = new Set<THREE.BufferGeometry>();
		root.traverse((o) => {
			if (o instanceof THREE.Mesh && ANIMALS.some((a) => a.id === o.parent?.parent?.name)) {
				out.add(o.geometry as THREE.BufferGeometry);
			}
		});
		return out;
	};

	it('the starter stage frees the animals it showed each time it shows them again', () => {
		const stage = new StarterScene();
		const ledger = new Ledger();
		const shown: THREE.BufferGeometry[] = [];
		for (let i = 0; i < 5; i++) {
			stage.show(STARTERS);
			ledger.see(stage.scene);
			const now = figureGeometries(stage.scene);
			expect(now.size).toBeGreaterThan(0);
			shown.push(...now);
		}
		const last = figureGeometries(stage.scene);
		expect(kinds(shown.filter((g) => !last.has(g) && !ledger.isDisposed(g)))).toEqual([]);
		expect(kinds([...last].filter((g) => ledger.isDisposed(g)))).toEqual([]);
	});

	it("the menu's world frees its team when the game starts, and when it shows another", () => {
		// The renderer's side of it, without WebGL: a group the figures stand in.
		const world = new THREE.Group();
		const renderer = {
			setStage() {},
			setWorld() {},
			setBoat() {},
			setPlayer() {},
			ensureChunksAround() {},
			lookAt() {},
			aspect: () => 1.6,
			addFigure: (figure: THREE.Group) => world.add(figure),
			removeFigure: (figure: THREE.Group) => world.remove(figure)
		} as unknown as GameRenderer;
		const scenery = new TitleScenery(renderer);
		const ledger = new Ledger();
		const team = ['bear', 'fox', 'rabbit', 'otter', 'deer', 'squirrel'];
		const spawn = spawnPoint(WORLD_SEED);
		scenery.showWorld(WORLD_SEED, spawn, 'down', team);
		ledger.see(world);
		const first = [...figureGeometries(world)];
		expect(world.children).toHaveLength(team.length);
		scenery.showWorld(WORLD_SEED, spawn, 'left', STARTERS);
		ledger.see(world);
		expect(world.children.map((f) => f.name)).toEqual([...STARTERS]);
		expect(kinds(first.filter((g) => !ledger.isDisposed(g)))).toEqual([]);
		const second = [...figureGeometries(world)];
		scenery.hide();
		expect(world.children).toEqual([]);
		expect(kinds(second.filter((g) => !ledger.isDisposed(g)))).toEqual([]);
	});

	it("the menu's world puts the sea animals in the water, low in it as they swim, and the land's on the ground", () => {
		const world = new THREE.Group();
		const renderer = {
			setStage() {},
			setWorld() {},
			setBoat() {},
			setPlayer() {},
			ensureChunksAround() {},
			lookAt() {},
			aspect: () => 1.6,
			addFigure: (figure: THREE.Group) => world.add(figure),
			removeFigure: (figure: THREE.Group) => world.remove(figure)
		} as unknown as GameRenderer;
		const scenery = new TitleScenery(renderer);
		// Beside the lake north of the start.
		scenery.showWorld(WORLD_SEED, spawnPoint(WORLD_SEED), 'up', ['squirrel', 'crab', 'whale']);
		expect(world.children.map((f) => f.name)).toEqual(['squirrel', 'crab', 'whale']);
		for (const figure of world.children) {
			const kind = tileAtWorld(WORLD_SEED, figure.position.x, figure.position.z).kind;
			const height = (figure.userData.restShape as { height: number }).height;
			if (figure.name === 'squirrel') {
				expect(isWalkable(kind)).toBe(true);
			} else {
				expect(isWater(kind), figure.name).toBe(true);
				expect(figure.position.y, figure.name).toBeCloseTo(WATER_TOP - height * SWIM_DEPTH, 6);
			}
		}
		scenery.hide();
	});

	it("the menu's world gathers the team on the ground the saved game cleared: a stump is a place to stand", () => {
		const world = new THREE.Group();
		const renderer = {
			setStage() {},
			setWorld() {},
			setBoat() {},
			setPlayer() {},
			ensureChunksAround() {},
			lookAt() {},
			aspect: () => 1.6,
			addFigure: (figure: THREE.Group) => world.add(figure),
			removeFigure: (figure: THREE.Group) => world.remove(figure)
		} as unknown as GameRenderer;
		const scenery = new TitleScenery(renderer);
		const { stand, target } = besideA('tree');
		const team = ANIMALS.map((a) => a.id);
		const onTarget = () =>
			world.children.some((f) => f.position.x === target.x && f.position.z === target.y);
		scenery.showWorld(WORLD_SEED, stand, 'down', team);
		expect(onTarget()).toBe(false);
		scenery.showWorld(WORLD_SEED, stand, 'down', team, WorldEdits.none.with(target));
		expect(onTarget()).toBe(true);
		scenery.hide();
	});
});

describe("the animal book's pictures", () => {
	it('free every figure they draw, and leave the renderer drawing to the screen as they found it', () => {
		const ledger = new Ledger();
		const shown = new Set<THREE.BufferGeometry>();
		const calls: string[] = [];
		const clear = new THREE.Color(0x8fd3f4);
		let lost = false;
		// A renderer that draws nothing: what each picture puts before it, and how it leaves it.
		const renderer = {
			getContext: () => ({ isContextLost: () => lost }),
			getRenderTarget: () => null,
			setRenderTarget: (target: THREE.WebGLRenderTarget | null) =>
				calls.push(target ? 'to the picture' : 'to the screen'),
			getClearColor: (into: THREE.Color) => into.copy(clear),
			getClearAlpha: () => 1,
			setClearColor: (color: THREE.ColorRepresentation, alpha = 1) =>
				calls.push(`clear ${new THREE.Color(color).getHexString()} ${alpha}`),
			render: (scene: THREE.Object3D) => {
				ledger.see(scene);
				scene.traverse((o) => {
					if (o instanceof THREE.Mesh) shown.add(o.geometry as THREE.BufferGeometry);
				});
				calls.push('render');
			},
			readRenderTargetPixels: () => calls.push('read')
		} as unknown as PortraitRenderer;
		const studio = new PortraitStudio(renderer, () => 'data:,');
		for (const spec of ANIMALS) {
			calls.length = 0;
			expect(studio.draw(spec.id)).toBe('data:,');
			expect(calls).toEqual([
				'to the picture',
				'clear 000000 0',
				'render',
				'read',
				'to the screen',
				'clear 8fd3f4 1'
			]);
		}
		// A shape a species, each drawn once and freed.
		expect(shown.size).toBe(ANIMALS.length);
		expect(kinds([...shown].filter((g) => !ledger.isDisposed(g)))).toEqual([]);
		// With the context lost, nothing is drawn or built, and no picture comes back to keep.
		lost = true;
		calls.length = 0;
		const before = shown.size;
		expect(studio.draw('fox')).toBeNull();
		expect([calls, shown.size]).toEqual([[], before]);
		studio.dispose();
	});
});
