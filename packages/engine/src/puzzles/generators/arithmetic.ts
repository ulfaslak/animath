import type { Rng } from '../../rng.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';

// Operand ceilings per difficulty (index = difficulty - 1). These are the
// primary tuning knobs for how hard arithmetic feels; adjust freely.
const ADD_MAX = [5, 10, 20, 50, 100, 200, 500, 1000, 5000, 10000] as const;
const MUL_A_MAX = [2, 5, 5, 10, 10, 12, 20, 50, 100, 500] as const;
const MUL_B_MAX = [5, 5, 10, 10, 12, 12, 12, 20, 50, 100] as const;

function ceil(table: readonly number[], difficulty: number): number {
	return table[Math.min(Math.max(difficulty, 1), table.length) - 1] as number;
}

export const add: PuzzleGenerator = {
	kind: 'add',
	minDifficulty: 1,
	maxDifficulty: 10,
	generate(rng: Rng, difficulty: number): Puzzle {
		const max = ceil(ADD_MAX, difficulty);
		const a = rng.int(1, max);
		const b = rng.int(1, max);
		return { kind: 'add', difficulty, prompt: `${a} + ${b} = ?`, answer: a + b };
	}
};

export const sub: PuzzleGenerator = {
	kind: 'sub',
	minDifficulty: 1,
	maxDifficulty: 10,
	generate(rng: Rng, difficulty: number): Puzzle {
		const max = ceil(ADD_MAX, difficulty);
		// Non-negative results only: kids meet negative numbers late.
		const a = rng.int(1, max);
		const b = rng.int(0, a);
		return { kind: 'sub', difficulty, prompt: `${a} − ${b} = ?`, answer: a - b };
	}
};

export const mul: PuzzleGenerator = {
	kind: 'mul',
	minDifficulty: 2,
	maxDifficulty: 10,
	generate(rng: Rng, difficulty: number): Puzzle {
		const a = rng.int(1, ceil(MUL_A_MAX, difficulty));
		const b = rng.int(1, ceil(MUL_B_MAX, difficulty));
		return { kind: 'mul', difficulty, prompt: `${a} × ${b} = ?`, answer: a * b };
	}
};

export const div: PuzzleGenerator = {
	kind: 'div',
	minDifficulty: 3,
	maxDifficulty: 10,
	generate(rng: Rng, difficulty: number): Puzzle {
		// Build from the answer so the quotient is always whole.
		const divisor = rng.int(2, ceil(MUL_B_MAX, difficulty));
		const quotient = rng.int(1, ceil(MUL_A_MAX, difficulty));
		const dividend = divisor * quotient;
		return { kind: 'div', difficulty, prompt: `${dividend} ÷ ${divisor} = ?`, answer: quotient };
	}
};

/** "7 + ? = 12" / "4 × ? = 20": solve for the missing operand. */
export const missing: PuzzleGenerator = {
	kind: 'missing',
	minDifficulty: 1,
	maxDifficulty: 10,
	generate(rng: Rng, difficulty: number): Puzzle {
		if (difficulty <= 3 || rng.chance(0.5)) {
			const max = ceil(ADD_MAX, difficulty);
			const a = rng.int(1, max);
			const answer = rng.int(1, max);
			return {
				kind: 'missing',
				difficulty,
				prompt: `${a} + ? = ${a + answer}`,
				answer
			};
		}
		const a = rng.int(2, ceil(MUL_B_MAX, difficulty));
		const answer = rng.int(1, ceil(MUL_A_MAX, difficulty));
		return {
			kind: 'missing',
			difficulty,
			prompt: `${a} × ? = ${a * answer}`,
			answer
		};
	}
};
