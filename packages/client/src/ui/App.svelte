<script lang="ts">
	import { sfx } from '../audio/sfx.svelte';
	import { t } from '../copy';
	import { flags } from '../flags';
	import { battle } from '../state/battle.svelte';
	import { doctor } from '../state/doctor.svelte';
	import { game } from '../state/game.svelte';
	import { pause } from '../state/pause.svelte';
	import { title } from '../state/title.svelte';
	import BattlePanel from './BattlePanel.svelte';
	import DoctorCard from './DoctorCard.svelte';
	import Hud from './Hud.svelte';
	import Iris from './Iris.svelte';
	import PauseMenu from './PauseMenu.svelte';
	import SoundChip from './SoundChip.svelte';
	import TitleScreen from './TitleScreen.svelte';

	/** A game is under way: not loading, not at the title. */
	const playing = $derived(!title.open && game.mode !== 'loading' && game.mode !== 'title');
</script>

{#if title.open}
	<TitleScreen />
{:else if !playing}
	<div class="loading">{t('app.loading')}</div>
{:else if battle.active}
	{#if !battle.entering}<BattlePanel />{/if}
{:else if doctor.active}
	<DoctorCard />
{:else if pause.open}
	<PauseMenu />
{:else}
	<Hud />
{/if}

<SoundChip />
<!-- Over everything, the battle panel included: the encounter transition. -->
<Iris />

{#if flags.debug && playing}
	<!-- `?debug`: where the player stands and which way they face. -->
	<div class="debug">{game.pos.x}, {game.pos.y} · {game.facing}</div>
	<!-- `?debug`: the last cues the screens asked for, newest last; ✕ while sound is off. -->
	{#if sfx.recent.length}
		<div class="debug debug-cue">♪ {sfx.recent.join(' · ')}{sfx.on ? '' : ' ✕'}</div>
	{/if}
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
	.debug-cue {
		top: 56px;
	}
</style>
