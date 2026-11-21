<script lang="ts" module>
	import { ALL_PUZZLE_TOPICS, type PuzzleRecord, type PuzzleTopic } from '@mathgame/engine';

	/**
	 * One topic on the page: how many the kid solved, from the record. Only
	 * that: how many were tried, and so how many were missed, stays in the
	 * record for the game's makers and never reaches the page.
	 */
	interface StatRow {
		topic: PuzzleTopic;
		right: number;
	}

	/**
	 * The page's rows: every topic there is, the ones solved first, most solved
	 * first (in the topics' own order when two were solved as often), then the
	 * ones never solved, in the topics' order. A topic a newer build has, which
	 * this one cannot name, is not shown.
	 */
	export function statRows(record: PuzzleRecord): StatRow[] {
		const rows = ALL_PUZZLE_TOPICS.map((topic) => ({
			topic,
			right: record[topic]?.right ?? 0
		}));
		// A stable sort: equal counts keep the topics' order.
		return rows.sort((a, b) => b.right - a.right);
	}
</script>

<script lang="ts">
	import { t } from '../copy';
	import { unfocusable } from '../input/press';
	import { kindWord } from '../kinds';
	import TopicChips from './TopicChips.svelte';

	/**
	 * "My puzzles", in the pause menu's place: one row per topic, its chip
	 * (the battle's `TopicChips`), its word, a bar and how many were solved
	 * ("212 solved"). Every bar is measured against the most-solved topic, so a
	 * kind solved far more than another has a far longer bar. Topics never
	 * solved have no bar, and say so. It shows only the right answers of the
	 * record (`game.puzzles`, the authority's): never how many were tried or
	 * missed, and nothing on it says what a topic is worth in a battle.
	 * `lit` is the row the arrows are on, kept in view; a tap lights a row
	 * (`press`).
	 */
	let {
		rows,
		lit,
		press
	}: { rows: readonly StatRow[]; lit: number; press: (i: number) => string } = $props();

	const most = $derived(Math.max(1, ...rows.map((r) => r.right)));
</script>

<div class="stats">
	{#each rows as row, i (row.topic)}
		<button
			type="button"
			class="stat"
			class:none={row.right === 0}
			class:lit={lit === i}
			data-press={press(i)}
			{@attach unfocusable}
			{@attach (el) => {
				if (lit === i) el.scrollIntoView({ block: 'nearest' });
			}}
		>
			<TopicChips topics={[row.topic]} />
			<span class="word">{kindWord(row.topic)}</span>
			{#if row.right > 0}
				<span class="bar" aria-hidden="true">
					<span class="right" style:width="{(100 * row.right) / most}%"></span>
				</span>
				<span class="count">{t('puzzles.row', { right: row.right })}</span>
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
		/* Every row's columns alike, so every bar's track is as long and the bars compare. */
		grid-template-columns: 64px minmax(0, 11em) minmax(60px, 1fr) 11em;
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
	/* Never solved: its contents fade, never the ring that says it is lit. */
	.stat.none > :global(*) {
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
	/* How many were solved: a green bar from the left. */
	.right {
		display: block;
		height: 100%;
		min-width: 6px;
		border-radius: 9px;
		background: var(--good);
	}
	.count {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		text-align: right;
		font-size: 16px;
	}
	/* A phone held sideways: tighter rows. */
	@media (max-height: 500px) {
		.stat {
			min-height: 40px;
			font-size: 16px;
			gap: 8px;
			grid-template-columns: 64px minmax(0, 9em) minmax(40px, 1fr) 10.5em;
		}
		.count {
			font-size: 16px;
		}
	}
</style>
