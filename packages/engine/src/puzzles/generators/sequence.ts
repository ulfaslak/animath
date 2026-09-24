import type { Rng } from '../../rng.js';
import type { Puzzle, PuzzleGenerator } from '../types.js';

type Family = 'arithmetic' | 'geometric' | 'squares' | 'triangular' | 'fibonacci';

// Which families are available at which difficulty. Lower difficulties stay on
// small-step counting; higher ones mix in multiplicative and quadratic growth.
function familiesFor(difficulty: number): Family[] {
	if (difficulty <= 2) return ['arithmetic'];
	if (difficulty <= 4) return ['arithmetic', 'geometric'];
	if (difficulty <= 6) return ['arithmetic', 'geometric', 'squares'];
	return ['arithmetic', 'geometric', 'squares', 'triangular', 'fibonacci'];
}

const SHOWN = 4; // terms shown before the "?"

function terms(family: Family, rng: Rng, difficulty: number): number[] {
	const out: number[] = [];
	switch (family) {
		case 'arithmetic': {
			const step = rng.int(1, Math.min(2 + difficulty * 2, 25));
			const start = rng.int(0, difficulty * 5);
			for (let i = 0; i <= SHOWN; i++) out.push(start + i * step);
			return out;
		}
		case 'geometric': {
			const ratio = difficulty <= 5 ? 2 : rng.int(2, 3);
			const start = rng.int(1, 5);
			for (let i = 0; i <= SHOWN; i++) out.push(start * ratio ** i);
			return out;
		}
		case 'squares': {
			const start = rng.int(1, Math.max(1, difficulty - 4));
			for (let i = 0; i <= SHOWN; i++) out.push((start + i) ** 2);
			return out;
		}
		case 'triangular': {
			const start = rng.int(1, 3);
			for (let i = 0; i <= SHOWN; i++) {
				const n = start + i;
				out.push((n * (n + 1)) / 2);
			}
			return out;
		}
		case 'fibonacci': {
			let a = rng.int(1, 3);
			let b = a + rng.int(0, 2);
			for (let i = 0; i <= SHOWN; i++) {
				out.push(a);
				[a, b] = [b, a + b];
			}
			return out;
		}
	}
}

/** "2, 4, 8, 16, ?" — name the next number. */
export const sequence: PuzzleGenerator = {
	kind: 'sequence',
	minDifficulty: 1,
	maxDifficulty: 10,
	generate(rng: Rng, difficulty: number): Puzzle {
		const family = rng.pick(familiesFor(difficulty));
		const seq = terms(family, rng, difficulty);
		const answer = seq[SHOWN] as number;
		return {
			kind: 'sequence',
			difficulty,
			prompt: `${seq.slice(0, SHOWN).join(', ')}, ?`,
			answer
		};
	}
};
