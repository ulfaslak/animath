<script lang="ts">
	import { t } from '../copy';
	import { unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { match, type ButtonRefusal } from '../state/match.svelte';

	/**
	 * "Challenge <name>" over the world, above the message line (the HUD
	 * stacks them: `Hud.svelte`'s bottom column), when another
	 * player stands within reach ([[UI_SPEC]] § Friendly matches): C, or a tap,
	 * asks them. Greyed, it says why in the kid's words: they are busy or out on
	 * the water, the player is on the water or has no animal that can fight on
	 * land, or they said no a moment ago. Written by `MatchController`.
	 */
	const button = $derived(match.button);

	function why(refusal: ButtonRefusal, name: string): string {
		switch (refusal) {
			case 'they-busy':
				return t('match.button.busy', { name });
			case 'they-water':
				return t('match.button.theyWater', { name });
			case 'water':
				return t('match.button.water');
			case 'no-team':
				return t('match.button.noTeam');
			case 'wait':
				return t('match.button.wait', { name });
		}
	}
</script>

{#if button && match.stage === 'none'}
	<button
		type="button"
		class="challenge"
		class:off={button.refusal !== null}
		data-press="c"
		{@attach unfocusable}
	>
		<span class="label">
			{t('match.button.challenge', { name: button.name })}
			{#if !touch.on && button.refusal === null}<kbd>{t('keys.challenge')}</kbd>{/if}
		</span>
		{#if button.refusal}<span class="why">{why(button.refusal, button.name)}</span>{/if}
	</button>
{/if}

<style>
	.challenge {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		min-height: 52px;
		max-width: min(420px, 100%);
		padding: 8px 22px;
		border: none;
		border-radius: 26px;
		background: var(--accent);
		color: white;
		font: inherit;
		box-shadow:
			0 var(--press) 0 var(--accent-edge),
			var(--hud-shadow);
		cursor: pointer;
	}
	.challenge:active {
		transform: translateY(var(--press));
		box-shadow: var(--hud-shadow);
	}
	.challenge.off {
		background: var(--panel-bg);
		color: var(--panel-ink);
		box-shadow:
			0 var(--press) 0 var(--edge),
			var(--hud-shadow);
		cursor: default;
	}
	.label {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-weight: 800;
		font-size: 19px;
	}
	.off .label {
		opacity: 0.55;
	}
	.why {
		font-weight: 600;
		font-size: 14px;
	}
	kbd {
		font-family: inherit;
		font-size: 14px;
		padding: 1px 8px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.3);
	}
</style>
