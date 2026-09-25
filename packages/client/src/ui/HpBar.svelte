<script lang="ts">
	/**
	 * The one HP bar, used by the party HUD and the battle status boxes.
	 * Colour follows the fraction left (green, then amber under half, then red
	 * under a fifth) and the numbers are always printed, so the state is
	 * readable without colour. Any HP above zero shows at least a sliver, so
	 * 1/100 never looks the same as a tired 0/100.
	 */
	let { hp, max }: { hp: number; max: number } = $props();
	const fraction = $derived(max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0);
	const band = $derived(fraction > 0.5 ? 'good' : fraction > 0.2 ? 'warn' : 'bad');
	const width = $derived(hp > 0 ? Math.max(4, fraction * 100) : 0);
</script>

<div class="hp">
	<div class="track">
		<div class="bar {band}" style:width="{width}%"></div>
	</div>
	<span class="text">{hp}/{max}</span>
</div>

<style>
	.hp {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.track {
		flex: 1;
		height: 12px;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.1);
		overflow: hidden;
	}
	.bar {
		height: 100%;
		border-radius: 6px;
		transition: width 0.35s ease-out;
	}
	.bar.good {
		background: var(--good);
	}
	.bar.warn {
		background: var(--warn);
	}
	.bar.bad {
		background: var(--bad);
	}
	.text {
		font-weight: 800;
		font-size: 16px;
		font-variant-numeric: tabular-nums;
		min-width: 3.6em;
		text-align: right;
	}
</style>
