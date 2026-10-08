import { STARTERS } from '@mathgame/engine';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { motion } from '../src/motion';
import { MIN_FIT, StarterScene, fitFor, liftFor, zoomed } from '../src/render/starter-scene';

/**
 * The starters keep to the room the starter screen leaves them (#78): the
 * card at the bottom grows for the name box, and the name tags under the
 * animals' feet must stay clear of it. The screen measures the room; the
 * stage moves the row into it, no further than it must.
 */
describe('liftFor', () => {
	const row = { feet: 400, top: 200 };

	it('leaves a row that fits where it is', () => {
		expect(liftFor(row, null)).toBe(0);
		expect(liftFor(row, { top: 100, bottom: 450 })).toBe(0);
		expect(liftFor(row, { top: 200, bottom: 400 })).toBe(0);
	});

	it('lifts the feet above the band’s bottom, and lowers the tops below its top, by just that much', () => {
		expect(liftFor(row, { top: 0, bottom: 350 })).toBe(50);
		expect(liftFor(row, { top: 230, bottom: 700 })).toBe(-30);
	});

	it('never lowers the feet out of the band, and when it is too short, the feet win', () => {
		expect(liftFor(row, { top: 260, bottom: 420 })).toBe(-20);
		expect(liftFor(row, { top: 300, bottom: 350 })).toBe(50);
	});
});

describe('fitFor', () => {
	const row = { feet: 400, top: 200 };
	it('leaves a row that fits as it is, and shrinks one that does not just enough, never under MIN_FIT', () => {
		expect(fitFor(row, null)).toBe(1);
		expect(fitFor(row, { top: 100, bottom: 450 })).toBe(1);
		expect(fitFor(row, { top: 100, bottom: 250 })).toBeCloseTo(0.75);
		expect(fitFor(row, { top: 100, bottom: 120 })).toBe(MIN_FIT);
		expect(fitFor(row, { top: 300, bottom: 100 })).toBe(MIN_FIT);
	});
	it('shrinks about the middle of the screen', () => {
		expect(zoomed(row, 0.5, 400)).toEqual({ feet: 300, top: 200 });
	});
});

