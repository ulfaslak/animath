<script lang="ts">
	/**
	 * The Worlds row's picture, flat and chunky as the animal book's
	 * `BookIcon`: a little globe of the shallows' blue, rimmed in the deep
	 * water's, with three islands of the meadow's grass. Always beside the
	 * row's name, so it is decoration (`aria-hidden`).
	 */
	let { size = 28 }: { size?: number } = $props();
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
	<circle class="sea" cx="16" cy="16" r="13.2" />
	<path
		class="land"
		d="M6.4 10.6c2.6-2.4 6.6-2.2 7.6.2.7 1.7-1.1 2.7-.2 4.4 1 1.8-.4 3.6-2.6 3.4-2.6-.2-3.4-2.4-5.6-2.8-.4-1.9-.2-3.7.8-5.2z"
	/>
	<path
		class="land"
		d="M18.2 4.4c3.6.4 6.8 2.6 8.4 5.6-1.6.6-3.4.2-4.4 1.4-1 1.2-2.8 1-3.4-.6-.5-1.3.6-2.2-.4-3.4-.6-.8-.6-2.2-.2-3z"
	/>
	<path
		class="land"
		d="M18 20.2c1.6-1.4 4.4-1.4 5.8-.2 1.2 1-.2 2.8-1.6 3.8-1.6 1.2-3.6 1.4-4.4.2-.8-1.2-.8-2.8.2-3.8z"
	/>
	<path class="shine" d="M8.2 21.6a9.8 9.8 0 0 0 4.6 4.6" />
</svg>

<style>
	.icon {
		flex: none;
		display: block;
	}
	.sea {
		fill: #5ec8f2;
		stroke: #3f9fdc;
		stroke-width: 2;
	}
	.land {
		fill: #8bd66b;
	}
	.shine {
		fill: none;
		stroke: #fff4e6;
		stroke-width: 1.8;
		stroke-linecap: round;
		opacity: 0.8;
	}
</style>
