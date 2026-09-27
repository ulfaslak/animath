<script lang="ts">
	import { hpBand } from '../hp';

	/**
	 * The one HP bar, wherever an animal's HP shows (UI_SPEC § Component reuse).
	 * Colour follows the fraction left (green, then amber under half, then red
	 * under a fifth) and the numbers are always printed, so the state is
	 * readable without colour. Any HP above zero shows at least a sliver, so
	 * 1/100 never looks the same as a tired 0/100. `emptyTag` is a word written
	 * in the empty track at 0 HP, where the bar would fill: the doctor's list
	 * says "tired" there, beside a name of twelve wide letters that leaves no
	 * room for a tag of its own. The track stays, so the bar still fills from
	 * empty when the animal is healed. `thin` draws a slim bar without the
	 * numbers: all the HP of a card of several animals together, whose words
	 * beside it say how many are ready, tired soon and tired
	 * (`BundleCard`), so it is readable without colour there too. `thick`
	 * is the battle's status boxes': a chunkier bar and a bigger number.
	 * `preview` is the HP a hit would leave (the engine's `landHit`, from the
	 * screen that shows it): the part of the bar it would take off shows as
	 * a lighter segment that pulses gently (and holds still with reduced
	 * motion), running to the empty end when the hit would tire the animal.
	 */
	let {
		hp,
		max,
		emptyTag,
		thin = false,
		thick = false,
		preview = null
	}: {
		hp: number;
		max: number;
		emptyTag?: string;
		thin?: boolean;
		thick?: boolean;
		preview?: number | null;
	} = $props();
	const fraction = $derived(max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0);
	const band = $derived(hpBand(hp, max));
	const width = $derived(hp > 0 ? Math.max(4, fraction * 100) : 0);
	const tag = $derived(hp === 0 ? emptyTag : undefined);
	/** Where the bar would end after the previewed hit: the lighter segment runs from there to its end. */
	const after = $derived.by(() => {
		if (preview === null || !(preview < hp) || max <= 0) return null;
		return preview > 0 ? Math.min(width, Math.max(4, (preview / max) * 100)) : 0;
	});
</script>

<div class="hp" class:thin class:thick>
	<div class="track" class:tagged={tag !== undefined}>
		<div class="bar {band}" style:width="{width}%"></div>
		{#if after !== null && after < width}
			<div class="loss" style:left="{after}%" style:width="{width - after}%"></div>
		{/if}
		{#if tag !== undefined}<span class="tag">{tag}</span>{/if}
	</div>
	{#if !thin}<span class="text">{hp}/{max}</span>{/if}
</div>

<style>
	.hp {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.track {
		position: relative;
		flex: 1;
		height: 12px;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.1);
		overflow: hidden;
	}
	/* The battle's status boxes: chunkier, and the number bigger. */
	.thick .track {
		height: 16px;
		border-radius: 8px;
		box-shadow: inset 0 2px 0 rgba(0, 0, 0, 0.08);
	}
	.thick .bar {
		border-radius: 8px;
	}
	/*
	 * A tight line, so the box stays as tall as it was with the slimmer bar:
	 * the leash flies round the wild animal's (`WILD_STATUS_BOX`).
	 */
	.thick .text {
		font-size: 20px;
		line-height: 1;
		min-width: 3.4em;
	}
	/* What the previewed hit would take off: lighter, breathing gently. */
	.loss {
		position: absolute;
		top: 0;
		bottom: 0;
		background: rgba(255, 255, 255, 0.62);
		border-radius: 0 8px 8px 0;
		animation: loss 1.2s ease-in-out infinite alternate;
	}
	@keyframes loss {
		from {
			opacity: 0.95;
		}
		to {
			opacity: 0.45;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.loss {
			animation: none;
			opacity: 0.75;
		}
	}
	.bar {
		height: 100%;
		border-radius: 6px;
		transition: width 0.35s ease-out;
	}
	/* A card of several's: slim, and no numbers (its words say how they are). */
	.thin .track {
		height: 6px;
		border-radius: 3px;
	}
	.thin .bar {
		border-radius: 3px;
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
	/* The empty track holding its word: a tag as long as the bar, as tall as the word. */
	.track.tagged {
		display: flex;
		align-items: center;
		height: auto;
		border-radius: 8px;
		overflow: visible;
	}
	.tag {
		padding: 1px 8px;
		font-weight: 800;
		font-size: 16px;
		white-space: nowrap;
	}
	.text {
		font-weight: 800;
		font-size: 16px;
		font-variant-numeric: tabular-nums;
		min-width: 3.6em;
		text-align: right;
	}
</style>
