<script lang="ts">
	import type { HintToken, PuzzleHint } from '@mathgame/engine';
	import WandIcon from './WandIcon.svelte';

	/**
	 * A puzzle's hint, drawn from the engine's `puzzleHint` (UI_SPEC § Battle
	 * mode, "Hints"), in the trainer's blue:
	 * - an equation on a line of its own under the prompt, the wand before
	 *   it, each part to work out first on a pale pill of sky ("? = (10 × 8)
	 *   + (3 × 8)"); it wraps between its pieces, never inside a pill;
	 * - dots to count, in rows of five: `a` and then `b` more in the accent,
	 *   or `a` with the last `b` crossed out, taken away;
	 * - a number pattern's jumps over its numbers: the prompt itself, each
	 *   jump ("+5") in small type on a little arc over the comma between two
	 *   numbers, the last one "+?". `numbers` are the pattern's numbers.
	 * A screen reader reads the hint as its signs and numbers ("? = (10 × 8)
	 * + (3 × 8)"); the drawing itself is not read.
	 */
	let { hint, numbers = [] }: { hint: PuzzleHint; numbers?: readonly number[] } = $props();

	/** A number with a real minus sign, as the prompts write one. */
	function shown(t: HintToken): string {
		return typeof t === 'number' && t < 0 ? `−${-t}` : String(t);
	}

	/**
	 * The equation in runs: a pill's pieces together, every other piece on its
	 * own. A pill after a minus or a share sign shows its brackets too
	 * (`bracketed`): there the order is the sum, and 1 − 1 − (2 − 1) read left
	 * to right without them would be −3.
	 */
	const runs = $derived.by(() => {
		if (hint.form !== 'equation') return [];
		const out: { pill: boolean; bracketed: boolean; tokens: HintToken[] }[] = [];
		let pill: HintToken[] | null = null;
		let before: HintToken | null = null;
		for (const t of hint.tokens) {
			if (t === '(') pill = [];
			else if (t === ')') {
				out.push({ pill: true, bracketed: before === '−' || before === '÷', tokens: pill ?? [] });
				pill = null;
			} else if (pill) pill.push(t);
			else out.push({ pill: false, bracketed: false, tokens: [t] });
			if (!pill && t !== ')') before = t;
		}
		return out;
	});

	const spoken = $derived(
		hint.form === 'equation'
			? hint.tokens.map(shown).join(' ').replace(/\( /g, '(').replace(/ \)/g, ')')
			: hint.form === 'dots'
				? [hint.a, hint.take ? '−' : '+', hint.b].join(' ')
				: [...hint.gaps.map((g) => (g < 0 ? `−${-g}` : `+${g}`)), '+?'].join(', ')
	);
	/** A jump as it is written over the numbers: "+5", or "+?" for the one still to find. */
	const jumps = $derived(
		hint.form === 'gaps' ? [...hint.gaps.map((g) => (g < 0 ? `−${-g}` : `+${g}`)), '+?'] : []
	);
</script>

<span class="spoken">{spoken}</span>
{#if hint.form === 'gaps'}
	<span class="gaps" aria-hidden="true"
		>{#each numbers as n, i (i)}<span class="term">{n}</span><span class="step"
				>,<span class="jump"
					><span class="by">{jumps[i]}</span><svg viewBox="0 0 40 12" class="arc"
						><path d="M3 11 Q20 -2 37 11" /></svg
					></span
				></span
			>{/each}<span class="term">?</span></span
	>
{:else}
	<div class="hint" aria-hidden="true">
		{#if hint.form === 'equation'}
			<span class="sum">
				<WandIcon size={26} />
				{#each runs as run, i (i)}
					{#if run.pill}
						<span class="pill"
							>{#if run.bracketed}<span class="bracket">(</span
								>{/if}{#each run.tokens as t, k (k)}<span class="piece">{shown(t)}</span
								>{/each}{#if run.bracketed}<span class="bracket">)</span>{/if}</span
						>
					{:else}
						<span class="piece" class:unknown={run.tokens[0] === '?' || run.tokens[0] === '□'}
							>{shown(run.tokens[0]!)}</span
						>
					{/if}
				{/each}
			</span>
		{:else}
			<span class="sum">
				<WandIcon size={26} />
				<span class="dots">
					{#each Array.from({ length: hint.a }, (_, k) => k) as k (k)}
						<i class="dot" class:gone={hint.take && k >= hint.a - hint.b}></i>
					{/each}
				</span>
				{#if !hint.take}
					<span class="piece">+</span>
					<span class="dots">
						{#each Array.from({ length: hint.b }, (_, k) => k) as k (k)}
							<i class="dot more"></i>
						{/each}
					</span>
				{/if}
			</span>
		{/if}
	</div>
{/if}

<style>
	.spoken {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	/* Its size: a screen that fits it to a card (the druid's) sets `--hint-size` smaller. */
	.hint {
		display: flex;
		justify-content: center;
		max-width: 100%;
		color: var(--blue);
		font-weight: 800;
		font-size: var(--hint-size, clamp(22px, 3.6vh, 30px));
		line-height: 1.2;
	}
	.sum {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 4px 8px;
		min-width: 0;
	}
	.piece {
		white-space: nowrap;
	}
	/* A part to work out first: a pale tile of sky, as the operator chips are. */
	.pill {
		display: inline-flex;
		gap: 8px;
		padding: 1px 10px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--blue) 14%, var(--panel-cream));
		white-space: nowrap;
	}
	/* A pill's brackets, where the order matters: close to what they hold. */
	.bracket {
		margin-inline: -5px;
	}
	/* Dots to count, in rows of five. */
	.dots {
		display: grid;
		grid-template-columns: repeat(5, auto);
		gap: 4px;
	}
	.dot {
		display: block;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--blue);
	}
	.dot.more {
		background: var(--accent);
	}
	/* Taken away: pale, and crossed out. */
	.dot.gone {
		position: relative;
		background: color-mix(in srgb, var(--blue) 25%, var(--panel-cream));
	}
	.dot.gone::after {
		content: '';
		position: absolute;
		left: -2px;
		right: -2px;
		top: 7px;
		height: 3px;
		border-radius: 2px;
		background: var(--panel-ink);
		transform: rotate(-45deg);
	}
	/* A pattern's jumps over its numbers, in the prompt's own type. */
	.gaps {
		display: inline-block;
		padding-top: 0.5em;
		white-space: nowrap;
	}
	.step {
		position: relative;
		display: inline-block;
		width: 0.75em;
		text-align: left;
	}
	.jump {
		position: absolute;
		left: 50%;
		bottom: 0.95em;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		color: var(--blue);
		line-height: 1;
	}
	.by {
		font-size: max(16px, 0.36em);
	}
	.arc {
		width: 1.25em;
		height: 0.35em;
		fill: none;
		stroke: var(--blue);
		stroke-width: 3;
		stroke-linecap: round;
	}
</style>