describe('the starter stage in its room', () => {
	const SIZES: [number, number][] = [
		[1280, 720],
		[1024, 768],
		[1180, 820],
		[1920, 1080]
	];
	/** Where the starters' feet are on the stage's own camera, in CSS pixels from the top. */
	const feet = (stage: StarterScene, height: number) => stage.spots().map((s) => s.y * height);
	const reduced = motion.reduced;
	afterEach(() => {
		motion.reduced = reduced;
	});

	/** The highest any animal reaches on screen, over a whole bounce, in CSS pixels. */
	const highest = (stage: StarterScene, height: number) => {
		let top = Infinity;
		for (let t = 0; t < 1.3; t += 0.05) {
			stage.update(t);
			stage.scene.updateMatrixWorld(true);
			for (const figure of stage.scene.children.filter(
				(c) => c.name && STARTERS.includes(c.name)
			)) {
				const box = new THREE.Box3().setFromObject(figure);
				for (const x of [box.min.x, box.max.x])
					for (const y of [box.min.y, box.max.y])
						for (const z of [box.min.z, box.max.z]) {
							const p = new THREE.Vector3(x, y, z).project(stage.camera);
							top = Math.min(top, ((1 - p.y) / 2) * height);
						}
			}
		}
		return top;
	};

	function shown(width: number, height: number): StarterScene {
		const stage = new StarterScene();
		stage.resize(width, height);
		stage.show(STARTERS);
		return stage;
	}

	it('slides up above a card that grows under it, and back down when it shrinks', () => {
		for (const [width, height] of SIZES) {
			const size = `${width}×${height}`;
			const stage = shown(width, height);
			const natural = feet(stage, height);
			// A room the row fits in as it stands: nothing moves.
			stage.setRoom({ top: 0, bottom: height });
			expect(feet(stage, height), size).toEqual(natural);
			// The name box opens, and the card's top rises past the feet.
			const bottom = natural[0]! - 60;
			stage.setRoom({ top: 0, bottom });
			stage.slide(1 / 60);
			const first = feet(stage, height)[0]!;
			expect(first, size).toBeLessThan(natural[0]!);
			expect(first, size).toBeGreaterThan(bottom);
			for (let i = 0; i < 60; i++) stage.slide(1 / 60);
			for (const y of feet(stage, height)) expect(y, size).toBeCloseTo(bottom, 1);
			// The name box closes: back where it stood.
			stage.setRoom({ top: 0, bottom: height });
			for (let i = 0; i < 60; i++) stage.slide(1 / 60);
			expect(feet(stage, height), size).toEqual(natural);
		}
	});

	it('slides down under a card at the top until every animal, breathing and bouncing, is just below it', () => {
		for (const [width, height] of SIZES) {
			const size = `${width}×${height}`;
			for (let lit = 0; lit < STARTERS.length; lit++) {
				const stage = shown(width, height);
				stage.select(lit);
				stage.setRoom({ top: 0, bottom: height });
				// The name box on a touch screen: the card at the top, 60 px past the animals' tops.
				const top = highest(stage, height) + 60;
				stage.setRoom({ top, bottom: height });
				for (let i = 0; i < 60; i++) stage.slide(1 / 60);
				// Below the card, and no further than it must be: a few pixels of a box's corner.
				const now = highest(stage, height);
				expect(now, `${size}, ${STARTERS[lit]} lit`).toBeGreaterThanOrEqual(top);
				expect(now - top, `${size}, ${STARTERS[lit]} lit`).toBeLessThan(8);
			}
		}
	});

	it('takes its first room at once, and with reduced motion every room', () => {
		const stage = shown(1280, 720);
		const natural = feet(stage, 720)[0]!;
		stage.setRoom({ top: 0, bottom: natural - 40 });
		expect(feet(stage, 720)[0]).toBeCloseTo(natural - 40, 1);
		// Shown again (back to the title and New game): it stands where it stands, the last
		// screen's room forgotten, until the first room places it again.
		stage.show(STARTERS);
		expect(feet(stage, 720)[0]).toBeCloseTo(natural, 1);
		stage.setRoom({ top: 0, bottom: natural - 20 });
		expect(feet(stage, 720)[0]).toBeCloseTo(natural - 20, 1);
		motion.reduced = true;
		stage.setRoom({ top: 0, bottom: natural - 70 });
		stage.slide(1 / 60);
		expect(feet(stage, 720)[0]).toBeCloseTo(natural - 70, 1);
	});

	it('shrinks the row into a band too short for it, a phone held sideways, and grows it back', () => {
		for (const [width, height] of [
			[667, 375],
			[844, 390]
		] as const) {
			const stage = shown(width, height);
			const natural = feet(stage, height);
			// The heading's bottom to the card's top, less the tags' reach: a short band.
			const room = { top: 60, bottom: 150 };
			stage.setRoom(room);
			for (let i = 0; i < 60; i++) stage.slide(1 / 60);
			const top = highest(stage, height);
			const now = feet(stage, height);
			expect(top, `${width}×${height}`).toBeGreaterThanOrEqual(room.top - 4);
			for (const y of now) expect(y, `${width}×${height}`).toBeLessThanOrEqual(room.bottom + 0.5);
			// Smaller, but not too small to read: the row is at least MIN_FIT of its height.
			expect(now[0]! - top).toBeGreaterThanOrEqual(0.5 * (room.bottom - room.top));
			// Room again: it grows back where it stood.
			stage.setRoom({ top: 0, bottom: height });
			for (let i = 0; i < 90; i++) stage.slide(1 / 60);
			for (const [i, y] of feet(stage, height).entries()) expect(y).toBeCloseTo(natural[i]!, 0);
		}
	});

	it('keeps to its room at once through a new size', () => {
		const stage = shown(1280, 720);
		const room = { top: 0, bottom: feet(stage, 720)[0]! - 50 };
		stage.setRoom(room);
		stage.resize(1024, 768);
		expect(feet(stage, 768)[0]).toBeCloseTo(room.bottom, 1);
	});
});
