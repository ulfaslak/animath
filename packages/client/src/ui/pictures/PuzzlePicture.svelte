<script lang="ts">
	import type { PuzzleFace } from '@mathgame/engine';
	import BarChart from './BarChart.svelte';
	import ClockFace from './ClockFace.svelte';
	import FloorFence from './FloorFence.svelte';
	import FractionBar from './FractionBar.svelte';
	import Money from './Money.svelte';
	import Thermometer from './Thermometer.svelte';

	/**
	 * The picture of a puzzle with one (the Arctic's kinds, #191), drawn by
	 * the page from the face's numbers alone: no picture ever travels, so a
	 * friendly match's and a watched battle's are drawn the same way as the
	 * kid's own. SVG, so it is sharp at any size and its numbers are text in
	 * the game's font, sized with the card. It fills the slot it is given.
	 */
	let { face }: { face: PuzzleFace } = $props();
</script>

{#if face.kind === 'thermometer'}
	<Thermometer numbers={face.numbers} />
{:else if face.kind === 'kroner'}
	<Money numbers={face.numbers} />
{:else if face.kind === 'fraction'}
	<FractionBar numbers={face.numbers} />
{:else if face.kind === 'shape'}
	<FloorFence numbers={face.numbers} />
{:else if face.kind === 'barchart'}
	<BarChart numbers={face.numbers} />
{:else if face.kind === 'clock'}
	<ClockFace numbers={face.numbers} />
{/if}
