<script lang="ts">
	import { t } from '../copy';
	import { surprise } from '../state/surprise.svelte';
	import Celebration from './Celebration.svelte';

	/**
	 * The druid's surprise party ([[UI_SPEC]] § Explore mode, "The
	 * surprise"): the catch that completed a land, once the kid is back in the
	 * world. Confetti rains over the whole screen, and a card under the
	 * trainer (above them on a short screen) says "Hooray!" in the result card's big letters, over the rays and the
	 * stars (`Celebration`), and that every animal of the land is caught; the
	 * message line under it says the druid has a surprise. Nothing here
	 * takes a key or a tap: the kid walks on while it plays, for
	 * `PARTY_SECONDS`. With reduced motion the confetti stays still and fades.
	 */

	/** Each piece of confetti: where it starts across the screen (%), its delay and fall (s), its colour, its turn. */
	const PIECES = Array.from({ length: 48 }, (_, i) => ({
		x: (i * 37) % 100,
		d: ((i * 13) % 20) / 10,
		fall: 2.4 + ((i * 7) % 10) / 8,
		c: ['coral', 'gold', 'green', 'blue', 'accent'][i % 5],
		spin: i % 2 === 0 ? 1 : -1
	}));
</script>

{#if surprise.party}
	{@const party = surprise.party}
	<div class="surprise" aria-live="polite">
		<div class="confetti" aria-hidden="true">
			{#each PIECES as p, k (k)}
				<i
					class="piece {p.c}"
					style="left: {p.x}%; animation-delay: {p.d}s; animation-duration: {p.fall}s; --spin: {p.spin}"
				></i>
			{/each}
		</div>
		<div class="card">
			<Celebration kind="big" name={t('surprise.hooray')} />
			<div class="words">
				{t('surprise.caughtAll', { from: t(`lands.${party.from}.inLine`) })}
			</div>
		</div>
	</div>
{/if}

<style>
	.surprise {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		animation: fade-out 0.6s ease-in 4.4s forwards;
	}
	.confetti {
		position: absolute;
		inset: 0;
	}
	.piece {
		position: absolute;
		top: -24px;
		width: 10px;
		height: 16px;
		border-radius: 2px;
		animation: fall linear infinite both;
	}
	.piece.coral {
		background: var(--coral);
	}
	.piece.gold {
		background: var(--warn);
	}
	.piece.green {
		background: var(--good);
	}
	.piece.blue {
		background: var(--blue);
	}
	.piece.accent {
		background: var(--accent);
	}
	@keyframes fall {
		from {
			transform: translateY(0) rotate(0deg);
		}
		to {
			transform: translateY(calc(100vh + 48px)) rotate(calc(var(--spin) * 540deg));
		}
	}
	/*
	 * Under the trainer, who stands in the middle of the screen, so they stay
	 * in view; on a short screen (a phone held sideways), above them, clear of
	 * the message line.
	 */
	.card {
		--from: translate(-50%, 0);
		position: absolute;
		left: 50%;
		top: calc(50% + 56px);
		transform: var(--from);
		width: min(calc(100vw - 32px), 520px);
		box-sizing: border-box;
		padding: 20px 24px 22px;
		border-radius: var(--radius);
		background: var(--panel-bg);
		color: var(--panel-ink);
		box-shadow: var(--hud-shadow);
		text-align: center;
		animation: pop-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	.words {
		font-weight: 800;
		font-size: 22px;
		line-height: 1.25;
	}
	@keyframes pop-in {
		from {
			transform: var(--from) scale(0.6);
			opacity: 0;
		}
	}
	@keyframes fade-out {
		to {
			opacity: 0;
		}
	}
	@media (max-height: 560px) {
		.card {
			--from: translate(-50%, -100%);
			top: calc(50% - 72px);
			padding: 12px 20px 14px;
		}
		.words {
			font-size: 18px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.piece {
			animation: none;
			top: auto;
			opacity: 0.85;
		}
		.piece:nth-child(odd) {
			top: 8%;
		}
		.piece:nth-child(even) {
			top: 82%;
		}
		.card {
			animation: none;
		}
	}
</style>
