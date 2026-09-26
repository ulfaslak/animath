import { generateChunk, tileAtWorld } from './generate.js';
import { CHUNK_SIZE, type Chunk, type ClearableKind, type GridPos, type Tile } from './types.js';

/**
 * World edits: the tiles a player has cleared with a tool, trees chopped
 * down with the axe and rocks broken with the pickaxe ([[PRODUCT]] §4
 * "World"). An overlay on the seeded world, which stays a pure function of
 * its seed: `editedTileAt(seed, edits, x, y)` is the world as this player
 * has left it.
 *
 * An edit only ever turns a tree or a rock into plain ground (`grass`, with
 * `cleared` saying what stood there). A position whose seeded tile is
 * anything else stays exactly as it is whatever the overlay holds, so no
 * edit can make water, a tent or tall grass walkable, or change it at all.
 * Who comes out of the grass never reads the overlay: encounter tables and
 * the ground round a tall-grass tile are the seeded world's ([[DECISIONS]]
 * § Gameplay).
 *
 * It is authority state, saved with the game (`SavedGame.edits`) in a compact
 * text form: one entry per chunk, `"cx,cy:"` and the cleared tiles' indices
 * in the chunk (`y * 16 + x`) as two hex digits each, ascending, the entries
 * sorted by `cy`, then `cx`. The same tiles always give the same text, so two
 * saves with the same edits compare equal (`sameProgress`). The text is kept
 * within `EDITS_BUDGET` characters: past it the chunks farthest from the
 * player grow back (`trimmedAround`), so a save stays small however much a
 * kid chops.
 *
 * Immutable: every change returns a new overlay and leaves this one as it was.
 */

/** A chunk, by its coordinates. */
export interface ChunkRef {
	cx: number;
	cy: number;
}

/**
 * The most characters the overlay's text may take in a save, as JSON. Room
 * for thousands of cleared tiles as a kid clears them (paths and clearings:
 * a chunk with 20 cleared tiles is about 50 characters), and far more than
 * the 25 chunks round the player can ever take (`MAX_ENTRY_LENGTH` each), so
 * trimming never reaches a chunk on screen.
 */
export const EDITS_BUDGET = 24_000;

/** Tiles in a chunk. */
const TILES = CHUNK_SIZE * CHUNK_SIZE;
/** 32-bit words in a chunk's mask: one bit per tile. */
const WORDS = TILES / 32;

/** An entry of the text form: the chunk's coordinates and its tiles' indices in hex. */
const ENTRY = /^(-?\d{1,16}),(-?\d{1,16}):((?:[0-9a-f]{2})+)$/;

/**
 * The longest entry the text form can hold: every tile of a chunk cleared,
 * at the largest chunk coordinates a save can hold, with its quotes and comma.
 */
export const MAX_ENTRY_LENGTH =
	2 * String(-Math.floor(Number.MAX_SAFE_INTEGER / CHUNK_SIZE)).length + 2 + 2 * TILES + 3;

const keyOf = (cx: number, cy: number): string => `${cx},${cy}`;

/** Whether chunk coordinate `c` keeps every tile of the chunk a safe integer. */
function isChunkCoordinate(c: number): boolean {
	return (
		Number.isSafeInteger(c) &&
		Number.isSafeInteger(c * CHUNK_SIZE) &&
		Number.isSafeInteger(c * CHUNK_SIZE + CHUNK_SIZE - 1)
	);
}

/** The chunk a tile is in, and the tile's index in it. */
function locate(x: number, y: number): { cx: number; cy: number; index: number } {
	const cx = Math.floor(x / CHUNK_SIZE);
	const cy = Math.floor(y / CHUNK_SIZE);
	return { cx, cy, index: (y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE) };
}

function isSet(mask: Uint32Array, index: number): boolean {
	return ((mask[index >>> 5]! >>> (index & 31)) & 1) === 1;
}

function countOf(mask: Uint32Array): number {
	let n = 0;
	for (let i = 0; i < TILES; i++) if (isSet(mask, i)) n++;
	return n;
}

