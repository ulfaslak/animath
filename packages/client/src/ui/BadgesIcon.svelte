<script lang="ts">
	/**
	 * "My badges"' picture on the pause menu's title line, flat and chunky as
	 * the animal book's is: a gold medal standing on a point, as every badge's
	 * medal does (`BadgeMedal`), its face lighter, and a star on it in the
	 * medal's darker gold. Always beside the page's name, so it is decoration
	 * (`aria-hidden`).
	 */
	let { size = 28 }: { size?: number } = $props();
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
	<polygon class="rim" points="16,2.2 28,9.1 28,22.9 16,29.8 4,22.9 4,9.1" />
	<polygon class="face" points="16,4.9 25.6,10.5 25.6,21.5 16,27.1 6.4,21.5 6.4,10.5" />
	<path
		class="star"
		d="M16 10.5 17.5 14.4 21.7 14.7 18.5 17.3 19.5 21.4 16 19.1 12.5 21.4 13.5 17.3 10.3 14.7 14.5 14.4Z"
	/>
</svg>

<style>
	.icon {
		flex: none;
		display: block;
	}
	.rim {
		fill: #f0b43c;
		stroke: #c98a12;
		stroke-width: 1.2;
		stroke-linejoin: round;
	}
	.face {
		fill: #fbd67a;
	}
	.star {
		fill: #c98a12;
	}
</style>
