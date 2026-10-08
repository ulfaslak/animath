import { hashInts } from '../rng.js';

/**
 * Smooth value noise over the grid, from 0 to 1: a hashed value at every
 * `scale`-th lattice point, blended between them with a smoothstep. Keyed by
 * `(seed, x, y)` alone, never by call order, so every land's generator
 * (`generate.ts`, `arctic.ts`) stays a pure function of its coordinates.
 */
export function valueNoise(seed: number, x: number, y: number, scale: number): number {
	const fx = x / scale;
	const fy = y / scale;
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const tx = fx - x0;
	const ty = fy - y0;
	const lattice = (ix: number, iy: number) => hashInts(seed, ix, iy) / 4294967296;
	const sx = tx * tx * (3 - 2 * tx);
	const sy = ty * ty * (3 - 2 * ty);
	const top = lattice(x0, y0) * (1 - sx) + lattice(x0 + 1, y0) * sx;
	const bottom = lattice(x0, y0 + 1) * (1 - sx) + lattice(x0 + 1, y0 + 1) * sx;
	return top * (1 - sy) + bottom * sy;
}
