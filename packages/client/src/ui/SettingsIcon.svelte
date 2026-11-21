<script lang="ts">
	/**
	 * Settings' picture, flat and chunky as the animal book's `BookIcon`: a
	 * cog of eight teeth in the trainer's blue, a cream hole in its middle.
	 * Always beside the row's name, so it is decoration (`aria-hidden`).
	 */
	let { size = 28 }: { size?: number } = $props();

	/** The teeth, each a rounded bar through the middle: four bars make eight teeth. */
	const TEETH = [0, 45, 90, 135];
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
	<g class="cog">
		{#each TEETH as angle (angle)}
			<rect x="13" y="2.5" width="6" height="27" rx="2" transform="rotate({angle} 16 16)" />
		{/each}
		<circle cx="16" cy="16" r="10" />
	</g>
	<circle class="hole" cx="16" cy="16" r="4.2" />
</svg>

<style>
	.icon {
		flex: none;
		display: block;
	}
	.cog {
		fill: var(--blue);
	}
	.hole {
		fill: #fff4e6;
	}
</style>
