<script lang="ts">
	/**
	 * An analogue clock for a `clock` puzzle ([[UI_SPEC]] § Battle mode,
	 * "Puzzle pictures"): twelve numbers, a mark for every minute and a
	 * bigger one every five, a short thick hour hand that creeps on between
	 * the hours as a real one does, and a long thin minute hand. The time
	 * passing in the question is in its words, never on the face.
	 */
	let { numbers }: { numbers: readonly number[] } = $props();

	const h = $derived(numbers[1] ?? 12);
	const m = $derived(numbers[2] ?? 0);
	const hourAngle = $derived(((h % 12) + m / 60) * 30);
	const minuteAngle = $derived(m * 6);

	const R = 100;
	function at(angle: number, r: number): { x: number; y: number } {
		const a = (angle * Math.PI) / 180;
		return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
	}
</script>

<svg viewBox="-110 -110 220 220" class="picture" aria-hidden="true">
	<circle r={R} class="rim" />
	<circle r={R - 6} class="face" />
	{#each Array.from({ length: 60 }, (_, k) => k) as k (k)}
		{@const outer = at(k * 6, R - 9)}
		{@const inner = at(k * 6, k % 5 === 0 ? R - 20 : R - 14)}
		<line
			x1={inner.x}
			y1={inner.y}
			x2={outer.x}
			y2={outer.y}
			class="tick"
			class:five={k % 5 === 0}
		/>
	{/each}
	{#each Array.from({ length: 12 }, (_, k) => k + 1) as hour (hour)}
		{@const p = at(hour * 30, R - 36)}
		<text x={p.x} y={p.y} class="hour">{hour}</text>
	{/each}
	<line x1="0" y1="0" x2={at(hourAngle, 50).x} y2={at(hourAngle, 50).y} class="hand hour-hand" />
	<line
		x1="0"
		y1="0"
		x2={at(minuteAngle, 80).x}
		y2={at(minuteAngle, 80).y}
		class="hand minute-hand"
	/>
	<circle r="6" class="pin" />
</svg>

<style>
	.picture {
		width: 100%;
		height: 100%;
	}
	.rim {
		fill: var(--blue);
	}
	.face {
		fill: #ffffff;
	}
	.tick {
		stroke: var(--panel-ink);
		stroke-width: 1.5;
	}
	.tick.five {
		stroke-width: 3.5;
	}
	.hour {
		font-weight: 800;
		font-size: 22px;
		text-anchor: middle;
		dominant-baseline: central;
		fill: var(--panel-ink);
	}
	.hand {
		stroke-linecap: round;
	}
	.hour-hand {
		stroke: var(--panel-ink);
		stroke-width: 9;
	}
	.minute-hand {
		stroke: var(--coral);
		stroke-width: 5;
	}
	.pin {
		fill: var(--panel-ink);
	}
</style>
