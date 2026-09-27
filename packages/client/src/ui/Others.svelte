<script lang="ts">
	import type { Busy } from '@mathgame/engine';
	import { t } from '../copy';
	import { presence } from '../state/presence.svelte';

	/**
	 * The other players, over the world ([[UI_SPEC]] § Explore mode, "Playing
	 * together"): each one on screen has their name over their head, and a
	 * little bubble over it while they are busy — an amber "!" in a battle
	 * with a wild animal, a heart at the doctor, a pause sign in the menu, a
	 * star in a friendly match — worded for anyone who can't see it. At the
	 * edge of the screen an arrow with a name points to each of the nearest
	 * players off it. Only over the explore screen, under its HUD: never under
	 * the doctor's card or the menu, whose panels they would show through, and
	 * never in a battle. Where each goes is `presence.labels` and `presence.arrows`,
	 * placed every frame by `PresenceController.overlay`. Nothing here takes
	 * a tap.
	 */

	/** The gap between an arrow's middle and the near edge of its name (CSS pixels). */
	const NAME_GAP = 20;

	/**
	 * Where an arrow's name sits: on the side of it towards the middle of the
	 * screen, its near edge a little way from the arrow, so a long name never
	 * covers the arrow or runs off the screen's edge the arrow is on.
	 */
	function namePlace(angle: number): string {
		const across = Math.sin(angle);
		const down = -Math.cos(angle);
		if (Math.abs(across) >= Math.abs(down)) {
			// On a side edge: beside it, towards the middle.
			return across < 0
				? `translate(${NAME_GAP}px, -50%)`
				: `translate(calc(-100% - ${NAME_GAP}px), -50%)`;
		}
		// On the top or bottom edge: under it or over it.
		return down < 0
			? `translate(-50%, ${NAME_GAP}px)`
			: `translate(-50%, calc(-100% - ${NAME_GAP}px))`;
	}
</script>

{#snippet icon(busy: Busy)}
	<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
		{#if busy === 'battle'}
			<!-- An amber burst with a "!": a wild animal jumped out. -->
			<path
				d="M12 1.5l2.6 5.2 5.7-1.4-2.4 5.3 4.6 3.6-5.8 1.1.2 5.9-4.9-3.4-4.9 3.4.2-5.9-5.8-1.1 4.6-3.6-2.4-5.3 5.7 1.4z"
				fill="var(--warn)"
			/>
			<rect x="10.9" y="6.6" width="2.2" height="7" rx="1.1" fill="var(--panel-ink)" />
			<circle cx="12" cy="16.4" r="1.3" fill="var(--panel-ink)" />
		{:else if busy === 'doctor'}
			<!-- A heart: the doctor is looking after their animals. -->
			<path
				d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"
				fill="var(--coral)"
			/>
		{:else if busy === 'menu'}
			<!-- Two bars: taking a break. -->
			<rect x="6.5" y="5" width="4" height="14" rx="1.6" fill="var(--panel-ink)" />
			<rect x="13.5" y="5" width="4" height="14" rx="1.6" fill="var(--panel-ink)" />
		{:else}
			<!-- A star: a friendly match. -->
			<path
				d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z"
				fill="var(--good)"
			/>
		{/if}
	</svg>
{/snippet}

<div class="others">
	{#each presence.labels as label (label.pid)}
		<div
			class="label"
			style:transform="translate({label.x}px, {label.y}px) translate(-50%, -100%)"
			style:opacity={label.opacity}
		>
			{#if label.busy !== 'explore'}
				<div class="bubble" role="img" aria-label={t(`presence.busy.${label.busy}`)}>
					{@render icon(label.busy)}
				</div>
			{/if}
			<div class="name">{label.name}</div>
		</div>
	{/each}
	{#each presence.arrows as arrow (arrow.pid)}
		<div class="arrow" style:transform="translate({arrow.x}px, {arrow.y}px)">
			<div class="pointer" style:transform="translate(-50%, -50%) rotate({arrow.angle}rad)">
				<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
					<path
						d="M12 2l9 15h-6v5H9v-5H3z"
						fill="var(--accent)"
						stroke="var(--panel-cream)"
						stroke-width="1.6"
					/>
				</svg>
			</div>
			<div class="arrow-name" style:transform={namePlace(arrow.angle)}>
				{arrow.name}
			</div>
		</div>
	{/each}
</div>

<style>
	.others {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}
	.label,
	.arrow {
		position: absolute;
		left: 0;
		top: 0;
		will-change: transform;
	}
	.label {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding-bottom: 2px;
	}
	/*
	 * A name over a head: readable over any ground, at a tablet's size and a
	 * laptop's, and whole: sixteen of the widest letters fit (a name has 16 at
	 * most; the room is a guard, not a limit anyone meets).
	 */
	.name,
	.arrow-name {
		max-width: 18em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 2px 10px;
		border-radius: 999px;
		background: var(--panel-bg);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
		color: var(--panel-ink);
		font-weight: 800;
		font-size: 16px;
		line-height: 1.35;
	}
	/* What they are busy with: a little speech bubble over the name. */
	.bubble {
		position: relative;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: var(--panel-cream);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
	}
	.bubble::after {
		content: '';
		position: absolute;
		bottom: -4px;
		left: calc(50% - 5px);
		border: 5px solid transparent;
		border-top-color: var(--panel-cream);
		border-bottom: 0;
	}
	.pointer {
		position: absolute;
		left: 0;
		top: 0;
		filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.25));
	}
	.arrow-name {
		position: absolute;
		left: 0;
		top: 0;
	}
</style>
