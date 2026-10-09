import {
	CHUNK_SIZE,
	WorldEdits,
	editedChunk,
	editedTileAt,
	type ChunkRef,
	type GridPos
} from '@mathgame/engine';
import type * as THREE from 'three';
import type { Druid } from './doctor';
import {
	awaitsGlow,
	buildChunkGroup,
	campfiresReaching,
	disposeChunkGroup,
	doctorsIn,
	glowSteps,
	type WorldTiles
} from './tiles';

/** How many chunks the ring reaches out from the player's chunk: 5×5 chunks are drawn. */
export const CHUNK_RADIUS = 2;

/**
 * How many chunks out from the player's the ring is built at once when it
 * lacks them: the 3×3 round the player, which hold everything on screen (the
 * view reaches at most 15.4 tiles from the player on a 16:9 screen, and they
 * reach 16 past the player's chunk).
 */
export const SHOWN_RADIUS = 1;

/** How long the ring's work may go on in one frame, in ms, once it has done one piece. */
const FRAME_BUDGET_MS = 4;

/**
 * A piece of the ring's work for a later frame: build a chunk at its edge,
 * or paint its tent's glow, a step a frame (`steps`, for the chunk `group`).
 */
interface Job {
	cx: number;
	cy: number;
	glow: boolean;
	group?: THREE.Group;
	steps?: Generator<void>;
}

