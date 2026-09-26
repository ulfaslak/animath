import type { Direction } from '@mathgame/engine';

/**
 * The arrow of the D-pad a finger presses, from where it is relative to the
 * pad's centre (`dx` right, `dy` down, in pixels): the way it is furthest
 * along, or none while it rests within `dead` pixels of the centre. A finger
 * that slides round the pad changes arrow as it goes, and one that slides
 * off the pad keeps its arrow, as a thumb on a game pad does.
 */
export function padDirection(dx: number, dy: number, dead: number): Direction | null {
	if (Math.hypot(dx, dy) < dead) return null;
	if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
	return dy > 0 ? 'down' : 'up';
}

/** The key each arrow holds down: the D-pad walks exactly as the arrow keys do. */
export const ARROW_KEYS: Readonly<Record<Direction, string>> = {
	up: 'ArrowUp',
	down: 'ArrowDown',
	left: 'ArrowLeft',
	right: 'ArrowRight'
};
