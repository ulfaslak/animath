import type { Rect } from './presence/labels';

/**
 * The pieces of the explore screen that the marks at the edge of the screen
 * keep clear of ([[UI_SPEC]] § Explore mode, "The corners"): the party
 * column and a stack's open card, the top right's pills, the coordinates,
 * the message line and the Challenge button, the note about who came or
 * went while it shows, and the touch controls. Each piece takes `keepClear`
 * as an attachment (`{@attach keepClear}`), so it counts while it is on
 * screen and no longer; `clearBoxes` measures them where they stand now,
 * for the track the marks ride (`presence/edges.ts`). A new piece of the
 * explore HUD takes it too, or a friend's arrow can hide under it.
 */
const pieces = new Set<Element>();

/** Keep the marks at the edge of the screen clear of this element while it is on screen. */
export function keepClear(node: Element): () => void {
	pieces.add(node);
	return () => pieces.delete(node);
}

/** The boxes of the pieces on screen now, in CSS pixels: none outside a browser, and none for a piece with nothing in it. */
export function clearBoxes(): Rect[] {
	const boxes: Rect[] = [];
	for (const node of pieces) {
		const r = node.getBoundingClientRect();
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
