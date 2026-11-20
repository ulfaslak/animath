<script lang="ts">
	import { NUMBERLINE } from '@mathgame/engine';
	import { t } from '../../copy';

	/**
	 * A number line for a `numberline` puzzle ([[UI_SPEC]] § Battle mode,
	 * "Puzzle pictures"): a mark every step, a longer mark with its number
	 * beside it at both ends and in the middle, and an orange arrow onto the
	 * line with an orange "?" at its tail, its tip on a mark or halfway
	 * between two. Nothing else is written on it. Drawn from the face's
	 * numbers alone.
	 *
	 * It lies across where its slot is wide, as a maths book draws it, and
	 * stands up, the numbers growing upwards as on a thermometer, where the
	 * slot is narrow (beside a phone's number pad): lying across there, its
	 * numbers would be under 16 px and its marks too close to count.
	 */
	let { numbers }: { numbers: readonly number[] } = $props();

	const from = $derived(numbers[0] ?? 0);
	const step = $derived(numbers[1] ?? 1);
	const gaps = $derived(Math.max(1, numbers[2] ?? 10));
	const every = $derived(Math.max(1, numbers[3] ?? 5));
	const at = $derived((numbers[4] ?? 0) + (numbers[5] === NUMBERLINE.half ? 0.5 : 0));
	const marks = $derived(Array.from({ length: gaps + 1 }, (_, k) => k));

	/** The narrowest slot the line lies across in: 18 px numbers and marks 22 px apart. */
	const WIDE = 240;
	let width = $state(0);
	/**
	 * A line that stood up for a puzzle stays up until the next one: the pad
	 * goes once the answer is in, and the slot it leaves would lay the line
	 * down in front of the kid as they read "Correct!".
	 */
	const puzzle = $derived(numbers.join(','));
	let stoodFor = $state<string | null>(null);
	$effect(() => {
		if (width > 0 && width < WIDE) stoodFor = puzzle;
	});
	const across = $derived(width >= WIDE && stoodFor !== puzzle);

	// Lying across: the line runs wide of the edges by half a five-digit number, so the
	// numbers at its ends stay whole, and the arrow comes down onto it from above.
	const LEFT = 36;
	const RIGHT = 284;
	const ROW = 70;
	// Standing up: the numbers at the line's right, the arrow coming in from its left.
	const TOP = 14;
	const BOTTOM = 186;
	const COLUMN = 64;

	/** How far along the line a mark is, from its start: left to right, or bottom to top. */
	const along = $derived(across ? (RIGHT - LEFT) / gaps : (BOTTOM - TOP) / gaps);
	function x(mark: number): number {
		return LEFT + mark * along;
	}
	function y(mark: number): number {
		return BOTTOM - mark * along;
	}
</script>

<!-- Nothing until the slot is measured, so a line never shows the wrong way round for a frame. -->
<div class="number-line" bind:clientWidth={width}>
	{#if width === 0}
		<!-- Measuring. -->
	{:else if across}
		<svg viewBox="0 0 320 116" class="picture" aria-hidden="true">
			<line x1={LEFT} x2={RIGHT} y1={ROW} y2={ROW} class="line" />
			{#each marks as k (k)}
				{@const written = k % every === 0}
				<line
					x1={x(k)}
					x2={x(k)}
					y1={ROW - (written ? 12 : 7)}
					y2={ROW + (written ? 12 : 7)}
					class="mark"
					class:written
				/>
				{#if written}
					<text x={x(k)} y={ROW + 30} class="number">{from + k * step}</text>
				{/if}
			{/each}
			<!-- The arrow: its tip on the line, exactly where the number asked is. -->
			<g transform="translate({x(at)} 0)">
				<line x1="0" x2="0" y1="28" y2={ROW - 16} class="arrow" />
				<polygon points="-8,{ROW - 20} 8,{ROW - 20} 0,{ROW - 3}" class="head" />
				<text x="0" y="12" class="asked">{t('puzzle.picture.missing')}</text>
			</g>
		</svg>
	{:else}
		<svg viewBox="0 0 150 200" class="picture" aria-hidden="true">
			<line x1={COLUMN} x2={COLUMN} y1={TOP} y2={BOTTOM} class="line" />
			{#each marks as k (k)}
				{@const written = k % every === 0}
				<line
					x1={COLUMN - (written ? 12 : 7)}
					x2={COLUMN + (written ? 12 : 7)}
					y1={y(k)}
					y2={y(k)}
					class="mark"
					class:written
				/>
				{#if written}
					<text x={COLUMN + 18} y={y(k)} class="number up">{from + k * step}</text>
				{/if}
			{/each}
			<g transform="translate(0 {y(at)})">
				<line x1="22" x2={COLUMN - 16} y1="0" y2="0" class="arrow" />
				<polygon points="{COLUMN - 20},-8 {COLUMN - 20},8 {COLUMN - 3},0" class="head" />
				<text x="10" y="0" class="asked">{t('puzzle.picture.missing')}</text>
			</g>
		</svg>
	{/if}
</div>

<style>
	.number-line {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.picture {
		width: 100%;
		height: 100%;
	}
	.line {
		stroke: var(--panel-ink);
		stroke-width: 3;
		stroke-linecap: round;
	}
	.mark {
		stroke: var(--panel-ink);
		stroke-width: 2;
	}
	.mark.written {
		stroke-width: 3;
	}
	.number,
	.asked {
		font-weight: 800;
		font-size: 20px;
		text-anchor: middle;
		dominant-baseline: central;
		fill: var(--panel-ink);
	}
	.number.up {
		text-anchor: start;
	}
	.asked {
		fill: var(--accent-edge);
	}
	.arrow {
		stroke: var(--accent);
		stroke-width: 5;
		stroke-linecap: round;
	}
	.head {
		fill: var(--accent);
	}
</style>
