<script lang="ts">
	import { t } from '../copy';
	import { optionKey, unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { battle } from '../state/battle.svelte';
	import { match } from '../state/match.svelte';
	import Celebration from './Celebration.svelte';

	/**
	 * A friendly match's end, over the battle's screen ([[UI_SPEC]] § Friendly
	 * matches): who won, warm for both, with "Rematch?" (a new match once both
	 * have said so) and "Back to exploring"; or, when the server stopped for a
	 * new version mid-match, that the game is updating, with "Play again"
	 * (lit once the friend is back) and "Back to exploring". Left and right
	 * choose, Enter picks after the quiet moment, and a tap is its option's
	 * key (`option:<i>`). Written by `MatchController`; nothing here acts.
	 */
	const name = $derived(match.other?.name ?? '');
	const result = $derived(match.result);
	const updating = $derived(match.stage === 'updating');

	const title = $derived.by(() => {
		if (updating) return t('match.updating.title');
		if (!result) return '';
		if (result.missed) return t('match.result.missed');
		if (result.won) return t('match.result.won');
		if (result.reason === 'timed-out') return t('match.result.idle', { name });
		return t('match.result.lost', { name });
	});

	const text = $derived.by(() => {
		if (updating) {
			if (match.friendAsked) return t('match.updating.asked', { name });
			return match.friendBack ? t('match.updating.text') : t('match.updating.waiting', { name });
		}
		if (!result) return '';
		if (result.missed) return t('match.result.missedText');
		if (result.won) {
			if (result.reason === 'left') return t('match.result.theyLeft', { name });
			if (result.reason === 'timed-out') {
				return result.timeout === 'idle'
					? t('match.result.wanderedOff', { name })
					: t('match.result.hadToGo', { name });
			}
			return t('match.result.wonText', { name });
		}
		if (result.reason === 'timed-out') return t('match.result.idleText');
		return t('match.result.lostText');
	});

	/** How the rematch stands, when there is something to say. */
	const rematchLine = $derived.by(() => {
		if (updating || !result || result.missed) return '';
		const { mine, theirs } = match.rematch;
		if (theirs === false)
			return result.reason === 'all-tired' ? t('match.rematch.went', { name }) : '';
		if (theirs && !mine) return t('match.rematch.theyWant', { name });
		if (mine) return t('match.rematch.waiting', { name });
		return '';
	});

	/** The first button: Rematch? or Play again, greyed when it can do nothing now. */
	const first = $derived.by(() => {
		if (updating) return { label: t('match.updating.again'), off: !match.friendBack };
		const { mine, theirs } = match.rematch;
		return { label: t('match.rematch.button'), off: mine || theirs === false || !!result?.missed };
	});
</script>

<div class="result">
	<div class="card result-card">
		{#if result?.won && !updating}
			<Celebration kind="small" name="" />
		{/if}
		<div class="result-title">{title}</div>
		{#if text}<div class="result-text">{text}</div>{/if}
		{#if rematchLine}<div class="result-text soft">{rematchLine}</div>{/if}
		<div class="buttons">
			<button
				type="button"
				class="button"
				class:lit={match.option === 0}
				class:idle={first.off || !battle.ready}
				data-press={optionKey(0)}
				{@attach unfocusable}
			>
				{first.label}
			</button>
			<button
				type="button"
				class="button"
				class:lit={match.option === 1}
				class:idle={!battle.ready}
				data-press={optionKey(1)}
				{@attach unfocusable}
			>
				{t('match.back')}
			</button>
		</div>
		{#if !touch.on}<div class="keys">{t('match.resultKeys')}</div>{/if}
	</div>
</div>

<style>
	.result {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(45, 42, 50, 0.25);
	}
	.card {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		box-sizing: border-box;
	}
	.result-card {
		position: relative;
		padding: 28px 32px 22px;
		max-width: min(calc(100vw - 32px), 560px);
		text-align: center;
	}
	.result-title {
		font-weight: 800;
		font-size: 36px;
		line-height: 1.15;
		text-wrap: balance;
	}
	.result-text {
		margin-top: 10px;
		font-weight: 600;
		font-size: 18px;
		text-wrap: balance;
	}
	.soft {
		opacity: 0.75;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 14px;
		margin-top: 22px;
	}
	.button {
		display: inline-flex;
		align-items: center;
		min-height: 52px;
		padding: 0 24px;
		border: 3px solid transparent;
		border-radius: 26px;
		background: var(--panel-cream);
		color: var(--panel-ink);
		font: inherit;
		font-weight: 800;
		font-size: 18px;
		box-shadow: 0 var(--press) 0 var(--edge);
		cursor: pointer;
	}
	.button.lit {
		background: var(--accent);
		color: white;
		box-shadow: 0 var(--press) 0 var(--accent-edge);
	}
	.button.idle {
		opacity: 0.45;
	}
	.button:active {
		transform: translateY(var(--press));
		box-shadow: none;
	}
	.keys {
		margin-top: 14px;
		font-size: 14px;
		font-weight: 600;
		opacity: 0.7;
	}
</style>
