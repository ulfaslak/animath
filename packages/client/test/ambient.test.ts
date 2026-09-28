import { spawnPoint } from '@mathgame/engine';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { WORLD_SEED } from '../src/authority/local';
import { motion } from '../src/motion';
import { Butterflies } from '../src/render/ambient';
import { aimWorldCamera, frameWorldCamera } from '../src/render/renderer';

/**
 * The butterflies never pop into view or out of it ([[UI_SPEC]] § Explore
 * mode, #46), whatever the window's shape: one that joins, goes, or is put
 * somewhere rather than flown there does it out of the camera's sight. The
 * one exception is the world appearing (its first frame, or a jump of the
 * view), when they all start round the middle with it. Seen through the
 * world's own camera, and measured with three's projection, not the code's.
 */

const FRAME = 1 / 30;
/** Wing tip to wing tip is under half a tile: a butterfly this far outside the view is wholly out of it. */
const OUT = 0.5;
/** Further than any butterfly flies (or drifts down onto lower ground) in one frame. */
const FLIGHT = 0.5;
/** Tiles a second: one tile per 0.18 s step, as the explore controller walks. */
const PACE = 1 / 0.18;

/** How far outside the camera's view `p` is, in tiles on screen; negative inside it. */
function outside(camera: THREE.OrthographicCamera, p: THREE.Vector3): number {
	const ndc = p.clone().project(camera);
	const halfW = (camera.right - camera.left) / 2;
	const halfH = (camera.top - camera.bottom) / 2;
	return Math.max((Math.abs(ndc.x) - 1) * halfW, (Math.abs(ndc.y) - 1) * halfH);
}

/** How many butterflies there are, and how many wholly in view. */
interface Flock {
	flying: number;
	inView: number;
}

/** One stretch of the route, and optionally the flock expected at its end. */
type Leg = (
	| { walk: [number, number]; tiles: number }
	| { stand: number }
	| { jump: [number, number] }
	| { reduced: boolean }
) & { then?: Flock };

/**
 * Walk the view's middle along `route` from the spawn tile, a frame at a
 * time, and say every time a butterfly pops into or out of view, and every
 * leg that ends with another flock than expected.
 */
function fly(aspect: number, route: Leg[]): string[] {
	const scene = new THREE.Group();
	const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
	frameWorldCamera(camera, aspect);
	const butterflies = new Butterflies(scene, camera);
	butterflies.setWorld(WORLD_SEED);
	const start = spawnPoint(WORLD_SEED);
	const centre = new THREE.Vector3(start.x, 0, start.y);
	const problems: string[] = [];
	let before = new Map<THREE.Object3D, THREE.Vector3>();
	let t = 0;

	const frame = (move: [number, number], appearing: boolean) => {
		centre.x += move[0];
		centre.z += move[1];
		aimWorldCamera(camera, centre);
		butterflies.update({ x: centre.x, z: centre.z }, FRAME, t);
		t += FRAME;
		const now = new Map(scene.children.map((g) => [g, g.position.clone()] as const));
		const at = (p: THREE.Vector3) => `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}) at ${t.toFixed(2)} s`;
		if (appearing) {
			// The world appears: they start round the middle, in view.
			for (const p of now.values()) {
				if (outside(camera, p) > -OUT) problems.push(`started out of view ${at(p)}`);
			}
		} else {
			for (const [g, p] of now) {
				const was = before.get(g);
				if (!was) {
					if (outside(camera, p) < OUT) problems.push(`appeared in view ${at(p)}`);
				} else if (p.distanceTo(was) > FLIGHT) {
					if (outside(camera, was) < OUT) problems.push(`vanished from view ${at(was)}`);
					if (outside(camera, p) < OUT) problems.push(`appeared in view ${at(p)}`);
				}
			}
			for (const [g, was] of before) {
				if (!now.has(g) && outside(camera, was) < OUT)
					problems.push(`vanished from view ${at(was)}`);
			}
		}
		before = now;
	};

	frame([0, 0], true);
	route.forEach((leg, i) => {
		if ('reduced' in leg) motion.reduced = leg.reduced;
		else if ('jump' in leg) frame(leg.jump, true);
		else if ('stand' in leg) {
			for (let s = 0; s < leg.stand; s += FRAME) frame([0, 0], false);
		} else {
			const [dx, dz] = leg.walk;
			for (let s = 0; s < leg.tiles / PACE; s += FRAME) {
				frame([dx * PACE * FRAME, dz * PACE * FRAME], false);
			}
		}
		if (!leg.then) return;
		const flock: Flock = {
			flying: scene.children.length,
			inView: scene.children.filter((g) => outside(camera, g.position) < -OUT).length
		};
		if (flock.flying !== leg.then.flying || flock.inView !== leg.then.inView) {
			problems.push(`after leg ${i}: ${JSON.stringify(flock)}, not ${JSON.stringify(leg.then)}`);
		}
	});
	return problems;
}

const SIX: Flock = { flying: 6, inView: 6 };
const TWO: Flock = { flying: 2, inView: 2 };

/**
 * Every way the view moves: standing, walking each way and turning, a jump,
 * and reduced motion coming and going. Standing still a while, the whole
 * flock is in view round the trainer.
 */
const ROUTE: Leg[] = [
	{ stand: 3 },
	{ walk: [1, 0], tiles: 40 },
	{ stand: 2 },
	{ walk: [0, 1], tiles: 30 },
	{ walk: [-1, 0], tiles: 60 },
	{ walk: [0, -1], tiles: 30 },
	{ stand: 12, then: SIX },
	// Reduced motion comes on: the spare four fly off screen and go.
	{ reduced: true },
	{ stand: 1 },
	{ walk: [1, 0], tiles: 25 },
	{ stand: 20, then: TWO },
	// And goes: four new ones fly in from off screen.
	{ reduced: false },
	{ stand: 1 },
	{ walk: [0, 1], tiles: 25 },
	{ stand: 12, then: SIX },
	// A jump (Continue, a go-to): all six round the new middle at once.
	{ jump: [40, -25], then: SIX },
	{ stand: 3 },
	// On and straight off again: the ones on their way out turn back.
	{ reduced: true },
	{ stand: 0.5 },
	{ reduced: false },
	{ stand: 12, then: SIX }
];

describe('the butterflies', () => {
	afterEach(() => {
		motion.reduced = false;
	});

	// 1024×768, 1280×720, 1180×820, and a window far wider than any the game supports.
	for (const [label, aspect] of [
		['4:3', 4 / 3],
		['16:9', 16 / 9],
		['1180×820', 1180 / 820],
		['21:9', 21 / 9]
	] as const) {
		it(`never pop into or out of view at ${label}: they come and go off screen`, () => {
			expect(fly(aspect, ROUTE).slice(0, 5)).toEqual([]);
		});
	}
});
