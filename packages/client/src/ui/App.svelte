<script lang="ts">
	import { flags } from '../flags';
	import { battle } from '../state/battle.svelte';
	import { doctor } from '../state/doctor.svelte';
	import { game } from '../state/game.svelte';
	import { pause } from '../state/pause.svelte';
	import BattlePanel from './BattlePanel.svelte';
	import DoctorCard from './DoctorCard.svelte';
	import Hud from './Hud.svelte';
	import PauseMenu from './PauseMenu.svelte';
</script>

{#if game.mode === 'loading'}
	<div class="loading">Loading…</div>
{:else if battle.active}
	{#if !battle.entering}<BattlePanel />{/if}
{:else if doctor.active}
	<DoctorCard />
{:else if pause.open}
	<PauseMenu />
{:else}
	<Hud />
{/if}

{#if flags.debug && game.mode !== 'loading'}
	<!-- `?debug`: where the player stands and which way they face. -->
	<div class="debug">{game.pos.x}, {game.pos.y} · {game.facing}</div>
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
	.debug {
		position: absolute;
		top: 16px;
		right: 16px;
		padding: 4px 10px;
		border-radius: 8px;
		background: rgba(45, 42, 50, 0.6);
		color: white;
		font-weight: 600;
		font-size: 16px;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}
</style>
