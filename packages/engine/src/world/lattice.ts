/**
 * The tents' lattice: a tent stands only on a tile where `x mod 23 = 5` and
 * `y mod 19 = 7` (and only there where the ground would be grass, in the
 * forest or near water), so the doctors are spread out, never side by side.
 */
export const TENT_LATTICE = { everyX: 23, atX: 5, everyY: 19, atY: 7 } as const;

/** Whether a tent could stand on tile (x, y): it is on the tents' lattice. */
export function onTentLattice(x: number, y: number): boolean {
	return (
		mod(x, TENT_LATTICE.everyX) === TENT_LATTICE.atX &&
		mod(y, TENT_LATTICE.everyY) === TENT_LATTICE.atY
	);
}

/** Modulo that is never negative: `%` keeps the sign of `x`, so `-3 % 23` is -3. */
export function mod(x: number, m: number): number {
	return ((x % m) + m) % m;
}
