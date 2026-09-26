<script lang="ts">
	import { battle } from '../state/battle.svelte';

	/**
	 * The encounter transition (UI_SPEC § Battle mode, Entering), over
	 * everything: a circle of world closing on the player, rimmed in the
	 * accent colour, then a circle of the battle opening on the wild animal.
	 * With reduced motion the screen dims and clears instead. The battle
	 * controller moves it (`battle.transition`); this works out the circle and
	 * hands it to the CSS as custom properties. It never takes a click or a key.
	 */
	let width = $state(0);
	let height = $state(0);

	/** The rim's width in CSS pixels, while the circle is wide enough to carry it. */
	const RIM = 12;

	const circle = $derived.by(() => {
		const tr = battle.transition;
		if (!tr || tr.kind !== 'iris') return null;
		// Far enough to clear the corner furthest from the centre: fully open.
		const far =
			Math.max(
				Math.hypot(tr.x, tr.y),
				Math.hypot(width - tr.x, tr.y),
				Math.hypot(tr.x, height - tr.y),
				Math.hypot(width - tr.x, height - tr.y)
			) + RIM;
		// Closing starts slow (the step into the grass lands in view) and snaps shut;
		// opening springs wide and slows at the edges.
		const open = tr.closing ? 1 - tr.p ** 3 : 1 - (1 - tr.p) ** 3;
		const r = far * open;
		return { x: tr.x, y: tr.y, r, rim: Math.min(RIM, r * 0.3) };
	});

	/** How dark the reduced-motion dim is, 0..0.75. */
	const dim = $derived.by(() => {
		const tr = battle.transition;
		if (!tr || tr.kind !== 'fade') return 0;
		return 0.75 * (tr.closing ? tr.p : 1 - tr.p);
	});
</script>

<svelte:window bind:innerWidth={width} bind:innerHeight={height} />

{#if circle}
	<div
		class="iris"
		style:--iris-x="{circle.x.toFixed(1)}px"
		style:--iris-y="{circle.y.toFixed(1)}px"
		style:--iris-r="{circle.r.toFixed(1)}px"
		style:--iris-rim="{circle.rim.toFixed(1)}px"
		aria-hidden="true"
	></div>
{:else if battle.transition}
	<div class="dim" style:opacity={dim.toFixed(3)} aria-hidden="true"></div>
{/if}

<style>
	.iris,
	.dim {
		position: absolute;
		inset: 0;
		pointer-events: none !important;
	}
	.iris {
		--iris-x: 50%;
		--iris-y: 50%;
		--iris-r: 0px;
		--iris-rim: 0px;
		background: radial-gradient(
			circle at var(--iris-x) var(--iris-y),
			transparent var(--iris-r),
			var(--accent) calc(var(--iris-r) + 0.5px),
			var(--accent) calc(var(--iris-r) + var(--iris-rim)),
			var(--panel-ink) calc(var(--iris-r) + var(--iris-rim) + 0.5px)
		);
	}
	.dim {
		background: var(--panel-ink);
	}
</style>
