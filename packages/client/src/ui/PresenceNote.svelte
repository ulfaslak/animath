<script lang="ts">
	import { fade } from 'svelte/transition';
	import { t } from '../copy';
	import type { Note } from '../presence/notes';
	import { presence } from '../state/presence.svelte';

	/**
	 * The little note at the top of the screen when someone comes into the
	 * player's world or leaves it ("Ada is here!", "Bo went home"), or when
	 * this window stopped showing the player to the others ([[UI_SPEC]]
	 * § Explore mode, "Playing together"). Only over the explore screen, so it
	 * never covers a battle, the doctor or the menu; when and which is
	 * `presence/notes.ts`. It takes no tap.
	 */
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
		<div class="note" role="status" transition:fade={{ duration: 300 }}>
			{words(presence.note)}
		</div>
	{/key}
{/if}

<style>
	.note {
		position: absolute;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		max-width: min(420px, calc(100vw - 2 * 300px));
		min-width: 0;
		box-sizing: border-box;
		padding: 8px 18px;
		border-radius: 999px;
		background: var(--panel-bg);
		box-shadow: var(--hud-shadow);
		color: var(--panel-ink);
		font-weight: 800;
		font-size: 18px;
		text-align: center;
		pointer-events: none;
	}
</style>
