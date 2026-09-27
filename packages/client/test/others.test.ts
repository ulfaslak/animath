import {
	isWalkable,
	isWater,
	spawnPoint,
	step,
	tileAtWorld,
	type Direction,
	type GridPos,
	type PeerMessage
} from '@mathgame/engine';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WORLD_SEED } from '../src/authority/local';
import { FADE_SECONDS, HUSH_SECONDS, OtherPlayers, trainerLook } from '../src/render/others';
import { PLAYER_LOOK, TRAINER_LOOKS } from '../src/render/palette';
import { POOF_SECONDS, PUFF_GEOMETRY, Poofs } from '../src/render/poof';
import { STEP_SECONDS } from '../src/render/trainer';

// The other players on screen, drawn without WebGL: where each figure stands
// frame by frame, what fades and poofs, and that everything a player who
// leaves was drawn with is freed ([[INVARIANTS]] § Rendering).

function setup(centre: GridPos = spawnPoint(WORLD_SEED)) {
	const scene = new THREE.Scene();
	const figures = new THREE.Group();
	scene.add(figures);
	const host = {
		addFigure: (f: THREE.Group) => figures.add(f),
		removeFigure: (f: THREE.Group) => figures.remove(f)
	};
	const poofs = new Poofs(scene);
	let now = 0;
	const others = new OtherPlayers(scene, host, poofs);
	others.setWorld(WORLD_SEED);
	others.setCentre(centre);
	const frame = (dt = 1 / 30) => {
		now += dt;
		others.update(now, dt);
		poofs.update(now);
	};
	const frames = (seconds: number, dt = 1 / 30) => {
		for (let t = 0; t < seconds; t += dt) frame(dt);
	};
	const figureOf = (pid: string) =>
		scene.getObjectByName(`other:${pid}`) as THREE.Group | undefined;
	return { scene, figures, others, poofs, frame, frames, figureOf, centre };
}

function peer(pid: string, at: GridPos, patch: Partial<PeerMessage> = {}): PeerMessage {
	return {
		t: 'peer',
		pid,
		name: 'Ada',
		x: at.x,
		y: at.y,
		facing: 'down',
		lead: 'rabbit',
		boat: false,
		busy: 'explore',
		...patch
	};
}

/** A walk of `n` steps on open ground from `from`, turning where it must: every tile walkable. */
function walkFrom(from: GridPos, n: number): GridPos[] {
	const path: GridPos[] = [];
	let at = from;
	const ways: Direction[] = ['right', 'down', 'left', 'up'];
	const seen = new Set([`${at.x},${at.y}`]);
	for (let i = 0; i < n; i++) {
		const next = ways
			.map((d) => step(at, d))
			.find(
				(p) => isWalkable(tileAtWorld(WORLD_SEED, p.x, p.y).kind) && !seen.has(`${p.x},${p.y}`)
			);
		if (!next) break;
		seen.add(`${next.x},${next.y}`);
		path.push(next);
		at = next;
	}
	return path;
}

function opacityOf(figure: THREE.Object3D): number {
	let opacity = 1;
	figure.traverse((o) => {
		if (o instanceof THREE.Mesh) opacity = (o.material as THREE.Material).opacity;
	});
	return opacity;
}

describe('a trainer look from a name', () => {
	it("is the same for the same name in any case, never the player's own, and spreads over the palette", () => {
		expect(trainerLook('Ada')).toBe(trainerLook('ADA'));
		expect(trainerLook('Åse')).toBe(trainerLook('åse'));
		const used = new Set<object>();
		for (let i = 0; i < 400; i++) {
			const look = trainerLook(`kid${i}`);
			expect(TRAINER_LOOKS).toContain(look);
			expect(look.shirt === PLAYER_LOOK.shirt && look.cap === PLAYER_LOOK.cap).toBe(false);
			used.add(look);
		}
		expect(used.size).toBe(TRAINER_LOOKS.length);
	});
});

