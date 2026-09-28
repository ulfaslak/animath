<script lang="ts">
	import type { AttackLevel } from '@mathgame/engine';

	/**
	 * A hit landing: a comic starburst with the damage in it ("−14"), popped
	 * beside the status box of the animal hit (`StatusBox` places it). Its
	 * size follows the hit's level, so a hard hit's burst is plainly bigger
	 * than an easy one's, in the hit badge's colours for that level: the
	 * badge a kid picked is the burst that lands. It pops in, holds and fades
	 * within the hit's beat, so it adds no wait; with reduced motion it only
	 * fades in and out where it is. The number is text, never only colour.
	 */
	let { damage, level }: { damage: number; level: AttackLevel } = $props();
</script>

<span class="burst l{level}">
	<svg class="shape" viewBox="0 0 100 100" aria-hidden="true">
		<polygon
			points="50 2 58.5 18.1 71.6 12.6 73.3 26.7 91.6 26 81.9 41.5 95.1 50 81.9 58.5 86.6 71.1 73.3 73.3 74 91.6 58.5 81.9 50 94.2 41.5 81.9 26 91.6 26.7 73.3 12.6 71.6 18.1 58.5 3.4 50 18.1 41.5 13.8 29.1 26.7 26.7 26 8.4 41.5 18.1"
		/>
	</svg>
	<span class="n">−{damage}</span>
</span>

<style>
	.burst {
		position: relative;
		display: grid;
		place-items: center;
		width: var(--size);
		height: var(--size);
		pointer-events: none;
		animation: burst 1.1s ease-out forwards;
	}
	/* By the hit's level: the hit badge's colours, and plainly bigger each step. */
	.l1 {
		--size: 60px;
		--text: 22px;
		--fill: var(--warn);
	}
	.l2 {
		--size: 72px;
		--text: 26px;
		--fill: var(--accent);
	}
	.l3 {
		--size: 84px;
		--text: 30px;
		--fill: var(--coral);
	}
	.shape {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		filter: drop-shadow(0 3px 0 rgba(45, 42, 50, 0.25));
	}
	.shape polygon {
		fill: var(--fill);
		stroke: var(--panel-cream);
		stroke-width: 5;
		stroke-linejoin: round;
	}
	.n {
		position: relative;
		font-weight: 800;
		font-size: var(--text);
		line-height: 1;
		color: var(--panel-ink);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	@keyframes burst {
		0% {
			opacity: 0;
			transform: scale(0.3) rotate(-14deg);
		}
		14% {
			opacity: 1;
			transform: scale(1.12) rotate(4deg);
		}
		26% {
			transform: scale(1) rotate(0deg);
		}
		72% {
			opacity: 1;
			transform: scale(1);
		}
		100% {
			opacity: 0;
			transform: scale(0.94);
		}
	}
	/* Less motion: it fades in and out where it is, at its size. */
	@keyframes burst-still {
		0%,
		100% {
			opacity: 0;
		}
		15%,
		72% {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.burst {
			animation-name: burst-still;
		}
	}
	/*
	 * A short screen (a phone held sideways): a size smaller, as the status
	 * boxes it pops beside are, so a hard hit's burst stays on the screen and
	 * off the panel, and still plainly bigger at each level.
	 */
	@media (max-height: 560px) {
		.l1 {
			--size: 48px;
			--text: 18px;
		}
		.l2 {
			--size: 56px;
			--text: 21px;
		}
		.l3 {
			--size: 64px;
			--text: 24px;
		}
	}
</style>
