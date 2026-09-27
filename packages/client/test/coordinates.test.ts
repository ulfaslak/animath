import { spawnPoint, step, worldSeed, type Direction, type GridPos } from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { coordinates, mathNumber } from '../src/coordinates';

/**
 * The coordinates in the explore screen's corner ([[UI_SPEC]] § Explore mode):
 * counted from the world's spawn, x to the right and y up the screen, while
 * the engine's grid has y growing down it.
 */
describe('the coordinates a kid reads', () => {
	it('read 0, 0 on the spawn of every world', () => {
		for (const world of [1, 2, 42, 777, 9999]) {
			const spawn = spawnPoint(worldSeed(world));
			expect(coordinates(spawn, spawn)).toEqual({ x: 0, y: 0 });
		}
	});

	it('go up by one to the right and up the screen, and down by one to the left and down it', () => {
		const spawn = spawnPoint(worldSeed(1));
		const change: Record<Direction, Record<'x' | 'y', number>> = {
			right: { x: 1, y: 0 },
			left: { x: -1, y: 0 },
			up: { x: 0, y: 1 },
			down: { x: 0, y: -1 }
		};
		const places: GridPos[] = [spawn, { x: 0, y: 0 }, { x: -1003, y: 1005 }, { x: 250, y: -7 }];
		for (const from of places) {
			const before = coordinates(from, spawn);
			for (const dir of Object.keys(change) as Direction[]) {
				const after = coordinates(step(from, dir), spawn);
				expect(
					{ x: after.x - before.x, y: after.y - before.y },
					`${dir} from ${from.x}, ${from.y}`
				).toEqual(change[dir]);
			}
		}
	});

	it("count World 1 from its spawn at (−2, 6): the doctor's tent at (5, 7) is 7 right and 1 down", () => {
		const spawn = spawnPoint(worldSeed(1));
		expect(spawn).toEqual({ x: -2, y: 6 });
		expect(coordinates({ x: 5, y: 7 }, spawn)).toEqual({ x: 7, y: -1 });
		// The engine's own origin is nobody's start: 2 right of World 1's and 6 up.
		expect(coordinates({ x: 0, y: 0 }, spawn)).toEqual({ x: 2, y: 6 });
	});
});

describe('numbers as the game prints them in maths', () => {
	it('below zero with a real minus sign, and no separator between the thousands', () => {
		expect(mathNumber(0)).toBe('0');
		expect(mathNumber(-0)).toBe('0');
		expect(mathNumber(40)).toBe('40');
		expect(mathNumber(-1)).toBe('−1');
		expect(mathNumber(-1000)).toBe('−1000');
		expect(mathNumber(12345)).toBe('12345');
		expect(mathNumber(-12345)).toBe('−12345');
	});
});
