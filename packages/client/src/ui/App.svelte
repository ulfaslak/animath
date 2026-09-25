<script lang="ts">
	import { battle } from '../state/battle.svelte';
	import { game } from '../state/game.svelte';
	import { pause } from '../state/pause.svelte';
	import BattlePanel from './BattlePanel.svelte';
	import Hud from './Hud.svelte';
	import PauseMenu from './PauseMenu.svelte';
</script>

{#if game.mode === 'loading'}
	<div class="loading">Loading…</div>
{:else if battle.active}
	{#if !battle.entering}<BattlePanel />{/if}
{:else if pause.open}
	<PauseMenu />
{:else}
	<Hud />
{/if}

<style>
	.loading {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-size: 2rem;
		font-weight: 800;
		color: white;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}
</style>
