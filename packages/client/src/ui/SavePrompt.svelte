<script lang="ts">
	import { t } from '../copy';
	import { rowKey, unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { PROMPT_CHOICES, account, type PromptChoice } from '../state/account.svelte';

	/**
	 * The hourly card ([[UI_SPEC]] § Accounts): after every hour of a guest's
	 * play, while exploring, it offers to keep their animals safe with a
	 * secret password. "Save my game" (lit first) opens the account card;
	 * "Not now" goes back to the game, until another hour has passed. It reads
	 * `account`; keys are `AccountController`'s. A tap on a choice is its
	 * `row:<i>` key.
	 */
	function label(choice: PromptChoice): string {
		switch (choice) {
			case 'save':
				return t('account.prompt.save');
			case 'later':
				return t('account.prompt.later');
		}
	}
</script>

<div class="shade">
	<div class="card" role="dialog" aria-labelledby="save-prompt-heading">
		<div class="heading" id="save-prompt-heading">{t('account.prompt.title')}</div>
		<p>{t('account.prompt.text')}</p>
		<div class="choices">
			{#each PROMPT_CHOICES as choice, i (choice)}
				<button
					type="button"
					class="choice"
					class:save={choice === 'save'}
					class:lit={account.promptChoice === i}
					data-press={rowKey(i)}
					{@attach unfocusable}
				>
					{label(choice)}
				</button>
			{/each}
		</div>
		{#if !touch.on}
			<div class="keys">{t('account.prompt.keys')}</div>
		{/if}
	</div>
</div>

<style>
	.shade {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(45, 42, 50, 0.3);
		padding: calc(16px + var(--safe-top)) calc(16px + var(--safe-right))
			calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left));
		pointer-events: auto;
	}
	.card {
		width: min(520px, 100%);
		box-sizing: border-box;
		padding: 18px 22px 14px;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		color: var(--panel-ink);
		text-align: center;
	}
	.heading {
		font-weight: 800;
		font-size: 28px;
		line-height: 1.2;
		margin: 0 0 6px;
	}
	p {
		margin: 0 0 12px;
		font-weight: 600;
		font-size: 18px;
	}
	.choices {
		display: flex;
		justify-content: center;
		gap: 12px;
	}
	.choice {
		min-height: var(--tap);
		padding: 0 22px;
		border-radius: 24px;
		background: rgba(0, 0, 0, 0.06);
		font-weight: 800;
		font-size: 18px;
	}
	.choice.lit {
		background: rgba(255, 159, 67, 0.3);
		box-shadow: inset 0 0 0 3px var(--accent);
	}
	.choice.save.lit {
		background: var(--accent);
		color: white;
	}
	.choice:active {
		transform: scale(0.97);
	}
	.keys {
		margin-top: 12px;
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
	}
</style>
