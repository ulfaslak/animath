<script lang="ts">
	import { bundles, leadIndex, type Bundle } from '@mathgame/engine';
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { t } from '../copy';
	import { animalKey, bundleKey, moveKey, openKey, press, unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { motion } from '../motion';
	import { game } from '../state/game.svelte';
	import { hud } from '../state/hud.svelte';
	import { team } from '../state/team.svelte';
	import BundleAnimals from './BundleAnimals.svelte';
	import BundleCard from './BundleCard.svelte';

	/**
	 * The explore HUD. The party column: one card per species, in battle
	 * order (`BundleCard`; the party is kept in bundles), a card of several
	 * animals a stack. The lead — the engine's `leadIndex`, the first animal
	 * standing, the one a battle sends out — marks its card "goes first".
	 * Under the cards, the keys for choosing and for the menu; at the bottom,
	 * the message line (`state/hud.svelte.ts`), which also says who goes first
	 * after a party edit.
	 *
	 * The column scrolls when it is taller than the screen allows. A stack's
	 * animals, each with its name and HP, show beside it (`BundleAnimals`)
	 * while a mouse points at it, and while it is open: a click or a tap on
	 * it opens and closes it (`open:<species>`, `state/team.svelte.ts`). A
	 * card of one animal is that animal's key instead (`bundle:<species>`),
	 * and an animal beside an open card is its own (`animal:<id>`): either
	 * goes first. The number keys pick the first nine cards.
	 *
	 * A card is dragged up or down the column to another place: with a mouse
	 * as soon as it moves, with a finger after holding it still for a moment
	 * (moving first scrolls the column). Dropped, it is the key
	 * `move:<species>:<to>` (`input/press.ts`), which the explore controller
	 * sends as `move-species`; until the party comes back in its new order the
	 * cards stay where the drop left them. Every action is a key press, so a
	 * pointer goes through the same screen and guards a key does.
	 */
	const list = $derived(bundles(game.party));
	const leadId = $derived(game.party[leadIndex(game.party)]?.id ?? null);
	/** With one card there is nobody to choose between: no numbers, no tag, nothing to drag. */
	const choosing = $derived(list.length > 1);
	/** Some card holds several animals, which open to show them. */
	const stacks = $derived(list.some((b) => b.animals.length > 1));
	/** The number keys 1 to 9 reach the first nine cards. */
	const KEYS = 9;
	/** The cards' order, to see when a dropped card has landed. */
	const order = $derived(list.map((b) => b.speciesId).join());

	/** What a click or a tap on a card presses: open a stack, or choose its one animal. */
	function cardKey(bundle: Bundle): string | null {
		if (bundle.animals.length > 1) return openKey(bundle.speciesId);
		return choosing ? bundleKey(bundle.speciesId) : null;
	}

	// --- the open card ----------------------------------------------------------

	/** The stack a mouse points at, if any. */
	let hovered = $state<string | null>(null);
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	/** The stack whose animals show: the one opened, else the one pointed at; none while dragging. */
	const shown = $derived.by(() => {
		if (drag?.lifted) return null;
		const id = team.open ?? hovered;
		return list.find((b) => b.speciesId === id && b.animals.length > 1) ?? null;
	});

	function pointAt(e: PointerEvent, speciesId: string) {
		if (e.pointerType !== 'mouse' || drag) return;
		clearTimeout(hideTimer);
		hovered = speciesId;
	}

	function pointAway(e: PointerEvent) {
		if (e.pointerType !== 'mouse') return;
		clearTimeout(hideTimer);
		// Time for the pointer to cross the gap to the animals beside the card.
		hideTimer = setTimeout(() => (hovered = null), 160);
	}

	function pointAtAnimals(e: PointerEvent) {
		if (e.pointerType === 'mouse') clearTimeout(hideTimer);
	}

	let root = $state<HTMLElement>();
	let column = $state<HTMLElement>();
	/** Where the open card's animals stand, beside the column, top-aligned with the card. */
	let fanAt = $state<{ top: number; left: number; height: number } | null>(null);

	function placeAnimals(): void {
		const card = shown && column?.querySelector<HTMLElement>(`[data-species="${shown.speciesId}"]`);
		if (!card || !root || !column) {
			fanAt = null;
			return;
		}
		const base = root.getBoundingClientRect();
		const box = card.getBoundingClientRect();
		// Clear of the message line at the bottom of the screen.
		const bottom = window.innerHeight - 84;
		// Beside the card when there is room for a few rows below it, else as low as fits.
		const want = Math.min(bottom - 16, 280);
		const top = bottom - box.top >= want ? box.top : bottom - want;
		fanAt = {
			top: top - base.top,
			left: column.getBoundingClientRect().right - base.left + 4,
			height: bottom - top
		};
	}

	$effect(() => {
		void shown;
		void order;
		void touch.on;
		placeAnimals();
	});

	// The HUD leaves the screen (a battle, the doctor, the menu): an open card closes.
	$effect(() => () => {
		team.close();
		clearTimeout(hideTimer);
		clearTimeout(holdTimer);
		clearTimeout(dropTimer);
	});

	// --- dragging a card --------------------------------------------------------

	/** A mouse lifts a card once it has moved this far up or down. */
	const LIFT_PX = 8;
	/** A finger lifts a card after holding it this still for this long. */
	const HOLD_MS = 350;
	/** A finger that moves further than this first is scrolling the column. */
	const HOLD_SLOP_PX = 10;
	/** Within this far of the column's top or bottom, a lifted card scrolls it. */
	const EDGE_PX = 40;

	interface Drag {
		speciesId: string;
		pointerId: number;
		mouse: boolean;
		/** The card's place when it was picked up. */
		from: number;
		/** The cards' order then: a drag only draws over the column it was measured on. */
		order: string;
		startY: number;
		y: number;
		lifted: boolean;
		/** Dropped at `to`, waiting for the party to come back in that order. */
		dropped: boolean;
		to: number;
		startScroll: number;
		scroll: number;
		/** Each card's top in the column, and its height, when the card was lifted. */
		tops: number[];
		heights: number[];
		gap: number;
	}
	let drag = $state<Drag | null>(null);
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let dropTimer: ReturnType<typeof setTimeout> | undefined;

	function pickUp(e: PointerEvent, from: number, speciesId: string) {
		if (!choosing || e.button !== 0 || drag) return;
		drag = {
			speciesId,
			pointerId: e.pointerId,
			mouse: e.pointerType === 'mouse',
			from,
			order,
			startY: e.clientY,
			y: e.clientY,
			lifted: false,
			dropped: false,
			to: from,
			startScroll: 0,
			scroll: 0,
			tops: [],
			heights: [],
			gap: 0
		};
		if (!drag.mouse) holdTimer = setTimeout(lift, HOLD_MS);
	}

	function lift() {
		if (!drag || drag.lifted || !column) return;
		const cards = [...column.querySelectorAll<HTMLElement>('.bundle')];
		drag.tops = cards.map((c) => c.offsetTop);
		drag.heights = cards.map((c) => c.offsetHeight);
		drag.gap = cards.length > 1 ? drag.tops[1]! - drag.tops[0]! - drag.heights[0]! : 0;
		drag.startScroll = drag.scroll = column.scrollTop;
		drag.lifted = true;
		hovered = null;
	}

	function drift(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId || drag.dropped) return;
		drag.y = e.clientY;
		if (!drag.lifted) {
			const moved = Math.abs(e.clientY - drag.startY);
			if (drag.mouse && moved > LIFT_PX) lift();
			else if (!drag.mouse && moved > HOLD_SLOP_PX) letGo();
			return;
		}
		// Near the column's top or bottom, the column scrolls under the card.
		if (column) {
			const box = column.getBoundingClientRect();
			if (e.clientY < box.top + EDGE_PX) column.scrollTop -= 8;
			else if (e.clientY > box.bottom - EDGE_PX) column.scrollTop += 8;
			drag.scroll = column.scrollTop;
		}
	}

	function drop(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId || drag.dropped) return;
		clearTimeout(holdTimer);
		const to = drag.lifted ? landing(drag) : drag.from;
		if (to === drag.from || order !== drag.order) {
			drag = null;
			return;
		}
		drag.dropped = true;
		drag.to = to;
		press(moveKey(drag.speciesId, to));
		// The party comes back in its new order on the next frame; should nothing come, let go.
		dropTimer = setTimeout(() => (drag = null), 600);
	}

	function letGo() {
		clearTimeout(holdTimer);
		drag = null;
	}

	/** The place a lifted card would land on: among the others, by where its middle is. */
	function landing(d: Drag): number {
		const middle = d.tops[d.from]! + d.heights[d.from]! / 2 + lifted(d);
		let to = 0;
		for (let k = 0; k < d.tops.length; k++) {
			if (k !== d.from && d.tops[k]! + d.heights[k]! / 2 < middle) to++;
		}
		return to;
	}

	/**
	 * How far the lifted card has been carried, the column's scroll included,
	 * and never past the first card's top or the last card's bottom, where the
	 * column would cut it off.
	 */
	function lifted(d: Drag): number {
		const last = d.tops.length - 1;
		const least = d.tops[0]! - d.tops[d.from]!;
		const most = d.tops[last]! + d.heights[last]! - (d.tops[d.from]! + d.heights[d.from]!);
		return Math.min(most, Math.max(least, d.y - d.startY + (d.scroll - d.startScroll)));
	}

	/** How far card `k` is drawn from its place while a card is lifted or dropped. */
	function shift(k: number): number {
		const d = drag;
		if (!d?.lifted || order !== d.order) return 0;
		const to = d.dropped ? d.to : landing(d);
		if (k === d.from) {
			if (!d.dropped) return lifted(d);
			// Dropped: into its new place, where the party will put it.
			let at = 0;
			for (let j = Math.min(d.from, to); j <= Math.max(d.from, to); j++) {
				if (j !== d.from) at += (d.heights[j]! + d.gap) * (to > d.from ? 1 : -1);
			}
			return at;
		}
		const room = d.heights[d.from]! + d.gap;
		if (d.from < to && k > d.from && k <= to) return -room;
		if (to < d.from && k >= to && k < d.from) return room;
		return 0;
	}

	// The party came back in another order: the drop has landed, and the column is itself again.
	$effect(() => {
		void order;
		untrack(() => {
			if (drag?.dropped) {
				clearTimeout(dropTimer);
				drag = null;
			}
		});
	});

	/**
	 * While a card is lifted a finger moves it, not the column: the column
	 * would scroll otherwise (`touch-action: pan-y`), and the browser would
	 * take the finger away from the card.
	 */
	function holdStill(node: HTMLElement) {
		const still = (e: TouchEvent) => {
			if (drag?.lifted && e.cancelable) e.preventDefault();
		};
		node.addEventListener('touchmove', still, { passive: false });
		return () => node.removeEventListener('touchmove', still);
	}
