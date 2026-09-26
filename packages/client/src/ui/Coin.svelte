<script lang="ts">
	/**
	 * A token: a gold coin with a cream heart, the doctor's thank-you. Always
	 * beside the number and the word, so it is decoration (`aria-hidden`), and
	 * a token reads without its colour.
	 */
	let { size = 22 }: { size?: number } = $props();
</script>

<svg class="coin" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
	<circle class="face" cx="12" cy="12" r="10.5" />
	<circle class="inner" cx="12" cy="12" r="7.5" />
	<path
		class="heart"
		d="M12 17.2 7.6 12.9a2.7 2.7 0 0 1 3.8-3.8l.6.6.6-.6a2.7 2.7 0 0 1 3.8 3.8Z"
	/>
</svg>

<style>
	.coin {
		flex: none;
		display: block;
	}
	.face {
		fill: var(--warn);
		stroke: #c98a12;
		stroke-width: 1.5;
	}
	.inner {
		fill: none;
		stroke: #fbd67a;
		stroke-width: 1.2;
	}
	.heart {
		fill: var(--panel-cream);
	}
</style>
