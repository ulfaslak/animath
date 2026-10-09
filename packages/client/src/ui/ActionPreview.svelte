<script lang="ts" module>
	import type { AttackLevel, PuzzleTopic } from '@mathgame/engine';
	import type { MoveIconName } from './MoveIcon.svelte';
	import type { LevelOption } from './LevelPicker.svelte';

	/**
	 * What the highlighted move of a battle menu would do, as the preview card
	 * shows it. All of it comes from the screen that asks: its words through
	 * `t()`, its numbers from the engine.
	 */
	export type Preview =
		| {
				kind: 'attack';
				name: string;
				level: AttackLevel;
				/** What it hits for at `level`: the least, when its topics land differently. */
				damage: number;
				/** The most it hits for at `level` (`hitSpan`). */
				high: number;
				/** Every level, with its word and what it hits for. */
				levels: readonly LevelOption[];
				/** What its puzzles can be at `level` (the engine's `puzzleTopics`). */
				topics: readonly PuzzleTopic[];
				/** The sentence for readers: what it asks, and what it does. */
				line: string;
				/** The words to say when the hit would tire the other animal out; null when it would not. */
				tires: string | null;
		  }
		| {
				kind: 'move';
				icon: MoveIconName;
				title: string;
				line: string;
				/** The leash's catch hint: a word and its colour. */
				hint?: { band: 'good' | 'warn' | 'bad'; words: string };
				/** It can do nothing now (a greyed Switch): its picture greys too, and `line` says why. */
				off?: boolean;
		  };
</script>

<script lang="ts">
	import HitBadge from './HitBadge.svelte';
	import LevelPicker from './LevelPicker.svelte';
	import MoveIcon from './MoveIcon.svelte';
	import TopicChips from './TopicChips.svelte';

	/**
	 * The battle's right card before a pick: a preview of the highlighted
	 * move. On an attack, its name big with its hit badge, what kind of sums
	 * it asks as operator chips, the level picker with each level's damage,
	 * "That would tire it out!" when this hit would do it, and the sentence
	 * for readers; on another move, its picture big, its title and one line.
	 * The pictures carry the meaning; the sentence says it again in words. It
	 * shows and decides nothing: Go! and the key reminder are the screen's,
	 * under it, and a level button is a key like every button
	 * (`LevelPicker`). `waiting`: the screen takes no pick now (a turn
	 * playing), so the level picker dims with the menu.
	 */
	let { preview, waiting = false }: { preview: Preview; waiting?: boolean } = $props();
</script>

{#if preview.kind === 'attack'}
	<div class="preview">
		<div class="head">
			<span class="title">{preview.name}</span>
			<TopicChips topics={preview.topics} />
			<span class="badge"><HitBadge
					damage={preview.damage}
					high={preview.high}
					level={preview.level}
					big
				/></span>
		</div>
		<div class="picker" class:waiting>
			<LevelPicker options={preview.levels} current={preview.level} />
		</div>
		{#if preview.tires}
			{#key preview.level}
				<div class="tires">{preview.tires}</div>
			{/key}
		{/if}
		<!-- What the pictures above say, again in words: a short screen has no room for it. -->
		<div class="detail retold">{preview.line}</div>
	</div>
{:else}
	<div class="preview">
		<div class="head move">
			<span class="disc" class:off={preview.off}><MoveIcon name={preview.icon} size={40} /></span>
			<span class="title">{preview.title}</span>
			{#if preview.hint}<span class="hint {preview.hint.band}">{preview.hint.words}</span>{/if}
		</div>
		<div class="detail">{preview.line}</div>
	</div>
{/if}

<style>
	/*
	 * Everything an attack's preview holds — the longest sentence (a
	 * squirrel's Scurry Kick on hard, two lines) and "That would tire it
	 * out!" too — fits over Go! in the card at 1280×720 with the keyboard.
	 */
	.preview {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		align-self: stretch;
		min-width: 0;
	}
	:global(.touch) .preview {
		gap: 10px;
	}
	/* A turn playing: the level picker waits, dimmed, as the menu does. */
	.picker.waiting {
		opacity: 0.55;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 6px 12px;
		max-width: 100%;
	}
	/* A name in a box that ends it with "…" keeps the font's own line height: a tighter one cuts the ring off an Å (DESIGN § Typography). */
	.title {
		font-weight: 800;
		font-size: 26px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		display: inline-flex;
		margin-left: 4px;
	}
	.disc {
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--blue) 10%, var(--panel-cream));
		box-shadow: inset 0 0 0 2px rgba(45, 42, 50, 0.08);
	}
	.disc.off {
		filter: grayscale(1);
		opacity: 0.5;
	}
	.hint {
		padding: 1px 10px;
		border-radius: 10px;
		font-weight: 800;
		font-size: 18px;
		white-space: nowrap;
		background: color-mix(in srgb, var(--band) 35%, var(--panel-cream));
		--band: var(--bad);
	}
	.hint.good {
		--band: var(--good);
	}
	.hint.warn {
		--band: var(--warn);
	}
	/* The best thing a kid can find out while choosing: said big, in kid words. */
	.tires {
		padding: 2px 16px;
		border-radius: 14px;
		background: var(--warn);
		box-shadow: 0 3px 0 var(--edge);
		font-weight: 800;
		font-size: 19px;
		text-align: center;
		animation: tires-in 0.35s ease-out;
	}
	@keyframes tires-in {
		from {
			opacity: 0;
			transform: scale(0.8);
		}
		60% {
			transform: scale(1.06);
		}
	}
	.detail {
		font-weight: 600;
		font-size: 17px;
		line-height: 1.25;
		max-width: 40em;
		text-align: center;
		text-wrap: balance;
	}
	/* Less motion: it only fades in. */
	@keyframes tires-fade {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.tires {
			animation-name: tires-fade;
		}
	}
	/*
	 * A short screen (a phone held sideways): the card is 220 px tall. An
	 * attack keeps its name, chips, badge, level picker and "That would tire
	 * it out!" over Go!, and leaves out the sentence that says them again in
	 * words; another move keeps its sentence, which is most of what it says.
	 */
	@media (max-height: 560px) {
		.preview,
		:global(.touch) .preview {
			gap: 4px;
		}
		.title {
			font-size: 22px;
		}
		.retold {
			display: none;
		}
		.disc {
			width: 48px;
			height: 48px;
		}
		.detail {
			font-size: 16px;
		}
	}
</style>
