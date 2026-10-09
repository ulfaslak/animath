<script lang="ts">
	import {
		answerForm,
		isPictureKind,
		puzzleFace,
		type AttackLevel,
		type ShownPuzzle
	} from '@mathgame/engine';
	import { t } from '../copy';
	import { shownAnswer } from '../input/answer';
	import { questionParts, questionText } from '../puzzle-words';
	import PuzzlePicture from './pictures/PuzzlePicture.svelte';
	import { unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import HitBadge from './HitBadge.svelte';
	import NumberPad from './NumberPad.svelte';
	import BarMark from './pictures/BarMark.svelte';

	/**
	 * One puzzle being answered: the prompt in very large type, the answer
	 * typed so far, then the judgement — "Correct!" or "Not quite!" (the right
	 * answer is never shown; see UI_SPEC § Battle mode).
	 * The one puzzle view for every screen that asks one (a battle, a friendly
	 * match, the druid's token sums; see UI_SPEC § Component reuse). It only shows: keys are
	 * turned into text by `input/answer.ts` and answers are judged by the
	 * engine, so nothing here decides anything. With the touch controls on,
	 * the number pad stands to the right of it, and its keys are keys too.
	 * `note` is one more line under the key reminder, from the screen that
	 * asks: beside the pad it takes the room left under the answer, not a line
	 * of the card's height below the pad. `story` is a line over the prompt
	 * (the doctor's token sums tell what the numbers are), and `back` the
	 * label of a button that puts the puzzle away (Escape), for a screen that
	 * has a way back; a battle has none. `reward` is what a right answer
	 * wins, a battle's hit: "Correct!" shows its hit badge, so the sum and
	 * the reward connect ("Correct! ✸24"). `watch` is a friendly match's
	 * other player's puzzle, watched while they think: its line ("Bo is
	 * thinking…") where the key reminder would be, and no number pad, since
	 * nothing here is typed (what they type stays on their screen).
	 *
	 * A puzzle with a picture (the Arctic's kinds, #191) is drawn from its
	 * face: the picture on the left, filling the card's height, and its
	 * question in words beside it, picked here in the language on screen
	 * (`puzzle-words.ts`), over the answer. A clock's answer is a time: the
	 * box shows "--:--" until a digit is typed, and the pad has a colon.
	 */
	let {
		puzzle,
		input,
		judged,
		typing,
		note,
		story,
		back,
		reward,
		watch
	}: {
		puzzle: ShownPuzzle;
		input: string;
		judged: { correct: boolean } | null;
		/** True while keys type into the answer (shows a blinking cursor). */
		typing: boolean;
		/** The doctor's "↑ ↓ help another animal", when someone else is hurt too. */
		note?: string;
		/** What the numbers are: "You have 23 tokens. The axe costs 8. How many will you have left?" */
		story?: string;
		/** The label of the button that goes back (Escape): the doctor's "Back". */
		back?: string;
		/** The hit a right answer lands, from the engine: the battle's. */
		reward?: { damage: number; level: AttackLevel };
		/** Someone else's puzzle, watched: the line in place of the key reminder. */
		watch?: string;
	} = $props();

	const face = $derived(puzzleFace(puzzle));
	const pictured = $derived(face !== null && isPictureKind(face.kind));
	const parts = $derived(face && pictured ? questionParts(face) : null);
	const form = $derived(answerForm(puzzle.kind));
	const reminder = $derived(
		form === 'time'
			? touch.on
				? t('puzzle.keysTimeTouch')
				: t('puzzle.keysTime')
			: touch.on
				? t('puzzle.keysTouch')
				: t('puzzle.keys')
	);
</script>

<div class="puzzle-panel" class:with-pad={touch.on && !watch} class:pictured>
	{#if face && pictured}
		<div class="picture-slot"><PuzzlePicture {face} /></div>
	{/if}
	<div class="question">
		{#if story}<div class="story">{story}</div>{/if}
		{#if parts}
			<!-- Read aloud whole: a fraction as "3/5", a bar's mark by its name. -->
			<div class="ask">
				<span class="spoken">{questionText(parts)}</span><span aria-hidden="true"
					>{#each parts as part, i (i)}{#if 'text' in part}{part.text}{:else if 'fraction' in part}<span
								class="fraction"
								><span class="top">{part.fraction[0]}</span><span class="bottom"
									>{part.fraction[1]}</span
								></span
							>{:else}<BarMark index={part.shape} inline />{/if}{/each}</span
				>
			</div>
		{:else}
			<div class="puzzle-prompt" class:long={puzzle.prompt.length > 11}>{puzzle.prompt}</div>
		{/if}
		<div
			class="answer"
			class:correct={judged?.correct === true}
			class:wrong={judged?.correct === false}
		>
			{#if form === 'time' && input === '' && !watch}<span class="ghost">--:--</span
				>{/if}{shownAnswer(input, form)}<span class="cursor" class:blink={typing}></span>
		</div>
		<div class="foot">
			{#if back}
				<button type="button" class="back" data-press="Escape" {@attach unfocusable}>
					{back}
					{#if !touch.on}<kbd>{t('keys.esc')}</kbd>{/if}
				</button>
			{/if}
			{#if judged}
				<div class="judgement" class:good={judged.correct} class:bad={!judged.correct}>
					{judged.correct ? t('puzzle.correct') : t('puzzle.notQuite')}
					{#if judged.correct && reward}<HitBadge
							damage={reward.damage}
							level={reward.level}
						/>{/if}
				</div>
			{:else if watch}
				<div class="keys">{watch}</div>
			{:else}
				<div class="keys">{reminder}</div>
			{/if}
		</div>
		{#if note}
			<!-- Answered right, the puzzle is done and the note (help another animal) is over:
			     it goes, keeping its place, so nothing moves under "Correct!". `note` names it for
			     the screen that asked: the doctor's card leaves it out on a phone, the list out of view. -->
			<div class="keys note" class:spent={judged?.correct === true}>{note}</div>
		{/if}
	</div>
	{#if touch.on && !watch}
		<NumberPad active={typing} colon={form === 'time'} />
	{/if}
</div>

<style>
	/* Without the pad, the prompt, the answer and the judgement stack in the card that holds them. */
	.puzzle-panel,
	.question {
		display: contents;
	}
	.puzzle-panel.with-pad {
		display: flex;
		align-items: center;
		gap: 16px;
		width: 100%;
	}
	.with-pad .question {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		align-items: center;
		gap: 10px;
	}
	/*
	 * A puzzle with a picture: the picture fills the card's height on the
	 * left, as wide as its shape lets it, and the question, the answer and
	 * the reminder stand beside it (and the pad, on touch, on the right).
	 */
	.puzzle-panel.pictured {
		display: flex;
		align-items: center;
		gap: 20px;
		width: 100%;
		height: 100%;
		min-height: 0;
	}
	.picture-slot {
		flex: 0 1 auto;
		height: 100%;
		aspect-ratio: 3 / 2;
		max-width: 45%;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	/* Beside the pad, the question needs the room more than the picture does. */
	.with-pad.pictured .picture-slot {
		max-width: 36%;
	}
	.pictured .question {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		align-items: center;
		gap: 10px;
	}
	/* The question in words: big, for a kid reading it alone, and wrapped evenly. */
	.ask {
		font-weight: 800;
		font-size: clamp(18px, 3vh, 24px);
		line-height: 1.35;
		max-width: 24em;
		text-wrap: balance;
	}
	/* A fraction stacked, as a maths book writes it: the top over a line over the bottom. */
	.fraction {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		vertical-align: middle;
		margin: 0 0.15em;
		font-size: 1.15em;
		line-height: 1.05;
	}
	.fraction .top {
		padding: 0 0.15em;
		border-bottom: 3px solid currentColor;
	}
	/* The question as a screen reader says it, kept off the screen. */
	.spoken {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.ghost {
		opacity: 0.3;
	}
	/*
	 * A phone held sideways: the card is 220 px tall, so the question is a
	 * size smaller and the reminder goes (the pad's OK, the box's "--:--" and
	 * its colon key say how to answer), and nothing spills out of the card.
	 */
	@media (max-height: 560px) {
		.ask {
			font-size: 16px;
			line-height: 1.25;
		}
		.pictured .question {
			gap: 6px;
		}
		.pictured .foot .keys {
			display: none;
		}
		.with-pad.pictured .picture-slot {
			max-width: 26%;
		}
	}
	/* The token sum's story: what the numbers are, over them. */
	.story {
		font-weight: 800;
		font-size: 18px;
		line-height: 1.3;
		max-width: 26em;
		text-align: center;
	}
	/* The judgement or the key reminder, with Back before it when there is a way back. */
	.foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 8px 14px;
	}
	/*
	 * Beside the pad the column is narrow: the reminder takes the rest of
	 * Back's row, wrapping beside the button, while that row leaves it 8em,
	 * and goes under the button only in a narrower column. Danish's longer
	 * reminder went under it on a tablet, and the card's sum and the line
	 * under it spilled over its top and bottom edges.
	 */
	.with-pad .foot .keys {
		flex: 1 1 8em;
		min-width: 0;
	}
	/* A hint that wraps there wraps evenly, never one word alone on its last line. */
	.with-pad .keys {
		text-wrap: balance;
	}
	/*
	 * The note once the answer was right: unseen, in its place. The druid's
	 * cheer that comes with it can take three lines in Danish, and
	 * the card under it has no room left for the note's last line.
	 */
	.keys.spent {
		visibility: hidden;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 36px;
		padding: 0 16px;
		border-radius: 18px;
		background: rgba(0, 0, 0, 0.07);
		font-weight: 800;
		font-size: 16px;
	}
	:global(.touch) .back {
		min-height: var(--tap);
		padding: 0 22px;
	}
	.back:active {
		transform: translateY(1px) scale(0.97);
	}
	@media (hover: hover) and (pointer: fine) {
		.back:hover {
			background: rgba(255, 159, 67, 0.18);
		}
	}
	.back kbd {
		font-family: inherit;
		font-size: 16px;
		padding: 0 6px;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.08);
	}
	.puzzle-prompt {
		font-weight: 800;
		font-size: clamp(40px, 7vh, 64px);
		line-height: 1.1;
		overflow-wrap: anywhere;
	}
	/* Beside the pad the prompt has half the card: smaller, and a long one smaller still. */
	.with-pad .puzzle-prompt {
		font-size: clamp(32px, 6vh, 52px);
	}
	.with-pad .puzzle-prompt.long {
		font-size: clamp(32px, 4.5vh, 40px);
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
		display: inline-flex;
		align-items: center;
		gap: 10px;
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
	/* Less motion: a small shake; the red border and "Not quite!" say the rest. */
	@keyframes shake-small {
		0%,
		100% {
			transform: translateX(0);
		}
		25% {
			transform: translateX(-2px);
		}
		75% {
			transform: translateX(2px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.answer.wrong {
			animation-name: shake-small;
		}
	}
</style>