/** One chunk's entry in the text form. */
function entryOf(cx: number, cy: number, mask: Uint32Array): string {
	let hex = '';
	for (let i = 0; i < TILES; i++) if (isSet(mask, i)) hex += i.toString(16).padStart(2, '0');
	return `${cx},${cy}:${hex}`;
}

/**
 * Whether a value is the text form of an overlay: a list of entries, each
 * `"cx,cy:"` and at least one tile index in two hex digits, of a chunk whose
 * tiles all have safe-integer coordinates. Order and repeats don't matter.
 */
export function isEditsText(value: unknown): value is string[] {
	if (!Array.isArray(value)) return false;
	for (const entry of value as unknown[]) {
		const match = typeof entry === 'string' ? ENTRY.exec(entry) : null;
		if (!match) return false;
		if (!isChunkCoordinate(Number(match[1])) || !isChunkCoordinate(Number(match[2]))) return false;
	}
	return true;
}

export class WorldEdits {
	/** The overlay with nothing cleared: a new game's. */
	static readonly none = new WorldEdits(new Map(), 0);

	/** The text form, once worked out: the overlay never changes, so neither does it. */
	#text: readonly string[] | null = null;
	#textLength = -1;

	private constructor(
		/**
		 * The cleared tiles, by chunk (`"cx,cy"`): a mask with one bit per tile,
		 * `index = y * 16 + x` within the chunk. Read-only: never write to it.
		 */
		readonly chunks: ReadonlyMap<string, Uint32Array>,
		/** How many tiles are cleared. */
		readonly size: number
	) {}

	/**
	 * The overlay a text form describes (`encode`'s, or a save's). Entries may
	 * come in any order and repeat a chunk or a tile; the overlay is the same.
	 * Throws on anything else: check untrusted values with `isEditsText` first.
	 */
	static decode(text: readonly string[]): WorldEdits {
		if (!isEditsText(text)) throw new Error('WorldEdits.decode: that is not an overlay as text');
		if (text.length === 0) return WorldEdits.none;
		const chunks = new Map<string, Uint32Array>();
		for (const entry of text) {
			const [, x, y, hex] = ENTRY.exec(entry)!;
			// `+ 0` turns a "-0" into 0, so every chunk has one key.
			const key = keyOf(Number(x) + 0, Number(y) + 0);
			let mask = chunks.get(key);
			if (!mask) chunks.set(key, (mask = new Uint32Array(WORDS)));
			for (let i = 0; i < hex!.length; i += 2) {
				const index = parseInt(hex!.slice(i, i + 2), 16);
				mask[index >>> 5]! |= 1 << (index & 31);
			}
		}
		let size = 0;
		for (const mask of chunks.values()) size += countOf(mask);
		return new WorldEdits(chunks, size);
	}

	/** Whether tile (x, y) is cleared. */
	has(x: number, y: number): boolean {
		if (this.size === 0) return false;
		const { cx, cy, index } = locate(x, y);
		const mask = this.chunks.get(keyOf(cx, cy));
		return mask !== undefined && isSet(mask, index);
	}

	/** The indices (`y * 16 + x` in the chunk) of chunk (cx, cy)'s cleared tiles, ascending. */
	inChunk(cx: number, cy: number): number[] {
		const mask = this.chunks.get(keyOf(cx, cy));
		if (!mask) return [];
		const out: number[] = [];
		for (let i = 0; i < TILES; i++) if (isSet(mask, i)) out.push(i);
		return out;
	}

	/** The overlay with tile `pos` cleared too: this one when it already is. */
	with(pos: GridPos): WorldEdits {
		if (!Number.isSafeInteger(pos.x) || !Number.isSafeInteger(pos.y)) {
			throw new Error(`WorldEdits.with: ${pos.x},${pos.y} is not a tile`);
		}
		if (this.has(pos.x, pos.y)) return this;
		const { cx, cy, index } = locate(pos.x, pos.y);
		if (!isChunkCoordinate(cx) || !isChunkCoordinate(cy)) {
			throw new Error(`WorldEdits.with: ${pos.x},${pos.y} is too far out to save`);
		}
		const key = keyOf(cx, cy);
		const old = this.chunks.get(key);
		const mask = old ? new Uint32Array(old) : new Uint32Array(WORDS);
		mask[index >>> 5]! |= 1 << (index & 31);
		const chunks = new Map(this.chunks);
		chunks.set(key, mask);
		return new WorldEdits(chunks, this.size + 1);
	}

