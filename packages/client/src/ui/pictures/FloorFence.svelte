<script lang="ts">
	import { SHAPE } from '@mathgame/engine';
	import { t } from '../../copy';

	/**
	 * A floor or a fence for a `shape` puzzle ([[UI_SPEC]] § Battle mode,
	 * "Puzzle pictures"). Area is always the floor: wooden tiles inside the
	 * shape. Perimeter is always the fence: grass inside, a brown fence with
	 * posts all the way round. So the two never look alike. A shape in squares
	 * shows every tile (and every fence piece between two posts); without
	 * them, each side has its length written beside it. A side missing is
	 * marked "?", and that picture keeps the same shape whatever the answer,
	 * so it gives nothing away.
	 */
	let { numbers }: { numbers: readonly number[] } = $props();

	const how = $derived(numbers[0] ?? 0);
	const fence = $derived(how === SHAPE.fence || how === SHAPE.fenceSide);
	const missing = $derived(how === SHAPE.floorSide || how === SHAPE.fenceSide);
	/** The shape in tiles: a side missing is drawn 3 by 2, its bottom labelled and its left a "?". */
	const w = $derived(missing ? 3 : (numbers[1] ?? 1));
	const h = $derived(missing ? 2 : (numbers[2] ?? 1));
	const cw = $derived(missing ? 0 : (numbers[3] ?? 0));
	const ch = $derived(missing ? 0 : (numbers[4] ?? 0));
	const grid = $derived(!missing && numbers[5] === 1);

	const BOX = { w: 250, h: 160 };
	/** Room round the shape for the sides' numbers. */
	const PAD = 34;
	const cell = $derived(Math.min(BOX.w / w, BOX.h / h));
	const left = $derived(PAD + (BOX.w - w * cell) / 2);
	const top = $derived(PAD + (BOX.h - h * cell) / 2);

	function px(x: number): number {
		return left + x * cell;
	}
	function py(y: number): number {
		return top + y * cell;
	}

	/** The outline, clockwise from the top left; an L has its top right corner cut away. */
	const outline = $derived(
		cw > 0 && ch > 0
			? [
					[0, 0],
					[w - cw, 0],
					[w - cw, ch],
					[w, ch],
					[w, h],
					[0, h]
				]
			: [
					[0, 0],
					[w, 0],
					[w, h],
					[0, h]
				]
	);
	const path = $derived(
		// SVG path data: M, then L to each corner, Z to close.
		`M${outline.map(([x, y]) => `${px(x!)},${py(y!)}`).join('L')}Z`
	);
	const inside = (x: number, y: number) => !(x >= w - cw && y < ch);

	/** Each side, with where its length goes: just outside its middle. */
	const sides = $derived(
		outline.map(([x1, y1], i) => {
			const [x2, y2] = outline[(i + 1) % outline.length]!;
			const length = Math.abs(x2! - x1!) + Math.abs(y2! - y1!);
			const mx = (px(x1!) + px(x2!)) / 2;
			const my = (py(y1!) + py(y2!)) / 2;
			// Outward from a clockwise outline: to the left of the way it runs.
			const dx = Math.sign(x2! - x1!);
			const dy = Math.sign(y2! - y1!);
			return { length, x: mx + dy * 18, y: my - dx * 16, vertical: dx === 0 };
		})
	);
	/** The fence's posts: at every tile's corner in squares, else at the shape's corners only. */
	const posts = $derived.by(() => {
		const out: [number, number][] = [];
		outline.forEach(([x1, y1], i) => {
			const [x2, y2] = outline[(i + 1) % outline.length]!;
			const length = Math.abs(x2! - x1!) + Math.abs(y2! - y1!);
			// Without squares, posts only at the corners: posts between them would be counted as pieces.
			const steps = grid ? length : 1;
			for (let k = 0; k < steps; k++) {
				out.push([px(x1! + ((x2! - x1!) * k) / steps), py(y1! + ((y2! - y1!) * k) / steps)]);
			}
		});
		return out;
	});
</script>

<svg viewBox="0 0 {BOX.w + 2 * PAD} {BOX.h + 2 * PAD}" class="picture" aria-hidden="true">
	<path d={path} class="area" class:floor={!fence} class:grass={fence} />
	{#if grid}
		{#each Array.from({ length: w * h }, (_, k) => k) as k (k)}
			{#if inside(k % w, Math.floor(k / w))}
				<rect
					x={px(k % w)}
					y={py(Math.floor(k / w))}
					width={cell}
					height={cell}
					class="tile"
					class:floor={!fence}
				/>
			{/if}
		{/each}
	{/if}
	{#if fence}
		<path d={path} class="rail" />
		{#each posts as [x, y], i (i)}
			<rect x={x - 4} y={y - 4} width="8" height="8" rx="2" class="post" />
		{/each}
	{:else}
		<path d={path} class="edge" />
	{/if}
	{#if !grid}
		{#each sides as side, i (i)}
			{#if missing && i === 3}
				<!-- The left side, the one asked for. -->
				<circle cx={side.x - 4} cy={side.y} r="20" class="asked" />
				<text x={side.x - 4} y={side.y} class="length">{t('puzzle.picture.missing')}</text>
			{:else if !missing || i === 2}
				<text x={side.x} y={side.y} class="length" class:side={side.vertical}
					>{missing ? (numbers[1] ?? 0) : side.length}</text
				>
			{/if}
		{/each}
	{/if}
</svg>

<style>
	.picture {
		width: 100%;
		height: 100%;
	}
	.area.floor {
		fill: #e8c48f;
	}
	.area.grass {
		fill: #8bd66b;
	}
	.tile {
		fill: none;
		stroke: rgba(45, 42, 50, 0.35);
		stroke-width: 1.5;
	}
	.tile.floor {
		stroke: #b8864e;
	}
	.edge {
		fill: none;
		stroke: #8b5a3c;
		stroke-width: 3;
	}
	.rail {
		fill: none;
		stroke: #8b5a3c;
		stroke-width: 5;
		stroke-linejoin: round;
	}
	.post {
		fill: #6e4630;
	}
	.length {
		font-weight: 800;
		font-size: 24px;
		text-anchor: middle;
		dominant-baseline: central;
		fill: var(--panel-ink);
	}
	/* A phone held sideways draws the shape small: bigger numbers. */
	@media (max-height: 560px) {
		.length {
			font-size: 34px;
		}
	}
	.asked {
		fill: var(--accent);
	}
</style>
