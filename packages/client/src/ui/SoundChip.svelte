<script lang="ts">
	import { sfx } from '../audio/sfx.svelte';
	import { t } from '../copy';

	/**
	 * What M just did to the sound, on any screen (UI_SPEC § Sound and juice):
	 * a chip at the top of the screen for three seconds, so turning the
	 * sound off is never only heard as silence. Keyed by `sfx.flips`, so each
	 * press shows it afresh. It never takes a click. `low` puts it under the
	 * title's big name instead of over it.
	 */
	let { low = false }: { low?: boolean } = $props();
</script>

{#if sfx.flips > 0}
	{#key sfx.flips}
		<div class="chip" class:low role="status">
			<span class="state">{sfx.on ? t('sound.chipOn') : t('sound.chipOff')}</span>
			{#if !sfx.on}<span class="hint">{t('sound.chipHint')}</span>{/if}
		</div>
	{/key}
{/if}

<style>
	.chip {
		position: absolute;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 8px 20px;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		pointer-events: none !important;
		/* Long enough for a slow reader: three seconds, the last half-second fading. */
		animation: chip 3s ease-in forwards;
	}
	/* On the title, under "Animath" rather than over it. */
	.chip.low {
		top: clamp(100px, calc(11vh + 52px), 150px);
	}
	.state {
		font-weight: 800;
		font-size: 18px;
	}
	.hint {
		font-weight: 600;
		font-size: 16px;
	}
	@keyframes chip {
		0%,
		83% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
</style>
