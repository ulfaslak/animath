<script lang="ts">
	import type { AttackLevel } from '@mathgame/engine';
	import { unfocusable } from '../input/press';
	import HitBadge from './HitBadge.svelte';

	/**
	 * One attack on the battle menu: a chunky warm tile, the attack's name,
	 * its level's word and its hit badge (the damage at that level). The
	 * attacks are the heroes of the menu, so they are the biggest, warmest
	 * things to press there; the highlighted one lifts, ringed, with a caret.
	 * It is a button for its key (`press`, a row key: a tap only highlights,
	 * as the arrows do), and it knows nothing of who it would hit.
	 */
	let {
		name,
		word,
		level,
		damage,
		high,
		press,
		selected = false
	}: {
		name: string;
		/** The level's word: easy, medium or hard. */
		word: string;
		level: AttackLevel;
		/** The damage at that level, from the engine. */
		damage: number;
		/** The most it hits for there, when its topics land differently (`hitSpan`); `damage` is then the least. */
		high?: number;
		press: string;
		selected?: boolean;
	} = $props();
</script>

<button type="button" class="tile" class:selected data-press={press} {@attach unfocusable}>
	<span class="caret" aria-hidden="true">▸</span>
	<span class="name">{name}</span>
	<span class="level">{word}</span>
	<HitBadge {damage} {high} {level} />
</button>

<style>
	.tile {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 0 1 40px;
		width: 100%;
		min-height: 32px;
		box-sizing: border-box;
		/* Room under the face for its edge. */
		margin-bottom: 3px;
		padding: 0 12px 0 6px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--accent) 16%, var(--panel-cream));
		box-shadow: 0 3px 0 color-mix(in srgb, var(--accent-edge) 45%, transparent);
		font-weight: 800;
		font-size: 18px;
		transition:
			transform 0.08s ease-out,
			box-shadow 0.08s ease-out,
			background-color 0.15s;
	}
	/* Touch: a finger tall. */
	:global(.touch) .tile {
		flex: 0 0 var(--tap);
	}
	.caret {
		width: 14px;
		flex: none;
		text-align: center;
		visibility: hidden;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.level {
		flex: none;
		font-weight: 600;
		font-size: 16px;
		opacity: 0.75;
		white-space: nowrap;
	}
	/* The highlighted attack: lifted off the card, ringed in the accent, with the caret. */
	.selected {
		background: color-mix(in srgb, var(--accent) 34%, var(--panel-cream));
		box-shadow:
			0 0 0 3px var(--accent),
			0 5px 0 3px color-mix(in srgb, var(--accent-edge) 55%, transparent);
		transform: translateY(-1px);
	}
	.selected .caret {
		visibility: visible;
	}
	/* Pressed: the face squashes down onto its edge. */
	.tile:active {
		transform: translateY(2px);
		box-shadow: 0 1px 0 color-mix(in srgb, var(--accent-edge) 45%, transparent);
	}
	.selected:active {
		box-shadow:
			0 0 0 3px var(--accent),
			0 1px 0 3px color-mix(in srgb, var(--accent-edge) 55%, transparent);
	}
	/* A mouse over a tile it can press. Never on touch, where hover sticks after a tap. */
	@media (hover: hover) and (pointer: fine) {
		.tile:not(.selected):hover {
			background: color-mix(in srgb, var(--accent) 24%, var(--panel-cream));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.tile {
			transition: none;
		}
	}
	/*
	 * A short screen (a phone held sideways): the moves stand beside the tiles,
	 * so a tile is narrower and takes two lines, its name across the whole
	 * tile over its level's word and its badge. The ring alone marks the
	 * highlighted one: the caret's room goes to the name. A finger tall, touch
	 * or not.
	 */
	@media (max-height: 560px) {
		.tile {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas: 'name name' 'level badge';
			align-items: center;
			align-content: center;
			column-gap: 6px;
			flex: 0 0 var(--tap);
			padding: 0 10px;
			font-size: 16px;
		}
		.caret {
			display: none;
		}
		.name {
			grid-area: name;
		}
		.level {
			grid-area: level;
			line-height: 1.1;
		}
		.tile > :global(.badge) {
			grid-area: badge;
			line-height: 1.1;
		}
		/* The star as tall as the number, so a hard hit's badge fits the line. */
		.tile > :global(.badge .star) {
			width: 1.1em;
			height: 1.1em;
		}
	}
</style>
