<script lang="ts">
	import { battle } from '../state/battle.svelte';

	/**
	 * The encounter transition (UI_SPEC § Battle mode, Entering), over
	 * everything: a circle of world closing on the player, rimmed in the
	 * accent colour, then a circle of the battle opening on the wild animal.
	 * With reduced motion the screen dims and clears instead. The battle
	 * controller moves it (`battle.transition`); this only draws it. It never
	 * takes a click or a key.
	 */
	let width = $state(0);
	let height = $state(0);

	/** The rim's width in CSS pixels, while the circle is wide enough to carry it. */
	const RIM = 12;

	const style = $derived.by(() => {
		const tr = battle.transition;
		if (!tr) return '';
		if (tr.kind === 'fade') {
			const dim = tr.closing ? tr.p : 1 - tr.p;
			return `background: var(--panel-ink); opacity: ${(0.75 * dim).toFixed(3)};`;
		}
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
		const rim = Math.min(RIM, r * 0.3);
		return (
			`background: radial-gradient(circle at ${tr.x.toFixed(1)}px ${tr.y.toFixed(1)}px, ` +
			`transparent ${r.toFixed(1)}px, var(--accent) ${(r + 0.5).toFixed(1)}px, ` +
			`var(--accent) ${(r + rim).toFixed(1)}px, var(--panel-ink) ${(r + rim + 0.5).toFixed(1)}px);`
		);
	});
</script>

<svelte:window bind:innerWidth={width} bind:innerHeight={height} />

{#if battle.transition}
	<div class="iris" {style} aria-hidden="true"></div>
{/if}

<style>
	.iris {
		position: absolute;
		inset: 0;
		pointer-events: none !important;
	}
</style>
