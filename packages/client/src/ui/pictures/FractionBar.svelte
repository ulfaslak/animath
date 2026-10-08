<script lang="ts">
	import { t } from '../../copy';

	/**
	 * A fraction of an amount for a `fraction` puzzle ([[UI_SPEC]] § Battle
	 * mode, "Puzzle pictures"): the whole as a bar with its amount over it,
	 * cut into as many pieces as the fraction's bottom number, the top
	 * number's pieces shaded with a "?" under them. An amount of 30 or less
	 * is drawn as dots too, shared out evenly over the pieces, so a kid can
	 * count them.
	 */
	let { numbers }: { numbers: readonly number[] } = $props();

	const n = $derived(numbers[0] ?? 1);
	const d = $derived(Math.max(1, numbers[1] ?? 1));
	const amount = $derived(numbers[2] ?? 0);
	const share = $derived(Math.floor(amount / d));
	const dots = $derived(amount <= 30);

	const X = 10;
	const W = 280;
	const Y = 52;
	const H = 72;
	const piece = $derived(W / d);

	/** Where piece `p`'s dots sit: a grid filling the piece, as square as it goes. */
	function dotsIn(p: number): { x: number; y: number }[] {
		const cols = Math.max(1, Math.round(Math.sqrt((share * piece) / H)));
		const rows = Math.ceil(share / cols);
		return Array.from({ length: share }, (_, k) => ({
			x: X + p * piece + ((k % cols) + 0.5) * (piece / cols),
			y: Y + (Math.floor(k / cols) + 0.5) * (H / rows)
		}));
	}
</script>

<svg viewBox="0 0 300 180" class="picture" aria-hidden="true">
	<!-- The whole, and its amount over a bracket. -->
	<path d="M{X} 38 v-8 h{W} v8" class="bracket" />
	<text x={X + W / 2} y="16" class="amount">{amount}</text>
	{#each Array.from({ length: d }, (_, p) => p) as p (p)}
		<rect x={X + p * piece} y={Y} width={piece} height={H} class="piece" class:shaded={p < n} />
		{#if dots}
			{#each dotsIn(p) as dot, k (k)}
				<circle cx={dot.x} cy={dot.y} r={Math.min(6, piece / 6)} class="dot" />
			{/each}
		{/if}
	{/each}
	<!-- The shaded pieces: what the question asks. -->
	<path d="M{X} {Y + H + 10} v8 h{n * piece} v-8" class="bracket asked" />
	<text x={X + (n * piece) / 2} y={Y + H + 40} class="asked-mark"
		>{t('puzzle.picture.missing')}</text
	>
</svg>

<style>
	.picture {
		width: 100%;
		height: 100%;
	}
	.piece {
		fill: var(--panel-cream);
		stroke: var(--panel-ink);
		stroke-width: 2;
	}
	.piece.shaded {
		fill: #ffd7a8;
	}
	.dot {
		fill: var(--panel-ink);
	}
	.bracket {
		fill: none;
		stroke: var(--panel-ink);
		stroke-width: 2;
	}
	.bracket.asked {
		stroke: var(--accent);
		stroke-width: 3;
	}
	.amount,
	.asked-mark {
		font-weight: 800;
		font-size: 24px;
		text-anchor: middle;
		dominant-baseline: central;
		fill: var(--panel-ink);
	}
	.asked-mark {
		fill: var(--accent-edge);
	}
</style>
