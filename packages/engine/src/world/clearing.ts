import { hasItem, type ItemId } from '../items/catalog.js';
import { editedTileAt, type ChunkRef, type WorldEdits } from './edits.js';
import { step, type ClearableKind, type Direction, type GridPos, type TileKind } from './types.js';

/**
 * Clearing a tile with a tool ([[PRODUCT]] §4 "World"): the axe chops down a
 * tree, the pickaxe breaks a rock, and the tile is plain ground from then on
 * (`world/edits.ts`). The player stands next to the tile and faces it, as
 * they face a tent to talk to the doctor; `interact` does it. Nothing else can
 * be cleared: not tall grass, sand, water or a tent, and not a tile already
 * cleared.
 */

/** The tool each kind of tile takes. */
export const CLEARING_TOOL: Readonly<Record<ClearableKind, ItemId>> = {
	tree: 'axe',
	rock: 'pickaxe'
};

export function isClearable(kind: TileKind): kind is ClearableKind {
	return kind === 'tree' || kind === 'rock';
}

/** A tile a tool could clear: where it is, what it is, and the tool it takes. */
export interface Clearable {
	pos: GridPos;
	kind: ClearableKind;
	tool: ItemId;
}

/**
 * What stands in front of a player at `pos` facing `facing` that a tool could
 * clear, owned or not; null for anything else. The one check behind the
 * "Press Enter to chop the tree" prompt and the hint that the doctor sells a
 * tool; `clearTile` decides the same way.
 */
export function clearableAhead(
	seed: number,
	edits: WorldEdits,
	pos: GridPos,
	facing: Direction
): Clearable | null {
	const front = step(pos, facing);
	const { kind } = editedTileAt(seed, edits, front.x, front.y);
	return isClearable(kind) ? { pos: front, kind, tool: CLEARING_TOOL[kind] } : null;
}

/**
 * Why a clear was refused, as a code: `target` is not a tile next to the
 * player (`not-adjacent`), or not the one they face (`not-facing`); nothing
 * there can be cleared (`nothing-to-clear`); or the player does not own the
 * tool it takes (`needs-tool`, which names it).
 */
export type ClearRejection = 'not-adjacent' | 'not-facing' | 'nothing-to-clear' | 'needs-tool';

/** A tile cleared: where, what stood there, the tool, and the chunks that grew back to keep the save small. */
export interface Cleared {
	pos: GridPos;
	was: ClearableKind;
	tool: ItemId;
	regrown: ChunkRef[];
}

export type ClearStep =
	| { ok: true; edits: WorldEdits; cleared: Cleared }
	/** Refused. With `needs-tool`, what stands there and the tool it takes. */
	| { ok: false; reason: ClearRejection; kind?: ClearableKind; tool?: ItemId };

/** The player as a clear needs them: where they stand, which way they face, what they own. */
export interface Clearer {
	readonly pos: GridPos;
	readonly facing: Direction;
	readonly items: readonly string[];
}

/**
 * Clear `target` for `player` in the world of `seed` as `edits` leave it:
 * the whole rule, checked here and nowhere else. `target` must be the tile
 * next to the player that they face, a tree or a rock not yet cleared, and
 * the player must own its tool. Then the overlay gains the tile, and, when
 * that takes the save past `EDITS_BUDGET`, the chunks farthest from the
 * player grow back (`WorldEdits.trimmedAround`). Pure: `edits` is left as it
 * was, and a refusal changes nothing.
 */
export function clearTile(
	seed: number,
	edits: WorldEdits,
	player: Clearer,
	target: GridPos
): ClearStep {
	const { pos, facing } = player;
	const whole = Number.isSafeInteger(target?.x) && Number.isSafeInteger(target?.y);
	if (!whole || Math.abs(target.x - pos.x) + Math.abs(target.y - pos.y) !== 1) {
		return { ok: false, reason: 'not-adjacent' };
	}
	const front = step(pos, facing);
	if (front.x !== target.x || front.y !== target.y) return { ok: false, reason: 'not-facing' };
	const ahead = clearableAhead(seed, edits, pos, facing);
	if (!ahead) return { ok: false, reason: 'nothing-to-clear' };
	if (!hasItem(player, ahead.tool)) {
		return { ok: false, reason: 'needs-tool', kind: ahead.kind, tool: ahead.tool };
	}
	const { edits: kept, regrown } = edits.with(ahead.pos).trimmedAround(pos);
	return {
		ok: true,
		edits: kept,
		cleared: { pos: { ...ahead.pos }, was: ahead.kind, tool: ahead.tool, regrown }
	};
}
