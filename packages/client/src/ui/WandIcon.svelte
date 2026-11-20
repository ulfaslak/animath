<script lang="ts">
	/**
	 * The hint's picture: a magic wand in the druid's purple, a gold star on
	 * its tip and two little sparkles, flat as the moves' pictures
	 * (`MoveIcon`). On the Hint button beside its word, and before the hint
	 * itself, so the two read as one thing; decoration (`aria-hidden`).
	 */
	let { size = 24 }: { size?: number } = $props();
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
	<path class="stick" d="M5 27 17.5 14.5" />
	<path class="tip" d="M15.6 16.4 17.5 14.5" />
	<path
		class="star"
		d="M23 2 24.76 6.57 29.66 6.84 25.85 9.93 27.11 14.66 23 12 18.89 14.66 20.15 9.93 16.34 6.84 21.24 6.57Z"
	/>
	<path class="spark" d="M8 4.5 9 8 12.5 9 9 10 8 13.5 7 10 3.5 9 7 8Z" />
	<path
		class="spark"
		d="M27 19.5 27.7 21.8 30 22.5 27.7 23.2 27 25.5 26.3 23.2 24 22.5 26.3 21.8Z"
	/>
</svg>

<style>
	.icon {
		flex: none;
		display: block;
	}
	.stick,
	.tip {
		fill: none;
		stroke-width: 3.6;
		stroke-linecap: round;
	}
	.stick {
		stroke: #8a5fd0;
	}
	.tip {
		stroke: #fff4e6;
	}
	.star {
		fill: var(--warn);
		stroke: #c98a12;
		stroke-width: 1.2;
		stroke-linejoin: round;
	}
	.spark {
		fill: var(--warn);
	}
</style>
