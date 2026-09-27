<script lang="ts">
	import { t } from '../copy';
</script>

<!-- Instead of the game: this browser cannot draw its world (`boot.ts`). -->
<div class="no-webgl">
	<div class="card" role="alert">
		<img class="face" src="/favicon.svg" alt="" width="88" height="88" />
		<h1 class="title">{t('app.noWebGL.title')}</h1>
		<p class="ask">{t('app.noWebGL.ask')}</p>
		<p class="grown-ups">{t('app.noWebGL.grownUps')}</p>
	</div>
</div>

<style>
	.no-webgl {
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
		padding: 28px 32px 32px;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		text-align: center;
	}
	.face {
		display: block;
	}
	.title {
		margin: 4px 0 0;
		font-weight: 800;
		font-size: 26px;
		line-height: 1.2;
	}
	.ask {
		margin: 0;
		font-weight: 800;
		font-size: 20px;
	}
	.grown-ups {
		margin: 8px 0 0;
		font-weight: 600;
		font-size: 16px;
		line-height: 1.4;
		opacity: 0.75;
	}
</style>
