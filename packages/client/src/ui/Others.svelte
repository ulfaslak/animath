<script lang="ts">
	import type { Busy } from '@mathgame/engine';
	import { onDestroy } from 'svelte';
	import { t } from '../copy';
	import { hpBand } from '../hp';
	import { speciesName } from '../names';
	import { namesSide, placeNames } from '../presence/edges';
	import { THOUGHT_LEAN, unclutter, type Mark, type Rect } from '../presence/labels';
	import { safeArea } from '../safe-area';
	import { presence, type Label } from '../state/presence.svelte';

	/**
	 * The other players, over the world ([[UI_SPEC]] § Explore mode, "Playing
	 * together"): each one on screen has their name over their head, and a
	 * little bubble over it while they are busy — an amber "!" in a battle
	 * with a wild animal, a heart at the doctor, a pause sign in the menu, a
	 * star in a friendly match; none up in the air, where their glider says
	 * it — worded for anyone who can't see it. At the
	 * edge of the screen an arrow points each way the nearest players off it
	 * are, with their names beside it: never under a piece of the HUD, and no
	 * name over another (`presence/edges.ts`; #121, #140). Only over the
	 * explore screen, under its HUD: never under the doctor's card or the
	 * menu, whose panels they would show through, and never in a battle.
	 * Where each goes is `presence.labels` and `presence.arrows`, placed
	 * every frame by `PresenceController.overlay`. Nothing here takes a tap.
	 *
	 * A player thinking in a battle has a thought bubble over their name in
	 * place of the sign ([[UI_SPEC]] § Explore mode, "Playing together"): the
	 * sum they are working out, or three dots while they choose; a right
	 * answer pops it with a green tick, a wrong one wobbles it. The animals in
	 * the battle have their names and a small HP bar over them
	 * (`presence.bars`), and a hit's damage floats up from the one hit in a
	 * burst as hot as the hit (`presence.pops`: the battle screen's
	 * `HitBurst`, smaller). With reduced motion nothing jumps or wobbles: the
	 * tick, the tint and the number say it.
	 *
	 * No word covers another (#141): the names and the animals' tags are laid
	 * out by `unclutter` (`presence/labels.ts`) from what each measures here,
	 * the tags from where their animals stand still, so a lunge or a hop never
	 * shuffles them. A label rises over a tall animal's tag, and two tags make
	 * room for each other; each glides to its place (`translate`, which the
	 * placing `transform` leaves alone), and a hit's damage floats up from its
	 * tag wherever the tag went.
	 */

	/** A box as laid out in its element, before any transform: its place in it, its size. */
	interface Box {
		x: number;
		y: number;
		w: number;
		h: number;
		/** The thought cloud, which leans off the name (`THOUGHT_LEAN`). */
		thought: boolean;
	}
	/** What a label or a tag measures: its own size, and the boxes in it that hold anything. */
	interface Measured {
		w: number;
		h: number;
		parts: Box[];
	}

	/** Every label and tag on screen, by its key (`label:<pid>`, `tag:<key>`), as last measured. */
	let measured = $state.raw<Record<string, Measured>>({});
	/** The labels and tags being watched, and their keys. */
	const watched = new Map<HTMLElement, string>();
	const observer =
		typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measureAll());
	onDestroy(() => observer?.disconnect());

	/** Measure every label and tag again: one of them, or a part of one, changed size. */
	function measureAll(): void {
		const next: Record<string, Measured> = {};
		for (const [el, key] of watched) {
			const parts: Box[] = [];
			for (const part of el.querySelectorAll<HTMLElement>(':scope > [data-part]')) {
				parts.push({
					x: part.offsetLeft,
					y: part.offsetTop,
					w: part.offsetWidth,
					h: part.offsetHeight,
					thought: part.dataset.part === 'thought'
				});
			}
			next[key] = { w: el.offsetWidth, h: el.offsetHeight, parts };
		}
		measured = next;
	}

	/**
	 * A label or a tag to lay out (`data-key` its key, which a keyed element
	 * keeps): watched while it is on screen. What it measured stays until the
	 * next measuring, unread: only what is on screen is laid out.
	 */
	function watch(el: HTMLElement): () => void {
		watched.set(el, el.dataset.key ?? '');
		observer?.observe(el);
		return () => {
			watched.delete(el);
			observer?.unobserve(el);
		};
	}

	/** A part of a label (the name, the bubble, the thought cloud): a change in its size lays it out again. */
	function watchPart(el: HTMLElement): () => void {
		observer?.observe(el);
		return () => observer?.unobserve(el);
	}

	/**
	 * A label's boxes round its anchor (the middle of its bottom edge): the
	 * name, and over it the bubble or the thought, which leans away from the
	 * battle. Before it is measured, about a name's size.
	 */
	function labelParts(label: Label): Rect[] {
		const m = measured[`label:${label.pid}`];
		if (!m) return [{ x0: -40, x1: 40, y0: -28, y1: -2 }];
		return m.parts.map((p) => {
			const lean = p.thought && label.thought ? label.thought.lean * THOUGHT_LEAN * p.w : 0;
			const x0 = p.x - m.w / 2 + lean;
			const y0 = p.y - m.h;
			return { x0, x1: x0 + p.w, y0, y1: y0 + p.h };
		});
	}

	/** A tag's box round its anchor (the middle of its bottom edge); before it is measured, about a tag's size. */
	function tagParts(key: string): Rect[] {
		const m = measured[`tag:${key}`];
		if (!m) return [{ x0: -36, x1: 36, y0: -32, y1: 0 }];
		return [{ x0: -m.w / 2, x1: m.w / 2, y0: -m.h, y1: 0 }];
	}

	/** Where everything goes this frame: labels over the tags, the tags apart. */
	const layout = $derived.by(() => {
		const labels: Mark[] = presence.labels.map((label) => ({
			key: `label:${label.pid}`,
			x: label.x,
			y: label.y,
			parts: labelParts(label)
		}));
		// A tag that has faded away (its animal lying down) takes no room.
		const tags: Mark[] = presence.bars
			.filter((bar) => bar.opacity > 0.05)
			.map((bar) => ({ key: `tag:${bar.key}`, x: bar.rx, y: bar.ry, parts: tagParts(bar.key) }));
		return unclutter(labels, tags);
	});

	/** How far a label or a tag is moved from its anchor, as a `translate`. */
	function shift(key: string): string {
		const off = layout.get(key) ?? { dx: 0, dy: 0 };
		return [off.dx, off.dy].map((v) => `${v}px`).join(' ');
	}

	/** The window's size, for the bounds the arrows' names keep inside. */
	let innerWidth = $state(0);
	let innerHeight = $state(0);

	/**
	 * Where each arrow's names go (`placeNames`, `presence/edges.ts`): beside
	 * it towards the middle of the screen, moved along the edge as little as
	 * it takes to keep clear of the HUD's pieces, the other arrows and the
	 * names already placed, inside the safe area. By the arrow's key: the top
	 * left corner of its names, from the arrow's middle. Before a block is
	 * measured, about a name's size.
	 */
	const namesAt = $derived.by(() => {
		const inset = safeArea();
		const bounds = {
			x0: inset.left + 8,
			x1: innerWidth - inset.right - 8,
			y0: inset.top + 8,
			y1: innerHeight - inset.bottom - 8
		};
		const blocks = presence.arrows.map((arrow) => {
			const m = measured[`names:${arrow.key}`];
			const rows = arrow.names.length + (arrow.more > 0 ? 1 : 0);
			return { ...arrow, w: m?.w ?? 80, h: m?.h ?? rows * 28 };
		});
		const spots = placeNames(blocks, presence.pieces, bounds);
		return new Map(presence.arrows.map((arrow, i) => [arrow.key, spots[i]!]));
	});

	/** An arrow's names: where they stand from its middle, as a `transform`. */
	function namesPlace(key: string): string {
		const at = namesAt.get(key) ?? { dx: 0, dy: 0 };
		return `translate(${at.dx}px, ${at.dy}px)`;
	}
