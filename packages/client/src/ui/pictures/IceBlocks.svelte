<script lang="ts">
	import { BLOCKS } from '@mathgame/engine';
	import { t } from '../../copy';

	/**
	 * A stack of ice blocks for a `blocks` puzzle ([[UI_SPEC]] § Battle mode,
	 * "Puzzle pictures"), as a schoolbook draws one: the front face square on,
	 * the top and the right side going back at a slant, every block's edges
	 * drawn on all three, so a kid counts the blocks along each side. The
	 * world's ice blocks' colours ([[DESIGN]]), the top palest. A box whose
	 * layers are asked shows its bottom layer, its four corners going on up in
	 * lines that fade away, marked "?": no top, no layer and nothing to count
	 * is drawn above the bottom one, so how high it is cannot be read off the
	 * picture.
	 */
	let { numbers }: { numbers: readonly number[] } = $props();
	/** Each fading line's gradient is named apart from another picture's on the page. */
	const uid = $props.id();

	const high = $derived(numbers[0] === BLOCKS.high);
	const l = $derived(Math.max(1, numbers[1] ?? 1));
	const w = $derived(Math.max(1, numbers[2] ?? 1));
	/** The layers drawn solid: the bottom one alone when its layers are asked. */
	const h = $derived(high ? 1 : Math.max(1, numbers[3] ?? 1));
	/** The room a box whose layers are asked has above its bottom layer, in layers, whatever the answer. */
	const ROOM = 3;
	const tall = $derived(high ? ROOM : h);
	/** How far its corners' lines rise, in layers, fading to nothing: they never reach a top. */
	const RISE = 1.9;

	const BOX = { w: 300, h: 200 };
	/** Room round the stack, and on the left for the "?" beside a box whose layers are asked. */
	const PAD = 10;
	const ASK = 46;
	/**
	 * One block back, on the page: right and up, the depth drawn shorter than
	 * a side, as a schoolbook does. A row or a flat layer is seen more from
	 * above, so its rows stand apart and it fills the picture.
	 */
	const BACK = $derived(!high && h === 1 ? { x: 0.45, y: 0.8 } : { x: 0.45, y: 0.5 });
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
	function point(x: number, y: number, z: number): { x: number; y: number } {
		return { x: x0 + cell * (x + y * BACK.x), y: y0 - cell * (z + y * BACK.y) };
	}
	function at(x: number, y: number, z: number): string {
		const p = point(x, y, z);
		return `${p.x},${p.y}`;
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
	/** The layers asked: each corner of the bottom layer going on up, fading as it goes. */
	const rising = $derived(
		high
			? (
					[
						[0, 0],
						[l, 0],
						[l, w],
						[0, w]
					] as const
				).map(([x, y]) => ({ from: point(x, y, h), to: point(x, y, h + RISE) }))
			: []
	);
	const ask = $derived({ x: x0 - ASK / 2, y: y0 - (cell * tall) / 2 });
</script>

<svg viewBox="0 0 {BOX.w} {BOX.h}" class="picture" aria-hidden="true">
	<path d={front} class="front" />
	<path d={side} class="side" />
	<path d={top} class="top" />
	<path d={edges} class="edge" />
	<path d={front} class="outline" />
	<path d={side} class="outline" />
	<path d={top} class="outline" />
	{#if high}
		<defs>
			{#each rising as line, k (k)}
				<linearGradient
					id="{uid}-rise-{k}"
					gradientUnits="userSpaceOnUse"
					x1={line.from.x}
					y1={line.from.y}
					x2={line.to.x}
					y2={line.to.y}
				>
					<stop offset="0" class="rise-start" />
					<stop offset="1" class="rise-end" />
				</linearGradient>
			{/each}
		</defs>
		{#each rising as line, k (k)}
			<line
				x1={line.from.x}
				y1={line.from.y}
				x2={line.to.x}
				y2={line.to.y}
				stroke="url(#{uid}-rise-{k})"
				class="rising"
			/>
		{/each}
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
		fill: #6ab4dd;
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
	.rising {
		stroke-width: 3;
	}
	.rise-start {
		stop-color: #2f7fb3;
	}
	.rise-end {
		stop-color: #2f7fb3;
		stop-opacity: 0;
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
	/* A phone held sideways draws the stack small: a bigger "?", as a floor's numbers are. */
	@media (max-height: 560px) {
		.mark {
			font-size: 34px;
		}
	}
</style>
