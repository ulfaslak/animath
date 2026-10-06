<script lang="ts">
	import { sfx } from '../audio/sfx.svelte';
	import { t } from '../copy';
	import { flags } from '../flags';
	import { touch } from '../input/touch.svelte';
	import { account } from '../state/account.svelte';
	import { battle } from '../state/battle.svelte';
	import { behind } from '../state/behind.svelte';
	import { doctor } from '../state/doctor.svelte';
	import { game } from '../state/game.svelte';
	import { pause } from '../state/pause.svelte';
	import { title } from '../state/title.svelte';
	import { travel } from '../state/travel.svelte';
	import AccountCard from './AccountCard.svelte';
	import BattlePanel from './BattlePanel.svelte';
	import BehindCard from './BehindCard.svelte';
	import DoctorArrow from './DoctorArrow.svelte';
	import DoctorCard from './DoctorCard.svelte';
	import Hud from './Hud.svelte';
	import Iris from './Iris.svelte';
	import MatchCard from './MatchCard.svelte';
	import Others from './Others.svelte';
	import PauseMenu from './PauseMenu.svelte';
	import PresenceNote from './PresenceNote.svelte';
	import SavePrompt from './SavePrompt.svelte';
	import SoundChip from './SoundChip.svelte';
	import TitleScreen from './TitleScreen.svelte';
	import TouchControls from './TouchControls.svelte';
	import Travel from './Travel.svelte';

	/** A game is under way: not loading, not at the title. */
	const playing = $derived(!title.open && game.mode !== 'loading' && game.mode !== 'title');
</script>

{#if title.open}
	<TitleScreen />
{:else if !playing}
	<!-- Not under the behind card (a newer build's save found at start): the card says it all. -->
	{#if !behind.shown}<div class="loading">{t('app.loading')}</div>{/if}
{:else if battle.active}
	{#if !battle.entering}<BattlePanel />{/if}
{:else if doctor.active}
	<DoctorCard />
{:else if pause.open}
	<PauseMenu />
{:else}
	<!-- The other players' names and the arrows to them, and the way to a doctor while the
	     team is tired: over the world, under the HUD, and never under a card or the menu,
	     whose panels they would show through. -->
	<Others />
	<DoctorArrow />
	<Hud />
	<!-- Not under a trip's cover, which takes no key: a thumb that lands there presses nothing. -->
	{#if touch.on && !travel.active}<TouchControls />{/if}
	<PresenceNote where="top" />
	<!-- A friendly match's invite over the world (its Challenge button is the HUD's). -->
	<MatchCard />
{/if}

<!-- Over the explore HUD: after every 1,000 steps of a guest's game, the offer to keep the game safe. -->
{#if account.prompt && playing}
	<SavePrompt />
{/if}
<!-- Over the title, the pause menu or the game: make an account, or log in. -->
{#if account.card}
	<AccountCard />
{/if}

<SoundChip low={title.open} />
<!-- Over everything, the battle panel included: the encounter transition. -->
<Iris />
<!-- Over the world: a trip to another world, and its number on arrival. -->
<Travel />
{#if behind.shown}
	<!-- Over everything: this page is behind the save, and takes no play. -->
	<BehindCard />
{/if}

{#if flags.debug && playing}
	<!-- `?debug`: where the player stands and which way they face. -->
	<div class="debug">{game.pos.x}, {game.pos.y} · {game.facing}</div>
	<!-- `?debug`: the last cues the screens asked for, newest last; ✕ while sound is off. -->
	{#if sfx.recent.length}
		<div class="debug debug-cue">♪ {sfx.recent.join(' · ')}{sfx.on ? '' : ' ✕'}</div>
	{/if}
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
		/* Over everything: the HUD's open card (3) and a trip to another world (4) included. */
		z-index: 5;
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
	/* Less motion: the tablet lies still on its side, the way to hold it. */
	@media (prefers-reduced-motion: reduce) {
		.tablet {
			animation: none;
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
		/* A badge never takes a tap meant for what is under it. */
		pointer-events: none;
	}
	.debug-cue {
		top: 56px;
	}
</style>