/**
 * The world's chunks around the player: the (2·CHUNK_RADIUS + 1)² chunks
 * centred on the player's chunk. A chunk is built when it comes into the ring
 * and freed when it leaves it; walking back over old ground builds it again.
 * Each is built as the player left it (`editedChunk`): a tree they chopped
 * down is a stump, whenever its chunk comes into the ring.
 *
 * The chunks on screen (`SHOWN_RADIUS`) are built at once. The ring's edge,
 * which the screen never shows, is built a piece a frame (`work`): a step
 * across a chunk's border brings five chunks into the ring, and building
 * them and painting their campfires' glow in the one frame stood the game
 * still for a tenth of a second on a slow tablet (#150).
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
	/** Work for later frames, in order. */
	private jobs: Job[] = [];

	/** `budgetMs`: how long `work` may go on past its first piece (tests pass 0: one piece a call). */
	constructor(
		private parent: THREE.Object3D,
		private budgetMs = FRAME_BUDGET_MS
	) {}

	/** Start over in the world of `seed`, as `edits` leave it: every chunk built so far is freed. */
	reset(seed: number, edits: WorldEdits = WorldEdits.none): void {
		this.seed = seed;
		this.edits = edits;
		this.centre = null;
		this.jobs = [];
		for (const group of this.chunks.values()) this.free(group);
		this.chunks.clear();
	}

	/**
	 * Centre the ring on the chunk holding `pos`: free what fell out, build what
	 * the screen shows now, and leave the rest of the ring to `work`.
	 */
	update(pos: GridPos): void {
		const cx = Math.floor(pos.x / CHUNK_SIZE);
		const cy = Math.floor(pos.y / CHUNK_SIZE);
		// Called every frame: nothing to do until the player crosses into another chunk.
		if (this.centre && this.centre.cx === cx && this.centre.cy === cy) return;
		this.centre = { cx, cy };
		for (const [key, group] of this.chunks) {
			const [x, y] = key.split(',').map(Number) as [number, number];
			if (this.reach(x, y) > CHUNK_RADIUS) {
				this.free(group);
				this.chunks.delete(key);
			}
		}
		// Work for a chunk that left the ring before its turn is dropped.
		this.jobs = this.jobs.filter((job) => this.reach(job.cx, job.cy) <= CHUNK_RADIUS);
		for (let dy = -CHUNK_RADIUS; dy <= CHUNK_RADIUS; dy++) {
			for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
				const [x, y] = [cx + dx, cy + dy];
				if (this.chunks.has(`${x},${y}`)) continue;
				if (this.reach(x, y) <= SHOWN_RADIUS) this.build(x, y, true);
				else if (!this.jobs.some((job) => job.cx === x && job.cy === y)) {
					this.jobs.push({ cx: x, cy: y, glow: false });
				}
			}
		}
	}

	/**
	 * A frame's share of the work left (the renderer calls it once a frame):
	 * one piece, then more while `budgetMs` lasts, but never a chunk after
	 * another piece. A piece builds one chunk of the ring's edge, or paints a
	 * step of the glow of the tent in one (`glowSteps`: the ground round the
	 * fire, then its props two dozen at a time).
	 */
	work(): void {
		const start = performance.now();
		for (let job = this.jobs.shift(), first = true; job; job = this.jobs.shift(), first = false) {
			const key = `${job.cx},${job.cy}`;
			// A chunk is the biggest piece: never after another in the same frame.
			if (!job.glow && !first && !this.chunks.has(key)) {
				this.jobs.unshift(job);
				return;
			}
			if (job.glow) {
				const group = this.chunks.get(key);
				// A chunk built again meanwhile (a tree chopped) was painted whole then.
				if (group && (!job.group || job.group === group)) {
					job.group = group;
					job.steps ??= glowSteps(group, this.world());
					if (!job.steps.next().done) this.jobs.unshift(job);
				}
			} else if (!this.chunks.has(key)) {
				const group = this.build(job.cx, job.cy, false);
				if (awaitsGlow(group)) this.jobs.unshift({ cx: job.cx, cy: job.cy, glow: true });
			}
			if (performance.now() - start >= this.budgetMs) return;
		}
	}

	/** All the work left, at once. */
	finish(): void {
		while (this.jobs.length > 0) this.work();
	}

	/** How many pieces of work are left for later frames. */
	get pending(): number {
		return this.jobs.length;
	}

	/**
	 * The player cleared a tile (or tiles grew back): from now on the world is
	 * as `edits` leave it. Of `changed`, the chunks the ring holds are built
	 * again, one by one, at once, and so is a chunk next door whose tent's
	 * campfire reaches into one of them, since its glow is painted on what
	 * stood there (a tree chopped would leave its glow in the air). Nothing
	 * else is touched.
	 */
	setEdits(edits: WorldEdits, changed: readonly ChunkRef[]): void {
		this.edits = edits;
		const again = new Map<string, ChunkRef>();
		for (const ref of changed) {
			again.set(`${ref.cx},${ref.cy}`, ref);
			const [x0, y0] = [ref.cx * CHUNK_SIZE, ref.cy * CHUNK_SIZE];
			const [x1, y1] = [x0 + CHUNK_SIZE - 1, y0 + CHUNK_SIZE - 1];
			for (const camp of campfiresReaching(this.seed, x0, y0, x1, y1)) {
				again.set(`${camp.cx},${camp.cy}`, camp);
			}
		}
		for (const { cx, cy } of again.values()) {
			const old = this.chunks.get(`${cx},${cy}`);
			if (!old) continue;
			this.free(old);
			this.build(cx, cy, true);
		}
	}

	/** How many chunks are built right now. */
	get size(): number {
		return this.chunks.size;
	}

	/** Each druid at a tent in the chunks built: the renderer animates them every frame. */
	forEachDoctor(visit: (doctor: Druid) => void): void {
		for (const group of this.chunks.values()) for (const d of doctorsIn(group)) visit(d);
	}

	/** How many chunks from the centre chunk `(cx, cy)` is, across or along. */
	private reach(cx: number, cy: number): number {
		const centre = this.centre!;
		return Math.max(Math.abs(cx - centre.cx), Math.abs(cy - centre.cy));
	}

	/** The world as the player left it: what a campfire's glow reaches in the chunks round its own. */
	private world(): WorldTiles {
		const { seed, edits } = this;
		return (x, y) => editedTileAt(seed, edits, x, y);
	}

	private build(cx: number, cy: number, glow: boolean): THREE.Group {
		const group = buildChunkGroup(editedChunk(this.seed, this.edits, cx, cy), this.world(), glow);
		this.chunks.set(`${cx},${cy}`, group);
		this.parent.add(group);
		return group;
	}

	private free(group: THREE.Group): void {
		this.parent.remove(group);
		disposeChunkGroup(group);
	}
}
