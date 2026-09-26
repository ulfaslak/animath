<script lang="ts">
	import type { ItemId } from '@mathgame/engine';

	/**
	 * A picture of a shop item, flat and chunky like the world's props: the
	 * axe, the pickaxe, the boat. Always beside the item's name, so it is
	 * decoration (`aria-hidden`). The colours are the world's own (DESIGN §
	 * Palette): the trees' trunk brown, the rocks' grey, the water's blue, the
	 * trainer's coral.
	 */
	let { id, size = 32 }: { id: ItemId; size?: number } = $props();
</script>

<svg class="item" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
	{#if id === 'axe'}
		<rect
			class="wood"
			x="14.5"
			y="6"
			width="4"
			height="23"
			rx="2"
			transform="rotate(-30 16.5 17.5)"
		/>
		<path class="metal" d="M13.5 4.5 21 3l3.8 6.6-5.6 4.1L15 11Z" />
		<path class="edge" d="M21 3l3.8 6.6-1.6 1.2L19.8 4.2Z" />
	{:else if id === 'pickaxe'}
		<rect class="wood" x="14" y="7" width="4" height="23" rx="2" transform="rotate(20 16 18.5)" />
		<path class="metal" d="M3 11.5C8 5.5 16 3.5 29 6.5 22 6.8 12 8.5 5 13.5Z" />
		<path class="edge" d="M3 11.5 5 13.5 3.8 14.2 2 12.2Z" />
	{:else}
		<path class="water" d="M1 26c3-2 5-2 8 0s5 2 8 0 5-2 8 0 4 2 6 1v4H1Z" />
		<path class="wood" d="M3 20h26l-4 6H7Z" />
		<rect class="mast" x="15" y="4" width="2" height="16" rx="1" />
		<path class="sail" d="M17.5 5 26 17h-8.5Z" />
	{/if}
</svg>

<style>
	.item {
		flex: none;
		display: block;
	}
	.wood {
		fill: #8b5a3c;
	}
	.mast {
		fill: #6e4630;
	}
	.metal {
		fill: #a8a39e;
	}
	.edge {
		fill: #e9e6e2;
	}
	.water {
		fill: #5ec8f2;
	}
	.sail {
		fill: var(--coral);
	}
</style>
