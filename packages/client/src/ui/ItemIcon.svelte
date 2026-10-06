<script lang="ts">
	import type { ItemId } from '@mathgame/engine';

	/**
	 * A picture of a shop item, flat and chunky like the world's props: the
	 * axe, the pickaxe, the boat, the paraglider, the harness. Always beside the item's
	 * name, so it is decoration (`aria-hidden`). The colours are the world's
	 * own (DESIGN § Palette): the trees' trunk brown, the rocks' grey, the
	 * water's blue, the trainer's coral, the figures' cream.
	 */
	let { id, size = 32 }: { id: ItemId; size?: number } = $props();

	/**
	 * The paraglider's wing: five cells round an arch, outer edge first, each
	 * a four-cornered piece, coral at the ends and in the middle, cream between.
	 */
	const WING_OUTER = [
		[1.3, 13.5],
		[6, 8.3],
		[12.5, 5.4],
		[19.5, 5.4],
		[26, 8.3],
		[30.7, 13.5]
	];
	const WING_INNER = [
		[5.6, 16],
		[9, 12.3],
		[13.5, 10.3],
		[18.5, 10.3],
		[23, 12.3],
		[26.4, 16]
	];
	const cells = [0, 1, 2, 3, 4].map((i) =>
		[WING_OUTER[i], WING_OUTER[i + 1], WING_INNER[i + 1], WING_INNER[i]]
			.map((p) => p!.join(','))
			.join(' ')
	);
	const outline = [...WING_OUTER, ...[...WING_INNER].reverse()].map((p) => p.join(',')).join(' ');
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
	{:else if id === 'boat'}
		<path class="water" d="M1 26c3-2 5-2 8 0s5 2 8 0 5-2 8 0 4 2 6 1v4H1Z" />
		<path class="wood" d="M3 20h26l-4 6H7Z" />
		<rect class="mast" x="15" y="4" width="2" height="16" rx="1" />
		<path class="sail" d="M17.5 5 26 17h-8.5Z" />
	{:else if id === 'harness'}
		<!-- A saddle from the side: its coral blanket, the seat with a horn in front, a stirrup. -->
		<path class="sail" d="M3 15h26v5.5c0 1.8-1.2 3-3 3H6c-1.8 0-3-1.2-3-3Z" />
		<path
			class="wood"
			d="M4 16c0-4.5 2.5-7 5.5-6.5 2.5 2.3 8.5 2.3 11 0 1.2-2.8 3.3-4.5 5.3-4 1.6.4 2.2 2.2 1.2 3.7-1.4 2-1.9 4.3-1.4 6.8Z"
		/>
		<path class="lines" d="M15 17v7.5" />
		<path class="metal" d="M11.5 24.5h7l-1.2 5h-4.6Z" />
	{:else}
		<!-- The lines from the wing down to the harness, then the wing's cells over them. -->
		<path
			class="lines"
			d="M5.6 16 14.5 26.5M13.5 10.3 15 26.5M18.5 10.3 17 26.5M26.4 16 17.5 26.5"
		/>
		{#each cells as cell, i (i)}
			<polygon class={i % 2 === 0 ? 'sail' : 'cream'} points={cell} />
		{/each}
		<polygon class="wing-edge" points={outline} />
		<rect class="sail" x="13" y="26" width="6" height="4.5" rx="1.6" />
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
	.cream {
		fill: #fff4e6;
	}
	/* An edge round the whole wing, so its cream cells read on the cream card. */
	.wing-edge {
		fill: none;
		stroke: var(--coral);
		stroke-width: 1;
		stroke-linejoin: round;
	}
	.lines {
		fill: none;
		stroke: #2f2a28;
		stroke-width: 0.9;
		stroke-linecap: round;
	}
</style>
