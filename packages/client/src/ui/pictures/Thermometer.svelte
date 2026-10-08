<script lang="ts">
	import { THERMOMETER } from '@mathgame/engine';
	import { signed } from '../../puzzle-words';

	/**
	 * A thermometer for a `thermometer` puzzle ([[UI_SPEC]] § Battle mode,
	 * "Puzzle pictures"): a tube from −R to R degrees, 0 marked, the red
	 * column up to the temperature it starts at. Getting colder or warmer is
	 * an arrow beside it, its change written on it and never how far it
	 * reaches (that is the sum); between two temperatures, the second is a
	 * marker of its own. Drawn from the face's numbers alone.
	 */
	let { numbers }: { numbers: readonly number[] } = $props();

	const how = $derived(numbers[0] ?? 0);
	const start = $derived(numbers[1] ?? 0);
	const other = $derived(numbers[2] ?? 0);
	const turn = $derived(how === THERMOMETER.colder || how === THERMOMETER.warmer);
	/** How far the scale reaches either side of 0: a ten past every temperature in the question. */
	const reach = $derived(
		Math.max(
			10,
			10 *
				Math.ceil(
					(turn ? Math.abs(start) + other : Math.max(Math.abs(start), Math.abs(other))) / 10
				)
		)
	);
	/** A tick every degree up to 20, every two beyond; a number every 5 up to 10, every 10 beyond. */
	const minor = $derived(reach <= 20 ? 1 : 2);
	const label = $derived(reach <= 10 ? 5 : 10);

	const TOP = 14;
	const BOTTOM = 182;
	const TUBE_X = 58;
	function y(t: number): number {
		return BOTTOM - ((t + reach) / (2 * reach)) * (BOTTOM - TOP);
	}
	const ticks = $derived(
		Array.from({ length: (2 * reach) / minor + 1 }, (_, i) => -reach + i * minor)
	);
	const down = $derived(how === THERMOMETER.colder);
</script>

<svg viewBox="0 0 180 220" class="picture" aria-hidden="true">
	<!-- Cold below 0 and warm above it, faintly. -->
	<rect x={TUBE_X - 14} y={y(0)} width="28" height={y(-reach) - y(0)} rx="4" class="cold" />
	<rect x={TUBE_X - 14} y={y(reach)} width="28" height={y(0) - y(reach)} rx="4" class="warm" />
	<!-- The tube and its bulb. -->
	<rect x={TUBE_X - 7} y={TOP - 6} width="14" height={BOTTOM - TOP + 12} rx="7" class="glass" />
	<circle cx={TUBE_X} cy={BOTTOM + 18} r="15" class="glass" />
	<circle cx={TUBE_X} cy={BOTTOM + 18} r="11" class="mercury" />
	<rect x={TUBE_X - 4} y={y(start)} width="8" height={BOTTOM + 14 - y(start)} class="mercury" />
	{#each ticks as tick (tick)}
		<line
			x1={TUBE_X + 8}
			x2={TUBE_X + (tick % label === 0 ? 20 : 14)}
			y1={y(tick)}
			y2={y(tick)}
			class="tick"
			class:zero={tick === 0}
		/>
		{#if tick % label === 0}
			<text x={TUBE_X + 24} y={y(tick)} class="degrees" class:zero={tick === 0}>{signed(tick)}</text
			>
		{/if}
	{/each}
	<!-- Where it starts, beside the column's top. -->
	<polygon
		points="{TUBE_X - 10},{y(start)} {TUBE_X - 22},{y(start) - 7} {TUBE_X - 22},{y(start) + 7}"
		class="pointer"
	/>
	{#if turn}
		<!-- Colder or warmer: which way, and by how much, never where it ends. -->
		<g transform="translate(140 {y(start)})">
			<line x1="0" y1="0" x2="0" y2={down ? 46 : -46} class="arrow" class:down />
			<polygon points={down ? '-9,40 9,40 0,54' : '-9,-40 9,-40 0,-54'} class="head" class:down />
			<text x="0" y={down ? -10 : 22} class="change">{down ? '−' : '+'}{other}°</text>
		</g>
	{:else}
		<!-- Between two temperatures: the second has a marker of its own. -->
		<polygon
			points="{TUBE_X - 10},{y(other)} {TUBE_X - 22},{y(other) - 7} {TUBE_X - 22},{y(other) + 7}"
			class="pointer second"
		/>
		<text x={TUBE_X - 26} y={y(other)} class="mark second">{signed(other)}°</text>
	{/if}
	<text x={TUBE_X - 26} y={y(start)} class="mark">{signed(start)}°</text>
</svg>

<style>
	.picture {
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.cold {
		fill: #d6ecfa;
	}
	.warm {
		fill: #fde3d6;
	}
	.glass {
		fill: #ffffff;
		stroke: var(--panel-ink);
		stroke-width: 2;
	}
	.mercury {
		fill: var(--bad);
	}
	.tick {
		stroke: var(--panel-ink);
		stroke-width: 1.5;
	}
	.tick.zero {
		stroke-width: 3;
	}
	.degrees {
		font-weight: 800;
		font-size: 18px;
		dominant-baseline: central;
		fill: var(--panel-ink);
	}
	.degrees.zero {
		fill: var(--blue);
	}
	.pointer {
		fill: var(--panel-ink);
	}
	.pointer.second {
		fill: var(--blue);
	}
	.mark {
		font-weight: 800;
		font-size: 18px;
		text-anchor: end;
		dominant-baseline: central;
		fill: var(--panel-ink);
	}
	.mark.second {
		fill: var(--blue);
	}
	.arrow {
		stroke: var(--bad);
		stroke-width: 5;
		stroke-linecap: round;
	}
	.head {
		fill: var(--bad);
	}
	.arrow.down {
		stroke: var(--blue);
	}
	.head.down {
		fill: var(--blue);
	}
	.change {
		font-weight: 800;
		font-size: 18px;
		text-anchor: middle;
		dominant-baseline: central;
		fill: var(--panel-ink);
	}
</style>
