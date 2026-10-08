<script lang="ts">
	import { KRONER } from '@mathgame/engine';
	import { t } from '../../copy';

	/**
	 * Danish money for a `kroner` puzzle ([[UI_SPEC]] § Battle mode, "Puzzle
	 * pictures"): the notes on top, biggest first, then the coins, biggest
	 * first, each with its value on it. Coins of 1, 2 and 5 kroner are silver
	 * with a hole, as the real ones are; 10 and 20 are gold; the notes of 50,
	 * 100 and 200 are purple, orange and green. Never the witch doctor's
	 * tokens, whose gold coin has a heart and no number.
	 */
	let { numbers }: { numbers: readonly number[] } = $props();

	interface Piece {
		value: number;
		x: number;
		y: number;
	}

	const NOTE = { w: 92, h: 48, gap: 8 };
	const WIDTH = 300;

	/** Every coin and note, laid out: notes in rows, then coins in rows, left to right. */
	const laid = $derived.by(() => {
		const values: number[] = [];
		for (let i = KRONER.length - 1; i >= 0; i--) {
			for (let c = 0; c < (numbers[i + 1] ?? 0); c++) values.push(KRONER[i]!);
		}
		const notes = values.filter((v) => v >= 50);
		const coins = values.filter((v) => v < 50);
		const pieces: Piece[] = [];
		let y = 0;
		const perRow = Math.floor((WIDTH + NOTE.gap) / (NOTE.w + NOTE.gap));
		notes.forEach((value, i) => {
			if (i > 0 && i % perRow === 0) y += NOTE.h + NOTE.gap;
			pieces.push({ value, x: (i % perRow) * (NOTE.w + NOTE.gap), y });
		});
		if (notes.length > 0) y += NOTE.h + NOTE.gap * 2;
		let x = 0;
		let rowTop = y;
		for (const value of coins) {
			const d = 2 * radius(value);
			if (x + d > WIDTH) {
				x = 0;
				rowTop += 2 * radius(20) + NOTE.gap;
			}
			pieces.push({ value, x: x + d / 2, y: rowTop + radius(20) });
			x += d + NOTE.gap;
		}
		const height = coins.length > 0 ? rowTop + 2 * radius(20) : y - NOTE.gap * 2;
		return { pieces, height: Math.max(height, 60) };
	});

	/** A coin's size: bigger as it is worth more, as Danish coins mostly are. */
	function radius(value: number): number {
		return value === 1 ? 23 : value === 2 ? 26 : value === 5 ? 28 : value === 10 ? 25 : 29;
	}
</script>

<svg viewBox="-4 -4 {WIDTH + 8} {laid.height + 8}" class="picture" aria-hidden="true">
	{#each laid.pieces as piece, i (i)}
		{#if piece.value >= 50}
			<g transform="translate({piece.x} {piece.y})" class="note n{piece.value}">
				<rect width={NOTE.w} height={NOTE.h} rx="6" class="paper" />
				<rect x="5" y="5" width={NOTE.w - 10} height={NOTE.h - 10} rx="4" class="inset" />
				<text x={NOTE.w / 2 - 6} y={NOTE.h / 2} class="value">{piece.value}</text>
				<text x={NOTE.w - 9} y={NOTE.h / 2 + 4} class="unit">{t('puzzle.picture.kr')}</text>
			</g>
		{:else}
			<g transform="translate({piece.x} {piece.y})" class="coin" class:gold={piece.value >= 10}>
				<circle r={radius(piece.value)} class="face" />
				<circle r={radius(piece.value) - 4} class="ring" />
				{#if piece.value < 10}
					<!-- The hole, above the number, as on a real 1, 2 or 5 krone. -->
					<circle cy={-radius(piece.value) + 10} r="3.5" class="hole" />
				{/if}
				<text y="3" class="value">{piece.value}</text>
			</g>
		{/if}
	{/each}
</svg>

<style>
	.picture {
		width: 100%;
		height: 100%;
	}
	.paper {
		stroke: var(--panel-ink);
		stroke-width: 1.5;
	}
	.inset {
		fill: none;
		stroke: rgba(255, 255, 255, 0.7);
		stroke-width: 1.5;
	}
	.n50 .paper {
		fill: #b48be0;
	}
	.n100 .paper {
		fill: #ffb366;
	}
	.n200 .paper {
		fill: #7fd08f;
	}
	.value {
		font-weight: 800;
		font-size: 22px;
		text-anchor: middle;
		dominant-baseline: central;
		fill: var(--panel-ink);
	}
	.unit {
		font-weight: 800;
		font-size: 18px;
		text-anchor: end;
		fill: var(--panel-ink);
	}
	.coin .face {
		fill: #dfe3e8;
		stroke: #8e969f;
		stroke-width: 2;
	}
	.coin .ring {
		fill: none;
		stroke: #b8bfc7;
		stroke-width: 1.5;
	}
	.coin.gold .face {
		fill: #f3cf5d;
		stroke: #b8860b;
	}
	.coin.gold .ring {
		stroke: #d9ad2f;
	}
	.hole {
		fill: var(--panel-cream);
		stroke: #8e969f;
		stroke-width: 1.5;
	}
</style>
