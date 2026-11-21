<script lang="ts">
	import { puzzleTopics } from '@mathgame/engine';
	import { fit } from '../fit';
	import { press, unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { kindGlyph, wholePanel } from '../kinds';
	import PuzzlePanel from '../ui/PuzzlePanel.svelte';
	import { preview } from './preview.svelte';

	/**
	 * The puzzle preview's page (`preview.svelte.ts`): the puzzle in a card
	 * of the battle panel's own size and place (`--battle-panel`, the
	 * margins of `BattlePanel`'s `.panel`), on the sky, so what shows here is
	 * what a battle shows. A picture puzzle or one in words has the whole
	 * panel, as in a battle (`wide`); a sum has the battle's right-hand card. Over it, the
	 * kind's sign and the difficulty, each with its two arrows, which a
	 * finger can press too.
	 */
	const topic = $derived(puzzleTopics([preview.kind], preview.difficulty)[0] ?? 'add');
	const wide = $derived(wholePanel(preview.kind));
	/** `BattlePanel`'s steps, so a crowded puzzle fits here as it does there. */
	const PUZZLE_STEPS = ['close', 'small', 'least', 'tight', 'said'] as const;

	function key(name: string) {
		return (e: PointerEvent) => {
			if (e.button === 0) press(name);
		};
	}
</script>

<div class="preview" class:touch={touch.on}>
	<div class="dials">
		<button type="button" onpointerdown={key('ArrowUp')} {@attach unfocusable}>▲</button>
		<span class="dial">{kindGlyph(topic)}</span>
		<button type="button" onpointerdown={key('ArrowDown')} {@attach unfocusable}>▼</button>
		<button type="button" onpointerdown={key('ArrowLeft')} {@attach unfocusable}>◀</button>
		<!-- The difficulty the puzzle was made at: a kind asked below its range is made at its lowest. -->
		<span class="dial">{preview.puzzle?.difficulty ?? preview.difficulty}</span>
		<button type="button" onpointerdown={key('ArrowRight')} {@attach unfocusable}>▶</button>
	</div>
	<!-- `solo`: with the number pad, a short screen gives the puzzle the whole panel, as a battle does. -->
	<div class="panel" class:wide class:solo={touch.on}>
		{#if !wide}<div class="card blank"></div>{/if}
		<div
			class="card puzzle"
			class:correct={preview.judged?.correct === true}
			{@attach fit(PUZZLE_STEPS)}
		>
			{#if preview.puzzle}
				<PuzzlePanel
					puzzle={preview.puzzle}
					input={preview.input}
					judged={preview.judged}
					typing={preview.judged === null}
					hinted={preview.hinted}
				/>
			{/if}
		</div>
	</div>
</div>

<style>
	.preview {
		position: fixed;
		inset: 0;
		background: #8fd3f4;
		font-family: var(--font-ui);
		color: var(--panel-ink);
	}
	.dials {
		position: absolute;
		top: calc(16px + var(--safe-top));
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		border-radius: var(--radius);
		background: var(--panel-bg);
		box-shadow: var(--hud-shadow);
		font-weight: 800;
		font-size: 22px;
	}
	.dials button {
		min-width: var(--tap);
		min-height: var(--tap);
		border-radius: 12px;
		background: rgba(0, 0, 0, 0.07);
		font-size: 18px;
	}
	.dial {
		min-width: 2.5em;
		text-align: center;
	}
	/* `BattlePanel`'s `.panel` and `.card.puzzle`, as they stand. */
	.panel {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: var(--battle-panel);
		display: grid;
		grid-template-columns: minmax(300px, 2fr) 3fr;
		gap: 12px;
		padding: 0 calc(16px + var(--safe-right)) calc(16px + var(--safe-bottom))
			calc(16px + var(--safe-left));
		box-sizing: border-box;
	}
	.panel.wide {
		grid-template-columns: 1fr;
	}
	@media (max-width: 900px) {
		.panel:not(.wide) {
			grid-template-columns: 1fr 1fr;
		}
	}
	.card {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		box-sizing: border-box;
		min-height: 0;
	}
	.blank {
		opacity: 0.5;
	}
	.puzzle {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: safe center;
		gap: 8px;
		padding: 12px 20px;
		text-align: center;
		overflow: hidden;
		transition: background-color 0.3s;
	}
	.puzzle.correct {
		background: color-mix(in srgb, var(--good) 22%, var(--panel-bg));
	}
	/* `BattlePanel`'s fit steps (`PUZZLE_STEPS`), as they stand. */
	.puzzle:global([data-fit~='close']) {
		gap: 4px;
		padding-block: 4px;
	}
	.puzzle:global([data-fit~='close']) :global(.question) {
		gap: 3px;
	}
	.puzzle:global([data-fit~='small']) {
		--hint-size: 20px;
	}
	.puzzle:global([data-fit~='least']) {
		--hint-size: 17px;
	}
	.puzzle:global([data-fit~='least']) :global(.answer) {
		font-size: 28px;
	}
	.puzzle:global([data-fit~='tight']) :global(.ask) {
		line-height: 1.15;
	}
	.puzzle:global([data-fit~='tight']) :global(.hint) {
		line-height: 1.1;
	}
	.puzzle:global([data-fit~='tight']) :global(.hint .sum) {
		row-gap: 1px;
	}
	.puzzle:global([data-fit~='said']) :global(.ask .aside) {
		display: none;
	}
	/* A phone held sideways, after the rules it changes, as in `BattlePanel`. */
	@media (max-height: 560px) {
		.panel {
			gap: 8px;
			padding-bottom: calc(8px + var(--safe-bottom));
		}
		.puzzle {
			padding: 5px 12px;
			gap: 6px;
		}
		.panel.solo {
			grid-template-columns: 1fr;
		}
		.panel.solo .blank {
			display: none;
		}
	}
</style>
