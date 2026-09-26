import { ANIMALS } from '@mathgame/engine';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { touch } from '../src/input/touch.svelte';
import { motion } from '../src/motion';
import { BattleScene, LEASH_FLIGHT_SECONDS } from '../src/render/battle-scene';

/**
 * The leash's loop stays in the picture ([[DESIGN]] § Aesthetic direction: a
 * flourish never leaves the scene). Its throw used to arc a tile over the
 * straight line from the hand to the animal, and at every size the loop
 * left through the top edge, for every species (#54). Seen through the
 * battle scene's own camera, and measured with three's projection of every
 * point of the loop, not the code's own geometry.
 */

const FRAME = 1 / 60;
/** The supported sizes (a laptop, a tablet with a keyboard and without), and a wide monitor. */
const SIZES = [
	{ width: 1024, height: 768, touch: false },
	{ width: 1280, height: 720, touch: false },
	{ width: 1180, height: 820, touch: true },
	{ width: 1024, height: 768, touch: true },
	{ width: 2560, height: 1080, touch: false }
] as const;
/** The loop never comes nearer the top edge than this, in CSS pixels: it never touches it. */
const CLEAR = 8;
/** One scene for every battle, as in the game: `begin` dresses it for each throw. */
const scene = new BattleScene();

afterEach(() => {
	motion.reduced = false;
	touch.on = false;
});

/** The leash on screen: its loop, and the rope, which starts at the trainer's hand. */
function leashOf(scene: BattleScene): { loop: THREE.Mesh; rope: THREE.Mesh } | null {
	const loop = scene.scene.children.find(
		(o): o is THREE.Mesh => o instanceof THREE.Mesh && o.geometry instanceof THREE.TorusGeometry
	);
	if (!loop) return null;
	const rope = scene.scene.children.find(
		(o): o is THREE.Mesh => o instanceof THREE.Mesh && o !== loop && o.material === loop.material
	);
	return rope ? { loop, rope } : null;
}

/** How far below the canvas's top edge the loop's highest point is, in CSS pixels. */
function below(scene: BattleScene, loop: THREE.Mesh, height: number): number {
	scene.camera.updateMatrixWorld();
	loop.updateMatrixWorld(true);
	const points = loop.geometry.getAttribute('position');
	const p = new THREE.Vector3();
	let top = -Infinity;
	for (let i = 0; i < points.count; i++) {
		top = Math.max(
			top,
			p.fromBufferAttribute(points, i).applyMatrix4(loop.matrixWorld).project(scene.camera).y
		);
	}
	return ((1 - top) / 2) * height;
}

interface Throw {
	/** The nearest the loop came to the top edge, in CSS pixels, and when (a moment of the leash's life). */
	clear: number;
	when: string;
	/** The highest the loop's middle rose over the straight line from the hand to where it landed, in tiles. */
	arc: number;
}

/**
 * Throw the leash at `species` a frame at a time, as the battle does: the
 * flight, then (as `ending` says) the loop holding while the animal cheers,
 * or popping off.
 */
function throwAt(size: (typeof SIZES)[number], species: string, ending: 'caught' | 'broke'): Throw {
	touch.on = size.touch;
	scene.resize(size.width, size.height);
	scene.begin('meadow', 'squirrel', species);
	let t = 0;
	scene.update(t);
	scene.throwLeash();
	const flight: THREE.Vector3[] = [];
	let hand = new THREE.Vector3();
	let clear = Infinity;
	let when = '';
	const look = (moment: string) => {
		const leash = leashOf(scene);
		if (!leash) return;
		const gap = below(scene, leash.loop, size.height);
		if (gap < clear) [clear, when] = [gap, `${moment} at ${t.toFixed(2)} s`];
		if (moment === 'flying') {
			flight.push(leash.loop.position.clone());
			hand = leash.rope.position.clone();
		}
	};
	for (; t < LEASH_FLIGHT_SECONDS + 0.1;) {
		scene.update((t += FRAME));
		look('flying');
	}
	scene.leashResult(ending === 'caught');
	// A second: the pop is over in 0.3 s, the cheer's two hops in 0.9 s.
	for (let i = 0; i < 60; i++) {
		scene.update((t += FRAME));
		look(ending === 'caught' ? 'riding the cheer' : 'popping off');
	}
	// The straight throw runs from the hand to where the loop landed; x moves along it evenly.
	const landed = flight[flight.length - 1]!;
	let arc = 0;
	for (const at of flight) {
		const along = (at.x - hand.x) / (landed.x - hand.x);
		arc = Math.max(arc, at.y - (hand.y + (landed.y - hand.y) * along));
	}
	scene.end();
	return { clear, when, arc };
}

describe('the leash', () => {
	it('keeps its loop in the picture at every size, for every species, with and without reduced motion', () => {
		const bad: string[] = [];
		for (const reduced of [false, true]) {
			motion.reduced = reduced;
			for (const size of SIZES) {
				for (const { id } of ANIMALS) {
					for (const ending of ['caught', 'broke'] as const) {
						const { clear, when } = throwAt(size, id, ending);
						if (clear < CLEAR) {
							bad.push(
								`${id} at ${size.width}×${size.height}${size.touch ? ' (touch)' : ''}${reduced ? ', reduced motion' : ''}: ${clear.toFixed(1)} px from the top edge, ${when}`
							);
						}
					}
				}
			}
		}
		// Both endings share the flight: one line for a flight that fails in both.
		expect([...new Set(bad)]).toEqual([]);
		// About 0.6–0.9 s alone (160 throws, every point of the loop projected on
		// each of their 16,000 frames); up to four times that under a heavy load.
	}, 30_000);

	it('still arcs, and arcs lower with reduced motion', () => {
		const bad: string[] = [];
		for (const size of SIZES) {
			for (const { id } of ANIMALS) {
				motion.reduced = false;
				const full = throwAt(size, id, 'broke').arc;
				motion.reduced = true;
				const calm = throwAt(size, id, 'broke').arc;
				const where = `${id} at ${size.width}×${size.height}${size.touch ? ' (touch)' : ''}`;
				// A fifth of a tile at least: the loop visibly lobs, however little sky there is.
				if (full < 0.2) bad.push(`${where}: arcs ${full.toFixed(2)} tiles`);
				if (!(calm > 0 && calm < full * 0.5)) {
					bad.push(
						`${where}: arcs ${calm.toFixed(2)} tiles with reduced motion, ${full.toFixed(2)} without`
					);
				}
			}
		}
		expect(bad).toEqual([]);
	});
});
