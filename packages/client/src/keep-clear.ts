import type { Rect } from './presence/labels';

/**
 * The pieces of the explore screen that the marks at the edge of the screen
 * (a friend's arrow, the way to the doctor) keep clear of ([[UI_SPEC]] §
 * Explore mode, "The corners"): every element marked `data-keep-clear`. That
 * is the party column and a stack's open card, the top right corner, the
 * coordinates, the message line's column (the Challenge button, and on a
 * phone the note, over the message line), the note about who came or went
 * while it shows, and the touch controls. A mark counts a piece only while
 * it is on the page, and one with nothing in it not at all. A new piece of
 * the explore HUD takes the attribute too, or a friend's arrow can hide
 * under it.
 */
export function clearBoxes(root: ParentNode | null = globalThis.document ?? null): Rect[] {
	if (!root) return [];
	const boxes: Rect[] = [];
	for (const el of root.querySelectorAll('[data-keep-clear]')) {
		const r = el.getBoundingClientRect();
		if (r.width < 1 || r.height < 1) continue;
		boxes.push({
			x0: Math.floor(r.left),
			x1: Math.ceil(r.right),
			y0: Math.floor(r.top),
			y1: Math.ceil(r.bottom)
		});
	}
	return boxes;
}
