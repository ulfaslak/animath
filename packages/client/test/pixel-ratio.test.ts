import { describe, expect, it } from 'vitest';
import { pixelRatioFor } from '../src/render/renderer';

/**
 * How sharp the world is drawn (`pixelRatioFor`): the GPU's time goes with
 * the pixels it fills, and an older iPad at 2× drew too many to keep up (#150).
 */
describe('the pixels the world is drawn with', () => {
	it('a phone held sideways keeps 2 per CSS pixel', () => {
		expect(pixelRatioFor(932, 430, 3)).toBe(2);
		expect(pixelRatioFor(844, 390, 3)).toBe(2);
	});

	it('an iPad, a laptop and a big screen draw 1.5, never fewer', () => {
		expect(pixelRatioFor(1080, 810, 2)).toBe(1.5);
		expect(pixelRatioFor(1366, 1024, 2)).toBe(1.5);
		expect(pixelRatioFor(1512, 982, 2)).toBe(1.5);
		expect(pixelRatioFor(2560, 1440, 2)).toBe(1.5);
	});

	it('in between, as many as the budget holds, the phone at one end and the tablet at the other', () => {
		const ratios = [600, 750, 900, 1050, 1100].map((w) => pixelRatioFor(w, w * 0.75, 3));
		expect(ratios.every((r, i) => i === 0 || r <= ratios[i - 1]!)).toBe(true);
		expect(ratios[0]).toBe(2);
		expect(ratios[2]).toBeGreaterThan(1.5);
		expect(ratios[2]).toBeLessThan(2);
		expect(ratios[4]).toBe(1.5);
	});

	it('never more than the screen has', () => {
		expect(pixelRatioFor(1920, 1080, 1)).toBe(1);
		expect(pixelRatioFor(390, 844, 1)).toBe(1);
		expect(pixelRatioFor(1280, 800, 1.25)).toBe(1.25);
	});
});
