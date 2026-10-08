<script lang="ts" module>
	/**
	 * The marks a bar chart tells its bars apart by, in their order: a
	 * shape and a colour each, so a bar reads without its colour too, and
	 * without a word ([[UI_SPEC]] § Battle mode, "Puzzle pictures").
	 */
	export const BAR_MARKS = [
		{ shape: 'circle', color: '#3d7be8' },
		{ shape: 'triangle', color: '#ff7e6b' },
		{ shape: 'square', color: '#56c271' },
		{ shape: 'star', color: '#f5b83d' },
		{ shape: 'heart', color: '#9b6bd6' }
	] as const;
</script>

<script lang="ts">
	/**
	 * One bar's mark, `size` across, centred on (`x`, `y`) inside an SVG, or
	 * as an inline picture of its own in a line of text (`inline`).
	 */
	let {
		index,
		x = 0,
		y = 0,
		size = 24,
		inline = false
	}: { index: number; x?: number; y?: number; size?: number; inline?: boolean } = $props();

	const mark = $derived(BAR_MARKS[index % BAR_MARKS.length]!);
	const STAR =
		'M0 -11 L3.2 -3.6 L11 -3.4 L5 1.6 L7 9.6 L0 5.2 L-7 9.6 L-5 1.6 L-11 -3.4 L-3.2 -3.6 Z';
	const HEART =
		'M0 9 C-14 0 -10 -11 -4 -9 C-2 -8.5 -0.6 -7 0 -5.5 C0.6 -7 2 -8.5 4 -9 C10 -11 14 0 0 9 Z';
</script>

{#snippet shape()}
	<g transform="translate({x} {y}) scale({size / 24})" fill={mark.color} class="mark">
		{#if mark.shape === 'circle'}
			<circle r="10" />
		{:else if mark.shape === 'triangle'}
			<polygon points="0,-11 11,9 -11,9" />
		{:else if mark.shape === 'square'}
			<rect x="-9.5" y="-9.5" width="19" height="19" rx="2" />
		{:else if mark.shape === 'star'}
			<path d={STAR} />
		{:else}
			<path d={HEART} />
		{/if}
	</g>
{/snippet}

{#if inline}
	<svg class="inline" viewBox="-13 -13 26 26" width="1.25em" height="1.25em" aria-hidden="true">
		{@render shape()}
	</svg>
{:else}
	{@render shape()}
{/if}

<style>
	.mark {
		stroke: var(--panel-ink);
		stroke-width: 1.5;
		stroke-linejoin: round;
	}
	.inline {
		display: inline-block;
		vertical-align: -0.25em;
		margin: 0 0.1em;
	}
</style>
