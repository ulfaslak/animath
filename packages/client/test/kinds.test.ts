import {
	ALL_PUZZLE_KINDS,
	ALL_PUZZLE_TOPICS,
	MAX_DIFFICULTY,
	MIN_DIFFICULTY,
	Rng,
	generatePuzzle,
	puzzleFace
} from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { kindGlyph, thoughtSum } from '../src/kinds';

/**
 * The thought bubble over a player in a battle ([[UI_SPEC]] § Explore mode,
 * "Battles seen from outside"): a sum as the engine writes it, and a puzzle
 * the page words or draws as its kind's sign and a "?", never its face
 * written out ("double(0, 8)") and never a word.
 */
describe('a thought bubble', () => {
	it('never shows a face written out, for any kind at any difficulty', () => {
		const bad = new Set<string>();
		for (const kind of ALL_PUZZLE_KINDS) {
			for (let d = MIN_DIFFICULTY; d <= MAX_DIFFICULTY; d++) {
				const rng = new Rng(100 * d);
				for (let i = 0; i < 40; i++) {
					const face = puzzleFace(generatePuzzle(rng, d, [kind]))!;
					const bubble = thoughtSum(face);
					if (/[a-z]+\(/.test(bubble) || bubble.includes(',') !== (kind === 'sequence'))
						bad.add(`${kind} d${d}: ${bubble}`);
				}
			}
		}
		expect([...bad]).toEqual([]);
	});

	it('shows doubling and halving by their signs, and a sum as it is', () => {
		expect(thoughtSum({ kind: 'double', numbers: [0, 8] })).toBe('×2 ?');
		expect(thoughtSum({ kind: 'double', numbers: [1, 14] })).toBe('÷2 ?');
		expect(thoughtSum({ kind: 'mul', numbers: [7, 8] })).toBe('7 × 8 = ?');
	});
});

/**
 * A topic's sign, on an attack's chips, on My puzzles and in a thought bubble,
 * is the picture a kid who cannot read yet tells the topics apart by: no two
 * topics share one.
 */
describe("a topic's sign", () => {
	it('is its own, for every topic', () => {
		const byGlyph = new Map<string, string[]>();
		for (const topic of ALL_PUZZLE_TOPICS) {
			const glyph = kindGlyph(topic);
			byGlyph.set(glyph, [...(byGlyph.get(glyph) ?? []), topic]);
		}
		expect([...byGlyph].filter(([, topics]) => topics.length > 1)).toEqual([]);
	});
});
