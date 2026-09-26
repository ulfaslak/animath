import { CHUNK_SIZE, WorldEdits, editedChunk, type ChunkRef, type GridPos } from '@mathgame/engine';
import type * as THREE from 'three';
import { buildChunkGroup, disposeChunkGroup } from './tiles';

/** How many chunks the ring reaches out from the player's chunk: 5×5 chunks are drawn. */
export const CHUNK_RADIUS = 2;

/**
 * The world's chunks around the player: the (2·CHUNK_RADIUS + 1)² chunks
 * centred on the player's chunk. A chunk is built when it comes into the ring
 * and freed when it leaves it; walking back over old ground builds it again.
 * Each is built as the player left it (`editedChunk`): a tree they chopped
 * down is a stump, whenever its chunk comes into the ring.
 *
 * Freed means disposed, not only taken out of the scene. three.js keeps the GPU
 * buffers and vertex arrays of a mesh it has drawn for as long as the renderer
 * lives, unless the mesh or its geometry is disposed, so a chunk that was only
 * removed stayed in memory for the rest of the session (#24).
 */
export class ChunkRing {
	private chunks = new Map<string, THREE.Group>();
	private seed = 0;
	private edits = WorldEdits.none;
	/** The chunk the ring was last centred on; `null` until the first update after a reset. */
	private centre: { cx: number; cy: number } | null = null;

	constructor(private parent: THREE.Object3D) {}

	/** Start over in the world of `seed`, as `edits` leave it: every chunk built so far is freed. */
	reset(seed: number, edits: WorldEdits = WorldEdits.none): void {
		this.seed = seed;
		this.edits = edits;
		this.centre = null;
		for (const group of this.chunks.values()) this.free(group);
		this.chunks.clear();
	}

	/** Centre the ring on the chunk holding `pos`: build what is missing, free what fell out. */
	update(pos: GridPos): void {
		const cx = Math.floor(pos.x / CHUNK_SIZE);
		const cy = Math.floor(pos.y / CHUNK_SIZE);
		// Called every frame: nothing to do until the player crosses into another chunk.
		if (this.centre && this.centre.cx === cx && this.centre.cy === cy) return;
		this.centre = { cx, cy };
		const wanted = new Set<string>();
		for (let dy = -CHUNK_RADIUS; dy <= CHUNK_RADIUS; dy++) {
			for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
				const key = `${cx + dx},${cy + dy}`;
				wanted.add(key);
				if (!this.chunks.has(key)) this.build(cx + dx, cy + dy);
			}
		}
		for (const [key, group] of this.chunks) {
			if (!wanted.has(key)) {
				this.free(group);
				this.chunks.delete(key);
			}
		}
	}

	/**
	 * The player cleared a tile (or tiles grew back): from now on the world is
	 * as `edits` leave it. Of `changed`, the chunks the ring holds are built
	 * again, one by one, and nothing else is touched.
	 */
	setEdits(edits: WorldEdits, changed: readonly ChunkRef[]): void {
		this.edits = edits;
		for (const { cx, cy } of changed) {
			const old = this.chunks.get(`${cx},${cy}`);
			if (!old) continue;
			this.free(old);
			this.build(cx, cy);
		}
	}

	/** How many chunks are built right now. */
	get size(): number {
		return this.chunks.size;
	}

	private build(cx: number, cy: number): void {
		const group = buildChunkGroup(editedChunk(this.seed, this.edits, cx, cy));
		this.chunks.set(`${cx},${cy}`, group);
		this.parent.add(group);
	}

	private free(group: THREE.Group): void {
		this.parent.remove(group);
		disposeChunkGroup(group);
	}
}
