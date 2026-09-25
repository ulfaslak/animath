<script lang="ts">
	import type { Puzzle } from '@mathgame/engine';
	import { t } from '../copy';

	/**
	 * One puzzle being answered: the prompt in very large type, the answer
	 * typed so far, then the judgement — "Correct!" or "Not quite!" (the right
	 * answer is never shown; see UI_SPEC § Battle mode).
	 * The one puzzle view for every screen that asks one (battle now, the
	 * doctor later; see UI_SPEC § Component reuse). It only shows: keys are
	 * turned into text by `input/answer.ts` and answers are judged by the
	 * engine, so nothing here decides anything.
	 */
	let {
		puzzle,
		input,
		judged,
		typing
	}: {
		puzzle: Puzzle;
		input: string;
		judged: { correct: boolean } | null;
		/** True while keys type into the answer (shows a blinking cursor). */
		typing: boolean;
	} = $props();
</script>

<div class="puzzle-prompt">{puzzle.prompt}</div>
<div
	class="answer"
	class:correct={judged?.correct === true}
	class:wrong={judged?.correct === false}
>
	{input}<span class="cursor" class:blink={typing}></span>
</div>
{#if judged}
	<div class="judgement" class:good={judged.correct} class:bad={!judged.correct}>
		{judged.correct ? 'Correct!' : 'Not quite!'}
	</div>
{:else}
	<div class="keys">{t('puzzle.keys')}</div>
{/if}

<style>
	.puzzle-prompt {
		font-weight: 800;
		font-size: clamp(40px, 7vh, 64px);
		line-height: 1.1;
		overflow-wrap: anywhere;
	}
	.answer {
		min-width: 4em;
		min-height: 1.3em;
		padding: 2px 16px;
		border-radius: 12px;
		border: 3px solid rgba(0, 0, 0, 0.15);
		background: white;
		font-weight: 800;
		font-size: clamp(32px, 5vh, 44px);
		font-variant-numeric: tabular-nums;
		line-height: 1.3;
	}
	.answer.correct {
		border-color: var(--good);
	}
	.answer.wrong {
		border-color: var(--bad);
		animation: shake 0.4s ease-out;
	}
	.cursor {
		display: inline-block;
		width: 3px;
		height: 0.9em;
		margin-left: 2px;
		vertical-align: -0.1em;
		background: transparent;
	}
	.cursor.blink {
		background: var(--panel-ink);
		animation: blink 1s steps(2) infinite;
	}
	.judgement {
		font-weight: 800;
		font-size: 24px;
		padding: 2px 18px;
		border-radius: 18px;
	}
	.judgement.good {
		background: var(--good);
	}
	.judgement.bad {
		background: var(--bad);
	}
	.keys {
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
	}

	@keyframes shake {
		0%,
		100% {
			transform: translateX(0);
		}
		25% {
			transform: translateX(-8px);
		}
		75% {
			transform: translateX(8px);
		}
	}
	@keyframes blink {
		to {
			visibility: hidden;
		}
	}
</style>
