<script lang="ts" module>
	import { ALL_PUZZLE_TOPICS, type PuzzleRecord, type PuzzleTopic } from '@mathgame/engine';

	/** One topic on the page: how many were tried and right, from the record. */
	export interface StatRow {
		topic: PuzzleTopic;
		tried: number;
		right: number;
	}

	/**
	 * The page's rows: every topic there is, the ones tried first, most tried
	 * first (in the topics' own order when two were tried as often), then the
	 * ones never tried, in the topics' order. A topic a newer build has, which
	 * this one cannot name, is not shown.
	 */
	export function statRows(record: PuzzleRecord): StatRow[] {
		const rows = ALL_PUZZLE_TOPICS.map((topic) => ({
			topic,
			tried: record[topic]?.tried ?? 0,
			right: record[topic]?.right ?? 0
		}));
		// A stable sort: equal counts keep the topics' order.
		return rows.sort((a, b) => b.tried - a.tried);
	}
</script>

<script lang="ts">
	import { t } from '../copy';
	import { unfocusable } from '../input/press';
	import { kindWord } from '../kinds';
	import TopicChips from './TopicChips.svelte';

	/**
	 * "My puzzles", in the pause menu's place: one row per topic, its chip
	 * (the battle's `TopicChips`), its word, a bar and the counts ("4
	 * right of 9"). Every bar is measured against the most-tried topic, so a
	 * kind tried far more than another has a far longer bar: the bar is how
	 * many were tried, its green part how many were right. Topics never tried
	 * have no bar, and say so. It only shows the record (`game.puzzles`, the
	 * authority's): nothing on it says what a topic is worth in a battle.
	 * `lit` is the row the arrows are on, kept in view; a tap lights a row
	 * (`press`).
	 */
	let {
		rows,
		lit,
		press
	}: { rows: readonly StatRow[]; lit: number; press: (i: number) => string } = $props();

	const most = $derived(Math.max(1, ...rows.map((r) => r.tried)));
</script>

<div class="stats">
	{#each rows as row, i (row.topic)}
		<button
			type="button"
			class="stat"
			class:none={row.tried === 0}
			class:lit={lit === i}
			data-press={press(i)}
			{@attach unfocusable}
			{@attach (el) => {
				if (lit === i) el.scrollIntoView({ block: 'nearest' });
			}}
		>
			<TopicChips topics={[row.topic]} />
			<span class="word">{kindWord(row.topic)}</span>
			{#if row.tried > 0}
				<span class="bar" aria-hidden="true">
					<span class="tried" style:width="{(100 * row.tried) / most}%">
						<span class="right" style:width="{(100 * row.right) / row.tried}%"></span>
					</span>
				</span>
				<span class="count">{t('puzzles.row', { right: row.right, tried: row.tried })}</span>
			{:else}
				<span class="bar empty" aria-hidden="true"></span>
				<span class="count">{t('puzzles.never')}</span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.stats {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		/* A finger scrolls it; nothing else on the page moves. */
		touch-action: pan-y;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 6px;
	}
	.stat {
		display: grid;
		grid-template-columns: 64px minmax(0, 11em) minmax(60px, 1fr) max-content;
		align-items: center;
		gap: 12px;
		min-height: var(--tap);
		padding: 4px 12px;
		border-radius: 12px;
		background: rgba(0, 0, 0, 0.04);
		color: var(--panel-ink);
		text-align: left;
		font-weight: 800;
		font-size: 18px;
		outline: 3px solid transparent;
		outline-offset: -3px;
	}
	.stat.lit {
		outline-color: var(--accent);
	}
	.stat.none {
		opacity: 0.5;
	}
	.word {
		overflow-wrap: anywhere;
		hyphens: auto;
		line-height: 1.15;
	}
	.bar {
		height: 18px;
		border-radius: 9px;
		background: rgba(0, 0, 0, 0.06);
		overflow: hidden;
	}
	.bar.empty {
		background: none;
	}
	/* How many were tried: a warm bar, its right answers green inside it from the left. */
	.tried {
		display: block;
		height: 100%;
		min-width: 6px;
		border-radius: 9px;
		background: var(--warn);
		overflow: hidden;
	}
	.right {
		display: block;
		height: 100%;
		background: var(--good);
	}
	.count {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		font-size: 16px;
	}
	/* A phone held sideways: tighter rows. */
	@media (max-height: 500px) {
		.stat {
			min-height: 40px;
			font-size: 16px;
			gap: 8px;
			grid-template-columns: 64px minmax(0, 9em) minmax(40px, 1fr) max-content;
		}
		.count {
			font-size: 16px;
		}
	}
</style>