describe('other players on screen', () => {
	it('fade in where they are, with a poof when they turn up on screen and none far off', () => {
		const { others, poofs, frame, frames, figureOf, centre } = setup();
		others.seen(peer('near1', { x: centre.x + 2, y: centre.y }));
		expect(poofs.playing).toBe(1);
		const figure = figureOf('near1')!;
		expect(figure.position.x).toBeCloseTo(centre.x + 2);
		frame();
		expect(opacityOf(figure)).toBeGreaterThan(0);
		expect(opacityOf(figure)).toBeLessThan(1);
		frames(FADE_SECONDS + 0.1);
		expect(opacityOf(figure)).toBe(1);
		frames(POOF_SECONDS);
		expect(poofs.playing).toBe(0);
		// Walking in from the edge of the view: a fade, no poof.
		others.seen(peer('far1', { x: centre.x + 20, y: centre.y }, { name: 'Bo' }));
		expect(poofs.playing).toBe(0);
		expect(figureOf('far1')).toBeDefined();
	});

	it('walk the tiles they reach one step at a time, in order, and catch up when behind', () => {
		const { others, frames, figureOf, centre } = setup();
		const path = walkFrom(centre, 6);
		expect(path).toHaveLength(6);
		others.seen(peer('walker', centre));
		frames(FADE_SECONDS);
		// One step: there after a step's time, not before.
		others.seen(peer('walker', path[0]!));
		frames(STEP_SECONDS / 2);
		const mid = figureOf('walker')!.position;
		expect(Math.abs(mid.x - path[0]!.x) + Math.abs(mid.z - path[0]!.y)).toBeGreaterThan(0.1);
		frames(STEP_SECONDS);
		expect(others.tileOf('walker')).toEqual(path[0]);
		expect(figureOf('walker')!.position.x).toBeCloseTo(path[0]!.x);
		expect(figureOf('walker')!.position.z).toBeCloseTo(path[0]!.y);
		// Five tiles at once (the network held them back): walked through, in order, faster than five steps.
		for (const p of path.slice(1)) others.seen(peer('walker', p));
		const visited: string[] = [];
		let t = 0;
		for (; t < 5 * STEP_SECONDS && visited.length < 5; t += 1 / 60) {
			frames(1 / 60, 1 / 60);
			const tile = others.tileOf('walker')!;
			const key = `${tile.x},${tile.y}`;
			if (visited.at(-1) !== key) visited.push(key);
		}
		frames(STEP_SECONDS);
		expect(visited).toEqual(path.slice(1).map((p) => `${p.x},${p.y}`));
		expect(t).toBeLessThan(5 * STEP_SECONDS);
		const last = path.at(-1)!;
		expect(figureOf('walker')!.position.x).toBeCloseTo(last.x);
	});

	it('come without a poof when it is the player who just turned up, and with one again after', () => {
		const { others, poofs, frame, frames, centre } = setup();
		frame();
		others.hush();
		others.seen(peer('there1', { x: centre.x + 1, y: centre.y }));
		expect(poofs.playing).toBe(0);
		frames(HUSH_SECONDS + 0.1);
		others.seen(peer('new1', { x: centre.x - 1, y: centre.y }, { name: 'Bo' }));
		expect(poofs.playing).toBe(1);
	});

	it('play a poof whole from its first frame, however long the world round a far friend took to build', () => {
		const scene = new THREE.Scene();
		const poofs = new Poofs(scene);
		poofs.update(10);
		poofs.play(new THREE.Vector3(0, 0.5, 0), false);
		// The next frame comes two seconds late: 25 chunks round the friend were built first.
		poofs.update(12);
		expect(poofs.playing).toBe(1);
		poofs.update(12 + POOF_SECONDS / 2);
		expect(poofs.playing).toBe(1);
		poofs.update(12 + POOF_SECONDS + 0.01);
		expect(poofs.playing).toBe(0);
	});

	it('jump further than a step in a poof, gone from one tile and at the other at once', () => {
		const { others, poofs, frames, figureOf, centre } = setup();
		others.seen(peer('jumper', { x: centre.x + 1, y: centre.y }));
		frames(POOF_SECONDS + 0.1);
		expect(poofs.playing).toBe(0);
		const far = { x: centre.x - 3, y: centre.y + 4 };
		others.seen(peer('jumper', far));
		// A poof where they were and one where they are: both on screen.
		expect(poofs.playing).toBe(2);
		frames(1 / 30);
		expect(figureOf('jumper')!.position.x).toBeCloseTo(far.x);
		expect(figureOf('jumper')!.position.z).toBeCloseTo(far.y);
	});

	it('sail in their own boat out on the water, and carry it on land', () => {
		// A water tile near spawn, and the land beside it.
		const spawn = spawnPoint(WORLD_SEED);
		let water: GridPos | null = null;
		for (let r = 1; r < 30 && !water; r++) {
			for (let dx = -r; dx <= r && !water; dx++) {
				const p = { x: spawn.x + dx, y: spawn.y + r };
				if (isWater(tileAtWorld(WORLD_SEED, p.x, p.y).kind)) water = p;
			}
		}
		expect(water).not.toBeNull();
		const { others, frames, figureOf } = setup(water!);
		others.seen(peer('sailor', water!, { boat: true, lead: 'otter' }));
		frames(FADE_SECONDS + 0.2);
		const boat = figureOf('sailor')!.getObjectByName('boat')!;
		expect(boat.visible).toBe(true);
		// Afloat: right side up and full size under them.
		expect(boat.scale.x).toBeCloseTo(1);
		others.seen(peer('walker', spawn, { boat: true }));
		frames(FADE_SECONDS + 0.2);
		// On land: small, on their back.
		expect(figureOf('walker')!.getObjectByName('boat')!.scale.x).toBeLessThan(0.8);
	});

	it('fade away when gone, and a new world clears them all at once', () => {
		const { others, frames, figureOf, centre } = setup();
		others.seen(peer('a1', centre));
		others.seen(peer('b1', { x: centre.x + 1, y: centre.y }, { name: 'Bo' }));
		frames(FADE_SECONDS + 0.1);
		others.gone('a1');
		frames(FADE_SECONDS / 2);
		expect(figureOf('a1')).toBeDefined();
		expect(opacityOf(figureOf('a1')!)).toBeLessThan(1);
		frames(FADE_SECONDS);
		expect(figureOf('a1')).toBeUndefined();
		expect(others.count).toBe(1);
		others.setWorld(WORLD_SEED + 1);
		expect(others.count).toBe(0);
		expect(figureOf('b1')).toBeUndefined();
	});

	it('free everything they were drawn with: twenty players come, walk, jump and go', () => {
		const { scene, others, frames, centre } = setup();
		const geometries = new Set<THREE.BufferGeometry>();
		/** The trainers' own materials: copies each one fades alone, and must free. */
		const own = new Set<THREE.Material>();
		const disposed = new WeakSet<object>();
		const look = () =>
			scene.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				const g = o.geometry as THREE.BufferGeometry;
				if (!geometries.has(g)) {
					geometries.add(g);
					g.addEventListener('dispose', () => disposed.add(g));
				}
				let parent: THREE.Object3D | null = o;
				while (parent && !parent.name.startsWith('other:')) parent = parent.parent;
				const m = o.material as THREE.Material;
				if (parent && !own.has(m)) {
					own.add(m);
					m.addEventListener('dispose', () => disposed.add(m));
				}
			});
		const path = walkFrom(centre, 4);
		for (let i = 0; i < 20; i++) {
			const pid = `player${i}`;
			others.seen(
				peer(pid, centre, { name: `Kid${i}`, boat: i % 3 === 0, lead: i % 2 ? 'fox' : null })
			);
			for (const p of path) others.seen(peer(pid, p, { name: `Kid${i}`, boat: i % 3 === 0 }));
			frames(0.3);
			look();
			if (i % 4 === 0)
				others.seen(peer(pid, { x: centre.x + 9, y: centre.y - 7 }, { name: `Kid${i}` }));
			frames(0.2);
			look();
			others.gone(pid);
		}
		frames(FADE_SECONDS + POOF_SECONDS + 0.5);
		look();
		expect(others.count).toBe(0);
		// Nothing left in the scene: no trainer, no follower, no poof.
		const meshes: string[] = [];
		scene.traverse((o) => {
			if (o instanceof THREE.Mesh) meshes.push(o.name || o.type);
		});
		expect(meshes).toEqual([]);
		// Every shape freed but the puff's, which every poof shares.
		const kept = [...geometries].filter((g) => !disposed.has(g) && g !== PUFF_GEOMETRY);
		expect(kept.map((g) => g.type)).toEqual([]);
		// Each trainer faded with materials of its own, and freed them all.
		expect(own.size).toBeGreaterThan(20);
		expect([...own].filter((m) => !disposed.has(m)).map((m) => m.type)).toEqual([]);
	});
});
