<script lang="ts">
	import { t } from '../copy';

	/**
	 * Before the game, on an old address (`moved.ts`): the game lives at
	 * `domain` now. The big button goes there, in this tab; Enter or Space
	 * press it. The small link under it starts the game here after all
	 * (`stay`), for a grown-up trying something out; no key of the game's
	 * reaches it, only a click, a tap, or Tab and Enter, so a kid meets the
	 * move before anything else.
	 */
	let { domain, stay }: { domain: string; stay: () => void } = $props();

	const address = $derived(`https://${domain}/`);
	let go: HTMLAnchorElement | undefined = $state();
	let here: HTMLButtonElement | undefined = $state();

	function keydown(event: KeyboardEvent): void {
		if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
		// Tabbed to the small link: the browser presses it, as it does any button.
		if (document.activeElement === here) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		go?.click();
	}
</script>

<svelte:window onkeydown={keydown} />

<!-- Instead of the game, until the kid goes to its address or a grown-up stays (`boot.ts`). -->
<div class="moved">
	<div class="card">
		<img class="face" src="/favicon.svg" alt="" width="88" height="88" />
		<h1 class="title">{t('app.moved.title')}</h1>
		<a class="go" href={address} bind:this={go}>
			{t('app.moved.go', { domain })}
			<kbd>{t('keys.enter')}</kbd>
		</a>
		<button type="button" class="here" bind:this={here} onclick={stay}>
			{t('app.moved.stay')}
		</button>
	</div>
</div>

<style>
	.moved {
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
		padding: 28px 40px 24px;
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
		font-size: 30px;
		line-height: 1.2;
		text-wrap: balance;
	}
	/* The chunky toy button in the accent: the one thing to press. */
	.go {
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
		text-decoration: none;
		transition:
			transform 0.08s ease-out,
			box-shadow 0.08s ease-out;
	}
	.go:active {
		transform: translateY(calc(var(--press) - 1px));
		box-shadow: 0 1px 0 var(--accent-edge);
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
	/* Small and quiet, under the button: for a grown-up. */
	.here {
		margin-top: 10px;
		min-height: 48px;
		padding: 0 12px;
		border-radius: 12px;
		font-weight: 600;
		font-size: 16px;
		color: var(--panel-ink);
		opacity: 0.7;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.go:focus-visible,
	.here:focus-visible {
		outline: 3px solid var(--accent-edge);
		outline-offset: 4px;
	}
</style>
