import type { Rng } from '../../rng.js';
import { facePrompt } from '../face.js';
import type { Puzzle, PuzzleGenerator, PuzzleTopic } from '../types.js';
import type { Band } from './arithmetic.js';

/**
 * One step of the floor-and-fence ladder ([[PRODUCT]] §4 "Puzzles"): how
 * long a side is (`side`), whether the shape is drawn in squares (`grid`)
 * or with its sides' lengths written on, and what may be asked: the floor
 * (area) alone at first, then the fence (perimeter) too (`fence`), of a
 * rectangle or an L (`l`: the share of puzzles that are), or a side missing
 * (`missing`: that share of puzzles).
 */
export interface ShapeStep {
	side: Band;
	grid: boolean;
	fence: boolean;
	l: number;
	missing: number;
}

/** Index = difficulty − 1. Both ends of `side` never fall. */
export const SHAPE_LADDER: readonly ShapeStep[] = [
	{ side: [2, 4], grid: true, fence: false, l: 0, missing: 0 },
	{ side: [2, 5], grid: true, fence: true, l: 0, missing: 0 },
	{ side: [3, 7], grid: true, fence: true, l: 0, missing: 0 },
	{ side: [4, 9], grid: false, fence: true, l: 0, missing: 0 },
	{ side: [4, 9], grid: true, fence: true, l: 1, missing: 0 },
	{ side: [5, 12], grid: false, fence: true, l: 0, missing: 0.5 },
	{ side: [5, 12], grid: false, fence: true, l: 0.5, missing: 0.5 },
	{ side: [8, 15], grid: false, fence: true, l: 0.5, missing: 0.5 },
	{ side: [10, 20], grid: false, fence: true, l: 0.5, missing: 0.5 },
	{ side: [12, 25], grid: false, fence: true, l: 0.5, missing: 0.5 }
];

/** What `shape` asks: the floor (how many squares) or the fence (how long all the way round), or a side missing from either. */
export const SHAPE = { floor: 0, fence: 1, floorSide: 2, fenceSide: 3 } as const;

/**
 * Area and perimeter ([[PRODUCT]] §4 "Puzzles"), always as a floor and a
 * fence, so a kid never mixes them up: the floor is the squares inside, the
 * fence goes all the way round. A rectangle in squares first, then with its
 * sides written on, then an L (a rectangle with a corner cut away), then a
 * side missing: the floor's squares or the fence's length and one side given.
 */
export const shape: PuzzleGenerator = {
	kind: 'shape',
	minDifficulty: 1,
	maxDifficulty: 10,
	topics: (difficulty) =>
		SHAPE_LADDER[difficulty - 1]!.fence ? ['area', 'perimeter'] : (['area'] as PuzzleTopic[]),
	generate(rng: Rng, difficulty: number): Puzzle {
		const step = SHAPE_LADDER[difficulty - 1]!;
		const fence = step.fence && rng.chance(0.5);
		const w = rng.int(...step.side);
		const h = rng.int(...step.side);
		if (rng.chance(step.missing)) {
			// The bottom is w long; the left side, h, is what is asked.
			const how = fence ? SHAPE.fenceSide : SHAPE.floorSide;
			const total = fence ? 2 * (w + h) : w * h;
			return puzzle(difficulty, [how, w, total, 0, 0, 0], h);
		}
		const grid = step.grid ? 1 : 0;
		// An L: a corner of at least 1 by 1 cut from the top right, leaving at least 1 by 1 of each arm.
		const l = rng.chance(step.l) && w >= 2 && h >= 2;
		const cw = l ? rng.int(1, w - 1) : 0;
		const ch = l ? rng.int(1, h - 1) : 0;
		const how = fence ? SHAPE.fence : SHAPE.floor;
		// The fence of an L is as long as the rectangle's: the cut swaps two sides for two as long.
		const answer = fence ? 2 * (w + h) : w * h - cw * ch;
		return puzzle(difficulty, [how, w, h, cw, ch, grid], answer);
	}
};

function puzzle(difficulty: number, numbers: number[], answer: number): Puzzle {
	return { kind: 'shape', difficulty, prompt: facePrompt({ kind: 'shape', numbers }), answer };
}
