<script lang="ts">
	import type { PuzzleTopic } from '@mathgame/engine';
	import { kindGlyph, kindWord } from '../kinds';

	/**
	 * What kind of sums an attack asks, as pictures: one chip per kind, its
	 * operator in the prompts' own glyphs (+ − × ÷ √, "?" for a missing
	 * number, a row of numbers for a pattern). The topics are the engine's
	 * `puzzleTopics` for the attack at its level; the sentence beside the
	 * chips names them in words, and each chip says its word to a screen
	 * reader.
	 */
	let { topics }: { topics: readonly PuzzleTopic[] } = $props();
</script>

<span class="chips">
	{#each topics as topic (topic)}
		<span
			class="chip"
			class:wide={kindGlyph(topic).length > 1}
			role="img"
			aria-label={kindWord(topic)}>{kindGlyph(topic)}</span
		>
	{/each}
</span>

<style>
	.chips {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	/* A sum's sign on a pale tile of sky, in the trainer's blue: a picture, not a button. */
	.chip {
		display: grid;
		place-items: center;
		min-width: 34px;
		height: 32px;
		padding: 0 7px;
		box-sizing: border-box;
		border-radius: 8px;
		background: color-mix(in srgb, var(--blue) 14%, var(--panel-cream));
		color: var(--blue);
		font-weight: 800;
		font-size: 24px;
		line-height: 1;
		white-space: nowrap;
	}
	/* A pattern's row of numbers: smaller, so it stays a chip. */
	.chip.wide {
		font-size: 16px;
		letter-spacing: 0.02em;
	}
</style>
