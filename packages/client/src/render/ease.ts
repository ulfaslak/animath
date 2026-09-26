/**
 * The curves the figures move on, shared so a flourish looks the same
 * wherever it plays: an animal called back in a battle and a follower
 * making way for a new lead shrink alike, and one sent in grows alike.
 * Each takes `p`, 0..1 through the movement.
 */

/** Slow at both ends: a step from tile to tile. */
export function smoothstep(p: number): number {
	const t = Math.min(1, Math.max(0, p));
	return t * t * (3 - 2 * t);
}

/** Going away: shrinks to nothing, faster at the end; a sliver keeps the matrix invertible. */
export function recallScale(p: number): number {
	const t = Math.min(1, Math.max(0, p));
	return Math.max(0.001, 1 - t * t);
}

/** Coming in: grows from nothing past its size and settles back (an ease-out with a little overshoot). */
export function appearScale(p: number): number {
	const t = Math.min(1, Math.max(0, p));
	return Math.max(0.001, 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2));
}
