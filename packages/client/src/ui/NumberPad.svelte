<script lang="ts">
	import { t } from '../copy';
	import { press, unfocusable } from '../input/press';

	/**
	 * The number pad beside a puzzle, with the touch controls on, so a tablet's
	 * own keyboard never comes up over the puzzle. Each key is the key a
	 * keyboard has (`input/press.ts`): a digit, the minus, Backspace, and OK
	 * for Enter, so it types by the same rules (`input/answer.ts`) and a screen
	 * takes it only while it takes keys. A key acts as the finger lands, as a
	 * key on a keyboard does. Phone order, 1 2 3 at the top, and OK tall on
	 * the right, under the right thumb.
	 */
	let {
		active
	}: {
		/** The screen takes typing now; otherwise the pad is dimmed. */
		active: boolean;
	} = $props();

	const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

	/** A key presses as the finger (or the mouse button) goes down, once per press. */
	function key(name: string) {
		return (e: PointerEvent) => {
			if (e.button !== 0) return;
			press(name);
		};
	}
</script>

<div class="pad" class:off={!active}>
	{#each DIGITS as digit (digit)}
		<button type="button" class="key" onpointerdown={key(digit)} {@attach unfocusable}>
			{digit}
		</button>
	{/each}
	<button
		type="button"
		class="key sign"
		aria-label={t('puzzle.minus')}
		onpointerdown={key('-')}
		{@attach unfocusable}>−</button
	>
	<button type="button" class="key" onpointerdown={key('0')} {@attach unfocusable}>0</button>
	<button
		type="button"
		class="key sign"
		aria-label={t('puzzle.delete')}
		onpointerdown={key('Backspace')}
		{@attach unfocusable}>⌫</button
	>
	<button type="button" class="key ok" onpointerdown={key('Enter')} {@attach unfocusable}>
		{t('puzzle.ok')}
	</button>
</div>

<style>
	.pad {
		display: grid;
		grid-template-columns: repeat(3, 56px) 64px;
		grid-template-rows: repeat(4, var(--tap));
		gap: 6px;
		flex: none;
		touch-action: none;
	}
	.key {
		display: grid;
		place-items: center;
		border-radius: 12px;
		background: white;
		box-shadow:
			inset 0 -3px 0 rgba(0, 0, 0, 0.12),
			0 1px 3px rgba(0, 0, 0, 0.12);
		font-weight: 800;
		font-size: 26px;
		font-variant-numeric: tabular-nums;
		transition:
			transform 0.06s,
			background-color 0.06s;
	}
	.key:active {
		transform: translateY(2px);
		box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.12);
		background: color-mix(in srgb, var(--accent) 25%, white);
	}
	.sign {
		background: rgba(255, 255, 255, 0.6);
	}
	.ok {
		grid-column: 4;
		grid-row: 1 / span 4;
		background: var(--accent);
		color: white;
		font-size: 24px;
	}
	.ok:active {
		background: color-mix(in srgb, var(--accent) 80%, black);
	}
	.off {
		opacity: 0.45;
	}
</style>
