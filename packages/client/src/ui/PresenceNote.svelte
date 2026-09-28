<script lang="ts">
	import { fade } from 'svelte/transition';
	import { t } from '../copy';
	import type { Note } from '../presence/notes';
	import { presence } from '../state/presence.svelte';

	/**
	 * The little note when someone comes into the player's world or leaves it
	 * ("Ada is here!", "Bo went home"), or when this window stopped showing
	 * the player to the others ([[UI_SPEC]] § Explore mode, "Playing
	 * together"). Only over the explore screen, so it never covers a battle,
	 * the doctor or the menu; when and which is `presence/notes.ts`. It takes
	 * no tap.
	 *
	 * Where (`where`): at the top of the screen, in the middle, between the
	 * two top corners; on a short screen (a phone held sideways, under 560 px
	 * tall), where the top corners leave no room between them, over the
	 * message line instead, at the top of the HUD's bottom column. The page
	 * has both, and shows the one its screen asks for. While it shows, the
	 * marks at the edge of the screen keep clear of it (`data-keep-clear`).
	 */
	let { where }: { where: 'top' | 'bottom' } = $props();

	function words(note: Note): string {
		if (note.kind === 'elsewhere') return t('presence.elsewhere');
		const [name = '', other = ''] = note.names;
		const base = note.kind === 'arrived' ? 'presence.arrived' : 'presence.left';
		if (note.names.length === 1) return t(base, { name });
		if (note.names.length === 2) return t(`${base}Two`, { name, other });
		return t(`${base}Many`, { name, count: note.names.length - 1 });
	}
</script>

{#if presence.note}
	{#key presence.note.id}
		<div class="note {where}" role="status" transition:fade={{ duration: 300 }} data-keep-clear>
			{words(presence.note)}
		</div>
	{/key}
{/if}

<style>
	.note {
		box-sizing: border-box;
		padding: 8px 18px;
		border-radius: 999px;
		background: var(--panel-bg);
		box-shadow: var(--hud-shadow);
		color: var(--panel-ink);
		font-weight: 800;
		font-size: 18px;
		text-align: center;
		/* Not even in the HUD's bottom column, whose pieces take taps. */
		pointer-events: none !important;
	}
	.top {
		position: absolute;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		max-width: min(420px, calc(100vw - 2 * 300px));
		min-width: 0;
	}
	/* Over the message line, in the HUD's bottom column, which is as wide as the room between the thumbs. */
	.bottom {
		display: none;
		max-width: 100%;
	}
	@media (max-height: 560px) {
		.top {
			display: none;
		}
		.bottom {
			display: block;
		}
	}
</style>
