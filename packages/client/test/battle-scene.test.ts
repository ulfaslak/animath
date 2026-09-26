import { ANIMALS } from '@mathgame/engine';
import { parse, type AST } from 'svelte/compiler';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { touch } from '../src/input/touch.svelte';
import { motion } from '../src/motion';
import { BattleScene, LEASH_FLIGHT_SECONDS, WILD_STATUS_BOX } from '../src/render/battle-scene';
import { svelteSources } from './source';

/**
 * The leash's loop stays in the picture and in plain view ([[DESIGN]] §
 * Aesthetic direction: a flourish never leaves the scene, and marks a moment
 * the screen already shows). Its throw used to arc a tile over the straight
 * line from the hand to the animal, and at every size the loop left through
 * the top edge, for every species (#54). Held under the top edge, it then
 * passed behind the wild animal's status box on its way up (#56). Seen
 * through the battle scene's own camera, and measured with three's
 * projection of every point of the loop, not the code's own geometry.
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
/** The loop never comes nearer the top edge or the status box than this, in CSS pixels: it never touches them. */
const CLEAR = 8;
/** One scene for every battle, as in the game: `begin` dresses it for each throw. */
const scene = new BattleScene();

interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * The wild animal's status box, in CSS pixels from the canvas's top left:
 * where `BattlePanel.svelte`'s CSS puts it and how wide, read from the
 * component, and 74 px tall, as Chrome draws its name and HP bar at every
 * supported size, in both languages (no rule sets its height).
 */
const STATUS_BOX: Box = (() => {
	const source = svelteSources.get('src/ui/BattlePanel.svelte');
	const rules = (parse(source ?? '', { modern: true }).css?.children ?? []).filter(
		(node): node is AST.CSS.Rule => node.type === 'Rule'
	);
	const px = (selector: string, property: string) => {
		const rule = rules.find((r) => source!.slice(r.prelude.start, r.prelude.end) === selector);
		const value = rule?.block.children.find(
			(d): d is AST.CSS.Declaration => d.type === 'Declaration' && d.property === property
		)?.value;
		if (!value?.endsWith('px')) throw new Error(`${selector} has no ${property} in px`);
		return Number.parseFloat(value);
	};
	const left = px('.status.opponent', 'left');
	const top = px('.status.opponent', 'top');
	return { left, top, right: left + px('.status', 'width'), bottom: top + 74 };
})();

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

interface Point {
	x: number;
	y: number;
}

/** Where a point of the scene is on the canvas, in CSS pixels from its top left. */
function onCanvas(v: THREE.Vector3, size: (typeof SIZES)[number]): Point {
	const p = v.clone().project(scene.camera);
	return { x: ((p.x + 1) / 2) * size.width, y: ((1 - p.y) / 2) * size.height };
}

/** Every point of the loop on the canvas. */
function loopOnCanvas(loop: THREE.Mesh, size: (typeof SIZES)[number]): Point[] {
	scene.camera.updateMatrixWorld();
	loop.updateMatrixWorld(true);
	const points = loop.geometry.getAttribute('position');
	return Array.from({ length: points.count }, (_, i) =>
		onCanvas(
			new THREE.Vector3().fromBufferAttribute(points, i).applyMatrix4(loop.matrixWorld),
			size
		)
	);
}

/** How far a point is from the box, in CSS pixels: 0 on it or in it. */
function gap(p: Point, box: Box): number {
	return Math.hypot(
		Math.max(box.left - p.x, 0, p.x - box.right),
		Math.max(box.top - p.y, 0, p.y - box.bottom)
	);
}

/** How far the straight line from `a` to `b` passes from the box, in CSS pixels: 0 if it crosses it. */
function lineGap(a: Point, b: Point, box: Box): number {
	// The part of the line inside the box's edges, as a share of its length (Liang–Barsky).
	let from = 0;
	let to = 1;
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	for (const [p, q] of [
		[-dx, a.x - box.left],
		[dx, box.right - a.x],
		[-dy, a.y - box.top],
		[dy, box.bottom - a.y]
	] as const) {
		if (p === 0) {
			if (q < 0) from = Infinity;
		} else if (p < 0) from = Math.max(from, q / p);
		else to = Math.min(to, q / p);
	}
	if (from <= to) return 0;
	// Clear of it: the nearest is an end of the line, or a corner of the box.
	const toLine = (c: Point) => {
		const s = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy)));
		return Math.hypot(a.x + s * dx - c.x, a.y + s * dy - c.y);
	};
	return Math.min(
		gap(a, box),
		gap(b, box),
		...[box.left, box.right].flatMap((x) => [box.top, box.bottom].map((y) => toLine({ x, y })))
	);
}

