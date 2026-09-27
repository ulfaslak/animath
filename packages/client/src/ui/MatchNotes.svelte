<script lang="ts">
	import { t } from '../copy';
	import { unfocusable } from '../input/press';
	import { match } from '../state/match.svelte';

	/**
	 * A friendly match's notes, at the top of the battle's screen
	 * ([[UI_SPEC]] § Friendly matches): the connection is being found again,
	 * the other player dropped out and how long they have to come back, and
	 * "Still there?" after a while without a key on the kid's own turn, with
	 * "I'm here!" (any key does it). Written by `MatchController`.
	 */
	const name = $derived(match.other?.name ?? '');
</script>

{#if match.stage === 'playing' || match.stage === 'over'}
	<div class="notes" class:nudging={match.nudged && match.stage === 'playing'}>
		{#if match.offline}
			<div class="note" role="status">{t('match.notes.offline')}</div>
		{:else if match.away !== null && match.stage === 'playing'}
			<div class="note" role="status">
				{t('match.notes.away', { name, seconds: match.away })}
			</div>
		{/if}
		{#if match.nudged && match.stage === 'playing'}
			<div class="note nudge" role="alert">
				<span>{t('match.notes.stillThere')}</span>
				<button type="button" class="here" data-press="Enter" {@attach unfocusable}>
					{t('match.notes.here')}
				</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.notes {
		position: absolute;
		top: calc(16px + var(--safe-top));
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		width: max-content;
		max-width: min(420px, calc(100vw - 2 * 300px));
		pointer-events: none;
	}
	.note {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 8px 16px;
		font-weight: 700;
		text-align: center;
		text-wrap: balance;
	}
	.nudge {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px 10px 18px;
		font-size: 18px;
		pointer-events: auto;
	}
	.here {
		min-height: 48px;
		padding: 0 18px;
		border: none;
		border-radius: 24px;
		background: var(--accent);
		color: white;
		font: inherit;
		font-weight: 800;
		box-shadow: 0 var(--press) 0 var(--accent-edge);
		cursor: pointer;
	}
	.here:active {
		transform: translateY(var(--press));
		box-shadow: none;
	}
	@media (max-width: 900px) {
		.notes {
			max-width: calc(100vw - 32px);
			top: calc(96px + var(--safe-top));
		}
	}
	/*
	 * A short screen (a phone held sideways): the band over the panel has no
	 * room between the status boxes, so a note takes the narration line's
	 * place at the top right, over the player's box (`BattlePanel` hides the
	 * line meanwhile), as wide as it may be. "Still there?" asks the kid
	 * something now: while it is up, it is the one note there.
	 */
	@media (max-height: 560px) {
		.notes {
			top: calc(8px + var(--safe-top));
			right: calc(16px + var(--safe-right));
			left: auto;
			transform: none;
			align-items: flex-end;
			max-width: calc(100vw - 240px - var(--safe-left) - var(--safe-right));
		}
		.note {
			padding: 6px 14px;
		}
		.nudge {
			padding: 4px 4px 4px 14px;
			font-size: 16px;
		}
		.nudging .note:not(.nudge) {
			display: none;
		}
	}
</style>
