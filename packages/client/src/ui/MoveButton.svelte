<script lang="ts">
	import { unfocusable } from '../input/press';
	import MoveIcon, { type MoveIconName } from './MoveIcon.svelte';

	/**
	 * One of the other moves under the attacks (Leash, Switch, Run; a
	 * friendly match's Switch and Leave): a smaller round button in a calmer
	 * tone than the attack tiles, with the move's picture on it and its word
	 * under it, so the row reads as "other moves", not more attacks. `hint`
	 * is a word with a colour, a ring round the button in that colour and
	 * the word under the button's (the leash's catch hint: the odds never as
	 * a number). `off` greys a move that can do nothing now, whose sentence
	 * says why. A button for its key (`press`): a tap only highlights.
	 */
	let {
		icon,
		label,
		press,
		selected = false,
		off = false,
		hint
	}: {
		icon: MoveIconName;
		label: string;
		press: string;
		selected?: boolean;
		off?: boolean;
		hint?: { band: 'good' | 'warn' | 'bad'; words: string };
	} = $props();
</script>

<button
	type="button"
	class="move"
	class:selected
	class:off
	class:hinted={hint !== undefined}
	data-press={press}
	{@attach unfocusable}
>
	<span class="disc {hint ? `ring ${hint.band}` : ''}"><MoveIcon name={icon} /></span>
	<span class="word">{label}</span>
	{#if hint}<span class="hint {hint.band}">{hint.words}</span>{/if}
</button>

<style>
	/*
	 * Each move an even share of its row, whatever its words say, so the row
	 * stands still when the leash's hint changes; the one with a hint a little
	 * more, for its longer words.
	 */
	.move {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex: 1 1 0;
		min-width: 72px;
		min-height: var(--tap);
		padding: 2px 4px;
		box-sizing: border-box;
		border-radius: 14px;
	}
	.hinted {
		flex-grow: 1.4;
	}
	.disc {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		flex: none;
		/* Room under the face for its edge. */
		margin-bottom: calc(var(--press) + 1px);
		border-radius: 50%;
		background: color-mix(in srgb, var(--blue) 10%, var(--panel-cream));
		box-shadow: 0 var(--press) 0 var(--edge);
		transition:
			transform 0.08s ease-out,
			box-shadow 0.08s ease-out;
	}
	:global(.touch) .disc {
		width: 46px;
		height: 46px;
	}
	/* The leash's hint: a ring in its colour, inside the rim, and its word underneath. */
	.ring {
		--band: var(--bad);
	}
	.ring.good {
		--band: var(--good);
	}
	.ring.warn {
		--band: var(--warn);
	}
	.ring {
		box-shadow:
			inset 0 0 0 4px var(--band),
			0 var(--press) 0 var(--edge);
	}
	.word {
		font-weight: 800;
		font-size: 16px;
		line-height: 1.25;
		white-space: nowrap;
	}
	.hint {
		margin-top: 1px;
		padding: 0 5px;
		border-radius: 8px;
		font-weight: 800;
		font-size: 16px;
		line-height: 1.25;
		white-space: nowrap;
		background: color-mix(in srgb, var(--band) 35%, var(--panel-cream));
	}
	.hint {
		--band: var(--bad);
	}
	.hint.good {
		--band: var(--good);
	}
	.hint.warn {
		--band: var(--warn);
	}
	/* The highlighted move: lifted and ringed in the accent, as the highlighted attack is. */
	.selected .disc {
		transform: translateY(-1px) scale(1.05);
		box-shadow:
			0 0 0 3px var(--accent),
			0 var(--press) 0 var(--edge);
	}
	.selected .disc.ring {
		box-shadow:
			inset 0 0 0 4px var(--band),
			0 0 0 3px var(--accent),
			0 var(--press) 0 var(--edge);
	}
	.selected .word {
		text-decoration: underline 3px var(--accent);
		text-underline-offset: 3px;
	}
	/* Pressed: the face squashes down onto its edge. */
	.move:active .disc {
		transform: translateY(calc(var(--press) - 1px));
		box-shadow: 0 1px 0 var(--edge);
	}
	/* Nothing to do here now (a greyed Switch): still readable, clearly out, flat. */
	.off {
		opacity: 0.45;
	}
	.off .disc {
		box-shadow: none;
		transform: translateY(var(--press));
		filter: grayscale(1);
	}
	.off.selected .disc {
		box-shadow: 0 0 0 3px var(--accent);
	}
	@media (hover: hover) and (pointer: fine) {
		.move:not(.selected):not(.off):hover .disc {
			background: color-mix(in srgb, var(--blue) 18%, var(--panel-cream));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.disc {
			transition: none;
		}
	}
	/*
	 * A short screen (a phone held sideways): the moves stand in a column
	 * beside the attack tiles, so each is a little shorter. The button is
	 * still a finger tall and wide.
	 */
	@media (max-height: 560px) {
		.disc,
		:global(.touch) .disc {
			width: 36px;
			height: 36px;
		}
		.word,
		.hint {
			line-height: 1.15;
		}
	}
</style>
