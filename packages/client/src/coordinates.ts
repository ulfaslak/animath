import type { GridPos } from '@mathgame/engine';

/** Where the player stands, as the explore screen shows it: steps right (`x`) and up (`y`). */
export interface Coordinates {
	x: number;
	y: number;
}

/**
 * The player's coordinates, shown in the explore screen's bottom-right corner
 * ([[DECISIONS]] § Client, [[UI_SPEC]] § Explore mode): the steps from their
 * world's spawn, which reads 0, 0 in every world, with `x` growing to the
 * right and `y` growing up the screen (north), the way a maths book draws a
 * graph, and both below zero the other way.
 *
 * The engine's grid counts from its own origin, with `y` growing down the
 * screen ([[ARCHITECTURE]] § Coordinate system). This turns it over for the
 * screen only: the rules never see these numbers.
 */
export function coordinates(pos: GridPos, spawn: GridPos): Coordinates {
	return { x: pos.x - spawn.x, y: spawn.y - pos.y };
}

/**
 * A whole number as the game prints it in maths: a real minus sign ("−40",
 * [[DESIGN]] § Typography), and nothing between the thousands, so "1000"
 * never reads as two numbers.
 */
export function mathNumber(n: number): string {
	return n < 0 ? `−${-n}` : `${n}`;
}
