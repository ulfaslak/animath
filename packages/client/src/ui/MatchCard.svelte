<script lang="ts">
	import { matchTeam } from '@mathgame/engine';
	import { t } from '../copy';
	import { unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { game } from '../state/game.svelte';
	import { match } from '../state/match.svelte';

	/**
	 * The invite to a friendly match, over the world ([[UI_SPEC]] § Friendly
	 * matches): asked — "<name> wants a friendly match!" with Yes and No and
	 * the time left to answer, while walking goes on; asking — "Asking
	 * <name>…" with the time left and Never mind; and "Here we go!" while the
	 * match is on its way. Enter is Yes (after the quiet moment), Escape is No
	 * or Never mind; a tap is its key. A player with no animal that can fight
	 * on land has only No, and reads why.
	 */
	const ownTeam = $derived(matchTeam(game.party).ok);
	const name = $derived(match.other?.name ?? '');
	/** How much of the time to answer is left, 0..1, for the bar. */
	const share = $derived(match.total > 0 ? Math.max(0, Math.min(1, match.left / match.total)) : 0);
</script>

{#if match.stage === 'invited' || match.stage === 'asking' || match.stage === 'starting'}
	<div class="invite" role="dialog" aria-live="polite">
		{#if match.stage === 'invited'}
			<div class="title">{t('match.invite.title', { name })}</div>
			{#if !ownTeam}<div class="why">{t('match.said.no-team')}</div>{/if}
		{:else if match.stage === 'asking'}
			<div class="title">{t('match.invite.asking', { name })}</div>
		{:else}
			<div class="title">{t('match.invite.starting')}</div>
		{/if}
		{#if match.stage !== 'starting'}
			<div class="time" aria-hidden="true">
				<div class="left" style:width="{share * 100}%"></div>
			</div>
			<div class="buttons">
				{#if match.stage === 'invited'}
					{#if ownTeam}
						<button
							type="button"
							class="button yes"
							class:idle={!match.ready}
							data-press="Enter"
							{@attach unfocusable}
						>
							{t('match.invite.yes')}
							{#if !touch.on}<kbd>{t('keys.enter')}</kbd>{/if}
						</button>
					{/if}
					<button type="button" class="button" data-press="Escape" {@attach unfocusable}>
						{t('match.invite.no')}
						{#if !touch.on}<kbd>{t('keys.esc')}</kbd>{/if}
					</button>
				{:else}
					<button type="button" class="button" data-press="Escape" {@attach unfocusable}>
						{t('match.invite.neverMind')}
						{#if !touch.on}<kbd>{t('keys.esc')}</kbd>{/if}
					</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.invite {
		position: absolute;
		top: calc(64px + var(--safe-top));
		left: 50%;
		transform: translateX(-50%);
		width: max-content;
		/* Clear of the team's column at the left (and the tokens at the right) at 1024 px. */
		max-width: clamp(260px, calc(100vw - 2 * 344px), 460px);
		box-sizing: border-box;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 16px 20px 18px;
		text-align: center;
	}
	.title {
		font-weight: 800;
		font-size: 22px;
		line-height: 1.2;
		text-wrap: balance;
	}
	.why {
		margin-top: 6px;
		font-weight: 600;
	}
	.time {
		margin: 12px auto 0;
		height: 8px;
		border-radius: 4px;
		background: rgba(45, 42, 50, 0.12);
		overflow: hidden;
	}
	.left {
		height: 100%;
		border-radius: 4px;
		background: var(--accent);
		transition: width 0.25s linear;
	}
	.buttons {
		display: flex;
		justify-content: center;
		gap: 12px;
		margin-top: 14px;
	}
	.button {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 48px;
		padding: 0 20px;
		border: none;
		border-radius: 24px;
		background: var(--panel-cream);
		color: var(--panel-ink);
		font: inherit;
		font-weight: 800;
		font-size: 18px;
		box-shadow: 0 var(--press) 0 var(--edge);
		cursor: pointer;
	}
	.button.yes {
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
	kbd {
		font-family: inherit;
		font-size: 16px;
		padding: 2px 7px;
		border-radius: 8px;
		background: rgba(45, 42, 50, 0.1);
	}
	.yes kbd {
		background: rgba(255, 255, 255, 0.3);
	}
	@media (prefers-reduced-motion: reduce) {
		.left {
			transition: none;
		}
	}
</style>
