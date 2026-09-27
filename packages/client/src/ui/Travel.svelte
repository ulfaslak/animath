<script lang="ts">
	import { t } from '../copy';
	import { doctor } from '../state/doctor.svelte';
	import { pause } from '../state/pause.svelte';
	import { travel } from '../state/travel.svelte';
	import { BANNER_SECONDS } from '../travel/controller';

	/**
	 * A trip to another world ([[UI_SPEC]] § Explore mode, "Travelling"), over
	 * the world: the world closing into a circle of sky round the trainer,
	 * rimmed in cream, and the new one opening out of it (with reduced motion,
	 * the sky fades in and out); then the world's number, big and bouncing in
	 * the title's colours ("World 42!"), with a line for how the kid arrived,
	 * over the world only: a menu or the doctor's card opened meanwhile puts it
	 * away. `TravelController` moves it (`travel`); it never takes a click or a
	 * key.
	 */
	let width = $state(0);
	let height = $state(0);

	/** The rim's width in CSS pixels, while the circle is wide enough to carry it. */
	const RIM = 10;
	/** Seconds the banner takes to fade at the end of its time. */
	const BANNER_FADE = 0.6;

	const circle = $derived.by(() => {
		const cover = travel.cover;
		if (!cover || cover.calm) return null;
		const far =
			Math.max(
				Math.hypot(cover.x, cover.y),
				Math.hypot(width - cover.x, cover.y),
				Math.hypot(cover.x, height - cover.y),
				Math.hypot(width - cover.x, height - cover.y)
			) + RIM;
		// Closing gathers pace as it shuts; opening springs wide and slows at the edges.
		const open = cover.closing ? 1 - cover.p ** 2 : 1 - (1 - cover.p) ** 3;
		const r = far * open;
		return { x: cover.x, y: cover.y, r, rim: Math.min(RIM, r * 0.3) };
	});

	/** How much of the sky the reduced-motion fade shows, 0..1. */
	const sky = $derived.by(() => {
		const cover = travel.cover;
		if (!cover || !cover.calm) return 0;
		return cover.closing ? cover.p : 1 - cover.p;
	});

	const banner = $derived(pause.open || doctor.active ? null : travel.banner);
	const letters = $derived(banner ? Array.from(t('worlds.arrive', { world: banner.world })) : []);
	/** The banner fades away over its last moments. */
	const bannerOpacity = $derived(
		banner ? Math.min(1, Math.max(0, (BANNER_SECONDS - banner.age) / BANNER_FADE)) : 0
	);

	function arrivalLine(arrival: 'new' | 'back' | 'home'): string {
		switch (arrival) {
			case 'new':
				return t('worlds.arriveNew');
			case 'back':
				return t('worlds.arriveBack');
			case 'home':
				return t('worlds.arriveHome');
		}
	}
</script>

<svelte:window bind:innerWidth={width} bind:innerHeight={height} />

{#if circle}
	<div
		class="portal"
		style:--portal-x="{circle.x.toFixed(1)}px"
		style:--portal-y="{circle.y.toFixed(1)}px"
		style:--portal-r="{circle.r.toFixed(1)}px"
		style:--portal-rim="{circle.rim.toFixed(1)}px"
		aria-hidden="true"
	></div>
{:else if travel.cover}
	<div class="sky" style:opacity={sky.toFixed(3)} aria-hidden="true"></div>
{/if}

{#if banner}
	<!-- The fade out on the outside, the pop in on the inside: an animation's last frame would
	     hold the opacity the fade needs. -->
	<div class="banner" style:opacity={bannerOpacity.toFixed(3)}>
		<div class="pop" class:calm={banner.calm}>
			<div class="world" aria-label={t('worlds.arrive', { world: banner.world })}>
				{#each letters as letter, i (i)}
					<span class="letter" style="--i: {i}" aria-hidden="true">{letter}</span>
				{/each}
			</div>
			<div class="line">{arrivalLine(banner.arrival)}</div>
		</div>
	</div>
{/if}

<style>
	/* Above the HUD's open card (z-index 3), under the cards that go over everything (5). */
	.portal,
	.sky,
	.banner {
		z-index: 4;
	}
	.portal,
	.sky {
		position: absolute;
		inset: 0;
		pointer-events: none !important;
	}
	/* The world goes into a circle of sky round the trainer, a cream rim on it: a door to the next world. */
	.portal {
		--portal-x: 50%;
		--portal-y: 50%;
		--portal-r: 0px;
		--portal-rim: 0px;
		background: radial-gradient(
			circle at var(--portal-x) var(--portal-y),
			transparent var(--portal-r),
			var(--panel-cream) calc(var(--portal-r) + 0.5px),
			var(--panel-cream) calc(var(--portal-r) + var(--portal-rim)),
			#8fd3f4 calc(var(--portal-r) + var(--portal-rim) + 0.5px)
		);
	}
	.sky {
		background: #8fd3f4;
	}
	/* The world's number, big, in the upper third, clear of the trainer in the middle. */
	.banner {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(18vh + var(--safe-top));
		pointer-events: none !important;
	}
	.pop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		text-align: center;
		animation: arrive 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	.pop.calm {
		animation: fade-in 0.4s ease-out both;
	}
	.world {
		font-weight: 800;
		font-size: clamp(56px, 10vh, 96px);
		line-height: 1.1;
		white-space: nowrap;
	}
	.letter {
		display: inline-block;
		/* The space in "World 42!" keeps its width, alone in its box. */
		white-space: pre;
		color: var(--logo-color);
		-webkit-text-stroke: 10px var(--panel-cream);
		paint-order: stroke fill;
		text-shadow: 0 7px 0 rgba(45, 42, 50, 0.18);
		animation: bob 1.3s ease-in-out infinite;
		animation-delay: calc(var(--i) * -0.16s);
	}
	.letter:nth-child(5n + 1) {
		--logo-color: var(--coral);
	}
	.letter:nth-child(5n + 2) {
		--logo-color: var(--accent);
	}
	.letter:nth-child(5n + 3) {
		--logo-color: var(--good);
	}
	.letter:nth-child(5n + 4) {
		--logo-color: var(--blue);
	}
	.letter:nth-child(5n) {
		--logo-color: var(--warn);
	}
	.calm .letter {
		animation: none;
	}
	.line {
		font-weight: 800;
		font-size: 22px;
		padding: 6px 18px;
		border-radius: var(--radius);
		background: var(--panel-bg);
		box-shadow: var(--hud-shadow);
	}
	@keyframes arrive {
		from {
			transform: scale(0.4);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes bob {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-8px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pop,
		.letter {
			animation: none;
		}
	}
</style>
