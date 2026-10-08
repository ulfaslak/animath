<script lang="ts">
	import type { CurrencyId } from '@mathgame/engine';
	import { currencyOf } from '../money';

	/**
	 * A coin of the land's money, beside the number and the word, so it is
	 * decoration (`aria-hidden`), and reads without its colour. Nordland's
	 * token: a gold coin with a cream heart, the witch doctor's thank-you. The
	 * Arctic's ice dollar: a six-sided coin of pale ice blue with a white
	 * snowflake, another shape as well as another colour (#191: "it looks
	 * different on screen"). The land on screen's by default.
	 */
	let { size = 22, currency }: { size?: number; currency?: CurrencyId } = $props();
	const kind = $derived(currency ?? currencyOf());

	/** A hexagon round (12, 12), point up, of radius `r`, as SVG points. */
	const hexagon = (r: number) =>
		[0, 1, 2, 3, 4, 5]
			.map((i) => {
				const a = (Math.PI / 3) * i - Math.PI / 2;
				return `${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`;
			})
			.join(' ');
</script>

<svg class="coin" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
	{#if kind === 'ice-dollars'}
		<polygon class="ice-face" points={hexagon(11)} />
		<polygon class="ice-inner" points={hexagon(7.6)} />
		<!-- A snowflake: three strokes through the middle, each with a little V at both ends. -->
		<g class="flake">
			{#each [0, 60, 120] as turn (turn)}
				<g transform="rotate({turn} 12 12)">
					<path d="M12 6.4V17.6M10.4 7.6 12 9l1.6-1.4M10.4 16.4 12 15l1.6 1.4" />
				</g>
			{/each}
		</g>
	{:else}
		<circle class="face" cx="12" cy="12" r="10.5" />
		<circle class="inner" cx="12" cy="12" r="7.5" />
		<path
			class="heart"
			d="M12 17.2 7.6 12.9a2.7 2.7 0 0 1 3.8-3.8l.6.6.6-.6a2.7 2.7 0 0 1 3.8 3.8Z"
		/>
	{/if}
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
	.ice-face {
		fill: #9fdcf5;
		stroke: #2f7fb3;
		stroke-width: 1.5;
		stroke-linejoin: round;
	}
	.ice-inner {
		fill: none;
		stroke: #e6f7ff;
		stroke-width: 1;
		stroke-linejoin: round;
	}
	.flake {
		fill: none;
		stroke: #ffffff;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