</script>

<div class="party" bind:this={root}>
	<div class="cards" bind:this={column} onscroll={placeAnimals} {@attach holdStill}>
		{#each list as bundle, i (bundle.speciesId)}
			{@const carried = drag?.lifted && drag.speciesId === bundle.speciesId}
			<BundleCard
				animals={bundle.animals}
				{leadId}
				showLead={choosing}
				keyCap={choosing && i < KEYS ? String(i + 1) : null}
				press={carried ? 'drag' : cardKey(bundle)}
				open={shown?.speciesId === bundle.speciesId}
				class={carried ? (drag?.dropped ? 'carried dropped' : 'carried') : 'still'}
				style="transform: translateY({shift(i)}px)"
				data-species={bundle.speciesId}
				onpointerdown={(e: PointerEvent) => pickUp(e, i, bundle.speciesId)}
				onpointermove={drift}
				onpointerup={drop}
				onpointercancel={letGo}
				onpointerenter={(e: PointerEvent) => pointAt(e, bundle.speciesId)}
				onpointerleave={pointAway}
			/>
		{/each}
	</div>
	{#if touch.on}
		{#if stacks || choosing}
			<div class="keys">
				<span>{stacks ? t('hud.openTouch') : t('hud.pickLeadTouch')}</span>
				{#if choosing}<span class="quiet">{t('hud.dragTouch')}</span>{/if}
			</div>
		{/if}
	{:else}
		<div class="keys">
			{#if choosing}
				<span><kbd>1</kbd>–<kbd>{Math.min(list.length, KEYS)}</kbd> {t('hud.pickLead')}</span>
			{/if}
			<button type="button" class="esc" data-press="Escape" {@attach unfocusable}>
				<kbd>{t('keys.esc')}</kbd>
				{t('hud.menu')}
			</button>
			{#if choosing}<span class="quiet">{t('hud.dragMouse')}</span>{/if}
		</div>
	{/if}
	{#if shown && fanAt}
		<!-- The open card's animals, beside the column, outside its scroll. -->
		<div
			class="fan"
			role="group"
			class:still={motion.reduced}
			style="top: {fanAt.top}px; left: {fanAt.left}px; max-height: {fanAt.height}px"
			onpointerenter={pointAtAnimals}
			onpointerleave={pointAway}
			transition:fade={{ duration: motion.reduced ? 0 : 120 }}
		>
			<BundleAnimals
				animals={shown.animals}
				leadId={game.party.length > 1 ? leadId : null}
				press={(animal) => animalKey(animal.id)}
				class="fan-list"
			/>
		</div>
	{/if}
</div>

<!-- The message line: the latest message while it is fresh, then the doctor
     prompt or the controls hint (see `state/hud.svelte.ts`). -->
{#if hud.message || hud.hint}
	<div class="hint" transition:fade={{ duration: 400 }}>
		{#if hud.message}
			<div class="message" transition:fade={{ duration: 400 }}>{hud.message}</div>
		{/if}
		{#if hud.hint}
			<div class="prompt">{hud.hint}</div>
		{/if}
	</div>
{/if}

<svelte:window onresize={placeAnimals} />

<style>
	.party {
		position: absolute;
		top: 16px;
		left: 16px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		max-height: calc(100vh - 32px);
	}
	/* With the touch controls on, the column stops above the D-pad in the bottom-left corner. */
	:global(.touch) .party {
		max-height: calc(100vh - 16px - 20px - var(--tap) * 4 - 16px);
	}
	/*
	 * The cards, as wide as the widest of them needs, all the same; the column
	 * scrolls when it is taller than the screen allows. Its padding keeps the
	 * cards' shadows, the lead's ring and a stack's cards behind it inside the
	 * scroll box, which would cut them off.
	 */
	.cards {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 8px;
		min-height: 0;
		flex: 0 1 auto;
		overflow-y: auto;
		overscroll-behavior: contain;
		/* The one thing a finger may scroll in explore: the column, when it is long. */
		touch-action: pan-y;
		scrollbar-width: thin;
		padding: 4px 16px 14px 4px;
		margin: -4px -16px -14px -4px;
	}
	/* A card keeps its height: the column scrolls rather than squeeze them. */
	.cards :global(.bundle) {
		flex: none;
	}
	.cards :global(.bundle.still) {
		transition: transform 0.16s ease-out;
	}
	:global(.touch) .cards :global(.bundle) {
		min-height: var(--tap);
	}
	/* The card being carried: above the others, and lifted a little. */
	.cards :global(.bundle.carried) {
		z-index: 2;
		cursor: grabbing;
		box-shadow:
			0 10px 24px rgba(45, 42, 50, 0.28),
			var(--hud-shadow);
	}
	.cards :global(.bundle.dropped) {
		transition: transform 0.12s ease-out;
	}
	@media (hover: hover) and (pointer: fine) {
		.cards :global(button.bundle.still) {
			cursor: grab;
		}
		.esc:hover {
			text-decoration: underline;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.cards :global(.bundle.still),
		.cards :global(.bundle.dropped) {
			transition: none;
		}
	}
	.esc {
		display: flex;
		align-items: center;
		gap: 4px;
		font-weight: 800;
	}
	.keys {
		display: flex;
		flex: none;
		flex-direction: column;
		gap: 4px;
		max-width: 320px;
		box-sizing: border-box;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 6px 12px 6px 8px;
		font-weight: 800;
		font-size: 16px;
	}
	.quiet {
		font-weight: 600;
		opacity: 0.75;
	}
	kbd {
		display: inline-block;
		min-width: 12px;
		font-family: inherit;
		font-size: 16px;
		line-height: 1.3;
		text-align: center;
		padding: 0 6px;
		border-radius: 7px;
		background: rgba(0, 0, 0, 0.1);
		box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.12);
	}
	/* An open card's animals: a card of their own beside the column, scrolling when long. */
	.fan {
		position: absolute;
		display: flex;
		flex-direction: column;
		width: max-content;
		min-width: 300px;
		/* As wide as a name of twelve of the widest letters needs beside its bar and tag, when there is room. */
		max-width: calc(100vw - 340px);
		box-sizing: border-box;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 6px;
		z-index: 3;
	}
	.fan :global(.fan-list) {
		min-height: 0;
	}
	.hint {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		width: max-content;
		max-width: calc(100vw - 32px);
		box-sizing: border-box;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 8px 16px;
		font-weight: 600;
		text-align: center;
	}
	.prompt {
		font-weight: 800;
	}
	/* With the touch controls on, the line stays between the D-pad and the buttons. */
	:global(.touch) .hint {
		max-width: calc(100vw - 2 * (20px + var(--tap) * 4 + 20px));
	}
	.message + .prompt {
		margin-top: 2px;
	}
</style>
