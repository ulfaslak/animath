<script lang="ts">
	import type { AttackLevel } from '@mathgame/engine';

	/**
	 * The hit badge: a little starburst and the damage a hit does, wherever
	 * the screen says what an attack is worth — its tile, each button of the
	 * level picker, the preview card, "Correct!". A harder level's badge is
	 * bigger and hotter (amber, orange, coral), so a hard hit looks heavier
	 * than an easy one; the number is always printed, so it reads without
	 * colour. It only shows a number the engine gave (`attackDamage`,
	 * `landHit`) and decides nothing, so any screen that has one can show it.
	 * `big` is the preview card's.
	 */
	let {
		damage,
		level,
		big = false
	}: { damage: number; level: AttackLevel; big?: boolean } = $props();
</script>

<span class="badge l{level}" class:big>
	<svg class="star" viewBox="0 0 24 24" aria-hidden="true">
		<polygon
			points="12 0.5 14.2 5.2 18.8 2.7 17.8 7.8 22.9 8.4 19.2 12 22.9 15.6 17.8 16.2 18.8 21.3 14.2 18.8 12 23.5 9.8 18.8 5.2 21.3 6.2 16.2 1.1 15.6 4.8 12 1.1 8.4 6.2 7.8 5.2 2.7 9.8 5.2"
		/>
	</svg>
	<span class="n">{damage}</span>
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		flex: none;
		font-weight: 800;
		font-size: var(--size);
		line-height: 1;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	/* Heavier with the level: bigger, and from amber through orange to coral. */
	.l1 {
		--size: 16px;
		--fill: var(--warn);
	}
	.l2 {
		--size: 19px;
		--fill: var(--accent);
	}
	.l3 {
		--size: 22px;
		--fill: var(--coral);
	}
	.big.l1 {
		--size: 22px;
	}
	.big.l2 {
		--size: 26px;
	}
	.big.l3 {
		--size: 30px;
	}
	.star {
		width: 1.3em;
		height: 1.3em;
		flex: none;
	}
	/* Big, the number carries the size; the star stays about as tall as the words beside it. */
	.big .star {
		width: 1.1em;
		height: 1.1em;
	}
	.star polygon {
		fill: var(--fill);
		stroke: var(--panel-ink);
		stroke-opacity: 0.55;
		stroke-width: 1.4;
		stroke-linejoin: round;
	}
</style>
