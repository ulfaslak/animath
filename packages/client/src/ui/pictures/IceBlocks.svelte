<script lang="ts">
	import { BLOCKS } from '@mathgame/engine';
	import { t } from '../../copy';

	/**
	 * A stack of ice blocks for a `blocks` puzzle ([[UI_SPEC]] § Battle mode,
	 * "Puzzle pictures"), as a schoolbook draws one: the front face square on,
	 * the top and the right side going back at a slant, every block's edges
	 * drawn on all three, so a kid counts the blocks along each side. The
	 * world's ice blocks' colours ([[DESIGN]]), the top palest. A box whose
	 * layers are asked shows its bottom layer, and over it a dashed outline of
	 * the rest marked "?", always as tall, so it gives nothing away.
	 */
	let { numbers }: { numbers: readonly number[] } = $props();

	const high = $derived(numbers[0] === BLOCKS.high);
	const l = $derived(Math.max(1, numbers[1] ?? 1));
	const w = $derived(Math.max(1, numbers[2] ?? 1));
	/** The layers drawn solid: the bottom one alone when its layers are asked. */
	const h = $derived(high ? 1 : Math.max(1, numbers[3] ?? 1));
	/** How tall the outline of the layers asked is drawn, in layers, whatever the answer. */
	const GHOST = 3;
	const tall = $derived(high ? GHOST : h);

	const BOX = { w: 300, h: 200 };
	/** Room round the stack, and on the left for the "?" beside a box whose layers are asked. */
	const PAD = 10;
	const ASK = 46;
	/** One block back, on the page: right and up, the depth drawn shorter than a side, as a schoolbook does. */
	const BACK = { x: 0.45, y: 0.5 };
	/** A row of two is not drawn bigger than a hand of blocks would be. */
	const MAX_CELL = 44;

	const left = $derived(PAD + (high ? ASK : 0));
	const cell = $derived(
		Math.min(
			MAX_CELL,
			(BOX.w - left - PAD) / (l + w * BACK.x),
			(BOX.h - 2 * PAD) / (tall + w * BACK.y)
		)
	);
	/** The front bottom left corner, the stack centred in the room it has. */
	const x0 = $derived(left + (BOX.w - left - PAD - cell * (l + w * BACK.x)) / 2);
	const y0 = $derived(BOX.h - PAD - (BOX.h - 2 * PAD - cell * (tall + w * BACK.y)) / 2);

	/** A point of the stack, `x` along, `y` back and `z` up, in blocks, on the page. */
	function at(x: number, y: number, z: number): string {
		return `${x0 + cell * (x + y * BACK.x)},${y0 - cell * (z + y * BACK.y)}`;
	}
	function face(...corners: [number, number, number][]): string {
		return `M${corners.map((c) => at(...c)).join('L')}Z`;
	}
	function lines(pairs: [number, number, number][][]): string {
		return pairs.map(([a, b]) => `M${at(...a!)}L${at(...b!)}`).join('');
	}
	const steps = (n: number) => Array.from({ length: Math.max(0, n - 1) }, (_, k) => k + 1);

	const front = $derived(face([0, 0, 0], [l, 0, 0], [l, 0, h], [0, 0, h]));
	const top = $derived(face([0, 0, h], [l, 0, h], [l, w, h], [0, w, h]));
	const side = $derived(face([l, 0, 0], [l, w, 0], [l, w, h], [l, 0, h]));
	/** Every block's edges on the three faces a kid sees. */
	const edges = $derived(
		lines([
			...steps(l).map((x): [number, number, number][] => [
				[x, 0, 0],
				[x, 0, h]
			]),
			...steps(h).map((z): [number, number, number][] => [
				[0, 0, z],
				[l, 0, z]
			]),
			...steps(l).map((x): [number, number, number][] => [
				[x, 0, h],
				[x, w, h]
			]),
			...steps(w).map((y): [number, number, number][] => [
				[0, y, h],
				[l, y, h]
			]),
			...steps(w).map((y): [number, number, number][] => [
				[l, y, 0],
				[l, y, h]
			]),
			...steps(h).map((z): [number, number, number][] => [
				[l, 0, z],
				[l, w, z]
			])
		])
	);
	/** The rest of a box whose layers are asked: its outline over the bottom layer, no layers in it. */
	const ghost = $derived(
		lines([
			[
				[0, 0, h],
				[0, 0, tall]
			],
			[
				[l, 0, h],
				[l, 0, tall]
			],
			[
				[l, w, h],
				[l, w, tall]
			],
			[
				[0, 0, tall],
				[l, 0, tall]
			],
			[
				[l, 0, tall],
				[l, w, tall]
			],
			[
				[l, w, tall],
				[0, w, tall]
			],
			[
				[0, w, tall],
				[0, 0, tall]
			]
		])
	);
	const ask = $derived({ x: x0 - ASK / 2, y: y0 - (cell * tall) / 2 });
</script>

<svg viewBox="0 0 {BOX.w} {BOX.h}" class="picture" aria-hidden="true">
	{#if high}
		<path
			d={face([0, 0, h], [l, 0, h], [l, w, h], [l, w, tall], [0, w, tall], [0, 0, tall])}
			class="room"
		/>
	{/if}
	<path d={front} class="front" />
	<path d={side} class="side" />
	<path d={top} class="top" />
	<path d={edges} class="edge" />
	<path d={front} class="outline" />
	<path d={side} class="outline" />
	<path d={top} class="outline" />
	{#if high}
		<path d={ghost} class="ghost" />
		<circle cx={ask.x} cy={ask.y} r="20" class="asked" />
		<text x={ask.x} y={ask.y} class="mark">{t('puzzle.picture.missing')}</text>
	{/if}
</svg>

<style>
	.picture {
		width: 100%;
		height: 100%;
	}
	.top {
		fill: #e3f6fd;
	}
	.front {
		fill: #9fd8f2;
	}
	.side {
		fill: #7cc4e6;
	}
	.edge {
		fill: none;
		stroke: #2f7fb3;
		stroke-width: 1.5;
		stroke-linecap: round;
	}
	.outline {
		fill: none;
		stroke: #2f7fb3;
		stroke-width: 3;
		stroke-linejoin: round;
	}
	.room {
		fill: rgba(227, 246, 253, 0.45);
	}
	.ghost {
		fill: none;
		stroke: #2f7fb3;
		stroke-width: 2.5;
		stroke-dasharray: 7 6;
		stroke-linecap: round;
	}
	.asked {
		fill: var(--accent);
	}
	.mark {
		font-weight: 800;
		font-size: 24px;
		text-anchor: middle;
		dominant-baseline: central;
		fill: var(--panel-ink);
	}
</style>
