<script lang="ts">
	import { fade } from 'svelte/transition';
	import { badgeName } from '../badges/words';
	import { t } from '../copy';
	import { motion } from '../motion';
	import { badges } from '../state/badges.svelte';
	import BadgeMedal from './BadgeMedal.svelte';

	/**
	 * A new badge ([[UI_SPEC]] § Explore mode, "A new badge"): its medal and
	 * name over the world, under the top middle, for a few seconds, then the
	 * next one waiting; or, once, how many badges a game picked up was given.
	 * Only over the explore screen, as the presence note; when and which is
	 * `state/badges.svelte.ts`. It takes no tap, and the game goes on under it.
	 */
	const note = $derived(badges.note);
</script>

{#if note}
	{#key note}
		<div
			class="note"
			class:pop={!motion.reduced}
			role="status"
			transition:fade={{ duration: 250 }}
			data-keep-clear
		>
			{#if note.kind === 'new'}
				<BadgeMedal id={note.id} size={52} />
				<span class="words">
					<span class="new">{t('badges.new')}</span>
					<span class="name">{badgeName(note.id)}</span>
				</span>
			{:else}
				<span class="found">{t('badges.found', { count: note.count })}</span>
			{/if}
		</div>
	{/key}
{/if}

<style>
	.note {
		position: absolute;
		/* Under the presence note's row at the top middle, above the kid in the middle. */
		top: calc(72px + var(--safe-top));
		left: 50%;
		transform: translateX(-50%);
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: 12px;
		max-width: min(440px, calc(100vw - 32px - var(--safe-left) - var(--safe-right)));
		padding: 10px 20px 10px 12px;
		border-radius: var(--radius);
		background: var(--panel-cream);
		box-shadow: var(--hud-shadow);
		color: var(--panel-ink);
		pointer-events: none !important;
	}
	.pop {
		animation: pop 0.45s cubic-bezier(0.2, 1.6, 0.4, 1);
	}
	@keyframes pop {
		from {
			transform: translateX(-50%) scale(0.6);
		}
		to {
			transform: translateX(-50%) scale(1);
		}
	}
	.words {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.new {
		font-size: 16px;
		font-weight: 800;
		color: var(--accent-edge);
	}
	.name {
		font-size: 24px;
		font-weight: 900;
		line-height: 1.1;
		overflow-wrap: anywhere;
	}
	.found {
		padding: 4px 6px;
		font-size: 18px;
		font-weight: 800;
		text-align: center;
	}
	/* A phone held sideways: the top corners come nearer the middle, so the note sits a little lower. */
	@media (max-height: 560px) {
		.note {
			top: calc(64px + var(--safe-top));
		}
	}
</style>
