<script lang="ts">
	/**
	 * The animal book's picture, flat and chunky in the world's own colours,
	 * as the shop's `ItemIcon` and the moves' `MoveIcon` are: a book bound in
	 * the trainer's blue, its spine the trainer's darker blue, its pages
	 * cream, and a cream paw print on the cover. Always beside the book's
	 * name, so it is decoration (`aria-hidden`).
	 */
	let { size = 28 }: { size?: number } = $props();
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
	<rect class="pages" x="8" y="5" width="20" height="24" rx="2.5" />
	<rect class="cover" x="4" y="3" width="21" height="24" rx="3" />
	<rect class="spine" x="4" y="3" width="5" height="24" rx="2.5" />
	<ellipse class="paw" cx="17" cy="18.6" rx="4.2" ry="3.4" />
	<circle class="paw" cx="12.4" cy="13.6" r="1.7" />
	<circle class="paw" cx="15.2" cy="10.8" r="1.7" />
	<circle class="paw" cx="18.8" cy="10.8" r="1.7" />
	<circle class="paw" cx="21.6" cy="13.6" r="1.7" />
</svg>

<style>
	.icon {
		flex: none;
		display: block;
	}
	.pages {
		fill: #fff4e6;
		stroke: #2f4fa8;
		stroke-width: 1.2;
	}
	.cover {
		fill: var(--blue);
	}
	.spine {
		fill: #2f4fa8;
	}
	.paw {
		fill: #fff4e6;
	}
</style>
