<script lang="ts">
	import type { AttackLevel } from '@mathgame/engine';
	import HitBurst from './HitBurst.svelte';
	import HpBar from './HpBar.svelte';

	/**
	 * A battle status box: the animal's name and its HP bar, chunky, with
	 * the numbers big. Everything comes in as props, so any fight can show
	 * one (a wild battle's two, a friendly match's two); where it stands is
	 * the screen's to say. `opponent` puts a paw by the name, so the box
	 * across from yours reads as the other side at a glance. `acting` rings
	 * it and makes it glow, softly breathing (still, with reduced motion):
	 * this animal's turn. `preview` is the HP a hit would leave it with,
	 * shown on the bar (`HpBar`). `hit` pops the damage in a burst beside
	 * the box, on the `burst` side, the side away from the screen's edge,
	 * where it covers no word and no animal; each new `n` pops it again.
	 * `keepEnd`: a name too long for the box gives up its start, not its end
	 * (a friendly match's "Bo's Rabbit" keeps the animal when a long owner's
	 * name would push it out).
	 */
	let {
		name,
		id,
		hp,
		max,
		opponent = false,
		acting = false,
		preview = null,
		hit = null,
		burst = 'right',
		keepEnd = false
	}: {
		name: string;
		/** The animal's id: another animal in the box gets a fresh bar, never one sliding from the last one's HP. */
		id: string;
		hp: number;
		max: number;
		opponent?: boolean;
		acting?: boolean;
		preview?: number | null;
		hit?: { damage: number; level: AttackLevel; n: number } | null;
		burst?: 'left' | 'right';
		keepEnd?: boolean;
	} = $props();
</script>

<div class="box" class:acting>
	<div class="name">
		{#if opponent}
			<svg class="paw" viewBox="0 0 24 24" aria-hidden="true">
				<ellipse cx="12" cy="16.2" rx="5.6" ry="4.7" />
				<circle cx="5" cy="10.3" r="2.4" />
				<circle cx="9.3" cy="6" r="2.5" />
				<circle cx="14.7" cy="6" r="2.5" />
				<circle cx="19" cy="10.3" r="2.4" />
			</svg>
		{/if}
		<span class="text" class:end={keepEnd}
			>{#if keepEnd}<bdi>{name}</bdi>{:else}{name}{/if}</span
		>
	</div>
	{#key id}
		<HpBar {hp} {max} thick {preview} />
	{/key}
	{#if hit}
		{#key hit.n}
			<span class="burst-at {burst}"><HitBurst damage={hit.damage} level={hit.level} /></span>
		{/key}
	{/if}
</div>

<style>
	.box {
		position: relative;
		box-sizing: border-box;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		/*
		 * 74 px tall in all, as the slimmer box before it: the leash flies round
		 * the wild animal's, and `WILD_STATUS_BOX` in `render/battle-scene.ts`
		 * knows its size. Change them together.
		 */
		padding: 10px 16px 13px;
	}
	.name {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 7px;
		font-weight: 800;
		font-size: 18px;
	}
	/* A name that would not fit ends in "…", with the font's own line height (DESIGN § Typography). */
	.text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/*
	 * The end kept instead: the "…" at the start. The name inside stays in its
	 * own direction (`bdi`), so its letters and marks read as written.
	 */
	.text.end {
		direction: rtl;
	}
	.paw {
		width: 20px;
		height: 20px;
		flex: none;
		fill: var(--panel-ink);
		opacity: 0.7;
	}
	/* Whose turn it is: ringed in the accent, glowing, breathing gently. */
	.acting {
		box-shadow:
			0 0 0 3px var(--accent),
			0 0 16px 4px color-mix(in srgb, var(--accent) 45%, transparent),
			var(--hud-shadow);
		animation: turn 1.6s ease-in-out infinite alternate;
	}
	@keyframes turn {
		to {
			box-shadow:
				0 0 0 3px var(--accent),
				0 0 6px 1px color-mix(in srgb, var(--accent) 30%, transparent),
				var(--hud-shadow);
		}
	}
	/* The burst beside the box, level with it, never over its words. */
	.burst-at {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
	}
	.burst-at.right {
		left: calc(100% + 10px);
	}
	.burst-at.left {
		right: calc(100% + 10px);
	}
	@media (prefers-reduced-motion: reduce) {
		.acting {
			animation: none;
		}
	}
	/*
	 * A short screen (a phone held sideways): a size smaller, 60 px tall, so
	 * the scene between the boxes keeps room for the animals. `WILD_STATUS_BOX`
	 * in `render/battle-scene.ts` knows this size too.
	 */
	@media (max-height: 560px) {
		.box {
			padding: 6px 12px 8px;
		}
		.name {
			margin-bottom: 4px;
			font-size: 16px;
		}
		.paw {
			width: 18px;
			height: 18px;
		}
	}
</style>
