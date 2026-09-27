<script lang="ts">
	import { t } from '../copy';
	import { doctorWay } from '../state/doctor-way.svelte';

	/**
	 * The way to the nearest doctor's tent while the team needs the doctor
	 * ([[UI_SPEC]] § Explore mode): a cream disc with a little tent on it, at
	 * the edge of the screen, and a coral tip on its rim pointing where the
	 * tent is. Placed like a friend's arrow (`doctorWay.arrow`, from
	 * `DoctorWay`), and drawn so it never reads as one: a friend is an orange
	 * arrow with a name, the doctor a tent in a disc. It shows until the tent
	 * is in plain sight; then the tent says where to go. Only over the explore
	 * screen, under its HUD. Nothing here takes a tap.
	 */
</script>

{#if doctorWay.arrow}
	{@const arrow = doctorWay.arrow}
	<div
		class="doctor-arrow"
		style:transform="translate({arrow.x}px, {arrow.y}px)"
		role="img"
		aria-label={t('explore.doctorArrow')}
	>
		<div class="turn" style:transform="translate(-50%, -50%) rotate({arrow.angle}rad)">
			<svg class="tip" viewBox="0 0 76 76" width="76" height="76" aria-hidden="true">
				<path d="M38 1.5l12 16H26z" />
			</svg>
		</div>
		<div class="disc">
			<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
				<path class="cloth" d="M16 3.5 29.5 27.5H2.5Z" />
				<path class="door" d="M16 12.5 21 27.5H11Z" />
				<rect class="ground" x="1.5" y="27" width="29" height="2.5" rx="1.25" />
			</svg>
		</div>
	</div>
{/if}

<style>
	.doctor-arrow {
		position: absolute;
		left: 0;
		top: 0;
		pointer-events: none;
		will-change: transform;
	}
	/* Turns round the disc's middle, so the tip on the rim points where the tent is. */
	.turn {
		position: absolute;
		left: 0;
		top: 0;
		width: 76px;
		height: 76px;
	}
	.tip {
		display: block;
		fill: var(--coral);
		stroke: var(--panel-cream);
		stroke-width: 2;
		stroke-linejoin: round;
		filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.25));
		animation: nudge 1.4s ease-in-out infinite;
	}
	.disc {
		position: absolute;
		left: 0;
		top: 0;
		transform: translate(-50%, -50%);
		display: grid;
		place-items: center;
		width: 46px;
		height: 46px;
		border-radius: 50%;
		background: var(--panel-cream);
		border: 3px solid var(--coral);
		box-sizing: border-box;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
	}
	/* The tent in the world's own colours (DESIGN § Palette): the cloth and its door. */
	.cloth {
		fill: #f2a65a;
	}
	.door {
		fill: #d47c2a;
	}
	.ground {
		fill: #63b94a;
	}
	/* The tip leans out the way it points, and back: this way! */
	@keyframes nudge {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-4px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.tip {
			animation: none;
		}
	}
</style>
