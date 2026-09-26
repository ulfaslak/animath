<script lang="ts">
	import { t } from '../copy';
	import { flags } from '../flags';
	import { touch } from '../input/touch.svelte';
	import { battle } from '../state/battle.svelte';
	import { doctor } from '../state/doctor.svelte';
	import { game } from '../state/game.svelte';
	import { pause } from '../state/pause.svelte';
	import BattlePanel from './BattlePanel.svelte';
	import DoctorCard from './DoctorCard.svelte';
	import Hud from './Hud.svelte';
	import PauseMenu from './PauseMenu.svelte';
	import TouchControls from './TouchControls.svelte';
</script>

{#if game.mode === 'loading'}
	<div class="loading">{t('app.loading')}</div>
{:else if battle.active}
	{#if !battle.entering}<BattlePanel />{/if}
{:else if doctor.active}
	<DoctorCard />
{:else if pause.open}
	<PauseMenu />
{:else}
	<Hud />
	{#if touch.on}<TouchControls />{/if}
{/if}

{#if flags.debug && game.mode !== 'loading'}
	<!-- `?debug`: where the player stands and which way they face. -->
	<div class="debug">{game.pos.x}, {game.pos.y} · {game.facing}</div>
{/if}

{#if touch.on && touch.portrait}
	<!-- A touch screen held upright: the layout needs it sideways. Over everything, taps included. -->
	<div class="turn">
		<div class="turn-card">
			<div class="tablet" aria-hidden="true"></div>
			<div class="turn-text">{t('explore.turnSideways')}</div>
		</div>
	</div>
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
	.turn {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 16px;
		background: #8fd3f4;
	}
	.turn-card {
		display: grid;
		justify-items: center;
		gap: 24px;
		max-width: 420px;
		padding: 32px 28px;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		text-align: center;
	}
	.turn-text {
		font-weight: 800;
		font-size: 24px;
		line-height: 1.25;
	}
	/* A tablet, upright, turning onto its side. */
	.tablet {
		width: 64px;
		height: 92px;
		border: 6px solid var(--panel-ink);
		border-radius: 12px;
		animation: turn 2.4s ease-in-out infinite;
	}
	@keyframes turn {
		0%,
		25% {
			transform: rotate(0deg);
		}
		60%,
		100% {
			transform: rotate(-90deg);
		}
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
