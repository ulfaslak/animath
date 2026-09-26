import {
	ANIMALS,
	CHUNK_SIZE,
	STARTERS,
	spawnPoint,
	type Biome,
	type GridPos
} from '@mathgame/engine';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WORLD_SEED } from '../src/authority/local';
import { BattleScene } from '../src/render/battle-scene';
import { ChunkRing } from '../src/render/chunks';
import { Follower } from '../src/render/follower';
import type { GameRenderer } from '../src/render/renderer';
import { StarterScene } from '../src/render/starter-scene';
import { TitleScenery } from '../src/render/title-scenery';
import { SHARED_GEOMETRIES } from '../src/render/tiles';

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
				ring.update(p);
				// The scene only changes when the player crosses into another chunk.
				if (chunkOf(p) === chunk) continue;
				chunk = chunkOf(p);
				ledger.see(parent);
				// At every crossing, what the chunks own is exactly what is on screen.
				const leaked = ledger.ownedOutside(parent);
				if (leaked.length) leaks.push(`${chunk}: ${kinds(leaked).length} left behind`);
				if (ring.size !== RING) leaks.push(`${chunk}: ${ring.size} chunks built`);
			}
		}

		expect(leaks.slice(0, 5)).toEqual([]);
		expect(parent.children.length).toBe(RING);
		// Back where it began, the chunks own exactly as much as they did then.
		expect(ledger.owned().length).toBe(atStart);
		// Nothing still on screen was freed (a shared shape disposed under another chunk).
		expect(kinds(ledger.disposedIn(parent))).toEqual([]);
		expect(kinds([...SHARED_GEOMETRIES].filter((g) => ledger.isDisposed(g)))).toEqual([]);
		// About 1.8 s alone (hundreds of chunks built and freed); over 5 s under a heavy load.
	}, 30_000);

	it('free the whole ring on a jump, and every chunk of the old world when the world changes', () => {
		const parent = new THREE.Group();
		const ring = new ChunkRing(parent);
		const ledger = new Ledger();
		ring.reset(WORLD_SEED);
		// A step, then a jump far off (a knock-out's trip to a tent is one).
		for (const p of [start, { x: start.x + 1, y: start.y }, { x: -300, y: 200 }]) {
			ring.update(p);
			ledger.see(parent);
			expect(kinds(ledger.ownedOutside(parent))).toEqual([]);
		}
		expect(ring.size).toBe(RING);
		ring.reset(WORLD_SEED + 1);
		expect(parent.children.length).toBe(0);
		expect(kinds(ledger.owned())).toEqual([]);
		ring.update(start);
		expect(ring.size).toBe(RING);
		// About 1 s alone (three whole rings of chunks built); over 5 s under a heavy load.
	}, 30_000);

	it('draw only shared shapes: a chunk owns no geometry of its own', () => {
		const parent = new THREE.Group();
		const ring = new ChunkRing(parent);
		ring.reset(WORLD_SEED);
		// Meadow, river and tents by the start, forest and rocks further out.
		const own = new Set<THREE.BufferGeometry>();
		const shared = new Set<THREE.BufferGeometry>();
		for (const p of [start, { x: -80, y: -2 }]) {
			ring.update(p);
			parent.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				(SHARED_GEOMETRIES.has(o.geometry) ? shared : own).add(o.geometry);
			});
		}
		expect([...own].map((g) => g.type)).toEqual([]);
		// Every kind of prop was on the way, so none escaped the check.
		expect(shared.size).toBe(SHARED_GEOMETRIES.size);
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
});
