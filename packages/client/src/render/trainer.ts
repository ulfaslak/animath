import { isWater, tileAtWorld, type Direction, type GridPos } from '@mathgame/engine';
import { BOAT_STAND } from './boat';
import { groundTop } from './tiles';

/**
 * How a trainer walks from tile to tile: the player's own (`renderer.ts`)
 * and every other player's (`others.ts`) alike, so a friend walks, hops and
 * sails exactly as you do.
 */

/** Seconds a trainer takes for one step, tile to tile (Game Boy pace is ~0.25). */
export const STEP_SECONDS = 0.18;
/** How high the trainer hops on an ordinary step, and into the boat or out of it. */
const HOP = 0.15;
const BOARD_HOP = 0.24;
/** With reduced motion, a step's hop. */
const CALM_HOP = 0.05;

/**
 * Where a trainer is `progress` (0..1) of the way through a step from one
 * tile to the next in world `seed`, and how far their boat is under them
 * (`afloat`: 0 on their back, 1 afloat; always 0 without a boat). The feet
 * are on the ground, or out on the water on the boat's floor; a step hops,
 * higher into the boat or out of it, and out on the water they glide.
 */
export function trainerStep(
	seed: number,
	from: GridPos,
	to: GridPos,
	progress: number,
	boatOwned: boolean,
	calm: boolean
): { x: number; y: number; z: number; afloat: number } {
	const t = progress * progress * (3 - 2 * progress); // smoothstep
	const x = from.x + (to.x - from.x) * t;
	const z = from.y + (to.y - from.y) * t;
	const groundAt = (p: GridPos) => {
		const tile = tileAtWorld(seed, p.x, p.y);
		return groundTop(tile) + (boatOwned && isWater(tile.kind) ? BOAT_STAND : 0);
	};
	const yFrom = groundAt(from);
	const y = yFrom + (groundAt(to) - yFrom) * t;
	// With the boat, a step onto the water swings it under the trainer and one
	// back onto land swings it onto their back, in step with them; out on the
	// water they glide, standing in it.
	const fromWater = boatOwned && isWater(tileAtWorld(seed, from.x, from.y).kind);
	const toWater = boatOwned && isWater(tileAtWorld(seed, to.x, to.y).kind);
	const afloat = fromWater === toWater ? (toWater ? 1 : 0) : toWater ? progress : 1 - progress;
	const hop = fromWater && toWater ? 0 : fromWater !== toWater ? BOARD_HOP : HOP;
	const lift = Math.sin(progress * Math.PI) * (calm ? CALM_HOP : hop);
	return { x, y: y + lift, z, afloat };
}

/** A figure's turn about y for each way it faces: figures face +z (grid "down") at rest. */
export const FACING_ANGLE: Record<Direction, number> = {
	up: Math.PI,
	down: 0,
	left: -Math.PI / 2,
	right: Math.PI / 2
};

/** Which foot a step from anywhere onto `to` lands on: every step the other one (x + y changes by one). */
export function strideOnto(to: GridPos): 1 | -1 {
	return (((to.x + to.y) % 2) + 2) % 2 === 0 ? 1 : -1;
}
