<script lang="ts">
	import { t } from '../copy';
</script>

<!-- Another window of the game has played on: this one takes no play until it
     has the newest game (`save/behind.ts`). Over every screen, battle included. -->
<div class="behind">
	<div class="card">
		<div class="title">{t('save.behind')}</div>
		<div class="button">{t('save.behindGo')} <kbd>{t('keys.enter')}</kbd></div>
	</div>
</div>

<style>
	.behind {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgba(45, 42, 50, 0.45);
	}
	.card {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 28px 40px 32px;
		max-width: min(calc(100vw - 32px), 520px);
		box-sizing: border-box;
		text-align: center;
	}
	.title {
		font-weight: 800;
		font-size: 28px;
		line-height: 1.2;
	}
	.button {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		margin-top: 22px;
		min-height: 48px;
		padding: 0 26px;
		border-radius: 24px;
		background: var(--accent);
		color: white;
		font-weight: 800;
		font-size: 18px;
	}
	kbd {
		font-family: inherit;
		font-size: 16px;
		padding: 2px 8px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.3);
	}
</style>