</script>

<svelte:window bind:innerWidth bind:innerHeight />

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
	<!-- The animals in the battles on screen: their names and HP, over their heads. -->
	{#each presence.bars as bar (bar.key)}
		{@const share = bar.maxHp > 0 ? bar.hp / bar.maxHp : 0}
		<div
			class="hp"
			data-key="tag:{bar.key}"
			style:transform="translate({bar.x}px, {bar.y}px) translate(-50%, -100%)"
			style:translate={shift(`tag:${bar.key}`)}
			style:opacity={bar.opacity}
			aria-hidden="true"
			{@attach watch}
		>
			<span class="hp-name">{speciesName(bar.species)}</span>
			<span class="track"
				><span
					class="fill"
					class:warn={hpBand(bar.hp, bar.maxHp) === 'warn'}
					class:bad={hpBand(bar.hp, bar.maxHp) === 'bad'}
					style:width="{Math.round(share * 100)}%"
				></span></span
			>
		</div>
	{/each}
	{#each presence.labels as label (label.pid)}
		<div
			class="label"
			data-key="label:{label.pid}"
			style:transform="translate({label.x}px, {label.y}px) translate(-50%, -100%)"
			style:translate={shift(`label:${label.pid}`)}
			style:opacity={label.opacity}
			{@attach watch}
		>
			{#if label.thought}
				<!-- What they are working out: the sum as the engine writes it, or dots while they choose. -->
				<div
					class="thought"
					data-part="thought"
					style:--lean={label.thought.lean}
					style:translate="{label.thought.lean * THOUGHT_LEAN * 100}% 0"
					role="img"
					{@attach watchPart}
					aria-label={label.thought.sum === null
						? t('presence.choosing', { name: label.name })
						: t('presence.thinking', { name: label.name, sum: label.thought.sum })}
				>
					{#key label.thought.beat}
						<div
							class="cloud"
							class:choosing={label.thought.sum === null}
							class:right={label.thought.mood === 'right'}
							class:wrong={label.thought.mood === 'wrong'}
						>
							{#if label.thought.sum === null}
								<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
							{:else}
								<span class="sum">{label.thought.sum}</span>
							{/if}
							{#if label.thought.mood === 'right'}
								<svg class="tick" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
									<circle
										cx="12"
										cy="12"
										r="11"
										fill="var(--good)"
										stroke="var(--panel-cream)"
										stroke-width="2"
									/>
									<path
										d="M7 12.5l3.2 3.2L17 9"
										fill="none"
										stroke="var(--panel-cream)"
										stroke-width="3"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							{/if}
						</div>
					{/key}
					<span class="trail big" aria-hidden="true"></span>
					<span class="trail small" aria-hidden="true"></span>
				</div>
				<!-- Up in the air the glider says it: no bubble over a friend who flies. -->
			{:else if label.busy !== 'explore' && label.busy !== 'flight'}
				<div
					class="bubble"
					data-part="bubble"
					role="img"
					aria-label={t(`presence.busy.${label.busy}`)}
					{@attach watchPart}
				>
					{@render icon(label.busy)}
				</div>
			{/if}
			<div class="name" data-part="name" {@attach watchPart}>{label.name}</div>
		</div>
	{/each}
	<!-- The damage a hit did, floating up from the animal hit (over its tag, wherever that went), as big and hot as the hit. -->
	{#each presence.pops as pop (pop.id)}
		<div
			class="pop-at"
			style:transform="translate({pop.x}px, {pop.y}px)"
			style:translate={shift(`tag:${pop.key}`)}
			aria-hidden="true"
		>
			<div class="pop l{pop.level}">
				<svg class="burst" viewBox="0 0 100 100">
					<polygon
						points="50 2 58.5 18.1 71.6 12.6 73.3 26.7 91.6 26 81.9 41.5 95.1 50 81.9 58.5 86.6 71.1 73.3 73.3 74 91.6 58.5 81.9 50 94.2 41.5 81.9 26 91.6 26.7 73.3 12.6 71.6 18.1 58.5 3.4 50 18.1 41.5 13.8 29.1 26.7 26.7 26 8.4 41.5 18.1"
					/>
				</svg>
				<span class="n">−{pop.damage}</span>
			</div>
		</div>
	{/each}
	<!-- One arrow for each way players are out of sight, and every name that way beside it
	     (three and "+2 more" past four), clear of the HUD's pieces and of each other. -->
	{#each presence.arrows as arrow (arrow.key)}
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
			<div
				class="arrow-names {namesSide(arrow.angle)}"
				data-key="names:{arrow.key}"
				style:transform={namesPlace(arrow.key)}
				{@attach watch}
			>
				{#each arrow.names as name, i (i)}
					<div class="arrow-name">{name}</div>
				{/each}
				{#if arrow.more > 0}
					<div class="arrow-more">{t('presence.arrowMore', { count: arrow.more })}</div>
				{/if}
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
	 * Moved off its anchor so no word covers another (`unclutter`): a glide,
	 * not a jump, when a thought cloud comes or an animal is switched in.
	 */
	.label,
	.hp,
	.pop-at {
		transition: translate 0.18s ease-out;
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
	/*
	 * An arrow's names, nearest first, as a block placed from the arrow's
	 * middle (`placeNames`): each lined up on the arrow's side of the block,
	 * or centred under or over it.
	 */
	.arrow-names {
		position: absolute;
		left: 0;
		top: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		width: max-content;
	}
	.arrow-names.left {
		align-items: flex-end;
	}
	.arrow-names.under,
	.arrow-names.over {
		align-items: center;
	}
	/* "+2 more": how many more are that way, quieter than a name. */
	.arrow-more {
		padding: 1px 9px;
		border-radius: 999px;
		background: var(--panel-bg);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
		color: var(--panel-ink);
		font-weight: 700;
		font-size: 14px;
		line-height: 1.35;
		white-space: nowrap;
	}

	/*
	 * A thought bubble over a player in a battle: a cream cloud with the sum in
	 * it, big enough to read from across the screen on a tablet, and two little
	 * puffs trailing down to the name, as a comic draws a thought.
	 */
	/*
	 * It leans off the name, away from their battle (`--lean`: 1 to the right,
	 * -1 to the left), by `THOUGHT_LEAN` of its width (its `translate`, set
	 * where the layout reads it), so it keeps off the animals' tags; the puffs
	 * trail back down to the name.
	 */
	.thought {
		/* Upright until the page says which way (the label's own `--lean`). */
		--lean: 0;
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding-bottom: 12px;
	}
	.cloud {
		position: relative;
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 46px;
		min-height: 34px;
		padding: 4px 14px;
		justify-content: center;
		border-radius: 18px;
		background: var(--panel-cream);
		border: 3px solid var(--panel-cream);
		box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2);
		color: var(--panel-ink);
		transform-origin: 50% 100%;
	}
	/* Choosing what to do: a smaller cloud of three dots. */
	.cloud.choosing {
		min-width: 0;
		min-height: 26px;
		padding: 2px 9px;
		border-radius: 14px;
	}
	.sum {
		font-weight: 800;
		font-size: 18px;
		line-height: 1.2;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.trail {
		position: absolute;
		border-radius: 50%;
		background: var(--panel-cream);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.16);
	}
	.trail.big {
		width: 9px;
		height: 9px;
		bottom: 3px;
		left: calc(50% - 4.5px - var(--lean) * 22%);
	}
	.trail.small {
		width: 5px;
		height: 5px;
		bottom: -3px;
		left: calc(50% - 2.5px - var(--lean) * 30%);
	}
	/* Choosing what to do: three dots, one after the other. */
	.dots {
		display: flex;
		gap: 4px;
	}
	.dots i {
		display: block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--panel-ink);
		opacity: 0.35;
		animation: dot 1.2s ease-in-out infinite;
	}
	.dots i:nth-child(2) {
		animation-delay: 0.2s;
	}
	.dots i:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes dot {
		0%,
		60%,
		100% {
			transform: translateY(0);
			opacity: 0.35;
		}
		30% {
			transform: translateY(-4px);
			opacity: 0.8;
		}
	}
	/* Right: a happy pop, a green rim and a tick. Wrong: a little wobble, a warm rim. */
	.cloud.right {
		border-color: var(--good);
		animation: happy 0.55s ease-out;
	}
	.cloud.wrong {
		border-color: var(--warn);
		animation: wobble 0.55s ease-in-out;
	}
	.tick {
		flex: none;
		margin-right: -4px;
	}
	@keyframes happy {
		0% {
			transform: scale(1);
		}
		35% {
			transform: scale(1.22);
		}
		65% {
			transform: scale(0.96);
		}
		100% {
			transform: scale(1);
		}
	}
	@keyframes wobble {
		0%,
		100% {
			transform: rotate(0deg);
		}
		20% {
			transform: rotate(-7deg) translateX(-3px);
		}
		45% {
			transform: rotate(6deg) translateX(3px);
		}
		70% {
			transform: rotate(-3deg);
		}
	}

	/* An animal's name and HP over it: small, so two side by side stay apart. */
	.hp {
		position: absolute;
		left: 0;
		top: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 2px 7px 4px;
		border-radius: 10px;
		background: var(--panel-bg);
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.16);
		will-change: transform;
	}
	.hp-name {
		/* Whole at any species' name ("Europæisk bison", "Blæksprutte"). */
		max-width: 11em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--panel-ink);
		font-weight: 800;
		font-size: 12px;
		line-height: 1.2;
	}
	.track {
		display: block;
		width: 46px;
		height: 6px;
		border-radius: 3px;
		background: rgba(45, 42, 50, 0.18);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: 3px;
		background: var(--good);
		transition: width 0.35s ease-out;
	}
	.fill.warn {
		background: var(--warn);
	}
	.fill.bad {
		background: var(--bad);
	}

	/* A hit's damage, from the animal hit: pops in, floats up and fades. */
	.pop-at {
		position: absolute;
		left: 0;
		top: 0;
		width: 0;
		height: 0;
	}
	/* It starts over the animal's name tag, never on it. */
	.pop {
		position: absolute;
		left: calc(var(--size) / -2);
		top: calc(var(--size) * -1 - 34px);
		display: grid;
		place-items: center;
		width: var(--size);
		height: var(--size);
		animation: float 1.2s ease-out forwards;
	}
	.pop.l1 {
		--size: 38px;
		--text: 15px;
		--fill: var(--warn);
	}
	.pop.l2 {
		--size: 44px;
		--text: 17px;
		--fill: var(--accent);
	}
	.pop.l3 {
		--size: 50px;
		--text: 19px;
		--fill: var(--coral);
	}
	.burst {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		filter: drop-shadow(0 2px 0 rgba(45, 42, 50, 0.25));
	}
	.burst polygon {
		fill: var(--fill);
		stroke: var(--panel-cream);
		stroke-width: 6;
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
	@keyframes float {
		0% {
			opacity: 0;
			transform: translateY(6px) scale(0.4) rotate(-12deg);
		}
		15% {
			opacity: 1;
			transform: translateY(0) scale(1.12) rotate(4deg);
		}
		28% {
			transform: translateY(-4px) scale(1) rotate(0deg);
		}
		75% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translateY(-34px) scale(0.95);
		}
	}
	@keyframes float-still {
		0%,
		100% {
			opacity: 0;
		}
		15%,
		75% {
			opacity: 1;
		}
	}
	/* Less motion: nothing jumps, wobbles, floats or glides; the tick, the rims and the numbers say it. */
	@media (prefers-reduced-motion: reduce) {
		.label,
		.hp,
		.pop-at {
			transition: none;
		}
		.cloud.right,
		.cloud.wrong {
			animation: none;
		}
		.dots i {
			animation: none;
			opacity: 0.6;
		}
		.pop {
			animation-name: float-still;
		}
	}
</style>