interface Throw {
	/** The nearest the loop came to the top edge, in CSS pixels, and when (a moment of the leash's life). */
	top: number;
	topWhen: string;
	/** The nearest the loop came to the wild animal's status box, in CSS pixels, and when. */
	box: number;
	boxWhen: string;
	/** The nearest the rope came to it, and when: 0 if it crossed it. */
	rope: number;
	ropeWhen: string;
	/** The highest the loop's middle rose over the straight line from where it left the hand to where it landed, in tiles. */
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
	// No time passes: the loop is where it leaves the hand.
	scene.update(t);
	const start = leashOf(scene)!.loop.position.clone();
	const flight: THREE.Vector3[] = [];
	const seen: Throw = {
		top: Infinity,
		topWhen: '',
		box: Infinity,
		boxWhen: '',
		rope: Infinity,
		ropeWhen: '',
		arc: 0
	};
	const look = (moment: string) => {
		const leash = leashOf(scene);
		if (!leash) return;
		const when = `${moment} at ${t.toFixed(2)} s`;
		const loop = loopOnCanvas(leash.loop, size);
		const top = Math.min(...loop.map((p) => p.y));
		if (top < seen.top) [seen.top, seen.topWhen] = [top, when];
		const box = Math.min(...loop.map((p) => gap(p, STATUS_BOX)));
		if (box < seen.box) [seen.box, seen.boxWhen] = [box, when];
		// The rope runs straight from the hand to the loop's middle.
		const rope = lineGap(
			onCanvas(leash.rope.position, size),
			onCanvas(leash.loop.position, size),
			STATUS_BOX
		);
		if (rope < seen.rope) [seen.rope, seen.ropeWhen] = [rope, when];
		if (moment === 'flying') flight.push(leash.loop.position.clone());
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
	// The straight throw runs from where the loop left the hand to where it landed; x moves along it evenly.
	const landed = flight[flight.length - 1]!;
	for (const at of flight) {
		const along = (at.x - start.x) / (landed.x - start.x);
		seen.arc = Math.max(seen.arc, at.y - (start.y + (landed.y - start.y) * along));
	}
	scene.end();
	return seen;
}

/** Every throw, thrown once for all the tests that read it. */
let thrown: { where: string; seen: Throw }[] | null = null;

/**
 * What `check` finds wrong with every throw: at every size, for every
 * species, with and without reduced motion, ending both ways.
 */
function everyThrow(check: (seen: Throw) => string | null): string[] {
	if (!thrown) {
		thrown = [];
		for (const reduced of [false, true]) {
			motion.reduced = reduced;
			for (const size of SIZES) {
				for (const { id } of ANIMALS) {
					for (const ending of ['caught', 'broke'] as const) {
						const where = `${id} at ${size.width}×${size.height}${size.touch ? ' (touch)' : ''}${reduced ? ', reduced motion' : ''}`;
						thrown.push({ where, seen: throwAt(size, id, ending) });
					}
				}
			}
		}
		motion.reduced = false;
		touch.on = false;
	}
	const bad = thrown.flatMap(({ where, seen }) => {
		const wrong = check(seen);
		return wrong ? [`${where}: ${wrong}`] : [];
	});
	// Both endings share the flight: one line for a flight that fails in both.
	return [...new Set(bad)];
}

describe('the leash', () => {
	it('keeps its loop in the picture at every size, for every species, with and without reduced motion', () => {
		const bad = everyThrow(({ top, topWhen }) =>
			top < CLEAR ? `${top.toFixed(1)} px from the top edge, ${topWhen}` : null
		);
		expect(bad).toEqual([]);
		// About 1.6–2 s at a load average of 8–10 (160 throws, every point of the
		// loop projected on each of their 16,000 frames, against the top edge and
		// the status box); up to four times that under a heavy load.
	}, 30_000);

	it('knows where the wild animal’s status box is: its copy of the box covers the CSS’s', () => {
		expect(WILD_STATUS_BOX.right).toBe(STATUS_BOX.right);
		expect(WILD_STATUS_BOX.bottom).toBeGreaterThanOrEqual(STATUS_BOX.bottom);
	});

	it('never goes behind the wild animal’s status box: its loop keeps clear, and its rope never crosses it', () => {
		const bad = everyThrow(({ box, boxWhen, rope, ropeWhen }) =>
			box < CLEAR
				? `the loop ${box > 0 ? `${box.toFixed(1)} px from` : 'behind'} the status box, ${boxWhen}`
				: rope <= 0
					? `the rope crosses the status box, ${ropeWhen}`
					: null
		);
		expect(bad).toEqual([]);
		// Reads the throws of the test above; run alone, it throws them itself, and takes as long.
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
