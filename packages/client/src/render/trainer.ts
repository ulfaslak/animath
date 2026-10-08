import { isIce, isWater, tileAtWorld, type Direction, type GridPos } from '@mathgame/engine';
import { BOAT_STAND } from './boat';
import { groundTop } from './tiles';

/**
 * How a trainer walks from tile to tile: the player's own (`renderer.ts`)
 * and every other player's (`others.ts`) alike, so a friend walks, hops and
 * sails exactly as you do.
 */

/** Seconds a trainer takes for one step, tile to tile (Game Boy pace is ~0.25). */
export const STEP_SECONDS = 0.18;
/**
 * Seconds a trainer takes to slide over one tile of ice (The Arctic's frozen
 * lakes and sea ice): quicker than a step, so a slide reads as one, and no
 * quicker than presence tells the others of a tile (`MIN_GAP_MS`, 0.1 s).
 */
export const SLIDE_SECONDS = 0.11;

/**
 * Whether going from `from` to `to` is sliding: onto the ice, over it or off
 * it at the end of a slide. The trainer glides then, feet together, with no
 * hop and at an even speed (`SLIDE_SECONDS` a tile).
 */
export function slidesBetween(seed: number, from: GridPos, to: GridPos): boolean {
	if (from.x === to.x && from.y === to.y) return false;
	return isIce(tileAtWorld(seed, from.x, from.y).kind) || isIce(tileAtWorld(seed, to.x, to.y).kind);
}

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
 * higher into the boat or out of it, and out on the water they glide. On a
 * mount's back (`ride`, how far they sit there, 0 to 1) the mount does the
 * hopping, so they don't.
 */
export function trainerStep(
	seed: number,
	from: GridPos,
	to: GridPos,
	progress: number,
	boatOwned: boolean,
	calm: boolean,
	ride = 0
): { x: number; y: number; z: number; afloat: number } {
	// On the ice they glide at an even speed, tile after tile; a step eases in and out.
	const slide = slidesBetween(seed, from, to);
	const t = slide ? progress : progress * progress * (3 - 2 * progress); // smoothstep
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
	const hop = slide || (fromWater && toWater) ? 0 : fromWater !== toWater ? BOARD_HOP : HOP;
	const lift = Math.sin(progress * Math.PI) * (calm ? CALM_HOP : hop) * (1 - ride);
	return { x, y: y + lift, z, afloat };
}

/** Seconds the glider takes to fly one tile (walking is `STEP_SECONDS`): 20 tiles in 3 s. */
export const GLIDE_SECONDS = 0.15;
/** Seconds a trainer takes to rise to cruising height at take-off, the glider opening over them. */
export const RISE_SECONDS = 0.35;
/** Seconds they take to come down at the end, the glider folding away. */
export const DESCEND_SECONDS = 0.4;
/** How high over the ground under them a trainer flies with the glider: over the trees and the snowy peaks. */
export const CRUISE_HEIGHT = 2.1;

/**
 * Where a trainer is with the glider: `lift` of the way (0 on the ground, 1
 * at `CRUISE_HEIGHT`) from where `trainerStep` puts them up into the air.
 * Up there they glide from tile to tile without a hop, over the ground as it
 * rises and falls (the water's top out on a lake), and their boat, if they
 * own one, rides on their back: taking off from the boat swings it onto
 * their back as they rise, and coming down onto the water swings it under
 * them again. `lift` is eased by the caller.
 */
export function trainerPose(
	seed: number,
	from: GridPos,
	to: GridPos,
	progress: number,
	boatOwned: boolean,
	calm: boolean,
	lift: number,
	ride = 0
): { x: number; y: number; z: number; afloat: number } {
	const ground = trainerStep(seed, from, to, progress, boatOwned, calm, ride);
	const up = Math.min(1, Math.max(0, lift));
	if (up === 0) return ground;
	const t = progress * progress * (3 - 2 * progress);
	const topAt = (p: GridPos) => groundTop(tileAtWorld(seed, p.x, p.y));
	const air = topAt(from) + (topAt(to) - topAt(from)) * t + CRUISE_HEIGHT;
	return {
		x: ground.x,
		y: ground.y + (air - ground.y) * up,
		z: ground.z,
		afloat: ground.afloat * (1 - up)
	};
}

/** A figure's turn about y for each way it faces: figures face +z (grid "down") at rest. */
export const FACING_ANGLE: Record<Direction, number> = {
	up: Math.PI,
	down: 0,
	left: -Math.PI / 2,
	right: Math.PI / 2
};

/** A unit step for each way a figure faces, in world x and z (grid "down" is +z). */
export const AHEAD: Record<Direction, { readonly x: number; readonly z: number }> = {
	up: { x: 0, z: -1 },
	down: { x: 0, z: 1 },
	left: { x: -1, z: 0 },
	right: { x: 1, z: 0 }
};

/** Which foot a step from anywhere onto `to` lands on: every step the other one (x + y changes by one). */
export function strideOnto(to: GridPos): 1 | -1 {
	return (((to.x + to.y) % 2) + 2) % 2 === 0 ? 1 : -1;
}
