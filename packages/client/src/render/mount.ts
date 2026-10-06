import * as THREE from 'three';

/**
 * A kid riding their lead with the harness ([[PRODUCT]] §4 "World", riding): where
 * each animal that carries a kid (`carries` in the engine's catalog) is sat
 * on, and how a trainer sits there. The player's own trainer (`renderer.ts`)
 * and every other player's (`others.ts`) ride alike; the animal under them is
 * the follower's figure (`follower.ts`).
 */

/**
 * Where a kid sits on each animal that carries one, at its own size, as it
 * faces +z: `y`, the top of its back there, and `z`, how far behind its
 * middle, clear of the neck and of the moose's and the bison's humps.
 * `mount.test.ts` measures every `y` against the figure's own back.
 */
export const SADDLE: Readonly<Record<string, { y: number; z: number }>> = {
	deer: { y: 0.76, z: -0.06 },
	'wild-boar': { y: 0.605, z: -0.12 },
	wolf: { y: 0.58, z: -0.06 },
	bear: { y: 0.88, z: -0.08 },
	moose: { y: 1.1, z: -0.12 },
	'european-bison': { y: 0.87, z: -0.3 }
};

/** How far below the seat the trainer's feet are when they sit: the hips (`HIP_Y`), sunk a little into the fur. */
export const SIT_DROP = 0.17;
/** How far a sitting kid's legs spread round the animal, and swing forward, in radians. */
const STRADDLE = 0.55;
const KNEES_FORWARD = 0.5;

/**
 * Sit the trainer's rig on a mount `weight` of the way (0 standing, 1 sat
 * astride: the mount growing in or shrinking away in between): the legs
 * spread round the animal's back and swing forward. After `animateWalk`, whose
 * swing it takes over, every frame: at 0 it puts the legs straight again.
 */
export function poseRider(rig: THREE.Object3D, weight: number): void {
	weight = Math.min(1, Math.max(0, weight));
	for (const [name, side] of [
		['legL', -1],
		['legR', 1]
	] as const) {
		const leg = rig.getObjectByName(name);
		if (!leg) continue;
		leg.rotation.x = leg.rotation.x * (1 - weight) - KNEES_FORWARD * weight;
		leg.rotation.z = side * STRADDLE * weight;
	}
}