	/** The overlay without anything cleared in `gone`: those chunks grow back as the seed made them. */
	without(gone: readonly ChunkRef[]): WorldEdits {
		const keys = gone.map((c) => keyOf(c.cx, c.cy)).filter((k) => this.chunks.has(k));
		if (keys.length === 0) return this;
		const chunks = new Map(this.chunks);
		let size = this.size;
		for (const key of keys) {
			const mask = chunks.get(key);
			if (!mask) continue;
			size -= countOf(mask);
			chunks.delete(key);
		}
		return size === 0 ? WorldEdits.none : new WorldEdits(chunks, size);
	}

	/**
	 * The overlay within `EDITS_BUDGET`, and the chunks that grew back to get
	 * there: whole chunks, farthest from the chunk `near` is in first (ties:
	 * the one further down, then further right). The chunks round `near` are
	 * the last to go, and with the budget as it is never go at all.
	 */
	trimmedAround(near: GridPos): { edits: WorldEdits; regrown: ChunkRef[] } {
		if (this.textLength <= EDITS_BUDGET) return { edits: this, regrown: [] };
		const home = locate(near.x, near.y);
		const far = [...this.chunks.entries()]
			.map(([key, mask]) => {
				const [cx, cy] = key.split(',').map(Number) as [number, number];
				const distance = (cx - home.cx) ** 2 + (cy - home.cy) ** 2;
				return { cx, cy, distance, length: entryOf(cx, cy, mask).length + 3 };
			})
			.sort((a, b) => b.distance - a.distance || b.cy - a.cy || b.cx - a.cx);
		const regrown: ChunkRef[] = [];
		let length = this.textLength;
		for (const chunk of far) {
			if (length <= EDITS_BUDGET) break;
			regrown.push({ cx: chunk.cx, cy: chunk.cy });
			length -= chunk.length;
		}
		return { edits: this.without(regrown), regrown };
	}

	/**
	 * The text form, as saved: canonical, so the same tiles always give the
	 * same text. Shared and read-only: copy it before changing it.
	 */
	encode(): readonly string[] {
		if (this.#text) return this.#text;
		const entries = [...this.chunks.entries()]
			.map(([key, mask]) => {
				const [cx, cy] = key.split(',').map(Number) as [number, number];
				return { cx, cy, mask };
			})
			.sort((a, b) => a.cy - b.cy || a.cx - b.cx)
			.map((c) => entryOf(c.cx, c.cy, c.mask));
		this.#text = Object.freeze(entries);
		return this.#text;
	}

	/** How many characters the text form takes as JSON. */
	get textLength(): number {
		if (this.#textLength < 0) this.#textLength = JSON.stringify(this.encode()).length;
		return this.#textLength;
	}
}

/**
 * A tile as a cleared tile is: plain ground where a tree or a rock stood, the
 * same biome and height, and `cleared` saying what stood there. Any other tile
 * comes back as it is: an edit never touches it.
 */
export function clearedTile(tile: Tile): Tile {
	if (tile.kind !== 'tree' && tile.kind !== 'rock') return tile;
	const was: ClearableKind = tile.kind;
	return { kind: 'grass', biome: tile.biome, height: tile.height, cleared: was };
}

/** The tile at (x, y) in the world of `seed`, as `edits` leave it. */
export function editedTileAt(seed: number, edits: WorldEdits, x: number, y: number): Tile {
	const tile = tileAtWorld(seed, x, y);
	return edits.has(x, y) ? clearedTile(tile) : tile;
}

/** Chunk (cx, cy) of the world of `seed`, as `edits` leave it: `generateChunk`, edited. */
export function editedChunk(seed: number, edits: WorldEdits, cx: number, cy: number): Chunk {
	const chunk = generateChunk(seed, cx, cy);
	for (const index of edits.inChunk(cx, cy)) {
		chunk.tiles[index] = clearedTile(chunk.tiles[index]!);
	}
	return chunk;
}
