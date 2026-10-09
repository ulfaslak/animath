import { hasItem, type ItemId } from '../items/catalog.js';
import { landOfSeed, type LandId } from '../lands/ids.js';
import { editedTileAt, type ChunkRef, type WorldEdits } from './edits.js';
import { step, type ClearableKind, type Direction, type GridPos, type TileKind } from './types.js';

/**
 * Clearing a tile with a tool ([[PRODUCT]] §4 "World", "The Arctic's shop"):
 * the axe chops down a tree, the pickaxe breaks a rock, and the tile is plain
 * ground from then on; in The Arctic its own axe chops down a spruce, and the
 * ice pick breaks an ice block, which leaves what it stood on (snow, a
 * fishing hole in the ice, or water: `world/edits.ts`). The player stands
 * next to the tile and faces it, as they face a tent to talk to the doctor;
 * `interact` does it. Or they come down on a tree or a rock from the glider
 * (`clearLanding`, `world/flight.ts`); never on an ice block, which is never
 * a landing tile. Nothing else can be cleared: not tall grass, sand, water or
 * a tent, and not a tile already cleared.
 */

/**
 * The tool each kind of tile takes, land by land: a tree takes the land's own
 * axe (Nordland's `axe`, The Arctic's `arctic-axe`, which looks different), a
 * rock the pickaxe and an ice block the ice pick wherever they stand. A tool
 * a land's druid does not sell (the pickaxe in The Arctic) is never
 * owned there, so that land's rocks stay.
 */
const CLEARING_TOOLS: Readonly<Record<LandId, Readonly<Record<ClearableKind, ItemId>>>> = {
	nordland: { tree: 'axe', rock: 'pickaxe', iceblock: 'ice-pick' },
	arctic: { tree: 'arctic-axe', rock: 'pickaxe', iceblock: 'ice-pick' }
};

/** The tool a tile of kind `kind` takes in the world of `seed` (its land: `landOfSeed`). */
export function clearingTool(seed: number, kind: ClearableKind): ItemId {
	return CLEARING_TOOLS[landOfSeed(seed)][kind];
}

export function isClearable(kind: TileKind): kind is ClearableKind {
	return kind === 'tree' || kind === 'rock' || kind === 'iceblock';
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
	return isClearable(kind) ? { pos: front, kind, tool: clearingTool(seed, kind) } : null;
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
 * next to the player that they face, a tree, a rock or an ice block not yet
 * cleared, and the player must own its tool. Then the overlay gains the tile, and, when
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
	return clearAt(seed, edits, player, front, pos);
}

/**
 * Clear the tile a glide comes down on (`world/flight.ts`), for `player`
 * standing on it: the one other way a tile is cleared. The same rule as
 * `clearTile` but for where the player is: a tree or a rock not yet cleared,
 * and its tool owned; the save is trimmed round the landing tile. Anything
 * else (an ice block too, which no glide comes down on) is a refusal that
 * changes nothing.
 */
export function clearLanding(
	seed: number,
	edits: WorldEdits,
	player: Pick<Clearer, 'pos' | 'items'>
): ClearStep {
	const { pos } = player;
	if (!Number.isSafeInteger(pos?.x) || !Number.isSafeInteger(pos?.y)) {
		return { ok: false, reason: 'nothing-to-clear' };
	}
	if (editedTileAt(seed, edits, pos.x, pos.y).kind === 'iceblock') {
		return { ok: false, reason: 'nothing-to-clear' };
	}
	return clearAt(seed, edits, player, pos, pos);
}

/**
 * The tile at `at` cleared with its tool, the save trimmed round `around`
 * (where the player stands): a tree, a rock or an ice block, in the world as
 * `edits` leave it, whose tool the player owns; else why not.
 */
function clearAt(
	seed: number,
	edits: WorldEdits,
	player: { readonly items: readonly string[] },
	at: GridPos,
	around: GridPos
): ClearStep {
	const { kind } = editedTileAt(seed, edits, at.x, at.y);
	if (!isClearable(kind)) return { ok: false, reason: 'nothing-to-clear' };
	const tool = clearingTool(seed, kind);
	if (!hasItem(player, tool)) return { ok: false, reason: 'needs-tool', kind, tool };
	const { edits: kept, regrown } = edits.with(at).trimmedAround(around);
	return {
		ok: true,
		edits: kept,
		cleared: { pos: { x: at.x, y: at.y }, was: kind, tool, regrown }
	};
}
