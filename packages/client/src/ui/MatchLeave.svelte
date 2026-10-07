<script lang="ts">
	import { t } from '../copy';
	import { optionKey, unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { match } from '../state/match.svelte';

	/**
	 * "Leave the match?" over a friendly match ([[UI_SPEC]] § Friendly
	 * matches): Escape (or the other's turn card's button, which is Escape)
	 * asks before the kid leaves, and says what leaving does. Stay is lit
	 * first, so a second Escape or an Enter plays on; Leave takes an arrow
	 * and Enter, after the quiet moment, or a tap. Each button is its
	 * option's key (`option:<i>`). Written by `MatchController`; nothing here
	 * acts.
	 */
	const name = $derived(match.other?.name ?? '');
</script>

<div class="leave">
	<div class="card leave-card" role="dialog" aria-label={t('match.leave.ask')}>
		<div class="leave-title">{t('match.leave.ask')}</div>
		<div class="leave-text">{t('match.leave.detail', { name })}</div>
		<div class="buttons">
			<button
				type="button"
				class="button"
				class:lit={match.option === 0}
				class:idle={!match.ready}
				data-press={optionKey(0)}
				{@attach unfocusable}
			>
				{t('match.leave.stay')}
			</button>
			<button
				type="button"
				class="button"
				class:lit={match.option === 1}
				class:idle={!match.ready}
				data-press={optionKey(1)}
				{@attach unfocusable}
			>
				{t('match.leave.go')}
			</button>
		</div>
		{#if !touch.on}<div class="keys">{t('match.leave.keys')}</div>{/if}
	</div>
</div>

<style>
	.leave {
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
	/* Solid, where the other cards let the world through: the narration line runs under it. */
	.leave-card {
		background: var(--panel-cream);
		padding: 24px 28px 20px;
		max-width: min(calc(100vw - 32px), 480px);
		text-align: center;
	}
	.leave-title {
		font-weight: 800;
		font-size: 28px;
		line-height: 1.15;
		text-wrap: balance;
	}
	.leave-text {
		margin-top: 8px;
		font-weight: 600;
		font-size: 18px;
		text-wrap: balance;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 14px;
		margin-top: 20px;
	}
	.button {
		display: inline-flex;
		align-items: center;
		min-height: 52px;
		min-width: 120px;
		justify-content: center;
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
		font-size: 16px;
		font-weight: 600;
		opacity: 0.7;
	}
</style>
