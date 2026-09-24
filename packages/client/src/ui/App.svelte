<script lang="ts">
	import { game } from '../state/game.svelte';
	import Hud from './Hud.svelte';
</script>

{#if game.mode === 'loading'}
	<div class="loading">Loading…</div>
{:else if game.mode === 'explore'}
	<Hud />
{:else if game.mode === 'battle'}
	<!-- Battle panel lands with the battle-mode issue; see AGENTS/DNA/UI_SPEC.md -->
	<div class="loading">Battle</div>
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
