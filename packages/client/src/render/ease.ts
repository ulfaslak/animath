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

/** Going away: shrinks to nothing, faster at the end; a sliver keeps the matrix invertible. The same with reduced motion: it says what happened. */
export function recallScale(p: number): number {
	const t = Math.min(1, Math.max(0, p));
	return Math.max(0.001, 1 - t * t);
}

/**
 * A little double jump for joy: the battle's cheer (`battle-scene.ts`), and
 * the same cheer on another player's trainer (`others.ts`): two hops, the
 * second lower, and with `spin` a whole turn through the first. `lift` is how high (tiles, the first hop `high`), `turn` how far
 * round (radians). With `calm` (reduced motion) one small hop and no turn.
 */
export function doubleHop(
	p: number,
	{ high, spin, calm }: { high: number; spin: boolean; calm: boolean }
): { lift: number; turn: number } {
	const t = Math.min(1, Math.max(0, p));
	if (calm) return { lift: Math.sin(Math.min(1, t * 2) * Math.PI) * high * 0.25, turn: 0 };
	const first = t < 0.5;
	const q = first ? t / 0.5 : (t - 0.5) / 0.5;
	return {
		lift: Math.sin(q * Math.PI) * (first ? high : high * 0.55),
		turn: spin && first ? smoothstep(q) * Math.PI * 2 : 0
	};
}

/**
 * Coming in: grows from nothing past its size and settles back (an ease-out
 * with a little overshoot). `calm` (reduced motion) grows it to its size
 * and no further: the same arrival, without the bounce.
 */
export function appearScale(p: number, calm = false): number {
	const t = Math.min(1, Math.max(0, p));
	if (calm) return Math.max(0.001, 1 - Math.pow(1 - t, 3));
	return Math.max(0.001, 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2));
}
