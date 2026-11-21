<script lang="ts">
	import { t } from '../copy';

	/**
	 * Instead of the game, when its code did not load twice in a row (`boot.ts`,
	 * `boot-failure.ts`): the big button loads the page again. Enter or Space
	 * press it from anywhere on the page.
	 */
	let { retry }: { retry: () => void } = $props();

	function keydown(event: KeyboardEvent): void {
		if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		retry();
	}
</script>

<svelte:window onkeydown={keydown} />

<div class="not-loaded">
	<div class="card" role="alert">
		<img class="face" src="/favicon.svg" alt="" width="88" height="88" />
		<h1 class="title">{t('app.notLoaded.title')}</h1>
		<button type="button" class="again" onclick={retry}>
			{t('app.notLoaded.retry')}
			<kbd>{t('keys.enter')}</kbd>
		</button>
		<p class="grown-ups">{t('app.notLoaded.grownUps')}</p>
	</div>
</div>

<style>
	.not-loaded {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		overflow: auto;
		padding: calc(16px + var(--safe-top)) calc(16px + var(--safe-right))
			calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left));
	}
	.card {
		display: grid;
		justify-items: center;
		gap: 12px;
		max-width: 520px;
		box-sizing: border-box;
		padding: 28px 32px 28px;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		text-align: center;
	}
	.face {
		display: block;
	}
	.title {
		margin: 4px 0 6px;
		font-weight: 800;
		font-size: 26px;
		line-height: 1.2;
		text-wrap: balance;
	}
	/* The chunky toy button in the accent: the one thing to press. */
	.again {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		min-height: 64px;
		padding: 0 32px;
		border-radius: 32px;
		margin-bottom: var(--press);
		background: var(--accent);
		box-shadow: 0 var(--press) 0 var(--accent-edge);
		color: white;
		font-weight: 800;
		font-size: 24px;
		transition:
			transform 0.08s ease-out,
			box-shadow 0.08s ease-out;
	}
	.again:active {
		transform: translateY(calc(var(--press) - 1px));
		box-shadow: 0 1px 0 var(--accent-edge);
	}
	.again:focus-visible {
		outline: 3px solid var(--accent-edge);
		outline-offset: 4px;
	}
	kbd {
		font-family: inherit;
		font-size: 16px;
		padding: 2px 8px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.3);
	}
	/* A finger has no Enter key to press. */
	@media (pointer: coarse) {
		kbd {
			display: none;
		}
	}
	.grown-ups {
		margin: 8px 0 0;
		font-weight: 600;
		font-size: 16px;
		line-height: 1.4;
		opacity: 0.75;
	}
</style>
