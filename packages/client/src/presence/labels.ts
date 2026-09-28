/**
 * The words over the world, laid out so none covers another ([[UI_SPEC]] §
 * Explore mode, "Battles seen from outside"; #141): each player's label (the
 * name, and over it the busy bubble or the thought cloud) and the tag over
 * each animal in the battles on screen (its kind and its small HP bar). Each
 * is an anchor, where it belongs on the screen, and the boxes the page
 * measured round it. Two rules, in this order:
 *
 * - **Tags make room for each other.** Two tags that would touch move apart
 *   the shorter way: sideways, half each, for two animals side by side (as a
 *   match stands them); else the upper one up, off the other's animal.
 * - **Labels rise over what they would cover.** A player's label, the lowest
 *   on the screen first, goes up until it clears every tag and every label
 *   already placed. It never moves sideways, so a name stays over its
 *   player, and it never pushes a tag: an animal's HP bar, whose end is what
 *   moves when it is hit, is never under a name, however tall the animal.
 *
 * Pure and deterministic: the same boxes give the same offsets, so nothing
 * moves between two frames where nothing did.
 */

/** A box in CSS pixels (`y` grows down the screen): round a mark's anchor, or on the screen. */
export interface Rect {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

/** A label or a tag: its anchor on the screen, and the boxes it takes round it (a box over the anchor has `y1 <= 0`). */
export interface Mark {
	key: string;
	x: number;
	y: number;
	parts: readonly Rect[];
}

/** How far a mark moves from its anchor. */
export interface Offset {
	dx: number;
	dy: number;
}

/** The least room between two marks, in CSS pixels. */
export const MARK_GAP = 4;
/** How much of its own width a thought cloud leans off the name, away from the battle (`Others.svelte`). */
export const THOUGHT_LEAN = 0.32;
/** Passes over the tags: two animals a battle and six battles at most settle in far fewer. */
const TAG_PASSES = 12;

/** Where each mark goes: the offset from its anchor of every label and tag that has to move. */
export function unclutter(
	labels: readonly Mark[],
	tags: readonly Mark[],
	gap: number = MARK_GAP
): Map<string, Offset> {
	const offsets = new Map<string, Offset>();
	const at = (mark: Mark): Offset => offsets.get(mark.key) ?? { dx: 0, dy: 0 };
	/** A tag's box on the screen, where it is now. */
	const box = (tag: Mark): Rect => onScreen(bounds(tag.parts), tag, at(tag));

	// Tags side by side, in a fixed order, so the same scene always settles the same way:
	// each of two goes half the way apart, when that is shorter than one going over the other.
	const order = tags.filter((tag) => tag.parts.length > 0).sort(byPlace);
	for (let pass = 0; pass < TAG_PASSES; pass++) {
		let moved = false;
		for (let i = 0; i < order.length; i++) {
			for (let j = i + 1; j < order.length; j++) {
				const a = order[i]!;
				const b = order[j]!;
				const p = box(a);
				const q = box(b);
				if (!touching(p, q, gap)) continue;
				const pLeft = p.x0 + p.x1 < q.x0 + q.x1 || (p.x0 + p.x1 === q.x0 + q.x1 && a.key < b.key);
				const across = pLeft ? p.x1 + gap - q.x0 : q.x1 + gap - p.x0;
				const over = Math.min(p.y1 + gap - q.y0, q.y1 + gap - p.y0);
				if (across / 2 > over) continue;
				moved = true;
				const half = across / 2;
				const oa = at(a);
				const ob = at(b);
				offsets.set(a.key, { dx: oa.dx + (pLeft ? -half : half), dy: oa.dy });
				offsets.set(b.key, { dx: ob.dx + (pLeft ? half : -half), dy: ob.dy });
			}
		}
		if (!moved) break;
	}

	// Then everything, the lowest on the screen first, each rising over what it would cover:
	// a tag still on another (one animal behind the other) over it, and every label.
	const placed: Rect[] = [];
	const rise = (mark: Mark, dx: number, dy: number): number => {
		for (let step = 0; step < 256; step++) {
			let need = dy;
			for (const part of mark.parts) {
				const mine = onScreen(part, mark, { dx, dy });
				for (const other of placed) {
					// Up until this part's bottom clears the other's top.
					if (touching(mine, other, gap))
						need = Math.min(need, other.y0 - gap - (mark.y + part.y1));
				}
			}
			if (need === dy) break;
			dy = need;
		}
		for (const part of mark.parts) placed.push(onScreen(part, mark, { dx, dy }));
		return dy;
	};
	for (const tag of [...order].sort(byDepth)) {
		const { dx, dy } = at(tag);
		const risen = rise({ ...tag, parts: [bounds(tag.parts)] }, dx, dy);
		if (risen !== dy) offsets.set(tag.key, { dx, dy: risen });
	}
	for (const label of [...labels].sort(byDepth)) {
		const dy = rise(label, 0, 0);
		if (dy !== 0) offsets.set(label.key, { dx: 0, dy });
	}
	return offsets;
}

/** The box round all of a mark's boxes. */
function bounds(parts: readonly Rect[]): Rect {
	return {
		x0: Math.min(...parts.map((p) => p.x0)),
		x1: Math.max(...parts.map((p) => p.x1)),
		y0: Math.min(...parts.map((p) => p.y0)),
		y1: Math.max(...parts.map((p) => p.y1))
	};
}

/** A box round a mark's anchor, on the screen, the mark moved by `offset`. */
function onScreen(part: Rect, mark: Mark, offset: Offset): Rect {
	return {
		x0: mark.x + offset.dx + part.x0,
		x1: mark.x + offset.dx + part.x1,
		y0: mark.y + offset.dy + part.y0,
		y1: mark.y + offset.dy + part.y1
	};
}

/** Whether two boxes come closer than `gap` to each other. */
function touching(a: Rect, b: Rect, gap: number): boolean {
	return a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
}

/** Left to right, then top to bottom, then by key. */
function byPlace(a: Mark, b: Mark): number {
	return a.x - b.x || a.y - b.y || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** The lowest on the screen first (the nearest the camera), then left to right, then by key. */
function byDepth(a: Mark, b: Mark): number {
	return b.y - a.y || a.x - b.x || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
