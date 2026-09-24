/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * The engine never calls `Math.random`. Every random choice — puzzle operands,
 * encounter rolls, catch rolls, world generation — draws from an `Rng` that
 * was constructed from a seed, so a battle or a chunk of world can be
 * reproduced exactly from (seed, sequence of intents). That property is what
 * lets the same engine run on a client today and on an authoritative server
 * later without the two disagreeing.
 */
export class Rng {
	private state: number;

	constructor(seed: number) {
		this.state = seed >>> 0;
	}

	/** Uniform float in [0, 1). */
	next(): number {
		let t = (this.state += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	/** Uniform integer in [min, max], both inclusive. */
	int(min: number, max: number): number {
		if (max < min) throw new Error(`Rng.int: max (${max}) < min (${min})`);
		return min + Math.floor(this.next() * (max - min + 1));
	}

	/** True with probability `p`. */
	chance(p: number): boolean {
		return this.next() < p;
	}

	pick<T>(items: readonly T[]): T {
		if (items.length === 0) throw new Error('Rng.pick: empty array');
		return items[this.int(0, items.length - 1)] as T;
	}

	/** Fisher–Yates shuffle, returns a new array. */
	shuffle<T>(items: readonly T[]): T[] {
		const out = items.slice();
		for (let i = out.length - 1; i > 0; i--) {
			const j = this.int(0, i);
			[out[i], out[j]] = [out[j] as T, out[i] as T];
		}
		return out;
	}

	/** A new, independent generator derived from this one's stream. */
	fork(): Rng {
		return new Rng(Math.floor(this.next() * 4294967296));
	}
}

/**
 * Deterministic 32-bit hash of a list of integers (e.g. world seed + chunk
 * coordinates). Used to derive per-chunk / per-tile seeds so that any chunk
 * can be generated in isolation, in any order, and come out identical.
 */
export function hashInts(...values: number[]): number {
	let h = 0x811c9dc5;
	for (const v of values) {
		// Mix each 32-bit value byte by byte (FNV-1a style).
		let x = v | 0;
		for (let i = 0; i < 4; i++) {
			h ^= x & 0xff;
			h = Math.imul(h, 0x01000193);
			x >>>= 8;
		}
	}
	// Final avalanche.
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return h >>> 0;
}

/** Hash a string into a 32-bit seed (for user-typed world names). */
export function hashString(s: string): number {
	const codes: number[] = [];
	for (let i = 0; i < s.length; i++) codes.push(s.charCodeAt(i));
	return hashInts(s.length, ...codes);
}
