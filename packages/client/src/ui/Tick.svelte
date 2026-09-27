<script lang="ts">
	/**
	 * A puzzle solved: a green badge with a cream tick, the green of a right
	 * answer. Always beside the number and the word ("312 puzzles"), so it is
	 * decoration (`aria-hidden`), and the count reads without its colour.
	 */
	let { size = 22 }: { size?: number } = $props();
</script>

<svg class="tick" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
	<circle class="face" cx="12" cy="12" r="10.5" />
	<path class="mark" d="M7 12.4 10.4 15.8 17 8.8" />
</svg>

<style>
	.tick {
		flex: none;
		display: block;
	}
	.face {
		fill: var(--good);
		stroke: #3f9d57;
		stroke-width: 1.5;
	}
	.mark {
		fill: none;
		stroke: var(--panel-cream);
		stroke-width: 2.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
