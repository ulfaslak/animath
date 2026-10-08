<script lang="ts">
	import { MAX_BAR_LINES } from '@mathgame/engine';
	import BarMark, { BAR_MARKS } from './BarMark.svelte';

	/**
	 * A bar chart for a `barchart` puzzle ([[UI_SPEC]] § Battle mode, "Puzzle
	 * pictures"): how many fish each one caught, a bar each, with its mark
	 * (`BarMark`) under it and lines across every `scale`, each line numbered.
	 * A bar may end halfway between two lines; nothing else is written on it.
	 */
	let { numbers }: { numbers: readonly number[] } = $props();

	const scale = $derived(numbers[1] ?? 1);
	const bars = $derived(numbers[4] ?? 0);
	const values = $derived(numbers.slice(5, 5 + bars));
	/** The lines across: up to the tallest bar's, and at least 5. */
	const lines = $derived(
		Math.min(MAX_BAR_LINES, Math.max(5, Math.ceil(Math.max(...values, 0) / scale)))
	);

	const LEFT = 44;
	const RIGHT = 290;
	const TOP = 12;
	const BOTTOM = 214;
	const step = $derived((BOTTOM - TOP) / lines);
	/** Every line numbered while they are far enough apart for the numbers (up to 8 lines); else every other. */
	const every = $derived(step >= 24 ? 1 : 2);
	const slot = $derived((RIGHT - LEFT) / Math.max(1, bars));
	function y(v: number): number {
		return BOTTOM - (v / scale) * step;
	}
</script>

<svg viewBox="0 0 300 250" class="picture" aria-hidden="true">
	{#each Array.from({ length: lines + 1 }, (_, k) => k) as k (k)}
		<line x1={LEFT} x2={RIGHT} y1={BOTTOM - k * step} y2={BOTTOM - k * step} class="line" />
		{#if k % every === 0}
			<text x={LEFT - 8} y={BOTTOM - k * step} class="number" class:odd={k % 2 === 1}
				>{k * scale}</text
			>
		{/if}
	{/each}
	{#each values as value, i (i)}
		<rect
			x={LEFT + i * slot + slot * 0.2}
			y={y(value)}
			width={slot * 0.6}
			height={BOTTOM - y(value)}
			rx="3"
			class="bar"
			fill={BAR_MARKS[i % BAR_MARKS.length]!.color}
		/>
		<BarMark index={i} x={LEFT + (i + 0.5) * slot} y={BOTTOM + 20} size={26} />
	{/each}
	<line x1={LEFT} x2={LEFT} y1={TOP - 4} y2={BOTTOM} class="axis" />
	<line x1={LEFT} x2={RIGHT} y1={BOTTOM} y2={BOTTOM} class="axis" />
</svg>

<style>
	.picture {
		width: 100%;
		height: 100%;
	}
	.line {
		stroke: rgba(45, 42, 50, 0.25);
		stroke-width: 1.5;
	}
	.axis {
		stroke: var(--panel-ink);
		stroke-width: 2.5;
	}
	.number {
		font-weight: 800;
		font-size: 22px;
		text-anchor: end;
		dominant-baseline: central;
		fill: var(--panel-ink);
	}
	/* A phone held sideways draws the chart small: bigger numbers, every other line's. */
	@media (max-height: 560px) {
		.number {
			font-size: 32px;
		}
		.number.odd {
			display: none;
		}
	}
	.bar {
		stroke: var(--panel-ink);
		stroke-width: 1.5;
		fill-opacity: 0.85;
	}
</style>
