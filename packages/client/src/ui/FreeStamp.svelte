<script lang="ts">
	/**
	 * A kind set free at the druid's: a rose badge with a cream heart,
	 * the heart of the druid's thank-you. In the animal book, on a
	 * card's corner and beside the count of kinds set free; always beside
	 * words or a card's caption, so it is decoration (`aria-hidden`).
	 */
	let { size = 22 }: { size?: number } = $props();
</script>

<svg class="free" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
	<circle class="face" cx="12" cy="12" r="10.5" />
	<path
		class="heart"
		d="M12 17.6 7.2 12.9a2.9 2.9 0 0 1 4.1-4.1l.7.7.7-.7a2.9 2.9 0 0 1 4.1 4.1Z"
	/>
</svg>

<style>
	.free {
		flex: none;
		display: block;
	}
	.face {
		fill: #f27a9b;
		stroke: #d0587b;
		stroke-width: 1.5;
	}
	.heart {
		fill: var(--panel-cream);
	}
</style>
