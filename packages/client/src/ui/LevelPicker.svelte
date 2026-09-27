<script lang="ts" module>
	import type { AttackLevel } from '@mathgame/engine';

	/** One level of an attack as the picker shows it: its word and the damage it hits for. */
	export interface LevelOption {
		level: AttackLevel;
		word: string;
		damage: number;
	}
</script>

<script lang="ts">
	import { levelKey, unfocusable } from '../input/press';
	import HitBadge from './HitBadge.svelte';

	/**
	 * An attack's three levels side by side, each with its word and its hit
	 * badge — easy ✸10, medium ✸16, hard ✸24 — so choosing a level is
	 * choosing a bigger hit, not just a word. They stand as steps, each a
	 * little taller than the one before, and the one set is lit. Each is a
	 * button for its level key (`level:<n>`): a tap sets the highlighted
	 * attack's level and nothing more. Every number comes from the engine.
	 */
	let { options, current }: { options: readonly LevelOption[]; current: AttackLevel } = $props();
</script>

<div class="levels">
	{#each options as option (option.level)}
		<button
			type="button"
			class="level l{option.level}"
			class:on={option.level === current}
			data-press={levelKey(option.level)}
			{@attach unfocusable}
		>
			<span class="word">{option.word}</span>
			<HitBadge damage={option.damage} level={option.level} />
		</button>
	{/each}
</div>

<style>
	.levels {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 10px;
		/* Room under the steps for their edges. */
		padding-bottom: var(--press);
	}
	.level {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		min-width: 84px;
		padding: 0 12px;
		box-sizing: border-box;
		border-radius: 14px;
		background: var(--panel-cream);
		box-shadow:
			inset 0 0 0 2px rgba(45, 42, 50, 0.1),
			0 var(--press) 0 var(--edge);
		transition:
			transform 0.08s ease-out,
			box-shadow 0.08s ease-out;
	}
	/* Steps: each level a little taller than the one below it. */
	.l1 {
		height: 44px;
	}
	.l2 {
		height: 50px;
	}
	.l3 {
		height: 56px;
	}
	:global(.touch) .l1 {
		height: 50px;
	}
	:global(.touch) .l2 {
		height: 56px;
	}
	:global(.touch) .l3 {
		height: 62px;
	}
	.word {
		font-weight: 800;
		font-size: 16px;
		line-height: 1.1;
		white-space: nowrap;
	}
	/* The level set: lit in the accent, lifted a little. */
	.on {
		background: color-mix(in srgb, var(--accent) 38%, var(--panel-cream));
		box-shadow:
			inset 0 0 0 3px var(--accent),
			0 var(--press) 0 var(--accent-edge);
	}
	.level:active {
		transform: translateY(calc(var(--press) - 1px));
		box-shadow:
			inset 0 0 0 2px rgba(45, 42, 50, 0.1),
			0 1px 0 var(--edge);
	}
	.on:active {
		box-shadow:
			inset 0 0 0 3px var(--accent),
			0 1px 0 var(--accent-edge);
	}
	@media (hover: hover) and (pointer: fine) {
		.level:not(.on):hover {
			box-shadow:
				inset 0 0 0 2px var(--accent),
				0 var(--press) 0 var(--edge);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.level {
			transition: none;
		}
	}
</style>
