import { describe, expect, it } from 'vitest';
import { Rng, hashInts, hashString } from '../src/rng.js';

describe('Rng', () => {
	it('is deterministic for a given seed', () => {
		const a = new Rng(42);
		const b = new Rng(42);
		const seqA = Array.from({ length: 20 }, () => a.int(0, 1000));
		const seqB = Array.from({ length: 20 }, () => b.int(0, 1000));
		expect(seqA).toEqual(seqB);
	});

	it('differs between seeds', () => {
		const a = Array.from({ length: 10 }, (_, i) => new Rng(i).next());
		expect(new Set(a).size).toBe(10);
	});

	it('int() stays within inclusive bounds', () => {
		const rng = new Rng(7);
		for (let i = 0; i < 5000; i++) {
			const v = rng.int(3, 5);
			expect(v).toBeGreaterThanOrEqual(3);
			expect(v).toBeLessThanOrEqual(5);
		}
	});

	it('int() reaches both endpoints', () => {
		const rng = new Rng(9);
		const seen = new Set<number>();
		for (let i = 0; i < 1000; i++) seen.add(rng.int(0, 3));
		expect([...seen].sort()).toEqual([0, 1, 2, 3]);
	});

	it('fork() produces an independent, reproducible stream', () => {
		const f1 = new Rng(1).fork();
		const f2 = new Rng(1).fork();
		expect(f1.next()).toBe(f2.next());
	});
});

describe('hashInts / hashString', () => {
	it('is stable and order-sensitive', () => {
		expect(hashInts(1, 2, 3)).toBe(hashInts(1, 2, 3));
		expect(hashInts(1, 2, 3)).not.toBe(hashInts(3, 2, 1));
		expect(hashString('meadow')).toBe(hashString('meadow'));
		expect(hashString('meadow')).not.toBe(hashString('meadows'));
	});
});
